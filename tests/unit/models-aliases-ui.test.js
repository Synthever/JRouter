import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { getModelsAliasById } from "@/lib/db/repos/modelsAliasesRepo.js";
import { POST as createAlias } from "@/app/api/models-aliases/route.js";
import { invalidateModelsAliasRuntime } from "@/sse/services/modelsAliasRuntime.js";
const database = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => database.db }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => true }));
import * as config from "@/lib/modelsAliases/config.js";
import * as prompt from "@/lib/comboPromptInjection.js";

const require = createRequire(new URL("../../package.json", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const route = `${root}/src/app/(dashboard)/dashboard/models-aliases`;
const catalog = { visibleGroups: {}, searchQuery: "", setSearchQuery: vi.fn(), loading: false, error: "", reload: vi.fn() };
function mount(name, props = {}) {
  let cursor = 0; let tree; let mounted = false; let rendering = false; let rerender; const values = []; const effects = [];
  const hooks = { ...React, useId: () => "test-id", useState: initial => {
    const i = cursor++; if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial;
    return [values[i], value => { values[i] = typeof value === "function" ? value(values[i]) : value; if (mounted && !rendering) rerender(); }];
  }, useRef: initial => { const i = cursor++; return values[i] ||= { current: initial }; },
  useEffect: (fn, deps) => { const i = cursor++; const previous = values[i];
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) { previous?.cleanup?.(); values[i] = { deps }; effects.push(() => { values[i].cleanup = fn(); }); }
  }, useCallback: fn => fn, useMemo: fn => fn() };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), {
      filename, presets: [require.resolve("next/babel")], babelrc: false, configFile: false, caller: { name: "test", supportsStaticESM: false },
    }).code;
    const compiled = new Module(filename); compiled.paths = Module._nodeModulePaths(root); cache.set(filename, compiled.exports);
    compiled.require = specifier => {
      if (specifier === "react") return hooks;
      if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (specifier.endsWith("/config.js")) return config;
      if (specifier.endsWith("comboPromptInjection.js")) return prompt;
      if (specifier.endsWith("useModelCatalog")) return { useModelCatalog: options => { catalog.options = options; return catalog; } };
      if (specifier.endsWith("ModelPickerList")) return { default: p => React.createElement("picker", p), __esModule: true };
      if (specifier.endsWith("Modal")) return { default: p => React.createElement("dialog", p, p.children, p.footer), __esModule: true };
      if (specifier.endsWith("Icon")) return { default: () => null, __esModule: true };
      if (specifier.startsWith("@/")) return load(`${root}/src/${specifier.slice(2)}${specifier.endsWith(".js") ? "" : ".js"}`);
      if (specifier.startsWith(".")) return load(new URL(`${specifier}${specifier.endsWith(".js") ? "" : ".js"}`, `file://${filename}`).pathname);
      return require(specifier);
    };
    compiled._compile(code, filename); cache.set(filename, compiled.exports); return compiled.exports;
  }
  const Component = load(`${route}/${name}.js`).default;
  const render = () => { cursor = 0; rendering = true; tree = Component(props); rendering = false; };
  rerender = render;
  render(); mounted = true;
  return { render, nodes: () => nodes(tree), flush: async () => { effects.splice(0).forEach(fn => fn()); for (let i = 0; i < 12; i++) await Promise.resolve(); render(); }, unmount: () => { mounted = false; values.forEach(value => value?.cleanup?.()); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
const content = value => Array.isArray(value) ? value.map(content).join("") : typeof value === "string" ? value : "";
const button = (h, label) => h.nodes().find(node => node.type === "button" && (node.props["aria-label"] === label || content(node.props.children) === label));
const field = (h, id) => h.nodes().find(node => node.props.id === id && ["input", "select", "textarea"].includes(node.type));
const alias = { id: "id/Case", name: "Nested/Case", models: ["openai/gpt-4o", "cbai/flash"], primaryModel: "openai/gpt-4o", strategy: "fusion", judgeModel: null, initialResponseTimeoutSeconds: 15 };
afterEach(() => vi.unstubAllGlobals());

describe("compiled Models Aliases controls", () => {
  it("never renders raw rejected transport messages that resemble safe feedback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Session expired. private credential")));
    const h = mount("components/ModelAliasFormModal", { alias, onSaved: vi.fn(), onClose: vi.fn() });
    await h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); h.render();
    expect(JSON.stringify(h.nodes())).not.toContain("private credential"); h.unmount();
  });
  it("persists an actual form Save through the real CRUD route and SQLite repository", async () => {
    const events = ["beforeExit", "SIGINT", "SIGTERM"];
    const listeners = new Map(events.map(event => [event, new Set(process.listeners(event))]));
    database.db = await createNodeSqliteAdapter(":memory:");
    const added = events.flatMap(event => process.listeners(event).filter(listener => !listeners.get(event).has(listener)).map(listener => [event, listener]));
    let saved;
    try {
      for (const [name, table] of Object.entries(TABLES)) database.db.exec(buildCreateTableSql(name, table));
      database.db.run("INSERT INTO settings(id,data) VALUES(1,?)", [JSON.stringify({ requireLogin: true })]);
      database.db.run("INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", ["fixture", "openai", "apikey", JSON.stringify({ apiKey: "synthetic-only" }), "fixture", "fixture"]);
      vi.stubGlobal("fetch", (url, options) => createAlias(new Request(`http://fixture${url}`, { ...options, headers: { ...options.headers, cookie: "auth_token=fixture" } })));
      const h = mount("components/ModelAliasFormModal", { onSaved: row => { saved = row; }, onClose: vi.fn() });
      field(h, "alias-name").props.onChange({ target: { value: "UI/Nested" } }); h.render();
      const member = h.nodes().find(node => node.type === "picker"); member.props.onSelect({ value: "openai/gpt-4o" }); h.render();
      field(h, "alias-primary").props.onChange({ target: { value: "openai/gpt-4o" } }); h.render();
      await h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
      expect(saved).toMatchObject({ name: "UI/Nested", primaryModel: "openai/gpt-4o" });
      expect(await getModelsAliasById(saved.id)).toEqual(saved);
      expect(database.db.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
      h.unmount();
    } finally {
      if (saved) invalidateModelsAliasRuntime(saved.id);
      database.db.close(); database.db = null;
      for (const [event, listener] of added) process.removeListener(event, listener);
    }
  });
  it("submits one normalized boundary and preserves the full draft on rejected save", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"error":"private token"}', { status: 500 })); vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn(); const h = mount("components/ModelAliasFormModal", { alias, onSaved, onClose: vi.fn() });
    field(h, "alias-name").props.onChange({ target: { value: "New/Nested" } }); h.render();
    field(h, "alias-deadline").props.onChange({ target: { value: "15.25" } }); h.render();
    const form = h.nodes().find(node => node.type === "form"); await form.props.onSubmit({ preventDefault() {} }); h.render();
    expect(fetcher.mock.calls[0][0]).toBe("/api/models-aliases/id%2FCase");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ name: "New/Nested", initialResponseTimeoutSeconds: 15.25, judgeModel: null });
    expect(field(h, "alias-name").props.value).toBe("New/Nested"); expect(field(h, "alias-deadline").props.value).toBe("15.25");
    expect(onSaved).not.toHaveBeenCalled(); expect(JSON.stringify(h.nodes())).not.toContain("private token");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ...alias, name: "Server/Saved" })));
    await h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Server/Saved" })); h.unmount();
  });
  it("uploads locally, strips BOM, clears repeated input, and preserves prompt on read failure", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const h = mount("components/ModelAliasFormModal", { alias, onSaved: vi.fn(), onClose: vi.fn() });
    const input = h.nodes().find(node => node.props.type === "file");
    const target = { files: [{ text: async () => "\uFEFFpersona\r\nλ" }], value: "file" };
    await input.props.onChange({ target }); h.render();
    expect(target.value).toBe(""); expect(field(h, "alias-prompt").props.value).toBe("persona\r\nλ");
    target.value = "file"; target.files = [{ text: async () => { throw new Error("secret"); } }];
    await input.props.onChange({ target }); h.render();
    expect(target.value).toBe(""); expect(field(h, "alias-prompt").props.value).toBe("persona\r\nλ");
    expect(fetcher).not.toHaveBeenCalled(); h.unmount();
  });
  it("uses inline member context, preserves invalid primary, and invokes real reorder/remove callbacks", () => {
    let draft = { ...alias, models: [...alias.models, "cp/Third"] }; const onChange = value => { draft = value; };
    const h = mount("components/ModelAliasMembers", { draft, onChange, providerMetadata: { cbai: { outputObservability: "buffered" } }, activeProviders: [], modelAliases: {} });
    expect(catalog.options).toMatchObject({ catalogContext: "members", excludePlaceholders: true, includeLegacyCombos: false });
    button(h, "Move cp/Third up").props.onClick(); expect(draft.models).toEqual(["openai/gpt-4o", "cp/Third", "cbai/flash"]);
    button(h, "Remove openai/gpt-4o").props.onClick(); expect(draft.primaryModel).toBe("openai/gpt-4o");
    expect(draft.models).not.toContain("openai/gpt-4o");
    expect(JSON.stringify(h.nodes())).toContain("complete observable answer"); h.unmount();
  });
  it("does not show empty catalog on failed page load and retries an acknowledged catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 500 })); vi.stubGlobal("fetch", fetcher);
    const h = mount("page"); await h.flush();
    expect(JSON.stringify(h.nodes())).toContain("Unable to load Models Aliases"); expect(JSON.stringify(h.nodes())).not.toContain("No aliases configured");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ aliases: [], providerMetadata: {} })));
    button(h, "Retry").props.onClick(); h.render(); await h.flush();
    expect(JSON.stringify(h.nodes())).toContain("No aliases configured"); h.unmount();
  });
  it("reads the real provider connection DTO before enabling configured member selection", async () => {
    const fetcher = vi.fn(async url => url === "/api/providers"
      ? new Response(JSON.stringify({ connections: [{ provider: "openai", isActive: true }] }))
      : new Response(JSON.stringify({ aliases: {} })));
    vi.stubGlobal("fetch", fetcher);
    const h = mount("components/ModelAliasFormModal", { alias, onSaved: vi.fn(), onClose: vi.fn() });
    await h.flush();
    h.nodes();
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(["/api/models/alias", "/api/providers"]);
    expect(catalog.options.activeProviders).toEqual([{ provider: "openai", isActive: true }]);
    expect(catalog.options.modelAliases).toEqual({});
    expect(h.nodes().find(node => node.type === "picker").props.loading).toBe(false);
    h.unmount();
  });
  it("keeps confirmation open until an in-flight delete is acknowledged", async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise(r => { resolve = r; })); vi.stubGlobal("fetch", fetcher);
    const deleted = vi.fn(); const h = mount("components/ModelAliasRow", { alias, onEdit: vi.fn(), onDeleted: deleted });
    button(h, "Delete Nested/Case").props.onClick(); h.render();
    const pending = button(h, "Delete alias").props.onClick(); h.render();
    const modal = h.nodes().find(node => node.type === "dialog");
    expect(modal.props.closeOnOverlay).toBe(false);
    expect(button(h, "Cancel").props.disabled).toBe(true);
    modal.props.onClose(); h.render();
    expect(h.nodes().some(node => node.type === "dialog")).toBe(true);
    expect(deleted).not.toHaveBeenCalled();
    resolve(new Response("{}")); await pending; h.render();
    expect(deleted).toHaveBeenCalledWith(alias.id);
    expect(h.nodes().some(node => node.type === "dialog")).toBe(true);
    h.unmount();
  });
  it("reports copied only after clipboard acknowledgement and leaves delete row intact on failure", async () => {
    let resolve; vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise(r => { resolve = r; })) } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const deleted = vi.fn(); const h = mount("components/ModelAliasRow", { alias, onEdit: vi.fn(), onDeleted: deleted });
    const pending = button(h, "Copy public ID").props.onClick(); h.render(); expect(JSON.stringify(h.nodes())).not.toContain('"Copied"');
    resolve(); await pending; h.render(); expect(JSON.stringify(h.nodes())).toContain('"Copied"');
    button(h, "Delete Nested/Case").props.onClick(); h.render(); button(h, "Cancel").props.onClick(); h.render();
    expect(fetch).not.toHaveBeenCalled();
    button(h, "Delete Nested/Case").props.onClick(); h.render(); await button(h, "Delete alias").props.onClick(); h.render();
    expect(deleted).not.toHaveBeenCalled(); expect(JSON.stringify(h.nodes())).toContain("Unable to delete"); h.unmount();
  });
});

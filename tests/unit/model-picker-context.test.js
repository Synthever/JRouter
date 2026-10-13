import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { selectContextCatalog, normalizePublicCatalog } from "@/shared/utils/modelCatalogContext";
import { CAPACITY_META } from "@/shared/constants/models";

const fixture = vi.hoisted(() => ({ db: null, session: false }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => fixture.db }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => fixture.session }));
import { createModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { createCombo, getComboById, getCombos } from "@/lib/db/repos/combosRepo.js";
import { GET as dashboardCatalog } from "@/app/api/models/public/route.js";
import { buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";
import { resolvePublicLlmTarget, resolveConfiguredLlmLeaves } from "@/sse/services/publicLlmTarget.js";

const require = createRequire(new URL("../../package.json", import.meta.url));
const capsOptions = [];
let catalogOptions;
let suppliedCatalog;
function loadComponent(name) {
  const filename = fileURLToPath(new URL(`../../src/shared/components/${name}.js`, import.meta.url));
  const { code } = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), {
    filename, presets: [require.resolve("next/babel")], babelrc: false, configFile: false,
    caller: { name: "test", supportsStaticESM: false },
  });
  const compiled = new Module(filename);
  compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../..", import.meta.url)));
  compiled.require = specifier => {
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (specifier.endsWith("constants/models")) return { CAPACITY_META };
    if (specifier.endsWith("useModelCaps")) return { useModelCaps: options => {
      capsOptions.push(options); return { getCaps: () => ({ vision: true, tools: true }) };
    } };
    if (specifier.endsWith("useModelCatalog")) return { useModelCatalog: options => { catalogOptions = options; return suppliedCatalog; } };
    if (specifier === "./ModelPickerList") return { default: loadComponent("ModelPickerList"), __esModule: true };
    if (specifier === "./Modal") return { default: props => createElement("dialog", props, props.children), __esModule: true };
    if (specifier.endsWith("CapacityBadges")) return { default: props => createElement("capacity-badges", props), __esModule: true };
    if (specifier.endsWith("Icon") || specifier.endsWith("ProviderIcon")) return { default: props => createElement("i", props, props.children), __esModule: true };
    return require(specifier);
  };
  compiled._compile(code, filename);
  return compiled.exports.default;
}
function nodes(tree) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
const optionsIn = tree => nodes(tree).filter(node => node.props?.["data-model-option"] !== undefined);
const virtualRecords = [
  { id: "jrouter/Nested/Case", name: "Nested/Case", kind: "llm", targetType: "alias", capabilities: { vision: false, tools: true } },
  { id: "jrouter/Main", name: "Main", kind: "llm", targetType: "combo", capabilities: { vision: true } },
];

beforeEach(() => { capsOptions.length = 0; });

describe("compiled shared picker callbacks", () => {
  it("opts the standalone picker into existing focus containment and a real close control", () => {
    suppliedCatalog = { visibleGroups: {}, filteredAliases: [], filteredCombos: [], searchQuery: "", setSearchQuery: vi.fn(), loading: false, error: "", reload: vi.fn() };
    const tree = loadComponent("ModelSelectModal")({ isOpen: true, onSelect: vi.fn(), onClose: vi.fn() });
    expect(tree.props.trapFocus).toBe(true);
    expect(tree.props.showTrafficLights).toBe(false);
    expect(tree.props.className).toContain("dialog");
  });
  it("selects canonical aliases and Combos with full-value selected state and server caps only", () => {
    const entries = normalizePublicCatalog({ models: virtualRecords });
    const onSelect = vi.fn();
    const tree = loadComponent("ModelPickerList")({ aliases: [entries[0]], combos: [entries[1]], groups: {},
      selectedModel: entries[0].value, addedModelValues: [entries[1].value], onSelect, showSearch: false });
    const buttons = optionsIn(tree);
    expect(buttons).toHaveLength(2);
    expect(buttons.map(button => button.props["aria-pressed"])).toEqual([true, true]);
    buttons.forEach(button => button.props.onClick());
    expect(onSelect.mock.calls[0]).toMatchObject([{ value: "jrouter/Nested/Case" }, { isAlias: true, isCombo: false, targetType: "alias" }]);
    expect(onSelect.mock.calls[1]).toMatchObject([{ value: "jrouter/Main" }, { isCombo: true, isAlias: false, targetType: "combo" }]);
    expect(capsOptions).toEqual([{ enabled: false }]);
    expect(nodes(tree).filter(node => node.props?.className === "capability").map(node => node.props.children)).toEqual(["Vision"]);
    expect(nodes(tree).some(node => node.type === "capacity-badges")).toBe(false);
    const unknown = loadComponent("ModelPickerList")({ aliases: [{ id: "jrouter/gpt-4o", value: "jrouter/gpt-4o", name: "gpt-4o", targetType: "alias" }], onSelect });
    expect(nodes(unknown).some(node => node.props?.className === "capability" || node.type === "capacity-badges")).toBe(false);
  });

  it("preserves genuinely legacy bare Combo callbacks and enables caps only for actual provider rows", () => {
    const onSelect = vi.fn();
    const tree = loadComponent("ModelPickerList")({ combos: [{ id: "storage-uuid", name: "Inner" }],
      groups: { cp: { name: "Custom", models: [{ id: "Nested/Case", value: "cp/Nested/Case", name: "Nested/Case" }] } }, onSelect });
    optionsIn(tree)[0].props.onClick();
    expect(onSelect.mock.calls[0][0].value).toBe("Inner");
    expect(capsOptions).toEqual([{ enabled: true }]);
  });

  it("defaults empty collections, announces loading and error, and invokes Retry", () => {
    const List = loadComponent("ModelPickerList");
    const onRetry = vi.fn();
    expect(nodes(List({ onSelect: vi.fn(), showSearch: false })).some(node => node.props?.children === "No models found")).toBe(true);
    const loading = nodes(List({ onSelect: vi.fn(), loading: true, showSearch: false }));
    expect(loading.some(node => node.props?.role === "status" && node.props.children === "Loading models..." )).toBe(true);
    expect(loading.some(node => node.props?.children === "No models found")).toBe(false);
    const error = nodes(List({ onSelect: vi.fn(), error: "Unable to load models.", onRetry, showSearch: false }));
    expect(error.some(node => node.props?.role === "alert")).toBe(true);
    error.find(node => node.type === "button" && node.props.children === "Retry").props.onClick();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("propagates context and retry through the modal and deselects full canonical values without closing", () => {
    const entries = normalizePublicCatalog({ models: virtualRecords });
    const setSearchQuery = vi.fn(); const reload = vi.fn();
    suppliedCatalog = { visibleGroups: {}, filteredAliases: [entries[0]], filteredCombos: [entries[1]], searchQuery: "", setSearchQuery, loading: false, error: "", reload };
    const onSelect = vi.fn(); const onDeselect = vi.fn(); const onClose = vi.fn();
    const tree = loadComponent("ModelSelectModal")({ isOpen: true, onSelect, onDeselect, onClose,
      catalogContext: "key-allow", includeLegacyCombos: false, excludePlaceholders: true, addedModelValues: [entries[0].value], closeOnSelect: false });
    expect(catalogOptions).toMatchObject({ catalogContext: "key-allow", includeLegacyCombos: false, excludePlaceholders: true });
    const buttons = optionsIn(tree); buttons[0].props.onClick(); buttons[1].props.onClick();
    expect(onDeselect.mock.calls[0][0]).toMatchObject({ value: entries[0].value, isAlias: true, isCombo: false, targetType: "alias" });
    expect(onSelect.mock.calls[0][0]).toMatchObject({ value: entries[1].value, isAlias: false, isCombo: true, targetType: "combo" });
    expect(onClose).not.toHaveBeenCalled();
    suppliedCatalog.error = "Unable to load models.";
    const failed = nodes(loadComponent("ModelSelectModal")({ isOpen: true, onSelect, onClose }));
    failed.find(node => node.type === "button" && node.props.children === "Retry").props.onClick();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("dashboard descriptor and nested Combo persistence", () => {
  beforeEach(async () => {
    fixture.db = await createNodeSqliteAdapter(":memory:");
    for (const [name, table] of Object.entries(TABLES)) fixture.db.exec(buildCreateTableSql(name, table));
    fixture.db.run("INSERT INTO settings(id,data) VALUES(1,?)", [JSON.stringify({ requireLogin: true })]);
    fixture.db.run("INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", ["connection", "openai", "apikey", JSON.stringify({ apiKey: "private-account-token" }), "fixture", "fixture"]);
    fixture.session = true;
  });
  afterEach(() => { fixture.db.close(); fixture.session = false; });

  it("adds only name/targetType to authenticated dashboard entries, preserving exact native entries", async () => {
    await createModelsAlias({ name: "Nested/Case", models: ["openai/gpt-4o"], primaryModel: "openai/gpt-4o", systemPrompt: "private prompt" });
    await createCombo({ name: "Old Combo:free", models: ["openai/gpt-4o"] });
    const native = await buildPublicLlmModelsList();
    fixture.session = false;
    expect((await dashboardCatalog(new Request("http://fixture.test/api/models/public"))).status).toBe(401);
    fixture.session = true;
    const transport = vi.fn(() => { throw new Error("Unexpected provider request"); });
    vi.stubGlobal("fetch", transport);
    try {
      const dashboard = await (await dashboardCatalog(new Request("http://fixture.test/api/models/public", { headers: { cookie: "auth_token=fixture" } }))).json();
      expect(dashboard.models.map(({ name, targetType }) => ({ name, targetType }))).toEqual([
        { name: "Nested/Case", targetType: "alias" }, { name: "Old Combo:free", targetType: "combo" },
      ]);
      expect(dashboard.models.map(({ name, targetType, ...entry }) => entry)).toEqual(native);
      expect(await buildPublicLlmModelsList()).toEqual(native);
      expect(JSON.stringify(dashboard)).not.toMatch(/private-account-token|private prompt|primaryModel|models":\["openai/);
      expect(transport).not.toHaveBeenCalled();
      expect(fixture.db.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it("saves the actual picker-selected bare Inner, reloads it, and expands through the real nested resolver", async () => {
    await createCombo({ name: "Inner", models: ["openai/gpt-4o"] });
    const catalog = selectContextCatalog({ catalogContext: "members", includeLegacyCombos: true, combos: await getCombos() });
    let selection;
    const tree = loadComponent("ModelPickerList")({ combos: catalog.combos, onSelect: model => { selection = model; }, showSearch: false });
    optionsIn(tree)[0].props.onClick();
    const saved = await createCombo({ name: "Outer", models: [selection.value] });
    expect((await getComboById(saved.id)).models).toEqual(["Inner"]);
    const leaves = await resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("jrouter/Outer"));
    expect(leaves.map(member => member.canonicalId)).toEqual(["openai/gpt-4o"]);
  });
});

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("management picker annotations", () => {
  it("marks all five management sites before invocation becomes the default", () => {
    const combo = read("src/app/(dashboard)/dashboard/combos/page.js");
    const sites = combo.match(/<ModelSelectModal[\s\S]*?\/>/g);
    expect(sites).toHaveLength(3);
    for (const site of sites) expect(site).toContain('catalogContext="members"');
    expect(sites[0]).toContain("includeLegacyCombos");
    expect(sites[1]).not.toContain("includeLegacyCombos");
    expect(sites[2]).toContain("includeLegacyCombos");
    expect(read("src/shared/components/ComboFormModal.js")).toContain('catalogContext={kindFilter && kindFilter !== "llm" ? "media" : "members"}');
    expect(read("src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js")).toContain('catalogContext="media"');
  });
});

import { existsSync, readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as providers from "@/shared/constants/providers";
import * as models from "@/shared/constants/models";
import * as capabilities from "open-sse/providers/capabilities.js";

const require = createRequire(new URL("../../package.json", import.meta.url));

function hookHarness() {
  const cells = [];
  let index = 0;
  let effects = [];
  let value;
  let options;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const slot = index++;
      if (!cells[slot]) cells[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[slot].value, update => { cells[slot].value = typeof update === "function" ? update(cells[slot].value) : update; }];
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (same(cells[slot]?.deps, deps)) return;
      cells[slot]?.cleanup?.();
      cells[slot] = { deps };
      effects.push(() => { cells[slot].cleanup = effect(); });
    },
    useMemo(compute, deps) {
      const slot = index++;
      if (!same(cells[slot]?.deps, deps)) cells[slot] = { deps, value: compute() };
      return cells[slot].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  };
  const modules = new Map();
  function load(path) {
    const filename = fileURLToPath(new URL(`../../${path}`, import.meta.url));
    if (modules.has(filename)) return modules.get(filename);
    const { code } = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), {
      filename, presets: [require.resolve("next/babel")], babelrc: false, configFile: false,
      caller: { name: "test", supportsStaticESM: false },
    });
    const compiled = new Module(filename);
    compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../..", import.meta.url)));
    compiled.require = specifier => {
      if (specifier === "react") return react;
      if (specifier === "@/shared/constants/providers") return providers;
      if (specifier === "@/shared/constants/models") return models;
      if (specifier === "open-sse/providers/capabilities.js") return capabilities;
      if (specifier.startsWith("@/shared/hooks/")) return load(`src/${specifier.slice(2)}.js`);
      return require(specifier.startsWith("@/") ? fileURLToPath(new URL(`../../src/${specifier.slice(2)}${specifier.endsWith(".js") ? "" : ".js"}`, import.meta.url))
        : specifier.startsWith("open-sse/") ? fileURLToPath(new URL(`../../${specifier}`, import.meta.url)) : specifier);
    };
    compiled._compile(code, filename);
    modules.set(filename, compiled.exports);
    return compiled.exports;
  }
  const hook = load("src/shared/hooks/useModelCatalog.js").useModelCatalog;
  const capsHook = load("src/shared/hooks/useModelCaps.js").useModelCaps;
  return {
    render(next = options, capsOnly = false) {
      options = next; index = 0; effects = [];
      value = capsOnly ? capsHook(options) : hook(options);
      for (const effect of effects) effect();
      return value;
    },
    async settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); return this.render(); },
    snapshot() { return JSON.stringify(cells.map(cell => cell?.value)); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = models => ({ ok: true, json: async () => ({ models }) });

function environment(fetcher) {
  const listeners = new Map();
  const window = {
    addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
    removeEventListener: vi.fn(name => listeners.delete(name)),
  };
  vi.stubGlobal("window", window);
  vi.stubGlobal("fetch", fetcher);
  return window;
}

describe("actual catalog effect owners", () => {
  it.each(["invocation", "key-allow"])("%s reads only the public catalog, with no capability listeners", async catalogContext => {
    const fetcher = vi.fn(async () => response(records));
    const window = environment(fetcher);
    const harness = hookHarness();
    try {
      harness.render({ catalogContext, activeProviders: [{ id: "account", provider: "cursor" }] });
      const catalog = await harness.settle();
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/models/public"]);
      expect(window.addEventListener).not.toHaveBeenCalled();
      expect(catalog.groups).toEqual({});
      expect(catalog.filteredAliases[0].value).toBe(records[0].id);
      expect(catalog.filteredCombos[0].value).toBe(records[1].id);
      expect(catalog.loading).toBe(false);
      expect(catalog.error).toBe("");
    } finally { harness.unmount(); vi.unstubAllGlobals(); }
  });

  it.each(["network", "status", "malformed"])("shows %s failures and retries without provider substitution or selection mutation", async failure => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      if (++attempt > 1) return response(records);
      if (failure === "network") throw new Error("private-token");
      return failure === "status" ? { ok: false, status: 401 } : { ok: true, json: async () => ({ models: [{}] }) };
    });
    environment(fetcher);
    const harness = hookHarness();
    const selected = ["jrouter/Absent"];
    try {
      harness.render({ addedModelValues: selected });
      const failed = await harness.settle();
      expect(failed.error).toBe("Unable to load models. Retry to refresh the catalog.");
      expect(failed.loading).toBe(false);
      expect(failed.groups).toEqual({});
      expect(selected).toEqual(["jrouter/Absent"]);
      failed.reload(); harness.render();
      const retried = await harness.settle();
      expect(retried.error).toBe("");
      expect(retried.filteredAliases).toHaveLength(1);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/models/public", "/api/models/public"]);
    } finally { harness.unmount(); vi.unstubAllGlobals(); }
  });

  it("ignores stale public reads on reload, context change, close and unmount", async () => {
    const pending = [];
    const fetcher = vi.fn(url => {
      if (url === "/api/models/public") { const d = deferred(); pending.push(d); return d.promise; }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    environment(fetcher);
    const harness = hookHarness();
    try {
      harness.render({ catalogContext: "invocation" }); await harness.settle();
      harness.render().reload(); harness.render(); await harness.settle();
      pending[1].resolve(response(records));
      expect((await harness.settle()).filteredAliases).toHaveLength(1);
      pending[0].resolve(response([]));
      expect((await harness.settle()).filteredAliases).toHaveLength(1);
      harness.render({ catalogContext: "members" });
      expect((await harness.settle()).filteredAliases).toEqual([]);
      harness.render({ catalogContext: "invocation" }); await harness.settle();
      harness.render({ catalogContext: "invocation", isOpen: false });
      const closed = harness.snapshot();
      pending[2].resolve(response([])); await harness.settle();
      expect(harness.snapshot()).toBe(closed);
      harness.render({ catalogContext: "invocation" }); await harness.settle();
      const mounted = harness.snapshot();
      harness.unmount(); pending[3].resolve(response([]));
      await harness.settle();
      expect(harness.snapshot()).toBe(mounted);
    } finally { harness.unmount(); vi.unstubAllGlobals(); }
  });

  it("key-block fetches virtuals and management providers while media preserves provider-as-model IDs", async () => {
    const fetcher = vi.fn(async url => url === "/api/models/public" ? response(records) : { ok: true, json: async () => ({}) });
    environment(fetcher);
    const harness = hookHarness();
    try {
      harness.render({ catalogContext: "key-block", activeProviders: [{ provider: "openai" }] });
      const blocked = await harness.settle();
      expect(blocked.filteredAliases).toHaveLength(1);
      expect(blocked.groups.openai.models.some(model => model.value === "openai/gpt-4o")).toBe(true);
      expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(["/api/models", "/api/models/public", "/api/combos", "/api/provider-nodes", "/api/models/custom", "/api/models/disabled"].sort());
      fetcher.mockClear();
      const web = Object.entries(providers.AI_PROVIDERS).find(([, info]) => info.serviceKinds?.includes("webFetch"));
      expect(web).toBeDefined();
      harness.render({ kindFilter: "webFetch", activeProviders: [{ provider: web[0] }] });
      const media = await harness.settle();
      expect(media.groups[web[0]].models[0].value).toBe(web[0]);
      expect(media.filteredAliases).toEqual([]);
      expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/models/public");
    } finally { harness.unmount(); vi.unstubAllGlobals(); }
  });

  it("disabled caps register no fetch/listeners and never infer virtual capabilities", () => {
    const fetcher = vi.fn(async () => response([]));
    const window = environment(fetcher);
    const harness = hookHarness();
    try {
      const { getCaps } = harness.render({ enabled: false }, true);
      expect(fetcher).not.toHaveBeenCalled();
      expect(window.addEventListener).not.toHaveBeenCalled();
      expect(getCaps("jrouter/gpt-4o")).toBeNull();
    } finally { harness.unmount(); vi.unstubAllGlobals(); }
  });
});

const helperUrl = new URL("../../src/shared/utils/modelCatalogContext.js", import.meta.url);
const records = [
  { id: "jrouter/deepseek/Flash", name: "deepseek/Flash", kind: "llm", targetType: "alias", capabilities: { vision: true, contextWindow: 4000 } },
  { id: "jrouter/Old Combo:free", name: "Old Combo:free", kind: "llm", targetType: "combo", capabilities: { vision: false } },
];

describe("model catalog contexts", () => {
  it("uses the production context normalizer for canonical public and bare management values", async () => {
    expect(existsSync(helperUrl)).toBe(true);
    const { resolveCatalogContext, normalizePublicCatalog, selectContextCatalog, filterCatalogEntries } = await import(helperUrl.href);
    const virtuals = normalizePublicCatalog({ models: records });
    const groups = { cp: { name: "Custom", models: [
      { id: "Nested/Case", name: "Nested/Case", value: "cp/Nested/Case" },
      { id: "image", name: "Image", value: "cp/image", kind: "image", isCustom: true },
      { id: "__placeholder__cp", name: "cp/model-id", value: "cp/model-id", isPlaceholder: true },
    ] } };
    for (const catalogContext of ["invocation", "key-allow"]) {
      const catalog = selectContextCatalog({ catalogContext, virtuals, groups });
      expect(catalog.groups).toEqual({});
      expect(catalog.aliases[0]).toMatchObject({ value: "jrouter/deepseek/Flash", caps: { vision: true } });
      expect(catalog.combos[0].value).toBe("jrouter/Old Combo:free");
    }
    expect(resolveCatalogContext(null, null)).toBe("invocation");
    expect(resolveCatalogContext(undefined, "llm")).toBe("invocation");
    expect(resolveCatalogContext(undefined, "webFetch")).toBe("media");
    expect(resolveCatalogContext("members", "image")).toBe("members");
    const combos = [{ id: "stored-id", name: "Inner" }];
    expect(selectContextCatalog({ catalogContext: "members", virtuals, groups, combos }).combos).toEqual([]);
    const member = selectContextCatalog({ catalogContext: "members", virtuals, groups, combos, includeLegacyCombos: true, excludePlaceholders: true });
    expect(member.aliases).toEqual([]);
    expect(member.combos[0].value).toBe("Inner");
    expect(member.groups.cp.models.map(m => m.value)).toEqual(["cp/Nested/Case"]);
    expect(selectContextCatalog({ catalogContext: "key-block", virtuals, groups }).groups).toEqual(groups);
    expect(selectContextCatalog({ catalogContext: "media", virtuals, groups, combos, kindFilter: "webFetch" })).toEqual({ aliases: [], combos: [], groups });
    expect(filterCatalogEntries(virtuals, { searchQuery: "JROUTER/DEEPSEEK", capFilter: "vision" }).map(m => m.value)).toEqual(["jrouter/deepseek/Flash"]);
    expect(filterCatalogEntries(virtuals, { capFilter: "tools" })).toEqual([]);
    expect(normalizePublicCatalog({ models: [{ ...records[0], capabilities: undefined }] })[0].caps).toBeNull();
    expect(normalizePublicCatalog({ models: [{ ...records[0], capabilities: { invented: true, vision: "true" } }] })[0].caps).toBeNull();
    const virtualGroup = { cp: { name: "Custom", models: [{ id: "fake", value: "jrouter/fake", name: "fake" }] } };
    expect(selectContextCatalog({ catalogContext: "members", groups: virtualGroup }).groups).toEqual({});
  });

  it.each([null, {}, { models: null }, { models: [{}] }, { models: [{ ...records[0], id: "provider/model" }] }, { models: [{ ...records[0], targetType: "guess" }] }, { models: [{ ...records[0], id: "jrouter/https://evil", name: "https://evil" }] }, { models: [{ ...records[0], id: "jrouter/bad\n", name: "bad\n" }] }])("rejects malformed public catalog %j instead of pretending success-empty", async payload => {
    expect(existsSync(helperUrl)).toBe(true);
    const { normalizePublicCatalog } = await import(helperUrl.href);
    expect(() => normalizePublicCatalog(payload)).toThrow("Invalid public model catalog.");
  });
});

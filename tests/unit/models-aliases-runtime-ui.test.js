import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModelsAliasConfigKey, getConfiguredAliasOrder } from "@/lib/modelsAliases/config.js";

const require = createRequire(new URL("../../package.json", import.meta.url));
const alias = { id: "a/Case", name: "Case", models: ["openai/gpt-4o", "cbai/flash"], primaryModel: "openai/gpt-4o", strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 15 };
const dto = (a = alias) => ({ aliasId: a.id, configVersion: getModelsAliasConfigKey(a), serverNow: 1000, configuredOrder: getConfiguredAliasOrder(a), effectiveOrder: [...getConfiguredAliasOrder(a)].reverse(), members: a.models.map((modelId, i) => ({ modelId, status: i ? "recovering" : "cooldown", retryAt: i ? null : 4000 })) });
function mount(props = { alias, expanded: true }) {
  let cursor = 0; let tree; const values = []; const effects = [];
  const hooks = { ...React, useState: initial => {
    const i = cursor++; if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial;
    return [values[i], value => { values[i] = typeof value === "function" ? value(values[i]) : value; }];
  }, useRef: initial => { const i = cursor++; return values[i] ||= { current: initial }; },
  useEffect: (fn, deps) => { const i = cursor++; const previous = values[i];
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) { previous?.cleanup?.(); values[i] = { deps }; effects.push(() => { values[i].cleanup = fn(); }); }
  } };
  const filename = fileURLToPath(new URL("../../src/app/(dashboard)/dashboard/models-aliases/components/ModelAliasRuntimeStatus.js", import.meta.url));
  const code = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), { filename, presets: [require.resolve("next/babel")], babelrc: false, configFile: false, caller: { name: "test", supportsStaticESM: false } }).code;
  const compiled = new Module(filename); compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../..", import.meta.url)));
  compiled.require = specifier => {
    if (specifier === "react") return hooks;
    if (specifier.endsWith("config.js")) return { getModelsAliasConfigKey, getConfiguredAliasOrder };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: {} };
    if (specifier.endsWith("Button")) return { __esModule: true, default: p => React.createElement("button", p) };
    return require(specifier);
  };
  compiled._compile(code, filename); const Component = compiled.exports.default;
  const render = () => { cursor = 0; tree = Component(props); };
  render();
  return { render, update: p => { props = p; render(); }, nodes: () => nodes(tree), flush: async () => { effects.splice(0).forEach(fn => fn()); for (let i = 0; i < 15; i++) await Promise.resolve(); render(); }, unmount: () => values.forEach(value => value?.cleanup?.()) };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; if (Array.isArray(tree)) return tree.flatMap(nodes); if (typeof tree.type === "function") return nodes(tree.type(tree.props)); return [tree, ...nodes(tree.props?.children)]; }
const reset = h => h.nodes().find(node => node.type === "button" && node.props.children === "Reset runtime order");
const text = h => JSON.stringify(h.nodes());
let documentFixture;
beforeEach(() => { vi.useFakeTimers(); documentFixture = Object.assign(new EventTarget(), { visibilityState: "visible" }); vi.stubGlobal("document", documentFixture); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("compiled alias runtime lifecycle", () => {
  it("never renders rejected transport text that resembles configuration feedback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Configuration unavailable private credential")));
    const h = mount(); await h.flush(); expect(text(h)).not.toContain("private credential"); h.unmount();
  });
  it("polls only expanded/visible, aborts hidden requests and cleans timers on collapse", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(dto()))); vi.stubGlobal("fetch", fetcher);
    const h = mount({ alias, expanded: false }); await h.flush(); expect(fetcher).not.toHaveBeenCalled();
    h.update({ alias, expanded: true }); await h.flush(); expect(fetcher).toHaveBeenCalledOnce();
    documentFixture.visibilityState = "hidden"; documentFixture.dispatchEvent(new Event("visibilitychange")); h.render();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(6000); expect(fetcher).toHaveBeenCalledOnce();
    documentFixture.visibilityState = "visible"; documentFixture.dispatchEvent(new Event("visibilitychange")); await h.flush(); expect(fetcher).toHaveBeenCalledTimes(2);
    h.update({ alias, expanded: false }); await h.flush(); await vi.advanceTimersByTimeAsync(6000); expect(fetcher).toHaveBeenCalledTimes(2);
    h.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("clears displayed old members immediately when configuration changes", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(dto()))).mockImplementationOnce(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher); const h = mount(); await h.flush();
    expect(h.nodes().filter(node => node.type === "li")).toHaveLength(2);
    h.update({ alias: { ...alias, name: "New/Config" }, expanded: true }); await h.flush();
    expect(h.nodes().filter(node => node.type === "li")).toHaveLength(0); h.unmount();
  });
  it("never overlaps polls or lets an old configuration response resurrect status", async () => {
    const pending = []; const fetcher = vi.fn(() => new Promise(resolve => pending.push(resolve))); vi.stubGlobal("fetch", fetcher);
    const h = mount(); await h.flush(); await vi.advanceTimersByTimeAsync(9000); expect(fetcher).toHaveBeenCalledOnce();
    const next = { ...alias, name: "New/Config" }; h.update({ alias: next, expanded: true }); await h.flush();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
    pending[0](new Response(JSON.stringify(dto()))); await h.flush(); expect(reset(h).props.disabled).toBe(true);
    pending[1](new Response(JSON.stringify(dto(next)))); await h.flush(); expect(reset(h).props.disabled).toBe(false); h.unmount();
  });
  it("uses serverNow plus elapsed time for a bounded countdown and honest recovery label", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(dto())))); const h = mount(); await h.flush();
    expect(text(h)).toContain("Cooldown: 3s"); expect(text(h)).toContain("Recovery pending"); expect(text(h)).not.toContain("Trial in progress");
    await vi.advanceTimersByTimeAsync(2000); h.render(); expect(text(h)).toContain("Cooldown: 1s");
    h.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("posts only displayed configVersion, preserves cooldown, and does not PUT or infer", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(dto()))); vi.stubGlobal("fetch", fetcher); const h = mount(); await h.flush();
    await reset(h).props.onClick(); h.render();
    expect(fetcher.mock.calls[1][0]).toBe("/api/models-aliases/a%2FCase/runtime/reset");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ configVersion: dto().configVersion }) });
    expect(text(h)).toContain("Runtime order restored"); expect(text(h)).toContain("Cooldown: 3s"); h.unmount();
  });
  it("invalidates stale409 displayed version and refreshes without retrying reset", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(dto()))).mockResolvedValueOnce(new Response("{}", { status: 409 })).mockResolvedValue(new Response(JSON.stringify(dto())));
    vi.stubGlobal("fetch", fetcher); const h = mount(); await h.flush(); await reset(h).props.onClick(); await h.flush();
    expect(text(h)).toContain("Configuration changed"); expect(text(h)).not.toContain("Runtime order restored");
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3); h.unmount();
  });
  it("surfaces unavailable configuration rather than rendering ghost runtime members", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 }))); const h = mount(); await h.flush();
    expect(text(h)).toContain("Configuration unavailable"); expect(reset(h).props.disabled).toBe(true); expect(h.nodes().filter(node => node.type === "li")).toHaveLength(0); h.unmount();
  });
  it("does not overlap repeated reset callbacks before a render", async () => {
    let resolve; const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(dto()))).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    vi.stubGlobal("fetch", fetcher); const h = mount(); await h.flush();
    const callback = reset(h).props.onClick; const pending = callback(); const duplicate = callback();
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    resolve(new Response(JSON.stringify(dto()))); await pending; await duplicate; h.unmount();
  });
  it("aborts reset on collapse and ignores its late successful response", async () => {
    let resolve; const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(dto()))).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    vi.stubGlobal("fetch", fetcher); const h = mount(); await h.flush(); const pending = reset(h).props.onClick();
    h.update({ alias, expanded: false }); await h.flush(); expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify(dto()))); await pending; h.render(); expect(text(h)).not.toContain("Runtime order restored"); h.unmount();
  });
});

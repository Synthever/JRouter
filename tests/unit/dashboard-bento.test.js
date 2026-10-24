import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  attachGridRefs, createBrowserFixture, createComponentLoader, createHookHarness, elements,
} from "../helpers/bento-component-harness.js";

const loadComponent = createComponentLoader();
const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});

const componentPath = "src/app/(dashboard)/dashboard/components/KpiBentoGrid.js";
const gridPath = "src/shared/components/ui/bento-grid.js";
const STORAGE_KEY = "jrouter.dashboard.kpiLayout.v1";
const LAYOUT_ENDPOINT = "/api/dashboard/layout";
const defaultLayout = [
  { id: "requests", span: 2 }, { id: "cost", span: 2 }, { id: "connections", span: 2 },
  { id: "success", span: 3 }, { id: "tokens", span: 3 },
];

function storageFixture(value) {
  const data = new Map(value === undefined ? [] : [[STORAGE_KEY, value]]);
  return {
    data,
    getItem: vi.fn((key) => data.get(key) ?? null),
    setItem: vi.fn((key, next) => data.set(key, next)),
    removeItem: vi.fn((key) => data.delete(key)),
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

// Default: the database holds no layout yet, so cache-first restore is unchanged.
function createFetchMock(handler = () => jsonResponse({ layout: null, updatedAt: null })) {
  return vi.fn((url, init = {}) => {
    try {
      return Promise.resolve(handler(url, init));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

async function settle(harness) {
  harness.flush();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  harness.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.flush();
}

function callsFor(fetchMock, method) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}

function mountKpi(storage = storageFixture(), handler) {
  const browser = createBrowserFixture(storage);
  vi.stubGlobal("window", browser.window);
  const fetchMock = createFetchMock(handler);
  vi.stubGlobal("fetch", fetchMock);
  const harness = createHookHarness();
  const load = createComponentLoader({ react: harness.react });
  harness.mount(load(componentPath).default);
  cleanups.push(() => harness.cleanup());
  return {
    harness, storage, browser, fetchMock,
    grid: () => elements(harness.tree, (node) => node.props.items && node.props.rowHeight)[0],
    reset: () => elements(harness.tree, (node) => node.props["aria-label"] === "Reset layout")[0],
  };
}

function keyEvent(key) { return { key, preventDefault: vi.fn() }; }

function mountGrid(props = {}, width = 600) {
  const browser = createBrowserFixture();
  vi.stubGlobal("window", browser.window);
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("navigator", { vibrate() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const harness = createHookHarness();
  const load = createComponentLoader({
    react: harness.react,
    "motion/react": { useReducedMotion: () => true },
  });
  const onLayoutChange = vi.fn();
  const onLayoutCommit = vi.fn();
  harness.mount(load(gridPath).default, {
    items: [{ id: "requests", title: "Requests", defaultSpan: 4, render: () => null },
      { id: "cost", title: "Cost", defaultSpan: 2, render: () => null }],
    onLayoutChange, onLayoutCommit, ...props,
  }, (tree) => attachGridRefs(tree, width));
  harness.flush();
  cleanups.push(() => harness.cleanup());
  const cell = (id = "requests") => elements(harness.tree, (node) => node.props.item?.id === id)[0].props;
  return {
    harness, browser, cell, onLayoutChange, onLayoutCommit,
    key: (key) => harness.act(() => cell().onGripKeyDown(keyEvent(key))),
    resizeKey: (key) => harness.act(() => cell().onResizeKeyDown(keyEvent(key))),
    pointerDown: (resize = false) => harness.act(() => cell()[resize ? "onResizePointerDown" : "onGripPointerDown"]({
      pointerId: 1, button: 0, clientX: 20, clientY: 20, preventDefault() {},
    })),
    dispatch: (type, values) => harness.act(() => browser.dispatch(type, values)),
  };
}
const render = (props = {}) => {
  const { default: KpiBentoGrid } = loadComponent(componentPath);
  return renderToStaticMarkup(React.createElement(KpiBentoGrid, props));
};

describe("Kokonut widget layout", () => {
  const { normalizeLayout, sizeForSpan } = loadComponent("src/shared/components/ui/bento-grid.js");
  const items = [{ id: "requests", defaultSpan: 4 }, { id: "cost", defaultSpan: 2 }];

  it("preserves valid order, removes duplicate/unknown IDs and restores missing widgets", () => {
    expect(normalizeLayout([{ id: "cost", span: 3 }, { id: "missing", span: 6 }, { id: "cost", span: 6 }], items))
      .toEqual([{ id: "cost", span: 3 }, { id: "requests", span: 4 }]);
  });

  it("bounds spans and falls back safely for malformed layout values", () => {
    expect(normalizeLayout(null, items)).toEqual([{ id: "requests", span: 4 }, { id: "cost", span: 2 }]);
    expect(normalizeLayout([null, { id: "requests", span: Infinity }, { id: "cost", span: -100 }], items))
      .toEqual([{ id: "requests", span: 4 }, { id: "cost", span: 2 }]);
    expect(normalizeLayout([{ id: "requests", span: 99 }], items)[0].span).toBe(6);
  });

  it("maps six-column spans to responsive widget content sizes", () => {
    expect([2, 3, 4, 5, 6].map((span) => sizeForSpan(span))).toEqual(["s", "m", "m", "l", "l"]);
    expect([2, 4, 6].map((span) => sizeForSpan(span, true))).toEqual(["s", "m", "m"]);
  });
});

describe("widget gesture commit lifecycle", () => {
  it.each(["pointer", "resize", "keyboard"])("tears down active %s interaction without publishing or rolling back parent layout", (mode) => {
    const fixture = mountGrid();
    if (mode === "keyboard") { fixture.key(" "); fixture.key("ArrowRight"); }
    else {
      fixture.pointerDown(mode === "resize");
      fixture.dispatch("pointermove", { clientX: mode === "resize" ? 122 : 220, clientY: 20 });
    }
    fixture.harness.update({ layout: [{ id: "cost", span: 3 }, { id: "requests", span: 6 }] });
    const previewCount = fixture.onLayoutChange.mock.calls.length;
    fixture.harness.cleanup();
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(previewCount);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    expect(fixture.browser.listenerCount()).toBe(0);
    fixture.browser.dispatch("pointerup");
    fixture.browser.dispatch("keydown", { key: "Escape" });
    fixture.cell().onGripBlur();
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(previewCount);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("publishes pointer resize once on release, not during preview", () => {
    const fixture = mountGrid();
    fixture.pointerDown(true);
    fixture.dispatch("pointermove", { clientX: 122 });
    fixture.dispatch("pointermove", { clientX: 224 });
    expect(fixture.cell().span).toBe(6);
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(2);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.dispatch("pointerup", { pointerId: 2 });
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.dispatch("pointerup");
    expect(fixture.onLayoutCommit).toHaveBeenCalledExactlyOnceWith([{ id: "requests", span: 6 }, { id: "cost", span: 2 }]);
    fixture.dispatch("pointerup");
    expect(fixture.onLayoutCommit).toHaveBeenCalledTimes(1);
    expect(fixture.browser.listenerCount()).toBe(0);
  });

  it("publishes only actual keyboard resize changes including at span bounds", () => {
    const fixture = mountGrid();
    fixture.resizeKey("ArrowRight");
    expect(fixture.onLayoutCommit).toHaveBeenLastCalledWith([{ id: "requests", span: 5 }, { id: "cost", span: 2 }]);
    fixture.resizeKey("ArrowUp");
    fixture.resizeKey("ArrowRight");
    fixture.resizeKey("Enter");
    expect(fixture.onLayoutCommit).toHaveBeenCalledTimes(2);
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(2);
  });

  it("keeps a single-column mobile layout readable without overwriting saved desktop widths", () => {
    const fixture = mountGrid({ narrowColumns: 1 }, 390);
    expect(fixture.cell().narrowColumns).toBe(1);
    fixture.resizeKey("ArrowRight");
    fixture.resizeKey("ArrowLeft");
    expect(fixture.cell().span).toBe(4);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.key(" ");
    fixture.key("ArrowRight");
    fixture.key("Enter");
    expect(fixture.onLayoutCommit).toHaveBeenCalledExactlyOnceWith([{ id: "cost", span: 2 }, { id: "requests", span: 4 }]);
  });

  it("does not publish redundant narrow-screen keyboard resizes", () => {
    const fixture = mountGrid({}, 390);
    fixture.resizeKey("ArrowRight");
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.resizeKey("ArrowLeft");
    fixture.resizeKey("ArrowDown");
    expect(fixture.onLayoutCommit).toHaveBeenCalledExactlyOnceWith([{ id: "requests", span: 2 }, { id: "cost", span: 2 }]);
  });

  it.each(["Escape", "pointercancel"])("rolls pointer resize back on %s without an accepted commit", (cancel) => {
    const fixture = mountGrid();
    fixture.pointerDown(true);
    fixture.dispatch("pointermove", { clientX: 122 });
    expect(fixture.cell().span).toBe(5);
    if (cancel === "Escape") fixture.dispatch("keydown", { key: "Escape" });
    else fixture.dispatch("pointercancel");
    expect(fixture.cell().span).toBe(4);
    expect(fixture.onLayoutChange).toHaveBeenLastCalledWith([{ id: "requests", span: 4 }, { id: "cost", span: 2 }]);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    expect(fixture.browser.listenerCount()).toBe(0);
    fixture.dispatch("pointerup");
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
  });

  it.each(["keyboard", "pointer-Escape", "pointercancel"])("rolls %s movement back without an accepted commit", (mode) => {
    const fixture = mountGrid();
    if (mode === "keyboard") {
      fixture.key(" ");
      fixture.key("ArrowRight");
      fixture.key("Escape");
    } else {
      fixture.pointerDown();
      fixture.dispatch("pointermove", { clientX: 220, clientY: 20 });
      fixture.dispatch(mode === "pointercancel" ? "pointercancel" : "keydown", { key: "Escape" });
    }
    expect(fixture.onLayoutChange).toHaveBeenLastCalledWith([{ id: "requests", span: 4 }, { id: "cost", span: 2 }]);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.harness.act(() => fixture.cell().onGripBlur());
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
  });

  it.each([" ", "Enter", "blur"])("publishes one keyboard drop on %s after live previews", (drop) => {
    const fixture = mountGrid();
    fixture.key(" ");
    fixture.key("ArrowRight");
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    if (drop === "blur") fixture.harness.act(() => fixture.cell().onGripBlur());
    else fixture.key(drop);
    expect(fixture.onLayoutCommit).toHaveBeenCalledExactlyOnceWith([{ id: "cost", span: 2 }, { id: "requests", span: 4 }]);
    fixture.harness.act(() => fixture.cell().onGripBlur());
    expect(fixture.onLayoutCommit).toHaveBeenCalledTimes(1);
  });

  it("publishes pointer reorder only on matching pointerup", () => {
    const fixture = mountGrid();
    fixture.pointerDown();
    fixture.dispatch("pointermove", { clientX: 220, clientY: 20 });
    expect(fixture.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.dispatch("pointerup", { pointerId: 2 });
    expect(fixture.onLayoutCommit).not.toHaveBeenCalled();
    fixture.dispatch("pointerup");
    expect(fixture.onLayoutCommit).toHaveBeenCalledExactlyOnceWith([{ id: "cost", span: 2 }, { id: "requests", span: 4 }]);
    fixture.dispatch("pointerup");
    expect(fixture.onLayoutCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps the commit callback optional and respects the latest controlled callbacks", () => {
    const fixture = mountGrid({ onLayoutCommit: undefined });
    fixture.key(" ");
    fixture.key("ArrowRight");
    expect(() => fixture.key("Enter")).not.toThrow();
    const accepted = vi.fn();
    fixture.harness.update({ onLayoutCommit: accepted, layout: [{ id: "cost", span: 2 }, { id: "requests", span: 4 }] });
    fixture.key(" ");
    fixture.key("ArrowLeft");
    fixture.key("Enter");
    expect(accepted).toHaveBeenCalledExactlyOnceWith([{ id: "requests", span: 4 }, { id: "cost", span: 2 }]);
  });
});

describe("dashboard browser layout persistence", () => {
  it("keeps previews in memory and writes only canonical accepted layouts", () => {
    const { harness, grid, storage } = mountKpi();
    harness.flush();
    harness.act(() => grid().props.onLayoutChange([...defaultLayout].reverse()));
    expect(grid().props.layout.map((entry) => entry.id)).toEqual([...defaultLayout].reverse().map((entry) => entry.id));
    expect(storage.setItem).not.toHaveBeenCalled();
    harness.act(() => grid().props.onLayoutCommit([{ id: "cost", span: 3, extra: "discard" }]));
    const canonical = [{ id: "cost", span: 3 }, ...defaultLayout.filter((entry) => entry.id !== "cost")];
    expect(grid().props.layout).toEqual(canonical);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, JSON.stringify(canonical));
    harness.update({ period: "30d", stats: { totalRequests: 10 }, fetching: true });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(grid().props.layout).toEqual(canonical);
  });

  it("resets only its own key and cannot restore stale storage on keyed remount", () => {
    const { harness, grid, reset, storage } = mountKpi(storageFixture(JSON.stringify([...defaultLayout].reverse())));
    storage.data.set("other-preference", "kept");
    harness.flush();
    const previousKey = grid().key;
    harness.act(() => reset().props.onClick());
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY);
    expect(storage.data.get("other-preference")).toBe("kept");
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(grid().props.layout).toEqual(defaultLayout);
    expect(grid().key).not.toBe(previousKey);
    expect(storage.setItem).not.toHaveBeenCalled();
    harness.replayEffects();
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(grid().props.layout).toEqual(defaultLayout);
  });

  it.each(["{bad-json", "null", "{}", "[null,3,\"requests\"]"])("ignores malformed saved data %s without writing defaults", (saved) => {
    const { harness, grid, storage } = mountKpi(storageFixture(saved));
    harness.flush();
    expect(grid().props.layout).toEqual(defaultLayout);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["getter", "get", "set", "remove"])("keeps in-memory changes usable when storage %s throws", (operation) => {
    const fixture = mountKpi();
    const fail = () => { throw new Error("Storage denied"); };
    if (operation === "getter") Object.defineProperty(fixture.browser.window, "localStorage", { get: fail });
    else fixture.storage[{ get: "getItem", set: "setItem", remove: "removeItem" }[operation]].mockImplementation(fail);
    fixture.harness.flush();
    const next = [...defaultLayout].reverse();
    expect(() => fixture.harness.act(() => fixture.grid().props.onLayoutCommit(next))).not.toThrow();
    expect(fixture.grid().props.layout).toEqual(next);
    expect(() => fixture.harness.act(() => fixture.reset().props.onClick())).not.toThrow();
    expect(fixture.grid().props.layout).toEqual(defaultLayout);
  });

  it("restores a normalized controlled layout after mount without an initial storage write", () => {
    const storage = storageFixture(JSON.stringify([
      { id: "cost", span: 99, secret: "ignored" }, { id: "cost", span: 3 },
      { id: "unknown", span: 4 }, { id: "requests", span: "5" },
    ]));
    const { harness, grid } = mountKpi(storage);
    expect(grid().props.layout).toEqual(defaultLayout);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    harness.flush();
    expect(grid().props.layout).toEqual([
      { id: "cost", span: 6 }, { id: "requests", span: 2 },
      { id: "connections", span: 2 }, { id: "success", span: 3 }, { id: "tokens", span: 3 },
    ]);
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("dashboard layout server persistence", () => {
  const serverLayout = [
    { id: "tokens", span: 6 }, { id: "success", span: 4 }, { id: "unknown", span: 2 },
  ];
  const canonicalServer = [
    { id: "tokens", span: 6 }, { id: "success", span: 4 },
    { id: "requests", span: 2 }, { id: "cost", span: 2 }, { id: "connections", span: 2 },
  ];

  it("adopts the database layout over localStorage and mirrors it into the cache", async () => {
    const storage = storageFixture(JSON.stringify([...defaultLayout].reverse()));
    const { harness, grid, fetchMock } = mountKpi(
      storage,
      () => jsonResponse({ layout: serverLayout, updatedAt: "2026-10-24T00:00:00.000Z" }),
    );
    await settle(harness);
    expect(grid().props.layout).toEqual(canonicalServer);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, JSON.stringify(canonicalServer));
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(LAYOUT_ENDPOINT);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(callsFor(fetchMock, "PUT")).toHaveLength(0);
  });

  it("migrates a saved browser layout exactly once when the database is empty", async () => {
    const local = [{ id: "cost", span: 4 }, { id: "requests", span: 2 }];
    const { harness, grid, storage, fetchMock } = mountKpi(storageFixture(JSON.stringify(local)));
    await settle(harness);
    const puts = callsFor(fetchMock, "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe(LAYOUT_ENDPOINT);
    expect(JSON.parse(puts[0][1].body)).toEqual({
      layout: [
        { id: "cost", span: 4 }, { id: "requests", span: 2 },
        { id: "connections", span: 2 }, { id: "success", span: 3 }, { id: "tokens", span: 3 },
      ],
    });
    expect(callsFor(fetchMock, "GET")).toHaveLength(1);
    expect(grid().props.layout).toEqual([
      { id: "cost", span: 4 }, { id: "requests", span: 2 },
      { id: "connections", span: 2 }, { id: "success", span: 3 }, { id: "tokens", span: 3 },
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["{bad-json", "null", "{}", "3"])("does not migrate unusable saved data %s", async (saved) => {
    const { harness, fetchMock } = mountKpi(storageFixture(saved));
    await settle(harness);
    expect(callsFor(fetchMock, "PUT")).toHaveLength(0);
    expect(callsFor(fetchMock, "GET")).toHaveLength(1);
  });

  it("persists an accepted commit with the canonical layout", async () => {
    const { harness, grid, fetchMock } = mountKpi();
    await settle(harness);
    fetchMock.mockClear();
    harness.act(() => grid().props.onLayoutCommit([{ id: "tokens", span: 99, extra: "discard" }]));
    const puts = callsFor(fetchMock, "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body)).toEqual({
      layout: [{ id: "tokens", span: 6 }, ...defaultLayout.filter((entry) => entry.id !== "tokens")],
    });
    expect(puts[0][1].headers).toMatchObject({ "Content-Type": "application/json" });
    expect(grid().props.layout).toEqual([
      { id: "tokens", span: 6 }, ...defaultLayout.filter((entry) => entry.id !== "tokens"),
    ]);
  });

  it("clears the stored layout on reset", async () => {
    const { harness, reset, fetchMock } = mountKpi();
    await settle(harness);
    fetchMock.mockClear();
    harness.act(() => reset().props.onClick());
    const deletes = callsFor(fetchMock, "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe(LAYOUT_ENDPOINT);
    expect(callsFor(fetchMock, "PUT")).toHaveLength(0);
  });

  it("keeps the in-memory layout usable when server writes fail", async () => {
    const handler = (url, init) => ((init?.method ?? "GET") === "GET"
      ? jsonResponse({ layout: null, updatedAt: null })
      : Promise.reject(new Error("offline")));
    const { harness, grid, reset, fetchMock } = mountKpi(storageFixture(), handler);
    await settle(harness);
    const next = [...defaultLayout].reverse();
    expect(() => harness.act(() => grid().props.onLayoutCommit(next))).not.toThrow();
    expect(grid().props.layout).toEqual(next);
    await settle(harness);
    expect(grid().props.layout).toEqual(next);
    expect(() => harness.act(() => reset().props.onClick())).not.toThrow();
    expect(grid().props.layout).toEqual(defaultLayout);
    await settle(harness);
    expect(grid().props.layout).toEqual(defaultLayout);
    expect(callsFor(fetchMock, "PUT")).toHaveLength(1);
    expect(callsFor(fetchMock, "DELETE")).toHaveLength(1);
  });

  it("ignores a slow database response after the user has committed", async () => {
    let resolveGet;
    const handler = (url, init) => ((init?.method ?? "GET") === "GET"
      ? new Promise((resolve) => { resolveGet = resolve; })
      : jsonResponse({ layout: null, updatedAt: null }));
    const { harness, grid } = mountKpi(storageFixture(), handler);
    harness.flush();
    const next = [...defaultLayout].reverse();
    harness.act(() => grid().props.onLayoutCommit(next));
    resolveGet(jsonResponse({ layout: serverLayout, updatedAt: "2026-10-24T00:00:00.000Z" }));
    await settle(harness);
    expect(grid().props.layout).toEqual(next);
  });
});

describe("dashboard KPI widgets", () => {
  it("uses the reference three-plus-two layout without the removed overview hero", () => {
    const html = render();
    expect([...html.matchAll(/data-widget-id="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["requests", "cost", "connections", "success", "tokens"]);
    expect(html).not.toContain("Gateway overview");
    expect(html).not.toContain("Request volume, token usage and upstream connections for your proxy");
    expect(html).toContain("Last 7 days");
    const { grid } = mountKpi();
    expect(grid().props.layout).toEqual(defaultLayout);
    expect(grid().props.rowHeight).toBe(208);
  });

  it("preserves an existing saved order and widths instead of replacing them with the new defaults", () => {
    const previous = [
      { id: "requests", span: 4 }, { id: "success", span: 2 }, { id: "tokens", span: 2 },
      { id: "cost", span: 2 }, { id: "connections", span: 2 },
    ];
    const { harness, grid, storage } = mountKpi(storageFixture(JSON.stringify(previous)));
    harness.flush();
    expect(grid().props.layout).toEqual(previous);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not claim a success rate when no recent requests exist", () => {
    const html = render({ stats: { totalRequests: 0, recentRequests: [] } });
    expect(html).not.toContain("100.0%");
    expect(html).toContain("No recent requests");
  });

  it("renders all five metrics as movable and resizable widgets", () => {
    const html = render({
      stats: { totalRequests: 42, totalPromptTokens: 3000, totalCompletionTokens: 1000, totalCost: 0.125, recentRequests: [{ status: "ok" }, { status: "error" }] },
      connectionsCount: 3, nodesCount: 2,
    });
    expect(html.match(/aria-label="Move /g)).toHaveLength(5);
    expect(html.match(/aria-label="Resize /g)).toHaveLength(5);
    expect(html).toMatch(/50\.0<span[^>]*>%<\/span>/);
    expect(html).toContain("4.0K");
    expect(html).toContain("$0.1250");
  });

  it("labels loading and failed metrics instead of presenting them as zero", () => {
    const loading = render({ loading: true, connectionsLoading: true });
    expect(loading.match(/Loading metric/g)).toHaveLength(5);
    const failed = render({ error: "Could not load telemetry.", connectionsError: true });
    expect(failed).toContain('role="alert"');
    expect(failed.match(/Unavailable/g)).toHaveLength(5);
  });

  it("leaves a zero-token bar empty", () => {
    const html = render({ stats: { totalPromptTokens: 0, totalCompletionTokens: 0 } });
    expect(html).toMatch(/data-token-segment="input" style="width:0%"/);
    expect(html).toMatch(/data-token-segment="output" style="width:0%"/);
  });
});

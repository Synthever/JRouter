import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createComponentLoader, createHookHarness, elements,
} from "../helpers/bento-component-harness.js";

const componentPath = "src/app/(dashboard)/dashboard/components/LatestRequestsTable.js";
const loadReal = createComponentLoader();
const cleanups = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mountRequests(initialRequests = []) {
  const harness = createHookHarness();
  const load = createComponentLoader({
    react: harness.react,
    "@/components/core/animated-background": loadReal("src/components/core/animated-background.js"),
    "./KpiBentoGrid": loadReal("src/app/(dashboard)/dashboard/components/KpiBentoGrid.js"),
  });
  harness.mount(load(componentPath).default, { initialRequests });
  cleanups.push(() => harness.cleanup());
  return {
    harness,
    html: () => renderToStaticMarkup(harness.tree),
    input: () => elements(harness.tree, (node) => node.type === "input")[0],
    button: (name) => elements(harness.tree, (node) => node.type === "button" && node.props["aria-label"] === name)[0],
    layout: () => elements(harness.tree, (node) => node.props["aria-label"] === "Request logs layout")[0],
    polling: () => elements(harness.tree, (node) => node.type === "button" && /Live polling|Polling paused/.test(node.props.title))[0],
  };
}

const requests = [
  { id: "first", model: "Alpha", provider: "River", status: "ok", promptTokens: 42650, completionTokens: 37, ttftMs: 2312, durationMs: 2730, timestamp: "2026-10-24T11:59:30Z" },
  { id: "second", model: "Beta", provider: "Cloud", status: 429, prompt_tokens: 1500, completion_tokens: 18, ttft: 120, duration: 730, timestamp: "2026-10-24T11:00:00Z" },
  { id: "third", model: "Gamma", provider: "River", status: "partial", promptTokens: 0, completionTokens: 0, ttftMs: 0, durationMs: 0 },
];

const response = (data) => ({ ok: true, json: async () => data });
async function settle(harness) {
  await vi.advanceTimersByTimeAsync(0);
  harness.flush();
}

function rowTexts(fixture) {
  const body = elements(fixture.harness.tree, (node) => node.type === "tbody")[0];
  return elements(body, (node) => node.type === "tr").map((node) => renderToStaticMarkup(node));
}

describe("latest request controls", () => {
  it("gives the request filter an accessible search name independent of its placeholder", () => {
    const fixture = mountRequests();

    expect(fixture.input().props["aria-label"]).toBe("Filter requests");
    expect(fixture.input().props.type).toBe("search");
  });

  it("names the panel and keyboard-scrollable table from its title", () => {
    const fixture = mountRequests();
    const heading = elements(fixture.harness.tree, (node) => node.type === "h2")[0];
    const table = elements(fixture.harness.tree, (node) => node.type === "table")[0];
    const scrollRegion = elements(fixture.harness.tree, (node) => node.props.role === "region")[0];

    expect(heading?.props.children).toBe("Latest requests");
    expect(table.props["aria-labelledby"]).toBe(heading.props.id);
    expect(scrollRegion?.props["aria-label"]).toBe("Latest requests table");
    expect(scrollRegion.props.tabIndex).toBe(0);
    expect(elements(table, (node) => node.type === "th").every((node) => node.props.scope === "col")).toBe(true);
    expect(fixture.html()).toContain("Live stream of the most recent payloads");
  });

  it("exposes the Live toggle state to assistive technology", () => {
    const fixture = mountRequests(requests);
    expect(fixture.polling().props["aria-label"]).toBe("Live polling");
    expect(fixture.polling().props["aria-pressed"]).toBe(true);

    fixture.harness.act(() => fixture.polling().props.onClick());

    expect(fixture.polling().props["aria-pressed"]).toBe(false);
    expect(fixture.html()).toContain("Paused");
  });

  it.each([
    ["  ALPHA  ", ["Alpha"]], ["river", ["Alpha", "Gamma"]], ["429", ["Beta"]], ["   ", ["Alpha", "Beta", "Gamma"]],
  ])("filters model, provider and status case-insensitively for %j", (query, expected) => {
    const fixture = mountRequests(requests);

    fixture.harness.act(() => fixture.input().props.onChange({ target: { value: query } }));

    const rows = rowTexts(fixture);
    expect(rows).toHaveLength(expected.length);
    expected.forEach((model, index) => expect(rows[index]).toContain(model));
    expect(fixture.html()).toContain(`Showing ${expected.length} most recent payloads`);
  });

  it("keeps a real table until Cards is selected and can return to Table", () => {
    const fixture = mountRequests(requests);
    expect(fixture.html()).toMatch(/<table\b/);
    expect(fixture.html()).toMatch(/aria-label="Table view"[^>]*aria-pressed="true"/);

    fixture.harness.act(() => fixture.layout().props.onValueChange("cards"));
    expect(fixture.html()).not.toMatch(/<table\b/);
    expect(fixture.html()).toMatch(/aria-label="Cards view"[^>]*aria-pressed="true"/);
    expect(fixture.html()).toContain("42.6K");
    expect(fixture.html()).toContain("2312ms");
    expect(fixture.html()).toContain("2.73s");

    fixture.harness.act(() => fixture.layout().props.onValueChange("table"));
    expect(rowTexts(fixture)).toHaveLength(3);
  });

  it("polls the existing read-only endpoint every six seconds", async () => {
    vi.mocked(fetch).mockResolvedValue(response(requests));
    const fixture = mountRequests();
    fixture.harness.flush();
    await settle(fixture.harness);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/usage/request-logs?format=json", { cache: "no-store" });

    await vi.advanceTimersByTimeAsync(5999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    fixture.harness.flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rowTexts(fixture)).toHaveLength(3);
    fixture.harness.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling while paused and resumes on Live", async () => {
    const fixture = mountRequests(requests);
    fixture.harness.flush();
    await settle(fixture.harness);
    fixture.harness.act(() => fixture.polling().props.onClick());

    await vi.advanceTimersByTimeAsync(12000);
    expect(fetch).toHaveBeenCalledTimes(1);
    fixture.harness.act(() => fixture.polling().props.onClick());
    await vi.advanceTimersByTimeAsync(6000);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retains rows while manual refresh is busy and refreshes while paused", async () => {
    const fixture = mountRequests(requests);
    fixture.harness.flush();
    await settle(fixture.harness);
    fixture.harness.act(() => fixture.polling().props.onClick());
    let resolveFetch;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));

    fixture.harness.act(() => fixture.button("Refresh logs").props.onClick());
    expect(fixture.button("Refresh logs").props["aria-busy"]).toBe(true);
    expect(rowTexts(fixture)).toHaveLength(3);
    resolveFetch(response([requests[1]]));
    await settle(fixture.harness);

    expect(fixture.button("Refresh logs").props["aria-busy"]).toBe(false);
    expect(rowTexts(fixture)).toHaveLength(1);
    expect(rowTexts(fixture)[0]).toContain("Beta");
    expect(fixture.html()).toContain("Paused");
  });
});

describe("latest request content", () => {
  it("scales decorative TTFT bars from visible measured timings without replacing labels", () => {
    const fixture = mountRequests(requests);
    const timings = () => elements(fixture.harness.tree, (node) => node.props.title === "Bar scaled to the longest TTFT in this view");
    const fills = () => elements(fixture.harness.tree, (node) => typeof node.props.style?.width === "string");

    expect(timings()).toHaveLength(2);
    expect(fills().map((node) => node.props.style.width)).toEqual(["100%", `${120 / 2312 * 100}%`]);
    expect(elements(timings()[0], (node) => node.props["aria-hidden"] === "true")).toHaveLength(1);
    expect(rowTexts(fixture)[0]).toContain("2312ms");
    expect(rowTexts(fixture)[2]).toContain("—");

    fixture.harness.act(() => fixture.input().props.onChange({ target: { value: "Beta" } }));

    expect(fills().map((node) => node.props.style.width)).toEqual(["100%"]);
    expect(rowTexts(fixture)[0]).toContain("120ms");
  });

  it("preserves camel/snake token fields, timing units, status variants and links", () => {
    const fixture = mountRequests([...requests, { id: "unknown", status: "unexpected" }]);
    const rows = rowTexts(fixture);

    for (const text of ["42.6K", "37", "2312ms", "2.73s", "30s ago", "OK"]) expect(rows[0]).toContain(text);
    for (const text of ["1.5K", "18", "120ms", "730ms", "1h ago", "429"]) expect(rows[1]).toContain(text);
    expect(rows[2]).toContain("Partial");
    expect(rows[2]).toContain("—");
    expect(rows[3]).toContain("Error");
    expect(rows[3]).toContain("default");
    expect(rows[3]).toContain("gateway");
    expect(fixture.html()).toContain('href="/dashboard/usage?tab=details"');
    expect(fixture.html()).toContain('href="/dashboard/console-log"');
  });

  it("shows at most fifteen of the thirty fetched records while retaining filtering", async () => {
    const logs = Array.from({ length: 35 }, (_, i) => ({ id: String(i), model: `Model-${i}` }));
    vi.mocked(fetch).mockResolvedValue(response(logs));
    const fixture = mountRequests();
    fixture.harness.flush();
    await settle(fixture.harness);

    expect(rowTexts(fixture)).toHaveLength(15);
    expect(fixture.html()).toContain("Showing 15 most recent payloads");
    fixture.harness.act(() => fixture.input().props.onChange({ target: { value: "Model-29" } }));
    expect(rowTexts(fixture)[0]).toContain("Model-29");
    fixture.harness.act(() => fixture.input().props.onChange({ target: { value: "Model-30" } }));
    expect(fixture.html()).toContain("No requests matching filter");
  });

  it.each(["table", "cards"])("retains empty and unmatched messages in %s view", (layout) => {
    const fixture = mountRequests();
    fixture.harness.act(() => fixture.layout().props.onValueChange(layout));
    expect(fixture.html()).toContain("No recent requests logged yet.");

    fixture.harness.act(() => fixture.input().props.onChange({ target: { value: "absent" } }));

    expect(fixture.html()).toContain("No requests matching filter");
    expect(fixture.html()).toContain("Showing 0 most recent payloads");
  });

  it.each(["http", "network", "malformed"])("preserves existing rows and clears refresh state after %s failure", async (failure) => {
    const fixture = mountRequests(requests);
    const error = new Error("Offline fixture");
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    fixture.harness.flush();
    await settle(fixture.harness);
    if (failure === "network") vi.mocked(fetch).mockRejectedValueOnce(error);
    else vi.mocked(fetch).mockResolvedValueOnce(failure === "http" ? { ok: false } : response({ invalid: true }));

    fixture.harness.act(() => fixture.button("Refresh logs").props.onClick());
    await settle(fixture.harness);

    expect(rowTexts(fixture)).toHaveLength(3);
    expect(fixture.button("Refresh logs").props["aria-busy"]).toBe(false);
    if (failure === "network") expect(logError).toHaveBeenCalledWith("Failed to fetch latest request logs:", error);
    else expect(logError).not.toHaveBeenCalled();
  });
});

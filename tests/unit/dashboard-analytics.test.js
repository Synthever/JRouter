import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createComponentLoader, createHookHarness, elements } from "../helpers/bento-component-harness.js";

const require = createRequire(import.meta.url);
const { BarChart, Bar, YAxis, Tooltip } = require("recharts");
const directory = "src/app/(dashboard)/dashboard/components/";
const load = createComponentLoader();
const cleanups = [];
const chartData = [
  { label: "Oct 22", requests: 3, tokens: 1500, cost: 0.0003 },
  { label: "Oct 23", requests: 1, tokens: 500, cost: 0.0001 },
];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderCard(name, props = {}) {
  return renderToStaticMarkup(React.createElement(load(`${directory}${name}.js`).default, props));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function mountActivity(props = {}) {
  const harness = createHookHarness();
  const component = createComponentLoader({ react: harness.react })(`${directory}ActivityTimelineCard.js`).default;
  harness.mount(component, props);
  harness.flush();
  cleanups.push(() => harness.cleanup());
  return {
    harness,
    html: () => renderToStaticMarkup(harness.tree),
    chart: () => elements(harness.tree, (node) => node.type === BarChart)[0],
    bar: () => elements(harness.tree, (node) => node.type === Bar)[0],
    select: (mode) => {
      const control = elements(harness.tree, (node) => node.props["aria-label"] === "Activity metric")[0];
      harness.act(() => control.props.onValueChange(mode));
    },
  };
}

async function settled(fixture, assertion) {
  await vi.waitFor(() => {
    fixture.harness.flush();
    assertion();
  });
}

function summary(fixture) {
  return elements(fixture.harness.tree, (node) => node.type === "dd").map((node) => node.props.children);
}

describe("dashboard activity analytics", () => {
  it("renders a title-case heading and a loading state without invented zero totals", () => {
    const html = renderCard("ActivityTimelineCard");
    expect(html).toMatch(/<h2[^>]*>Activity<\/h2>/);
    expect(html).toContain("Throughput over time");
    expect(html).toContain("Loading timeline telemetry...");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/<dd[^>]*>0<\/dd>/);
  });

  it("plots the unchanged API buckets as pink request bars with a numeric summary", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => chartData });
    vi.stubGlobal("fetch", fetch);
    const fixture = mountActivity({ period: "24h" });

    await settled(fixture, () => expect(fixture.chart()).toBeDefined());

    expect(fetch.mock.calls[0][0]).toBe("/api/usage/chart?period=24h");
    expect(fixture.chart().props.data).toEqual(chartData);
    expect(fixture.chart().props.accessibilityLayer).toBe(true);
    expect(fixture.bar().props.dataKey).toBe("requests");
    expect(fixture.bar().props.fill).toBe("var(--brand-pink)");
    expect(summary(fixture)).toEqual(["4", "3", "2"]);
  });

  it.each([
    ["tokens", "var(--brand-lavender)", ["2.0K", "1.5K", "1.0K"]],
    ["cost", "var(--brand-peach)", ["$0.0004", "$0.0003", "$0.0002"]],
  ])("switches to %s without refetching or changing the underlying measurements", async (mode, color, expected) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => chartData });
    vi.stubGlobal("fetch", fetch);
    const fixture = mountActivity();
    await settled(fixture, () => expect(fixture.html()).not.toContain("Loading timeline telemetry..."));

    fixture.select(mode);

    expect(fixture.bar()?.props.dataKey).toBe(mode);
    expect(fixture.bar()?.props.fill).toBe(color);
    expect(summary(fixture)).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
    const label = mode === "tokens" ? "Tokens" : "Cost";
    expect(fixture.html()).toMatch(new RegExp(`aria-label="${label} view"[^>]*aria-pressed="true"`));
    expect(fixture.html()).toMatch(/aria-label="Requests view"[^>]*aria-pressed="false"/);
  });

  it("retains small cost precision on the chart axis and tooltip", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => chartData }));
    const fixture = mountActivity();
    await settled(fixture, () => expect(fixture.html()).not.toContain("Loading timeline telemetry..."));

    fixture.select("cost");

    const axis = elements(fixture.harness.tree, (node) => node.type === YAxis)[0];
    expect(axis.props.tickFormatter(0.0003)).toBe("$0.0003");
    const totals = elements(fixture.harness.tree, (node) => node.type === "dd");
    expect(totals[0].props.title).toBe("0.0004");
    const tooltip = elements(fixture.harness.tree, (node) => node.type === Tooltip)[0].props.content;
    const html = renderToStaticMarkup(React.cloneElement(tooltip, {
      active: true, payload: [{ value: 0.0003 }], label: "Oct 22",
    }));
    expect(html).toContain("$0.0003");
    expect(html).toContain("var(--brand-peach)");
  });

  it("reloads the current period when refreshVersion changes and preserves the selected metric", async () => {
    const next = deferred();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => chartData })
      .mockReturnValueOnce(next.promise);
    vi.stubGlobal("fetch", fetch);
    const fixture = mountActivity({ period: "7d", refreshVersion: 0 });
    await settled(fixture, () => expect(fixture.html()).not.toContain("Loading timeline telemetry..."));
    fixture.select("tokens");

    fixture.harness.update({ refreshVersion: 1 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/usage/chart?period=7d");
    expect(fixture.html()).toContain("Loading timeline telemetry...");
    next.resolve({ ok: true, json: async () => [{ label: "Oct 24", requests: 2, tokens: 4000, cost: 0.001 }] });
    await settled(fixture, () => expect(summary(fixture)).toEqual(["4.0K", "4.0K", "4.0K"]));
    expect(fixture.bar().props.dataKey).toBe("tokens");
  });

  it("does not let an older period response overwrite the selected period", async () => {
    const old = deferred();
    const fetch = vi.fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, json: async () => chartData });
    vi.stubGlobal("fetch", fetch);
    const fixture = mountActivity({ period: "7d" });

    fixture.harness.update({ period: "24h" });
    await settled(fixture, () => expect(fixture.html()).not.toContain("Loading timeline telemetry..."));
    old.resolve({ ok: true, json: async () => [{ label: "Old", requests: 99, tokens: 99, cost: 99 }] });
    // The old body has now settled; a queued task lets its state update run if unguarded.
    await new Promise((resolve) => setImmediate(resolve));
    fixture.harness.flush();

    expect(summary(fixture)).toEqual(["4", "3", "2"]);
    expect(fixture.chart().props.data).toEqual(chartData);
    expect(fetch.mock.calls[0][1]?.signal.aborted).toBe(true);
  });

  it.each([[], [{ label: "Oct 24", requests: 0, tokens: 0, cost: 0 }], { error: "not an array" }])(
    "keeps the no-activity state for empty or unusable chart payloads (%j)", async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
      const fixture = mountActivity();

      await settled(fixture, () => expect(fixture.html()).toContain("No activity recorded for this period"));

      expect(fixture.chart()).toBeUndefined();
      expect(fixture.html()).toContain("/v1/chat/completions");
    },
  );

  it.each(["http", "network"])("shows unavailable, not zero usage, after a %s error", async (kind) => {
    const fetch = kind === "http"
      ? vi.fn().mockResolvedValue({ ok: false, status: 503 })
      : vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = mountActivity();

    await settled(fixture, () => expect(fixture.html()).not.toContain("Loading timeline telemetry..."));

    expect(fixture.html()).toContain("Activity could not be loaded");
    expect(fixture.html()).not.toContain("No activity recorded");
    expect(summary(fixture)).toEqual(["—", "—", "—"]);
  });
});

describe("dashboard ranked analytics panels", () => {
  it("renders model ranking, real counts, proportional shares and the existing navigation destination", () => {
    const html = renderCard("TopModelsCard", { stats: { byModel: {
      "fallback-name (River)": { requests: 1, provider: "River" },
      "internal-key": { rawModel: "DeepSeek/V4", requests: 3, provider: "Upstream B" },
    } } });

    expect(html).toMatch(/<h2[^>]*>Top models<\/h2>/);
    expect(html).toContain("2 active models, ranked by requests");
    expect(html.indexOf("DeepSeek/V4")).toBeLessThan(html.indexOf("fallback-name"));
    expect(html).toContain("75.0%");
    expect(html).toContain("25.0%");
    expect(html).toContain("width:75%");
    expect(html).toContain("var(--brand-pink)");
    expect(html).toContain("var(--brand-lavender)");
    expect(html).toContain('href="/dashboard/combos"');
    expect(html).toContain("View combos and adapters");
    expect(html).not.toContain("ui-card");
  });

  it("preserves the six-model limit and top-six share denominator", () => {
    const byModel = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      `model-${index}`, { requests: index + 1, provider: "River" },
    ]));

    const html = renderCard("TopModelsCard", { stats: { byModel } });

    expect(html).not.toContain("model-0");
    expect(html).toContain("model-6");
    expect(html).toContain("25.9%");
    expect(html).toContain("Top 6");
  });

  it("never produces NaN widths when a recorded model has zero requests", () => {
    const html = renderCard("TopModelsCard", { stats: { byModel: { unused: { requests: 0 } } } });
    expect(html).not.toContain("NaN");
    expect(html).toContain("width:0%");
    expect(html).toContain("0.0%");
  });

  it("preserves provider shares, token and cost totals, with no minimum-size fake traffic", () => {
    const html = renderCard("ProviderDistributionCard", { stats: {
      totalRequests: 1000,
      byProvider: {
        Quiet: { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 },
        Tiny: { requests: 1, promptTokens: 200, completionTokens: 1, cost: 0.0001 },
        Main: { requests: 999, promptTokens: 1500, completionTokens: 500, cost: 0.1234 },
      },
    } });

    expect(html).toMatch(/<h2[^>]*>Provider distribution<\/h2>/);
    expect(html).toContain("3 upstream sources");
    expect(html).toContain("99.9%");
    expect(html).toContain("width:0.1%");
    expect(html).toContain("width:0%");
    expect(html).toContain("2.0K tokens");
    expect(html).toContain("$0.1234");
    expect(html).toContain('href="/dashboard/providers"');
    expect(html).toContain("Manage upstreams");
    expect(html).toContain('role="img"');
    expect(html).not.toContain("ui-card");
  });

  it("keeps the five-row provider limit while representing every source in the distribution", () => {
    const byProvider = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
      `source-${index}`, { requests: index + 1 },
    ]));

    const html = renderCard("ProviderDistributionCard", { stats: { totalRequests: 21, byProvider } });

    expect(html).toContain("6 upstream sources");
    expect(html.match(/<li\b/g)).toHaveLength(5);
    expect(html).toContain("source-0: 4.8%");
  });

  it("renders resolved provider labels and merges ids that share one label", () => {
    const html = renderCard("ProviderDistributionCard", { stats: {
      totalRequests: 10,
      byProvider: {
        "openai-compatible-chat-deleted": { label: "Custom provider", requests: 4 },
        "openai-compatible-chat-other": { label: "Custom provider", requests: 1 },
        river: { label: "River", requests: 5 },
      },
    } });

    expect(html).toContain("2 upstream sources");
    expect(html).toContain("Custom provider");
    expect(html).toContain("River");
    expect(html).not.toContain("openai-compatible-chat-deleted");
    expect(html).not.toContain("openai-compatible-chat-other");
  });

  it.each([
    ["TopModelsCard", "No model usage records found in this time range.", "/dashboard/combos"],
    ["ProviderDistributionCard", "No provider traffic logged for this period.", "/dashboard/providers"],
  ])("preserves %s empty state and usable navigation", (name, message, href) => {
    const html = renderCard(name, { stats: null });
    expect(html).toContain(message);
    expect(html).toContain(`href="${href}"`);
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

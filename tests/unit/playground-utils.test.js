import { describe, expect, it } from "vitest";
import {
  buildMetricParts,
  buildRoutePlan,
  cacheShare,
  estimateTokens,
  formatLatency,
  formatSpeed,
  shortModelName,
} from "@/app/(dashboard)/dashboard/playground/playgroundUtils.js";

describe("formatLatency", () => {
  it("uses ms below a second and seconds above", () => {
    expect(formatLatency(820)).toBe("820ms");
    expect(formatLatency(1240)).toBe("1.2s");
  });
  it("returns an empty string for missing values", () => {
    expect(formatLatency(0)).toBe("");
    expect(formatLatency(null)).toBe("");
    expect(formatLatency(Number.NaN)).toBe("");
  });
});

describe("formatSpeed", () => {
  it("divides completion tokens by the post-first-token window", () => {
    expect(formatSpeed({ completion_tokens: 420 }, 500, 5500)).toBe("84 tok/s");
  });
  it("stays empty without usage or a positive window", () => {
    expect(formatSpeed(null, 500, 5500)).toBe("");
    expect(formatSpeed({ completion_tokens: 10 }, 500, 500)).toBe("");
    expect(formatSpeed({ completion_tokens: 10 }, null, 1000)).toBe("");
  });
});

describe("shortModelName", () => {
  it("keeps the tail after the last slash", () => {
    expect(shortModelName("deepseek-ai/DeepSeek-V4.1-Flash")).toBe("DeepSeek-V4.1-Flash");
  });
  it("truncates with an ellipsis past the limit", () => {
    expect(shortModelName("a/abcdefghijklmnopqrstuvwxyz012345", 10)).toBe("abcdefghi…");
  });
  it("handles empty values", () => {
    expect(shortModelName("")).toBe("");
    expect(shortModelName(null)).toBe("");
  });
});

describe("estimateTokens", () => {
  it("rounds characters up in fours", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("cacheShare", () => {
  it("reports no data when nothing was prompted", () => {
    expect(cacheShare({ totalCachedTokens: 0, totalPromptTokens: 0 })).toEqual({
      percent: 0, cached: 0, prompt: 0, hasData: false,
    });
  });
  it("computes a capped percentage", () => {
    expect(cacheShare({ totalCachedTokens: 942, totalPromptTokens: 1000 })).toMatchObject({
      percent: 94.2, cached: 942, prompt: 1000, hasData: true,
    });
    expect(cacheShare({ totalCachedTokens: 2000, totalPromptTokens: 1000 }).percent).toBe(100);
  });
  it("tolerates a missing payload", () => {
    expect(cacheShare(null)).toEqual({ percent: 0, cached: 0, prompt: 0, hasData: false });
  });
});

describe("buildMetricParts", () => {
  it("orders TTFT, total, speed and tokens", () => {
    expect(buildMetricParts({
      firstTokenMs: 500,
      totalMs: 5500,
      usage: { prompt_tokens: 1024, completion_tokens: 420 },
      finishReason: "stop",
      reportedModel: "vendor/model-x",
      requestedModel: "vendor/model",
    })).toEqual(["TTFT 500ms", "total 5.5s", "84 tok/s", "1,024 in / 420 out", "stop", "vendor/model-x"]);
  });
  it("never emits NaN", () => {
    expect(buildMetricParts({ firstTokenMs: null, totalMs: null, usage: null })).toEqual([]);
  });
  it("marks stopped turns", () => {
    expect(buildMetricParts({ totalMs: 900, stopped: true })).toContain("stopped");
  });
});

const combos = [
  { name: "fast-pool", publicName: "deepseek-flash", models: ["river/deepseek-v4", "beatapi/qwen", "custom/llama"] },
];
const providers = [
  { id: "c1", provider: "openai", name: "work" },
  { id: "c2", provider: "openai", name: "personal" },
];

describe("buildRoutePlan", () => {
  it("returns an empty plan without a target", () => {
    expect(buildRoutePlan(null, combos, providers)).toMatchObject({ kind: "none", rows: [] });
  });
  it("lists a combo chain in configured order", () => {
    const plan = buildRoutePlan(
      { value: "deepseek-flash", name: "deepseek-flash", isCombo: true },
      combos,
      providers,
      { "fast-pool": { fallbackStrategy: "round-robin" } },
    );
    expect(plan.kind).toBe("combo");
    expect(plan.rows.map((row) => row.role)).toEqual(["primary", "fallback 1", "fallback 2"]);
    expect(plan.rows[0]).toMatchObject({ provider: "river", model: "deepseek-v4" });
    expect(plan.strategy).toBe("round-robin");
    expect(plan.summary).toContain("3 upstreams");
  });
  it("reports a direct target with its connection count", () => {
    const plan = buildRoutePlan(
      { value: "openai/gpt-4o", name: "GPT-4o", providerId: "openai", providerName: "OpenAI" },
      combos,
      providers,
    );
    expect(plan).toMatchObject({ kind: "direct", label: "Direct", connections: 2 });
    expect(plan.rows).toHaveLength(1);
  });
  it("does not treat a non-combo model as a combo", () => {
    const plan = buildRoutePlan({ value: "river/deepseek-v4", name: "deepseek-v4", providerId: "river" }, combos, []);
    expect(plan.kind).toBe("direct");
  });
});

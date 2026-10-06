import { describe, it, expect } from "vitest";
import { validateKeySettings, policyDefaults, sanitizeApiKey } from "@/lib/apiKeyPolicy/settings.js";
import { quotaPeriodStart, assertModelAllowed, enforceOutputLimit, ApiKeyPolicyError } from "@/lib/apiKeyPolicy/rules.js";
import { responseUsageObserver } from "@/lib/apiKeyPolicy/responseUsage.js";

describe("API key policy settings", () => {
  it("gives legacy keys unrestricted defaults", () => {
    expect(policyDefaults({})).toMatchObject({ tokenMultiplier: 1, quotaResetCycle: "lifetime", maxTokensQuota: null, allowedEndpoints: null, allowedModels: [], blockedModels: [] });
  });
  it.each([
    { maxTokensQuota: -1 }, { maxCostUsd: -1 }, { rateLimitRpm: 0 }, { rateLimitTpm: 1.5 },
    { tokenMultiplier: 0 }, { tokenMultiplier: Infinity }, { maxOutputTokens: -1 },
    { expiresAt: "not-a-date" }, { expiresAt: "2026-02-30T00:00:00Z" }, { expiresAt: "2026-10-07T00:00:00" },
    { quotaResetCycle: "custom" }, { allowedEndpoints: ["fake"] },
    { allowedModels: "gpt-4" }, { key: "new-secret" }, { isActive: "false" }, { name: " " },
  ])("rejects invalid settings %j", (settings) => {
    expect(() => validateKeySettings(settings)).toThrow();
  });
  it("accepts empty endpoint permissions and nullable limits", () => {
    expect(validateKeySettings({ maxTokensQuota: null, maxCostUsd: 0, allowedEndpoints: [], name: "production", tokenMultiplier: 1.5 })).toMatchObject({ maxTokensQuota: null, maxCostUsd: 0, allowedEndpoints: [], tokenMultiplier: 1.5 });
  });
  it("fully masks short credentials instead of revealing overlapping prefix and suffix", () => {
    expect(sanitizeApiKey({ id: "id", key: "short-secret" }).keyPrefix).toBe("••••••");
  });
});

describe("response usage observation", () => {
  it("handles metadata split across chunks and ignores quoted payloads", () => {
    const observer = responseUsageObserver("application/json");
    const data = JSON.stringify({ message: { content: '"usage":{"input_tokens":999} braces {} and \\"quotes"' }, usage: { input_tokens: 7, output_tokens: 4 } });
    for (const character of data) observer.push(new TextEncoder().encode(character));
    expect(observer.result()).toMatchObject({ hasUsage: true, input: 7, output: 4 });
  });
  it("retains canonical cached-token accounting for fallback cost calculations", () => {
    const observer = responseUsageObserver("application/json");
    observer.push(new TextEncoder().encode(JSON.stringify({ usage: { input_tokens: 5, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } })));
    expect(observer.result()).toMatchObject({ input: 15, output: 4, tokens: { prompt_tokens: 15, completion_tokens: 4, cached_tokens: 7, cache_creation_input_tokens: 3 } });
  });
});

describe("quota reset cycles", () => {
  const now = new Date("2026-10-07T13:45:12Z");
  it.each([
    ["hourly", "2026-10-07T13:00:00.000Z"], ["daily", "2026-10-07T00:00:00.000Z"],
    ["weekly", "2026-10-05T00:00:00.000Z"], ["monthly", "2026-10-01T00:00:00.000Z"],
  ])("uses the UTC %s boundary", (cycle, expected) => {
    expect(quotaPeriodStart(cycle, now)).toBe(expected);
  });
  it("never resets lifetime usage", () => expect(quotaPeriodStart("lifetime", now)).toBe(null));
});

describe("model restrictions", () => {
  const policy = { allowedModels: ["openai/*", "production"], blockedModels: ["gpt-blocked", "anthropic/*"] };
  it("allows matching provider wildcard", () => expect(() => assertModelAllowed(policy, ["openai/gpt-4", "gpt-4"])).not.toThrow());
  it("blacklist overrides whitelist and combo grants", () => expect(() => assertModelAllowed(policy, ["production", "openai/gpt-blocked", "gpt-blocked"])).toThrow(ApiKeyPolicyError));
  it("rejects models outside whitelist", () => expect(() => assertModelAllowed(policy, ["gemini/pro"])).toThrow(/not allowed/i));
  it("allows unrestricted keys", () => expect(() => assertModelAllowed({}, ["any/model"])).not.toThrow());
});

describe("maximum output tokens", () => {
  it.each(["max_tokens", "max_completion_tokens", "max_output_tokens"])("rejects excessive %s", (field) => {
    expect(() => enforceOutputLimit({ [field]: 4097 }, 4096)).toThrow(/output token/i);
  });
  it("caps requests that omit output limits", () => expect(enforceOutputLimit({ model: "test" }, 4096).max_tokens).toBe(4096));
  it("uses the Responses token field for string input", () => expect(enforceOutputLimit({ input: "hello" }, 4096).max_output_tokens).toBe(4096));
  it("checks Gemini and Ollama variants", () => {
    expect(() => enforceOutputLimit({ generationConfig: { maxOutputTokens: 5000 } }, 4096)).toThrow();
    expect(() => enforceOutputLimit({ options: { num_predict: -1 } }, 4096)).toThrow();
  });
  it("leaves uncapped requests alone", () => expect(enforceOutputLimit({ max_tokens: 9000 }, null)).toEqual({ max_tokens: 9000 }));
});

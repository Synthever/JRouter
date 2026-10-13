import { describe, expect, it } from "vitest";
import { validateModelsAliasName, normalizeModelsAliasConfig, getConfiguredAliasOrder, getModelsAliasConfigKey } from "@/lib/modelsAliases/config.js";
import { resolveAliasMembersFromContext } from "@/lib/modelsAliases/members.js";

const input = { name: "DeepSeek/Flash", models: ["cmc/deepseek/Flash", "cbai/Flash", "cmc/deepseek/Flash"], primaryModel: "cbai/Flash" };

describe("compatible node canonical identity", () => {
  it.each([
    ["built-in ID", "openai", "openai-compatible"],
    ["built-in alias", "xmtp", "openai-compatible"],
    ["virtual ID", "jrouter", "openai-compatible"],
    ["unsupported ID", "custom-node", "openai-compatible"],
    ["Anthropic ID with OpenAI type", "anthropic-compatible-invalid", "openai-compatible"],
    ["OpenAI ID with Anthropic type", "openai-compatible-invalid", "anthropic-compatible"],
    ["nonstring ID", 7, "openai-compatible"],
    ["null ID", null, "openai-compatible"],
    ["empty ID", "", "openai-compatible"],
    ["missing OpenAI suffix", "openai-compatible-", "openai-compatible"],
    ["missing Anthropic suffix", "anthropic-compatible-", "anthropic-compatible"],
    ["slash-bearing ID", "openai-compatible-invalid/nested", "openai-compatible"],
    ["whitespace-bearing ID", "openai-compatible-invalid ", "openai-compatible"],
    ["newline-bearing ID", "openai-compatible-invalid\n", "openai-compatible"],
    ["control-bearing ID", "openai-compatible-invalid\u0000", "openai-compatible"],
    ["DEL-bearing ID", "openai-compatible-invalid\u007f", "openai-compatible"],
    ["placeholder ID", "openai-compatible-__placeholder__", "openai-compatible"],
    ["punctuation-bearing ID", "openai-compatible-invalid?", "openai-compatible"],
  ])("rejects a %s selected through a different prefix", (_label, id, type) => {
    const context = {
      providerNodes: [{ id, type, prefix: "corp" }],
      providerConnections: [{ id: "builtin-account", provider: "openai" }],
      customModels: [],
    };
    expect(() => resolveAliasMembersFromContext(["corp/gpt-4o"], context)).toThrow(/provider/i);
  });
  it.each([
    ["openai-compatible-chat-fixture", "openai-compatible"],
    ["openai-compatible-responses-fixture", "openai-compatible"],
    ["anthropic-compatible-fixture", "anthropic-compatible"],
  ])("preserves exact %s identity and case-sensitive nested models", (id, type) => {
    const context = { providerNodes: [{ id, type, prefix: "corp" }], providerConnections: [], customModels: [] };
    expect(resolveAliasMembersFromContext(["corp/Nested/Flash", `${id}/Nested/Flash`], context)).toEqual([
      { requested: "corp/Nested/Flash", provider: id, model: "Nested/Flash", canonicalId: `${id}/Nested/Flash` },
      { requested: `${id}/Nested/Flash`, provider: id, model: "Nested/Flash", canonicalId: `${id}/Nested/Flash` },
    ]);
  });
});

describe("Models Aliases configuration", () => {
  it("preserves slash-bearing names and rejects repeated namespace", () => {
    expect(validateModelsAliasName("deepseek/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
    expect(validateModelsAliasName("DeepSeek/Flash_1.0")).toBe("DeepSeek/Flash_1.0");
    for (const name of ["jrouter/deepseek/flash", "deepseek//flash", "/flash", "flash/", "flash name", "https://flash", "flash\n", "", null]) {
      expect(() => validateModelsAliasName(name)).toThrow();
    }
  });
  it("pins primary without mutating or duplicating members", () => {
    expect(getConfiguredAliasOrder(input)).toEqual(["cbai/Flash", "cmc/deepseek/Flash"]);
    expect(input.models).toHaveLength(3);
  });
  it("normalizes defaults and prompt fields without persisting extra input", () => {
    const normalized = normalizeModelsAliasConfig({ ...input, id: "ignored" });
    expect(normalized).toEqual({ name: "DeepSeek/Flash", models: ["cbai/Flash", "cmc/deepseek/Flash"], primaryModel: "cbai/Flash", strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 15, promptInjectionEnabled: false, promptInjectionMode: "prepend", systemPrompt: null, displayIdentity: null });
    expect(input.models).toHaveLength(3);
    expect(normalizeModelsAliasConfig({ ...input, strategy: "fusion", judgeModel: "cmc/deepseek/Flash", promptInjectionEnabled: true, promptInjectionMode: "replace", systemPrompt: "one\ntwo", displayIdentity: "Agent" })).toMatchObject({ judgeModel: "cmc/deepseek/Flash", systemPrompt: "one\ntwo" });
  });
  it.each([0, -1, NaN, Infinity, "15", null, 2147483.648, Number.MIN_VALUE, 0.0001, 15n])("rejects unrepresentable initial deadlines %s", (timeout) => {
    expect(() => normalizeModelsAliasConfig({ ...input, initialResponseTimeoutSeconds: timeout })).toThrow(/timeout|deadline/i);
  });
  it("accepts fractional seconds and the maximum safe JS timer", () => {
    for (const timeout of [0.001, 0.5, 2147483.647]) expect(normalizeModelsAliasConfig({ ...input, initialResponseTimeoutSeconds: timeout }).initialResponseTimeoutSeconds).toBe(timeout);
  });
  it.each([{ models: [] }, { primaryModel: "missing/model" }, { primaryModel: null }, { judgeModel: "missing/model" }, { strategy: "random" }, { promptInjectionEnabled: 1 }, { promptInjectionMode: "bad" }, { systemPrompt: [] }, { models: ["bare"] }, { models: ["jrouter/virtual"] }, { models: ["node/model-id"] }, { models: ["__placeholder__node/model"] }, { models: ["node/deepseek//flash"] }, { models: ["node/https://model"] }, { models: ["node/model "] }])("rejects invalid configuration %j", (invalid) => {
    expect(() => normalizeModelsAliasConfig({ ...input, ...invalid })).toThrow();
  });
  it("rejects embedded control characters in member paths", () => {
    for (const member of ["node/Flash\u0000", "node/Flash\u007f"]) expect(() => normalizeModelsAliasConfig({ ...input, models: [member], primaryModel: member })).toThrow(/member/i);
  });
  it("keys routing and prompt edits independently of timestamp precision", () => {
    const alias = normalizeModelsAliasConfig(input);
    expect(getModelsAliasConfigKey(alias)).toBe(getModelsAliasConfigKey({ ...alias, updatedAt: "different" }));
    for (const edit of [{ name: "renamed" }, { primaryModel: "cmc/deepseek/Flash" }, { models: [...alias.models, "other/model"] }, { strategy: "fusion" }, { judgeModel: "cmc/deepseek/Flash" }, { initialResponseTimeoutSeconds: 14 }, { systemPrompt: "new" }]) {
      expect(getModelsAliasConfigKey({ ...alias, ...edit })).not.toBe(getModelsAliasConfigKey(alias));
    }
  });
});

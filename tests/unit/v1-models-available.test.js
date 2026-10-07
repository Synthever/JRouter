import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: db.getDisabledModels }));
vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(async () => ({ models: [{ id: "unselected-live-model" }] })),
}));
vi.mock("open-sse/services/cursorModels.js", () => ({
  resolveCursorModels: vi.fn(async () => ({ models: [{ id: "cursor-live-model" }] })),
}));

import { buildModelsList } from "@/app/api/v1/models/route.js";

const providerId = "openai-compatible-chat-openrouter";
const selectedIds = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "inclusionai/ling-3.0-flash-fin:free",
];

beforeEach(() => {
  db.getProviderConnections.mockResolvedValue([{
    id: "openrouter-key",
    provider: providerId,
    isActive: true,
    apiKey: "fixture-key",
    providerSpecificData: { prefix: "op", baseUrl: "https://fixture.invalid/v1" },
  }]);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
  db.getDisabledModels.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    data: Array.from({ length: 600 }, (_, i) => ({ id: `upstream-model-${i}` })),
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe("/v1/models available provider models", () => {
  it("lists only the three saved OpenRouter models, not the upstream catalog", async () => {
    db.getCustomModels.mockResolvedValue(selectedIds.map((id) => ({
      providerAlias: providerId, id, type: "llm",
    })));

    const models = await buildModelsList(["llm"]);

    expect(models).toHaveLength(3);
    expect(models.map((model) => model.id)).toEqual([
      "op/nvidia/nemotron-3-ultra-550b-a55b:free",
      "op/poolside/laguna-s-2.1:free",
      "op/inclusionai/ling-3.0-flash-fin:free",
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["openai-compatible-chat-empty", "anthropic-compatible-empty"])(
    "does not discover models for %s when Available Models is empty",
    async (provider) => {
      db.getProviderConnections.mockResolvedValue([{
        provider, isActive: true, apiKey: "fixture-key",
        providerSpecificData: { prefix: "empty", baseUrl: "https://fixture.invalid/v1" },
      }]);

      expect(await buildModelsList(["llm"])).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps saved models separate for each provider and deduplicates legacy aliases", async () => {
    db.getProviderConnections.mockResolvedValue([
      { provider: providerId, isActive: true, providerSpecificData: { prefix: "op" } },
      { provider: "anthropic-compatible-other", isActive: true, providerSpecificData: { prefix: "other" } },
    ]);
    db.getCustomModels.mockResolvedValue([
      { providerAlias: providerId, id: "selected", type: "llm" },
      { providerAlias: "anthropic-compatible-other", id: "selected", type: "llm" },
      { providerAlias: "openai-compatible-inactive", id: "not-available", type: "llm" },
    ]);
    db.getModelAliases.mockResolvedValue({
      duplicate: `${providerId}/selected`,
      legacy: `${providerId}/legacy-model`,
    });

    expect((await buildModelsList(["llm"])).map((model) => model.id)).toEqual([
      "op/selected", "op/legacy-model", "other/selected",
    ]);
  });

  it("preserves enabled and disabled model configuration", async () => {
    db.getProviderConnections.mockResolvedValue([{
      provider: providerId, isActive: true,
      providerSpecificData: { prefix: "op", enabledModels: ["selected", "blocked", "selected"] },
    }]);
    db.getDisabledModels.mockResolvedValue({ [providerId]: ["blocked"] });

    expect((await buildModelsList(["llm"])).map((model) => model.id)).toEqual(["op/selected"]);
  });

  it("preserves native provider models while excluding disabled entries", async () => {
    db.getProviderConnections.mockResolvedValue([{ provider: "deepseek", isActive: true }]);
    db.getDisabledModels.mockResolvedValue({ ds: ["deepseek-reasoner"] });

    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids).toContain("ds/deepseek-chat");
    expect(ids).not.toContain("ds/deepseek-reasoner");
    expect(ids.every((id) => id.startsWith("ds/"))).toBe(true);
  });

  it("does not replace native Available Models with an upstream live catalog", async () => {
    db.getProviderConnections.mockResolvedValue([{ provider: "kiro", isActive: true }]);

    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("kr/"))).toBe(true);
    expect(ids).not.toContain("kr/unselected-live-model");
  });

  it("preserves live models for Cursor, whose Available Models uses its live catalog", async () => {
    db.getProviderConnections.mockResolvedValue([{ provider: "cursor", isActive: true }]);

    expect((await buildModelsList(["llm"])).map((model) => model.id)).toEqual(["cu/cursor-live-model"]);
  });

  it("keeps vision chat models and excludes models belonging to other service kinds", async () => {
    db.getCustomModels.mockResolvedValue([
      { providerAlias: providerId, id: "selected", type: "llm" },
      { providerAlias: providerId, id: "vision", type: "imageToText" },
      { providerAlias: providerId, id: "embedding", type: "embedding" },
    ]);

    expect((await buildModelsList(["llm"])).map((model) => model.id)).toEqual(["op/selected", "op/vision"]);
  });

  it.each([[[]], [[{ provider: "deepseek", isActive: false }]]])(
    "does not publish the full registry when no providers are active: %j",
    async (connections) => {
      db.getProviderConnections.mockResolvedValue(connections);
      db.getCustomModels.mockResolvedValue([{ providerAlias: "ds", id: "not-active", type: "llm" }]);
      db.getCombos.mockResolvedValue([{ name: "configured-combo", models: ["ds/deepseek-chat"] }]);

      expect((await buildModelsList(["llm"])).map((model) => model.id)).toEqual(["configured-combo"]);
    },
  );
});

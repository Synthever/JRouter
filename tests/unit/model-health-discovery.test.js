import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{
    provider: "openai-compatible-fixture", isActive: true, apiKey: "fixture",
    providerSpecificData: { baseUrl: "https://fixture/v1", prefix: "fixture" },
  }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => [{
    providerAlias: "openai-compatible-fixture", id: "selected", type: "llm",
  }]),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

import { buildModelsList } from "@/app/api/v1/models/route.js";

afterEach(() => vi.unstubAllGlobals());

describe("health catalog discovery", () => {
  it("uses configured models without contacting compatible upstream catalogs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "unselected" }] })));

    const models = await buildModelsList(["llm"], { skipLiveResolvers: true });

    expect(models.map((model) => model.id)).toEqual(["fixture/selected"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Discovery publishes a combo's effective public id (publicName, else name) so
// the id a user key lists is the id it calls.
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("custom model-id in the public catalog", () => {
  it("lists a published combo under its publicName", async () => {
    db.getCombos.mockResolvedValue([
      {
        id: "c1",
        name: "fast-fallback",
        visibility: "public",
        publicName: "gpt-fast",
        models: ["openai/model-a"],
        kind: null,
      },
    ]);
    const list = await buildModelsList(["llm"]);
    const ids = list.filter((m) => m.owned_by === "combo").map((m) => m.id);
    expect(ids).toContain("gpt-fast");
    expect(ids).not.toContain("fast-fallback");
  });

  it("lists a published combo by its own name when publicName is null", async () => {
    db.getCombos.mockResolvedValue([
      { id: "c2", name: "named-combo", visibility: "public", publicName: null, models: ["openai/model-b"], kind: null },
    ]);
    const ids = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "combo").map((m) => m.id);
    expect(ids).toContain("named-combo");
  });

  it("keeps listing private combos for owner callers", async () => {
    // The role gate filters per key; discovery itself cannot hide what an
    // owner explicitly calls by name.
    db.getCombos.mockResolvedValue([
      { id: "c3", name: "private-thing", visibility: "private", publicName: null, models: ["openai/model-c"], kind: null },
    ]);
    const ids = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "combo").map((m) => m.id);
    expect(ids).toContain("private-thing");
  });
});

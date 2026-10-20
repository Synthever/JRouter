import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "fast-fallback", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] },
    { id: "c2", name: "internal-only", visibility: "private", publicName: null, models: ["openai/model-b"] },
    { id: "c3", name: "named-combo", visibility: "public", publicName: null, models: ["openai/model-c"] },
  ],
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) =>
    fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => [],
}));

const { getComboModels, getModelInfo, resolvePublicCombo } = await import("../../src/sse/services/model.js");

beforeEach(() => {
  fx.combos = fx.combos.map((c) => ({ ...c }));
});

describe("custom model-id resolution", () => {
  it("resolves a published publicName to its members", async () => {
    expect(await resolvePublicCombo("gpt-fast")).toMatchObject({ name: "fast-fallback" });
    expect(await getComboModels("gpt-fast")).toEqual(["openai/model-a"]);
  });

  it("falls back to the combo name when publicName is null", async () => {
    expect(await getComboModels("named-combo")).toEqual(["openai/model-c"]);
  });

  it("does not expose a private combo through a public lookup", async () => {
    expect(await resolvePublicCombo("internal-only")).toBeNull();
    // the internal combo stays callable by its own name, exactly as today
    expect(await getComboModels("internal-only")).toEqual(["openai/model-b"]);
  });

  it("routes a public name through the combo path, not to a provider", async () => {
    expect(await getModelInfo("gpt-fast")).toEqual({ provider: null, model: "fast-fallback" });
  });

  it("leaves provider/model strings and unknown names alone", async () => {
    expect((await getModelInfo("openai/model-a")).provider).toBe("openai");
    expect(await resolvePublicCombo("nope")).toBeNull();
    expect(await getComboModels("nope")).toBeNull();
  });
});

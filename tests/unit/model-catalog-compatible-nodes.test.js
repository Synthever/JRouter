import { describe, expect, it, vi } from "vitest";
import { useModelCatalog } from "../../src/shared/hooks/useModelCatalog.js";

const state = vi.hoisted(() => ({ values: [], index: 0 }));

vi.mock("react", () => ({
  useEffect: vi.fn(),
  useMemo: (compute) => compute(),
  useState: () => [state.values[state.index++], vi.fn()],
}));
vi.mock("@/shared/hooks/useModelCaps", () => ({
  useModelCaps: () => ({ getCaps: () => ({}) }),
}));

function Catalog(options) {
  return useModelCatalog(options);
}

function catalog({ nodes = [], models = [], disabled = {}, ...options } = {}) {
  state.values = [[], nodes, models, disabled, "", [], [], [], []];
  state.index = 0;
  return Catalog(options);
}

describe("shared model picker compatible nodes", () => {
  it.each([
    "openai-compatible-chat-deleted",
    "anthropic-compatible-deleted",
  ])("does not resurrect deleted provider %s from its custom models", (providerAlias) => {
    const { groups } = catalog({ models: [{ providerAlias, id: "glm-5.2" }] });
    expect(groups[providerAlias]).toBeUndefined();
  });

  it.each([
    "openai-compatible-chat-existing",
    "anthropic-compatible-existing",
  ])("keeps registered models for existing node %s without a saved connection", (id) => {
    const { groups } = catalog({
      nodes: [{ id, name: "My Provider", prefix: "mine" }],
      models: [{ providerAlias: id, id: "glm-5.2" }],
    });
    expect(groups[id]).toMatchObject({
      name: "My Provider",
      alias: "mine",
      models: [{ id: "glm-5.2", value: "mine/glm-5.2", isCustom: true }],
    });
  });

  it("keeps connected provider placeholders when no models are registered", () => {
    const id = "openai-compatible-chat-connected";
    const { groups } = catalog({
      nodes: [{ id, name: "Connected Provider", prefix: "cp" }],
      activeProviders: [{ provider: id, name: "Account" }],
    });
    expect(groups[id].models).toEqual([{
      id: `__placeholder__${id}`,
      name: "cp/model-id",
      value: "cp/model-id",
      isPlaceholder: true,
    }]);
  });

  it("preserves aliases and disabled-model filtering for existing nodes", () => {
    const id = "openai-compatible-chat-existing";
    const { groups } = catalog({
      nodes: [{ id, name: "My Provider", prefix: "mine" }],
      models: [{ providerAlias: id, id: "hidden" }],
      modelAliases: { Visible: `${id}/visible` },
      disabled: { [id]: ["hidden"] },
    });
    expect(groups[id].models).toEqual([{
      id: "visible", name: "Visible", value: "mine/visible",
    }]);
  });
});

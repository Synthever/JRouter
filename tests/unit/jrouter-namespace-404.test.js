import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ nodes: [] }));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async (filter) => state.nodes.filter((n) => !filter?.type || n.type === filter.type),
  getSettings: async () => ({}),
}));

vi.mock("@/lib/apiKeyPolicy/context.js", () => ({ assertCurrentModelAllowed: () => {} }));

import { getModelInfo } from "@/sse/services/model.js";

beforeEach(() => {
  state.nodes = [];
});

describe("jrouter virtual namespace resolution", () => {
  it("rejects an unresolved jrouter/* target with the real cause, not a credential error", async () => {
    await expect(getModelInfo("jrouter/zai/glm-5.3-flash")).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringMatching(/namespace/i),
    });
  });

  it("still resolves a user provider node that claims the jrouter prefix", async () => {
    state.nodes = [{ id: "openai-compatible-chat-node1", prefix: "jrouter", type: "openai-compatible" }];
    const info = await getModelInfo("jrouter/my-model");
    expect(info).toEqual({ provider: "openai-compatible-chat-node1", model: "my-model" });
  });

  it("leaves ordinary provider models untouched", async () => {
    const info = await getModelInfo("rvr/zai-org/GLM-5.3-Flash");
    expect(info.provider).toBe("rvr");
  });
});

import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ handlerCalled: false }));

vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({ transaction: (fn) => fn() }) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getComboByPublicName: async () => null }));
vi.mock("@/lib/apiKeyPolicy/authentication.js", () => ({
  authenticatePolicyKey: async () => ({ id: "k1", allowedEndpoints: null, allowedModels: [], maxCostUsd: null, maxOutputTokens: null }),
}));
vi.mock("@/sse/services/model.js", () => ({
  getComboModels: async () => null,
  getModelInfo: async (name) => {
    const err = new Error("Unknown jrouter/* target: the Models Aliases virtual namespace is not active on this instance. Use a provider model, provider node or combo.");
    err.statusCode = 404;
    throw err;
  },
}));

import { withApiKeyPolicy } from "@/lib/apiKeyPolicy/gateway.js";

describe("withApiKeyPolicy resolves typed model errors to their HTTP status", () => {
  it("returns the typed 404 for an unresolvable jrouter/* target instead of a 500", async () => {
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
      body: JSON.stringify({ model: "jrouter/zai/glm-5.3-flash", stream: false, messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await withApiKeyPolicy(request, () => { state.handlerCalled = true; return Response.json({ ok: true }); }, { family: "chat" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error?.message).toMatch(/namespace/i);
    expect(state.handlerCalled).toBe(false);
  });
});

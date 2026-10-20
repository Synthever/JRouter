// count_tokens once accepted any model string from any authenticated key. A
// user key must get the same typed 403 the chat path gives, without the route
// becoming an oracle for which a model exists.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({ combos: [], keys: {} }));

// The route is about the key-access gate, so the quota/policy wrapper is a
// passthrough; its own behaviour is covered by the api-key policy suites.
vi.mock("@/lib/apiKeyPolicy/gateway.js", () => ({
  withApiKeyPolicy: (request, handler) => handler(request),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) =>
    fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => [],
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (k) => fx.keys[k] || null,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

const { POST } = await import("../../src/app/api/v1/messages/count_tokens/route.js");

beforeEach(() => {
  fx.keys = {
    "sk-user": { id: "u", name: "user", isActive: true, role: "user", access: { restricted: false, allow: [] } },
  };
  fx.combos = [
    { id: "c1", name: "fast", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] },
  ];
});

const post = (model, key) =>
  POST(
    new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hello world" }] }),
    })
  );

describe("count_tokens honours key roles", () => {
  it("answers for a published custom model-id", async () => {
    const res = await post("gpt-fast", "sk-user");
    expect(res.status).toBe(200);
    expect((await res.json()).input_tokens).toBe(3);
  });

  it("denies a provider model for a user key without contacting an upstream", async () => {
    const res = await post("openai/model-a", "sk-user");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_not_allowed");
  });

  it("denies an unknown bare name too", async () => {
    const res = await post("nope", "sk-user");
    expect(res.status).toBe(403);
  });

  it("leaves anonymous calls as they are", async () => {
    expect((await post("openai/model-a")).status).toBe(200);
  });

  it("leaves owner keys as they are", async () => {
    fx.keys["sk-owner"] = { id: "o", name: "owner", isActive: true, role: "owner", access: { restricted: false, allow: [] } };
    expect((await post("openai/model-a", "sk-owner")).status).toBe(200);
  });
});

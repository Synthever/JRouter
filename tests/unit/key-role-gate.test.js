// Role gate: a `user` key may call only published Custom Model-IDs. An `owner`
// key keeps every path open, and a row without a role column is legacy → owner.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    {
      id: "c1",
      name: "fast-fallback",
      visibility: "public",
      publicName: "gpt-fast",
      models: ["openai/model-a", "openai/model-b"],
    },
    {
      id: "c2",
      name: "internal-only",
      visibility: "private",
      publicName: null,
      models: ["openai/model-c"],
    },
  ],
  nodes: [],
  aliases: {},
  keys: {},
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.aliases,
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getComboByPublicName: async (publicName) =>
    fx.combos.find((c) => (c.publicName || c.name) === publicName) || null,
  getProviderNodes: async () => fx.nodes,
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

const engine = await import("../../src/sse/services/keyAccess.js");

const req = (k) =>
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${k}` },
  });
const ctxFor = (k) => engine.getKeyAccessContext(req(k));
const gate = async (k, model) => engine.enforceKeyAccess(await ctxFor(k), model);
const status = async (k, model) => {
  const r = await gate(k, model);
  return r ? r.status : 200;
};

beforeEach(() => {
  fx.keys = {};
  fx.keys["sk-owner"] = {
    id: "o",
    name: "owner-key",
    isActive: true,
    role: "owner",
    access: { restricted: false, allow: [] },
  };
  fx.keys["sk-user"] = {
    id: "u",
    name: "user-key",
    isActive: true,
    role: "user",
    access: { restricted: false, allow: [] },
  };
  fx.keys["sk-user-restricted"] = {
    id: "ur",
    name: "user-restricted",
    isActive: true,
    role: "user",
    access: { restricted: true, allow: ["GPT-Fast"] },
  };
  fx.keys["sk-legacy"] = {
    id: "l",
    name: "legacy",
    isActive: true,
    access: { restricted: false, allow: [] },
  };
});

describe("api key role gate", () => {
  it("treats a key without the role column as owner", async () => {
    expect(await ctxFor("sk-legacy")).toBeNull();
    expect(await status("sk-legacy", "openai/model-a")).toBe(200);
    expect(await status("sk-legacy", "internal-only")).toBe(200);
  });

  it("owner keeps every path open", async () => {
    expect(await status("sk-owner", "gpt-fast")).toBe(200);
    expect(await status("sk-owner", "internal-only")).toBe(200);
    expect(await status("sk-owner", "openai/model-a")).toBe(200);
  });

  it("user may call a published custom model-id", async () => {
    expect(await status("sk-user", "gpt-fast")).toBe(200);
  });

  it("user is denied direct providers, private combos and unknown bare names", async () => {
    expect(await status("sk-user", "openai/model-a")).toBe(403);
    expect(await status("sk-user", "internal-only")).toBe(403);
    expect(await status("sk-user", "whatever")).toBe(403);
  });

  it("reports role denials with a stable code and no internal detail", async () => {
    const response = await gate("sk-user", "openai/model-a");
    const body = await response.json();
    expect(body.error.code).toBe("role_not_allowed");
    expect(body.error.message).toContain("openai/model-a");
    expect(body.error.message).not.toContain("user-key");
    expect(body.error.message).not.toContain("gpt-fast");
  });

  it("stacks the allow list inside the role, case-insensitively", async () => {
    expect(await status("sk-user-restricted", "gpt-fast")).toBe(200);
    expect(await status("sk-user-restricted", "internal-only")).toBe(403);
  });

  it("denies provider-as-model and resolved endpoints for a user key", async () => {
    const ctx = await ctxFor("sk-user");
    expect((await engine.enforceKeyAccessProvider(ctx, "tavily", null))?.status).toBe(403);
    expect(
      (await engine.enforceKeyAccessResolved(ctx, "openai/model-a", "openai", "model-a"))?.status
    ).toBe(403);
  });

  it("keeps server-injected adapter models for an authorized user target", async () => {
    const ctx = await ctxFor("sk-user");
    const augmented = ["gpt-fast", "openai/vision-model"];
    expect(await engine.filterAdapterModels(ctx, augmented, ["gpt-fast"])).toEqual(augmented);
  });

  it("lists only published custom model-ids for a user key", async () => {
    const ctx = await ctxFor("sk-user");
    const list = [
      { id: "gpt-fast", owned_by: "combo" },
      { id: "internal-only", owned_by: "combo" },
      { id: "openai/model-a", owned_by: "openai" },
    ];
    expect((await engine.filterModelsListForKey(ctx, list)).map((m) => m.id)).toEqual(["gpt-fast"]);
  });
});

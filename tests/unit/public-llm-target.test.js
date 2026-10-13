import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ aliases: [], combos: [], nodes: [], legacy: {}, connections: [] }));
vi.mock("@/lib/db/index.js", () => ({
  getModelsAliasByName: async (name) => fx.aliases.find((entry) => entry.name === name) || null,
  getComboByName: async (name) => fx.combos.find((entry) => entry.name === name) || null,
  getProviderNodes: async () => fx.nodes,
}));
vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.legacy,
  getComboByName: async (name) => fx.combos.find((entry) => entry.name === name) || null,
  getProviderNodes: async (filter = {}) => fx.nodes.filter((node) => !filter.type || node.type === filter.type),
}));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({
  all(sql) {
    if (sql.includes("providerNodes")) return fx.nodes.map(({ id, type, ...data }) => ({ id, type, data: JSON.stringify(data) }));
    if (sql.includes("providerConnections")) return fx.connections;
    if (sql.includes("customModels")) return [];
    throw new Error(`Unexpected fixture query: ${sql}`);
  },
}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));

import * as core from "open-sse/services/model.js";
import { resolvePublicLlmTarget, resolveConfiguredLlmLeaves } from "@/sse/services/publicLlmTarget.js";

beforeEach(() => {
  vi.restoreAllMocks();
  fx.aliases = [{ id: "a1", name: "deepseek/Flash", models: ["fixture/Deep/Flash"], primaryModel: "fixture/Deep/Flash" }];
  fx.combos = [{ id: "c1", name: "Main", kind: null, models: ["cx/Deep/Model"] }];
  fx.nodes = [{ id: "openai-compatible-chat-fixture", type: "openai-compatible", prefix: "fixture" }];
  fx.connections = [{ provider: "codex" }];
  fx.legacy = { fast: "cx/Deep/Model" };
});

const denied = (status, code) => ({ status, code });

describe("exact public LLM admission", () => {
  it("looks up the entire slash-bearing alias without parsing a provider", async () => {
    const parser = vi.spyOn(core, "parseModel");
    const findAliasByName = vi.fn(async (name) => name === "deepseek/Flash" ? fx.aliases[0] : null);
    const findComboByName = vi.fn(async () => null);
    const target = await resolvePublicLlmTarget("jrouter/deepseek/Flash", { findAliasByName, findComboByName });
    expect(target).toMatchObject({ kind: "alias", entityId: "a1", name: "deepseek/Flash", requestedId: "jrouter/deepseek/Flash", publicId: "jrouter/deepseek/Flash", members: ["fixture/Deep/Flash"], legacyBareRequested: false, contextMarker: null });
    expect(findAliasByName).toHaveBeenCalledWith("deepseek/Flash");
    expect(parser).not.toHaveBeenCalled();
  });

  it.each(["Main", "jrouter/Main"])("admits exact existing Combo %s", async (requested) => {
    expect(await resolvePublicLlmTarget(requested)).toMatchObject({ kind: "combo", entityId: "c1", name: "Main", publicId: "jrouter/Main", requestedId: requested, legacyBareRequested: requested === "Main" });
  });

  it.each(["Support Chat", "jrouter/Support Chat", "Support Chat[1m]", "jrouter/Support Chat[1M]"])("preserves exact persisted legacy Combo name %s", async (requested) => {
    const combo = { id: "support", name: "Support Chat", models: ["cx/Deep/Model"] };
    const findComboByName = vi.fn(async (name) => name === "Support Chat" ? combo : null);
    const parser = vi.spyOn(core, "parseModel");
    expect(await resolvePublicLlmTarget(requested, { findAliasByName: async () => null, findComboByName })).toMatchObject({
      kind: "combo", entityId: "support", name: "Support Chat", publicId: "jrouter/Support Chat",
      requestedId: requested, legacyBareRequested: !requested.startsWith("jrouter/"),
      contextMarker: requested.includes("[") ? "1m" : null,
    });
    expect(findComboByName).toHaveBeenCalledWith("Support Chat");
    expect(parser).not.toHaveBeenCalled();
    expect(combo.name).toBe("Support Chat");
  });

  it.each(["support Chat", "Support Chats", "jrouter/support Chat", "jrouter/Support Chats", "Support Chats[1m]"])("denies unconfigured similar legacy Combo name %s without provider fallback", async (requested) => {
    fx.combos.push({ id: "support", name: "Support Chat", models: ["cx/Deep/Model"] });
    const parser = vi.spyOn(core, "parseModel");
    await expect(resolvePublicLlmTarget(requested)).rejects.toMatchObject(denied(400, "invalid_request"));
    expect(parser).not.toHaveBeenCalled();
  });

  it.each(["jrouter/jrouter/Main", "jrouter/a//b", "jrouter/a/", "/Main", " ", "https://example.com/model", "jrouter/Main[1m][1m]", "Support\nChat"])("does not admit malformed or reserved persisted Combo name %j", async (requested) => {
    const combo = { id: "malformed", name: requested.startsWith("jrouter/") ? requested.slice(8) : requested, models: ["cx/Deep/Model"] };
    await expect(resolvePublicLlmTarget(requested, { findAliasByName: async () => null, findComboByName: async () => combo })).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("does not accept a persisted alias outside the alias naming grammar or its bare name", async () => {
    fx.aliases.push({ id: "invalid", name: "Support Chat", models: ["cx/Deep/Model"], primaryModel: "cx/Deep/Model" });
    await expect(resolvePublicLlmTarget("Support Chat")).rejects.toMatchObject(denied(400, "invalid_request"));
    await expect(resolvePublicLlmTarget("jrouter/Support Chat")).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("preserves existing slash-bearing bare Combo names", async () => {
    fx.combos.push({ id: "nested", name: "openai/Group", models: ["cx/Deep/Model"] });
    expect(await resolvePublicLlmTarget("openai/Group")).toMatchObject({ kind: "combo", publicId: "jrouter/openai/Group", legacyBareRequested: true });
  });

  it.each(["jrouter/deepseek/flash", "jrouter/main", "jrouter/cx/Deep/Model", "jrouter/unknown"])("never falls through an unknown namespace %s", async (requested) => {
    const parser = vi.spyOn(core, "parseModel");
    await expect(resolvePublicLlmTarget(requested)).rejects.toMatchObject(denied(404, "model_not_found"));
    expect(parser).not.toHaveBeenCalled();
  });

  it.each(["cx/Deep/Model", "codex/Deep/Model", "fast", "deepseek/Flash", "MAIN", "fixture/Deep/Flash", "gpt-4", "cx/Deep/Model[1m]"])("rejects direct or legacy targets %s", async (requested) => {
    await expect(resolvePublicLlmTarget(requested)).rejects.toMatchObject(denied(403, "direct_model_not_allowed"));
  });

  it.each([undefined, null, 4, {}, "", " ", "jrouter/", "jrouter/a//b", "jrouter/a/", "jrouter/a b", "jrouter/a\n", "https://example.com/model", "jrouter/Main[1m][1m]"])("rejects malformed target %j", async (requested) => {
    await expect(resolvePublicLlmTarget(requested)).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("strips the existing marker once and retains the original request and demand", async () => {
    expect(await resolvePublicLlmTarget("jrouter/deepseek/Flash[1M]")).toMatchObject({ requestedId: "jrouter/deepseek/Flash[1M]", publicId: "jrouter/deepseek/Flash", contextMarker: "1m" });
    expect(await resolvePublicLlmTarget("Main[1m]")).toMatchObject({ publicId: "jrouter/Main", contextMarker: "1m", legacyBareRequested: true });
  });

  it("does not admit media Combos as LLMs", async () => {
    fx.combos.push({ id: "image", name: "Pictures", kind: "image", models: ["openai/image"] });
    await expect(resolvePublicLlmTarget("jrouter/Pictures")).rejects.toMatchObject(denied(400, "invalid_request"));
    await expect(resolvePublicLlmTarget("Pictures")).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("takes an independent configuration snapshot", async () => {
    const target = await resolvePublicLlmTarget("jrouter/deepseek/Flash");
    fx.aliases[0].models.push("fixture/Other");
    expect(target.members).toEqual(["fixture/Deep/Flash"]);
    expect(target.config.models).toEqual(["fixture/Deep/Flash"]);
  });

  it("provides an existing compatible error response", async () => {
    try { await resolvePublicLlmTarget("cx/Deep/Model"); }
    catch (error) {
      const response = error.response();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "direct_model_not_allowed", message: expect.any(String) } });
    }
  });
});

describe("configured internal leaves", () => {
  it("uses provider-only alias resolution and preserves nested model case", async () => {
    const target = await resolvePublicLlmTarget("jrouter/deepseek/Flash");
    expect(await resolveConfiguredLlmLeaves(target)).toEqual([{ requested: "fixture/Deep/Flash", provider: "openai-compatible-chat-fixture", model: "Deep/Flash", canonicalId: "openai-compatible-chat-fixture/Deep/Flash" }]);
  });

  it("expands existing nested Combos and legacy leaves without request-policy side effects", async () => {
    fx.combos[0].models = ["Nested", "cx/Deep/Model"];
    fx.combos.push({ id: "c2", name: "Nested", models: ["fast", "fixture/Case/Model"] });
    expect(await resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("Main"))).toEqual([
      { requested: "fast", provider: "codex", model: "Deep/Model", canonicalId: "codex/Deep/Model" },
      { requested: "fixture/Case/Model", provider: "openai-compatible-chat-fixture", model: "Case/Model", canonicalId: "openai-compatible-chat-fixture/Case/Model" },
      { requested: "cx/Deep/Model", provider: "codex", model: "Deep/Model", canonicalId: "codex/Deep/Model" },
    ]);
  });

  it("guards cycles but permits a shared nested Combo in separate branches", async () => {
    fx.combos[0].models = ["Nested", "Nested"];
    fx.combos.push({ id: "c2", name: "Nested", models: ["cx/Deep/Model"] });
    expect(await resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("Main"))).toHaveLength(1);
    fx.combos[1].models = ["Main"];
    await expect(resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("Main"))).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("does not recurse aliases or accept virtual IDs as configured alias leaves", async () => {
    fx.aliases[0].models = ["jrouter/Other"];
    fx.aliases[0].primaryModel = "jrouter/Other";
    await expect(resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("jrouter/deepseek/Flash"))).rejects.toMatchObject(denied(400, "invalid_request"));
  });

  it("keeps built-in provider prefixes reserved against custom-node shadowing", async () => {
    fx.nodes.push({ id: "openai-compatible-chat-shadow", type: "openai-compatible", prefix: "cx" });
    expect(await resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("Main"))).toEqual([{ requested: "cx/Deep/Model", provider: "codex", model: "Deep/Model", canonicalId: "codex/Deep/Model" }]);
  });

  it.each([{ models: [] }, { models: ["jrouter/deepseek/Flash"] }, { models: [null] }])("rejects invalid configured Combo leaves $models", async ({ models }) => {
    fx.combos[0].models = models;
    await expect(resolveConfiguredLlmLeaves(await resolvePublicLlmTarget("Main"))).rejects.toMatchObject(denied(400, "invalid_request"));
  });
});

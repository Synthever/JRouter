import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const state = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => state.db }));
import { createModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { createCombo } from "@/lib/db/repos/combosRepo.js";
import { addCustomModel } from "@/lib/db/repos/aliasRepo.js";
import { resolvePublicLlmTarget, authorizeVirtualTarget } from "@/sse/services/publicLlmTarget.js";
import { getVirtualTargetCapabilities, buildPublicLlmModelsList } from "@/sse/services/publicLlmCatalog.js";
import { getCapabilitiesForModel, setCatalogSource, setLimitOverrideSource } from "open-sse/providers/capabilities.js";
import { handleModelsAliasChat } from "@/sse/services/modelsAliasChat.js";
import { GET as gemini } from "@/app/api/v1beta/models/route.js";
import { getAliasCandidateSnapshot, tryClaimAliasMember, settleAliasMemberAttempt, getModelsAliasRuntimeStatus, invalidateModelsAliasRuntime } from "@/sse/services/modelsAliasRuntime.js";

let aliases;
let transport;
beforeEach(async () => {
  aliases = [];
  transport = vi.fn(() => { throw new Error("Unexpected discovery transport"); });
  vi.stubGlobal("fetch", transport);
  state.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) state.db.exec(buildCreateTableSql(name, table));
  for (const [id, provider] of [["connection", "openai"], ["deepseek-connection", "deepseek"]]) {
    state.db.run("INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", [id, provider, "apikey", "{}", "2026-01-01", "2026-01-01"]);
  }
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  for (const alias of aliases) invalidateModelsAliasRuntime(alias.id);
  setCatalogSource(null);
  setLimitOverrideSource(null);
  vi.restoreAllMocks();
  state.db.close();
});
async function saveAlias(name, models) {
  const alias = await createModelsAlias({ name, models, primaryModel: models[0] });
  aliases.push(alias);
  return alias;
}

describe("Models Alias public capabilities", () => {
  it("uses resolved member capabilities, intersects multimodal promises, and takes configured minimum limits", async () => {
    const models = ["openai/gpt-4o", "deepseek/deepseek-chat"];
    await saveAlias("VisionAlias", models);
    const target = await resolvePublicLlmTarget("jrouter/VisionAlias");
    const caps = await getVirtualTargetCapabilities(target);
    const memberCaps = models.map((id) => { const [provider, ...parts] = id.split("/"); return getCapabilitiesForModel(provider, parts.join("/")); });
    expect(caps.vision).toBe(false);
    expect(caps.contextWindow).toBe(Math.min(...memberCaps.map((entry) => entry.contextWindow)));
    expect(caps.maxOutput).toBe(Math.min(...memberCaps.map((entry) => entry.maxOutput)));
  });

  it("does not infer vision from an arbitrary alias name", async () => {
    await saveAlias("Vision", ["deepseek/deepseek-chat"]);
    const caps = await getVirtualTargetCapabilities(await resolvePublicLlmTarget("jrouter/Vision"));
    expect(caps.vision).toBe(false);
  });

  it("keeps low blocked and cooling member limits with real runtime settlement", async () => {
    setLimitOverrideSource({ getLimits: (provider) => provider === "deepseek" ? { contextWindow: 4096, maxOutput: 256 } : { contextWindow: 32000, maxOutput: 4096 } });
    const alias = await saveAlias("Stable", ["openai/gpt-4o", "deepseek/deepseek-chat"]);
    const options = { policy: { allowedModels: ["jrouter/Stable"], blockedModels: ["deepseek/deepseek-chat"] }, keyAccess: { allow: ["jrouter/Stable"] } };
    const before = await buildPublicLlmModelsList(options);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ context_length: 4096, max_completion_tokens: 256 });
    const snapshot = getAliasCandidateSnapshot(alias, { allowedMembers: alias.models, now: 1000 });
    const lease = tryClaimAliasMember(snapshot, "deepseek/deepseek-chat", { now: 1000 });
    expect(settleAliasMemberAttempt(lease, { category: "provider", status: 503 }, { now: 1000 }).penalize).toBe(true);
    expect(getModelsAliasRuntimeStatus(alias, { now: 1001 }).members.find((member) => member.modelId === "deepseek/deepseek-chat").status).toBe("cooldown");
    expect(await buildPublicLlmModelsList(options)).toEqual(before);
    expect((await buildPublicLlmModelsList())[0]).toMatchObject({ context_length: 4096, max_completion_tokens: 256 });
  });

  it("uses custom-node metadata and resolved catalog pins in Combo aggregation without changing alias intersections", async () => {
    const provider = "openai-compatible-local";
    state.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)", [provider, "openai-compatible", JSON.stringify({ prefix: "local", baseUrl: "https://private.test" }), "2026-01-01", "2026-01-01"]);
    await addCustomModel({ providerAlias: "local", id: "plain", caps: { vision: true, audioInput: true, tools: false, contextWindow: 6000, maxOutput: 900 } });
    setCatalogSource({ getModalities: () => null, getLimits: (id) => id === "openai" ? { contextWindow: 12000, maxOutput: 1500 } : null });
    setLimitOverrideSource({ getLimits: (id) => id === "openai" ? { contextWindow: 10000, maxOutput: 1000 } : null });
    const models = ["local/plain", "openai/gpt-4o"];
    await saveAlias("Arbitrary", models);
    await createCombo({ name: "Combined", models });
    const list = await buildPublicLlmModelsList();
    const alias = list.find((entry) => entry.id === "jrouter/Arbitrary");
    const combo = list.find((entry) => entry.id === "jrouter/Combined");
    expect(alias).toMatchObject({ context_length: 6000, max_completion_tokens: 900, capabilities: { audioInput: false, vision: false, tools: false } });
    expect(getCapabilitiesForModel(provider, "plain").vision).toBe(false);
    expect(combo).toMatchObject({ context_length: 6000, max_completion_tokens: 900, capabilities: { audioInput: true, vision: true, tools: false } });
    expect(JSON.stringify(list)).not.toMatch(/private.test|thinkingFormat|thinkingRange|baseUrl/);
  });

  it("does not coerce null or unknown custom limits into zero or inflate Gemini defaults", async () => {
    await addCustomModel({ providerAlias: "openai", id: "gpt-4o", caps: { contextWindow: null, maxOutput: null } });
    await saveAlias("Unknown", ["openai/gpt-4o"]);
    const caps = await getVirtualTargetCapabilities(await resolvePublicLlmTarget("jrouter/Unknown"));
    expect(caps.contextWindow).toBeNull();
    expect(caps.maxOutput).toBeNull();
    const list = await buildPublicLlmModelsList();
    expect(list[0]).not.toHaveProperty("context_length");
    expect(list[0]).not.toHaveProperty("max_completion_tokens");
    const google = (await (await gemini(new Request("http://router.test/v1beta/models"))).json()).models.find((entry) => entry.name === "models/jrouter/Unknown");
    expect(google).not.toHaveProperty("inputTokenLimit");
    expect(google).not.toHaveProperty("outputTokenLimit");
    expect(google.supportedGenerationMethods).toEqual(["generateContent", "streamGenerateContent"]);
  });

  it("uses accepted nested Combo snapshots rather than rereading changed repositories for limits", async () => {
    setLimitOverrideSource({ getLimits: (provider) => provider === "deepseek" ? { contextWindow: 4000, maxOutput: 200 } : { contextWindow: 16000, maxOutput: 2000 } });
    const child = await createCombo({ name: "Child", models: ["deepseek/deepseek-chat"] });
    await createCombo({ name: "Parent", models: ["Child", "openai/gpt-4o"] });
    const admitted = await authorizeVirtualTarget(await resolvePublicLlmTarget("jrouter/Parent"));
    expect(Object.isFrozen(admitted.target)).toBe(true);
    state.db.run("UPDATE combos SET models=? WHERE id=?", [JSON.stringify(["openai/gpt-4o"]), child.id]);
    expect(await getVirtualTargetCapabilities(admitted.target)).toMatchObject({ contextWindow: 4000, maxOutput: 200 });
    expect(admitted.target.comboConfigs.find((config) => config.name === "Child").models).toEqual(["deepseek/deepseek-chat"]);
  });
  it("never advertises a custom vision promise rejected by the actual alias input guard", async () => {
    const provider = "openai-compatible-local";
    state.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)", [provider, "openai-compatible", JSON.stringify({ prefix: "local", baseUrl: "http://127.0.0.1:20388/v1" }), "fixture", "fixture"]);
    await addCustomModel({ providerAlias: "local", id: "plain", caps: { vision: true } });
    await saveAlias("OnlyCustom", ["local/plain"]);
    const target = await resolvePublicLlmTarget("jrouter/OnlyCustom");
    const authorized = await authorizeVirtualTarget(target);
    const body = { model: target.publicId, stream: false, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } }] }] };
    const response = await handleModelsAliasChat({ authorized, body, request: new Request("http://router.test/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No authorized configured member supports");
    expect(getCapabilitiesForModel(provider, "plain").vision).toBe(false);
    const entry = (await buildPublicLlmModelsList()).find(model => model.id === target.publicId);
    expect(entry.capabilities.vision).toBe(false);
  });
  it("keeps same-member manual pins above stored custom numeric limits", async () => {
    const provider = "openai-compatible-local";
    state.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,?,?,?,?)", [provider, "openai-compatible", JSON.stringify({ prefix: "local", baseUrl: "http://127.0.0.1:20388/v1" }), "fixture", "fixture"]);
    await addCustomModel({ providerAlias: "local", id: "plain", caps: { contextWindow: 6000, maxOutput: 900 } });
    setLimitOverrideSource({ getLimits: (id, model) => id === provider && model === "plain" ? { contextWindow: 1000, maxOutput: 100 } : null });
    await saveAlias("Pinned", ["local/plain"]);
    expect(getCapabilitiesForModel(provider, "plain")).toMatchObject({ contextWindow: 1000, maxOutput: 100 });
    const target = await resolvePublicLlmTarget("jrouter/Pinned");
    expect(await getVirtualTargetCapabilities(target)).toMatchObject({ contextWindow: 1000, maxOutput: 100 });
    expect((await buildPublicLlmModelsList())[0]).toMatchObject({ context_length: 1000, max_completion_tokens: 100 });
  });
});

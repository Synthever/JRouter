import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
const ref = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ref.db }));
import { createProviderNode, deleteProviderNode } from "@/lib/db/repos/nodesRepo.js";
import { createProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { addCustomModel } from "@/lib/db/repos/aliasRepo.js";
import { resolveAliasMembers, resolveAliasMembersFromContext } from "@/lib/modelsAliases/members.js";
import { getModelsAliases, getModelsAliasById, getModelsAliasByName, createModelsAlias, updateModelsAlias, deleteModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { createCombo, updateCombo, getComboById } from "@/lib/db/repos/combosRepo.js";
import { assertAliasComboNameAvailable } from "@/lib/db/helpers/modelsAliasesNamespace.js";
import * as database from "@/lib/db/index.js";
import * as models from "@/models/index.js";

beforeEach(async () => {
  const events = ["beforeExit", "SIGINT", "SIGTERM"];
  const listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  ref.listeners = events.flatMap((event) => process.listeners(event).filter((listener) => !listeners.get(event).has(listener)).map((listener) => [event, listener]));
  for (const [name, table] of Object.entries(TABLES)) ref.db.exec(buildCreateTableSql(name, table));
  await createProviderNode({ id: "openai-compatible-a", type: "openai-compatible", prefix: "fixture", name: "CMC" });
});
afterEach(() => {
  ref.db.close();
  for (const [event, listener] of ref.listeners) process.removeListener(event, listener);
});
const config = { name: "DeepSeek/Flash", models: ["fixture/deepseek/Flash", "fixture/Other", "fixture/deepseek/Flash"], primaryModel: "fixture/Other" };

describe("Models Aliases persistence and namespace", () => {
  it("creates, reads, edits and deletes a separate entity with stable metadata", async () => {
    const alias = await createModelsAlias(config);
    expect(alias).toMatchObject({ name: config.name, models: ["fixture/Other", "fixture/deepseek/Flash"], strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 15 });
    expect(alias.id).toBeTruthy();
    expect(await getModelsAliases()).toEqual([alias]);
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
    expect(await getModelsAliasByName(config.name)).toEqual(alias);
    expect(await getModelsAliasByName("deepseek/flash")).toBeNull();
    const edited = await updateModelsAlias(alias.id, { name: "Renamed/Flash", strategy: "fusion", judgeModel: "fixture/deepseek/Flash", initialResponseTimeoutSeconds: 0.5, promptInjectionEnabled: true, systemPrompt: "one\ntwo" });
    expect(edited).toMatchObject({ id: alias.id, createdAt: alias.createdAt, initialResponseTimeoutSeconds: 0.5, systemPrompt: "one\ntwo" });
    const { preImage, alias: saved } = await updateModelsAlias(alias.id, { strategy: "fallback" }, { returnPreImage: true });
    expect(preImage).toEqual(edited);
    expect(saved).toMatchObject({ id: alias.id, strategy: "fallback" });
    expect(await getModelsAliasById(alias.id)).toEqual(saved);
    expect(await deleteModelsAlias(alias.id)).toBe(true);
    expect(await deleteModelsAlias(alias.id)).toBe(false);
    expect(await updateModelsAlias(alias.id, { name: "missing" })).toBeNull();
  });
  it("rejects primary and judge removal without replacing them in the same update", async () => {
    const alias = await createModelsAlias({ ...config, judgeModel: "fixture/deepseek/Flash" });
    await expect(updateModelsAlias(alias.id, { models: ["fixture/Other"] })).rejects.toThrow(/judge/i);
    await expect(updateModelsAlias(alias.id, { models: ["fixture/deepseek/Flash"] })).rejects.toThrow(/primary/i);
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
    expect(await updateModelsAlias(alias.id, { models: ["fixture/New"], primaryModel: "fixture/New", judgeModel: null })).toMatchObject({ models: ["fixture/New"] });
  });
  it("rejects duplicate and cross-entity names in both write directions as typed 409", async () => {
    const alias = await createModelsAlias(config);
    await expect(createModelsAlias(config)).rejects.toMatchObject({ status: 409, code: "alias_combo_name_conflict" });
    await expect(createCombo({ name: config.name })).rejects.toMatchObject({ status: 409, code: "alias_combo_name_conflict" });
    const combo = await createCombo({ name: "Combo" });
    await expect(createModelsAlias({ ...config, name: "Combo" })).rejects.toMatchObject({ status: 409 });
    await expect(updateModelsAlias(alias.id, { name: "Combo" })).rejects.toMatchObject({ status: 409 });
    await expect(updateCombo(combo.id, { name: config.name })).rejects.toMatchObject({ status: 409 });
    expect(await getComboById(combo.id)).toMatchObject({ name: "Combo" });
    expect(await updateModelsAlias(alias.id, { systemPrompt: "ok" })).toMatchObject({ name: config.name });
    expect(await updateCombo(combo.id, { systemPrompt: "ok" })).toMatchObject({ name: "Combo" });
    expect(() => assertAliasComboNameAvailable(ref.db, config.name, { aliasId: alias.id })).not.toThrow();
    await createModelsAlias({ ...config, name: "deepseek/flash" });
  });
  it("takes a stable partial-update input snapshot before awaiting member checks", async () => {
    const alias = await createModelsAlias(config);
    const input = { systemPrompt: "intended" };
    const transaction = ref.db.transaction;
    ref.db.transaction = (fn) => transaction(() => {
      input.systemPrompt = "mutated after validation";
      return fn();
    });
    expect(await updateModelsAlias(alias.id, input)).toMatchObject({ systemPrompt: "intended" });
    ref.db.transaction = transaction;
  });
  it("rejects a node prefix reassigned between validation and write", async () => {
    const transaction = ref.db.transaction;
    ref.db.transaction = (fn) => transaction(() => {
      ref.db.run("UPDATE providerNodes SET id = 'openai-compatible-replacement'");
      return fn();
    });
    await expect(createModelsAlias(config)).rejects.toThrow(/changed/i);
    ref.db.transaction = transaction;
    expect(await getModelsAliases()).toEqual([]);
    expect(ref.db.get("SELECT id FROM providerNodes").id).toBe("openai-compatible-a");
  });
  it("revalidates provider existence inside the synchronous write transaction", async () => {
    const transaction = ref.db.transaction;
    ref.db.transaction = (fn) => transaction(() => {
      ref.db.run("DELETE FROM providerNodes");
      const result = fn();
      expect(result).not.toBeInstanceOf(Promise);
      return result;
    });
    await expect(createModelsAlias(config)).rejects.toThrow(/provider/i);
    ref.db.transaction = transaction;
    expect(await getModelsAliases()).toEqual([]);
    expect(ref.db.all("SELECT * FROM providerNodes")).toHaveLength(1);
  });
});

describe("Models Aliases database backup and import", () => {
  it("exports CRUD functions through both existing barrels", () => {
    for (const barrel of [database, models]) for (const name of ["getModelsAliases", "getModelsAliasById", "getModelsAliasByName", "createModelsAlias", "updateModelsAlias", "deleteModelsAlias"]) expect(typeof barrel[name]).toBe("function");
  });
  it("round-trips aliases separately from the unchanged legacy KV mappings", async () => {
    const alias = await createModelsAlias({ ...config, promptInjectionEnabled: true, systemPrompt: "two\nlines" });
    await database.setModelAlias("legacy", "fixture/Other");
    const backup = await database.exportDb();
    expect(backup.modelsAliases).toEqual([alias]);
    expect(backup.modelAliases).toEqual({ legacy: "fixture/Other" });
    await database.importDb(backup);
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
    expect(await database.getModelAliases()).toEqual(backup.modelAliases);
  });
  it("restores incoming providers and custom models rather than destination definitions", async () => {
    await createModelsAlias(config);
    const incoming = {
      providerNodes: [{ id: "openai-compatible-new", type: "openai-compatible", prefix: "new" }],
      providerConnections: [{ id: "auth", provider: "openai" }],
      customModels: [{ providerAlias: "openai", id: "Incoming/Model", type: "llm" }],
      modelsAliases: [{ id: "incoming", name: config.name, models: ["new/Nested/Flash", "openai/Incoming/Model"], primaryModel: "new/Nested/Flash" }],
    };
    const restored = await database.importDb(incoming);
    expect(restored.modelsAliases).toHaveLength(1);
    expect(restored.modelsAliases[0]).toMatchObject({ id: "incoming", models: incoming.modelsAliases[0].models });
    expect(restored.providerNodes[0].prefix).toBe("new");
    const bad = { ...incoming, modelsAliases: [{ ...incoming.modelsAliases[0], models: ["fixture/Other"], primaryModel: "fixture/Other" }] };
    await expect(database.importDb(bad)).rejects.toThrow(/provider/i);
    expect(await database.exportDb()).toEqual(restored);
  });
  it.each([
    ["built-in ID", "openai", "openai-compatible"],
    ["built-in alias", "xmtp", "openai-compatible"],
    ["virtual ID", "jrouter", "openai-compatible"],
    ["unsupported ID", "custom-node", "openai-compatible"],
    ["Anthropic ID with OpenAI type", "anthropic-compatible-invalid", "openai-compatible"],
    ["OpenAI ID with Anthropic type", "openai-compatible-invalid", "anthropic-compatible"],
    ["nonstring ID", 7, "openai-compatible"],
    ["slash-bearing ID", "openai-compatible-invalid/nested", "openai-compatible"],
    ["control-bearing ID", "openai-compatible-invalid\u0000", "openai-compatible"],
  ])("rejects incoming %s node identity without replacing the destination", async (_label, id, type) => {
    await createModelsAlias(config);
    const before = await database.exportDb();
    const incoming = {
      providerNodes: [{ id, type, prefix: "corp" }],
      providerConnections: [{ id: "builtin-account", provider: "openai" }],
      modelsAliases: [{ id: "incoming", name: "Incoming", models: ["corp/gpt-4o"], primaryModel: "corp/gpt-4o" }],
    };
    await expect(database.importDb(incoming)).rejects.toThrow(/provider/i);
    expect(await database.exportDb()).toEqual(before);
  });
  it("rolls back an invalid node identity introduced after import prevalidation", async () => {
    await createModelsAlias(config);
    const before = await database.exportDb();
    const incoming = {
      providerNodes: [{ id: "openai-compatible-incoming", type: "openai-compatible", prefix: "corp" }],
      modelsAliases: [{ id: "incoming", name: "Incoming", models: ["corp/gpt-4o"], primaryModel: "corp/gpt-4o" }],
    };
    const run = ref.db.run;
    let inserted = false;
    ref.db.run = (sql, params) => {
      const result = run(sql, params);
      if (sql.includes("INSERT OR REPLACE INTO providerNodes")) {
        inserted = true;
        run("UPDATE providerNodes SET id = ? WHERE id = ?", ["jrouter", "openai-compatible-incoming"]);
      }
      return result;
    };
    try {
      await expect(database.importDb(incoming)).rejects.toThrow(/provider/i);
      expect(inserted).toBe(true);
      expect(await database.exportDb()).toEqual(before);
    } finally {
      ref.db.run = run;
    }
  });
  it("older backups clear stale aliases before inserting a Combo with the old name", async () => {
    await createModelsAlias(config);
    await database.importDb({ combos: [{ id: "old", name: config.name }] });
    expect(await getModelsAliases()).toEqual([]);
    expect(await getComboById("old")).toMatchObject({ name: config.name });
    await database.importDb({ providerNodes: [{ id: "openai-compatible-new", type: "openai-compatible", prefix: "new" }], modelsAliases: [{ id: "swap", name: config.name, models: ["new/Flash"], primaryModel: "new/Flash" }] });
    expect(await getModelsAliases()).toHaveLength(1);
    expect(await getComboById("old")).toBeNull();
  });
  it("rejects collisions, duplicate aliases and malformed members atomically", async () => {
    await createModelsAlias(config);
    const before = await database.exportDb();
    const incomingAlias = { ...before.modelsAliases[0], id: "new" };
    const invalids = [
      { modelsAliases: [incomingAlias], combos: [{ id: "combo", name: config.name }] },
      { modelsAliases: [incomingAlias, { ...incomingAlias, id: "duplicate" }] },
      { modelsAliases: [incomingAlias, { ...incomingAlias, name: "different" }] },
      { modelsAliases: [{ ...incomingAlias, models: ["jrouter/virtual"], primaryModel: "jrouter/virtual" }] },
      { modelsAliases: [{ ...incomingAlias, models: ["fixture/model-id"], primaryModel: "fixture/model-id" }] },
      { modelsAliases: [{ ...incomingAlias, initialResponseTimeoutSeconds: Infinity }] },
      { modelsAliases: [{ ...incomingAlias, promptInjectionEnabled: "yes" }] },
      { modelsAliases: [{ ...incomingAlias, models: ["unknown/model"], primaryModel: "unknown/model" }] },
      { modelsAliases: null }, { modelsAliases: {} },
    ];
    for (const invalid of invalids) {
      await expect(database.importDb({ ...before, ...invalid })).rejects.toThrow();
      expect(await database.exportDb()).toEqual(before);
    }
    await expect(database.importDb({ ...before, apiKeys: [{ id: "invalid", key: "fixture", access: { restricted: "yes" } }] })).rejects.toThrow(/access/);
    expect(await database.exportDb()).toEqual(before);
  });
});

describe("provider-only alias member resolution", () => {
  it("preserves exact node IDs, case and nested model paths", async () => {
    expect(await resolveAliasMembers(["fixture/deepseek/Flash", "openai-compatible-a/deepseek/Flash"])).toEqual([
      { requested: "fixture/deepseek/Flash", provider: "openai-compatible-a", model: "deepseek/Flash", canonicalId: "openai-compatible-a/deepseek/Flash" },
      { requested: "openai-compatible-a/deepseek/Flash", provider: "openai-compatible-a", model: "deepseek/Flash", canonicalId: "openai-compatible-a/deepseek/Flash" },
    ]);
  });
  it("resolves built-in aliases before colliding node prefixes and permits no-auth LLMs", async () => {
    await createProviderConnection({ provider: "xiaomi-tokenplan", authType: "apikey" });
    await createProviderNode({ id: "openai-compatible-shadow", type: "openai-compatible", prefix: "xmtp" });
    await addCustomModel({ providerAlias: "xmtp", id: "MiMo/Flash" });
    expect((await resolveAliasMembers(["xmtp/MiMo/Flash"]))[0].provider).toBe("xiaomi-tokenplan");
    expect((await resolveAliasMembers(["oc/minimax-m2.5-free"]))[0].provider).toBe("opencode");
  });
  it("requires configured credentials for authenticated built-ins and rejects arbitrary provider fallback", async () => {
    await expect(resolveAliasMembers(["openai/gpt-4o"])).rejects.toThrow(/configured/i);
    await createProviderConnection({ provider: "openai", authType: "apikey" });
    expect((await resolveAliasMembers(["openai/gpt-4o"]))[0].provider).toBe("openai");
    await expect(resolveAliasMembers(["made-up/gpt-4o"])).rejects.toThrow(/provider/i);
    await expect(resolveAliasMembers(["openai/NotARegisteredModel"])).rejects.toThrow(/model/i);
    await addCustomModel({ providerAlias: "openai", id: "CaseSensitive/Model" });
    expect((await resolveAliasMembers(["openai/CaseSensitive/Model"]))[0].model).toBe("CaseSensitive/Model");
    await expect(resolveAliasMembers(["openai/casesensitive/model"])).rejects.toThrow(/model/i);
  });
  it("rejects media model metadata even on LLM providers or nodes", async () => {
    await createProviderConnection({ provider: "openai", authType: "apikey" });
    await createProviderNode({ id: "custom-embedding-a", type: "custom-embedding", prefix: "embed" });
    await addCustomModel({ providerAlias: "fixture", id: "image-model", type: "image" });
    for (const id of ["openai/tts-1", "openai/text-embedding-3-small", "embed/model", "fixture/image-model", "edge-tts/en-US-AriaNeural"]) {
      await expect(resolveAliasMembers([id])).rejects.toThrow(/LLM/i);
    }
  });
  it("rejects virtual, bare and placeholder members without fallback inference", async () => {
    for (const id of ["jrouter/Main", "Main", "gpt-4o", "fixture/model-id", "__placeholder__fixture", "fixture//Flash"]) await expect(resolveAliasMembers([id])).rejects.toThrow();
    await deleteProviderNode("openai-compatible-a");
    await expect(resolveAliasMembers(["fixture/deepseek/Flash"])).rejects.toThrow(/provider/i);
  });
  it("uses an explicit incoming context instead of the destination DB", () => {
    const context = { providerNodes: [{ id: "openai-compatible-incoming", type: "openai-compatible", prefix: "new" }], providerConnections: [], customModels: [] };
    expect(resolveAliasMembersFromContext(["new/Nested/Flash"], context)[0].provider).toBe("openai-compatible-incoming");
    expect(() => resolveAliasMembersFromContext(["fixture/Flash"], context)).toThrow();
  });
});

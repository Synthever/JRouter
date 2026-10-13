import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import * as database from "@/lib/db/index.js";
import { createModelsAlias, getModelsAliasById, getModelsAliases, insertModelsAlias, updateModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { createCombo, getComboById, getCombos } from "@/lib/db/repos/combosRepo.js";
import { createProviderNode, deleteProviderNode } from "@/lib/db/repos/nodesRepo.js";
import { createProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { addCustomModel } from "@/lib/db/repos/aliasRepo.js";
import { updateSettings } from "@/lib/db/repos/settingsRepo.js";
import * as runtime from "@/sse/services/modelsAliasRuntime.js";
import { getRotatedModels, resetComboRotation } from "open-sse/services/combo.js";
import { resolveAliasMembers } from "@/lib/modelsAliases/members.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { GET as listAliases } from "../../src/app/api/models-aliases/route.js";
import { POST as postCombo } from "../../src/app/api/combos/route.js";
import { PUT as putCombo } from "../../src/app/api/combos/[id]/route.js";
import { proxy } from "../../src/dashboardGuard.js";

const ref = vi.hoisted(() => ({ db: null, adapter: null, verify: vi.fn(), machineId: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: () => ref.adapter ? ref.adapter() : Promise.resolve(ref.db) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: ref.verify }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: ref.machineId }));
const config = { name: "Alias", models: ["fixture/Primary", "fixture/Nested/Other"], primaryModel: "fixture/Primary" };
const runtimeIds = new Set();

beforeEach(async () => {
  vi.clearAllMocks();
  ref.adapter = null;
  ref.verify.mockImplementation(async (token) => token === "dashboard-fixture");
  ref.machineId.mockResolvedValue("cli-fixture");
  const events = ["beforeExit", "SIGINT", "SIGTERM"];
  const listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  ref.listeners = events.flatMap((event) => process.listeners(event).filter((listener) => !listeners.get(event).has(listener)).map((listener) => [event, listener]));
  for (const [name, table] of Object.entries(TABLES)) ref.db.exec(buildCreateTableSql(name, table));
  await createProviderNode({ id: "openai-compatible-fixture", type: "openai-compatible", prefix: "fixture", baseUrl: "https://private-fixture.invalid" });
});
afterEach(() => {
  ref.adapter = null;
  for (const id of runtimeIds) runtime.invalidateModelsAliasRuntime(id);
  runtimeIds.clear();
  resetComboRotation();
  ref.db.close();
  for (const [event, listener] of ref.listeners) process.removeListener(event, listener);
  vi.restoreAllMocks();
});
function request(path = "/api/models-aliases", method = "GET", body, headers = { cookie: "auth_token=dashboard-fixture" }) {
  return new Request(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function active(alias, member = alias.primaryModel) {
  runtimeIds.add(alias.id);
  const signal = runtime.getModelsAliasConfigurationSignal(alias);
  const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models, now: 1000 });
  const lease = runtime.tryClaimAliasMember(snapshot, member, { now: 1000 });
  expect(lease).not.toBeNull();
  return { signal, lease, version: snapshot.configVersion };
}

// These assertions exercise the DB API, not only a dashboard import caller.
describe("database import runtime handoff", () => {
  it.each([
    ["rename", { name: "Renamed" }],
    ["members", { models: ["fixture/New"], primaryModel: "fixture/New" }],
    ["strategy", { strategy: "round-robin" }],
    ["prompt", { systemPrompt: "changed private prompt" }],
  ])("invalidates an active old lease after committed %s replacement", async (_label, patch) => {
    const alias = await createModelsAlias(config);
    const { signal, lease, version } = active(alias);
    const payload = await database.exportDb();
    Object.assign(payload.modelsAliases[0], patch);
    let committedRow;
    signal.addEventListener("abort", () => { committedRow = ref.db.get("SELECT * FROM modelsAliases WHERE id = ?", [alias.id]); });
    const result = await database.importDb(payload);
    expect(signal.aborted).toBe(true);
    expect(committedRow).toMatchObject({ id: alias.id, ...patch, ...(patch.models ? { models: JSON.stringify(patch.models) } : {}) });
    expect(result).toEqual(await database.exportDb());
    expect(runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 1001 })).toBeNull();
    expect(runtime.getModelsAliasRuntimeStatus(result.modelsAliases[0], { now: 1001 }).configVersion).not.toBe(version);
  });
  it("clears stale aliases and aborts removed active leases for an older backup", async () => {
    const alias = await createModelsAlias(config);
    const { signal, lease } = active(alias);
    const payload = await database.exportDb();
    delete payload.modelsAliases;
    expect((await database.importDb(payload)).modelsAliases).toEqual([]);
    expect(await getModelsAliases()).toEqual([]);
    expect(signal.aborted).toBe(true);
    expect(runtime.settleAliasMemberAttempt(lease, { category: "success" })).toBeNull();
  });
  it("preserves version, signal, cooldown, order and active lease for timestamp-only changes", async () => {
    const alias = await createModelsAlias(config);
    const { signal, lease, version } = active(alias);
    const failure = runtime.tryClaimAliasMember(runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models, now: 1000 }), "fixture/Nested/Other", { now: 1000 });
    runtime.settleAliasMemberAttempt(failure, { category: "transient" }, { now: 1000 });
    const before = runtime.getModelsAliasRuntimeStatus(alias, { now: 1001 });
    const payload = await database.exportDb();
    Object.assign(payload.modelsAliases[0], { createdAt: "2020-01-01", updatedAt: "2021-01-01" });
    const result = await database.importDb(payload);
    expect(signal.aborted).toBe(false);
    expect(runtime.getModelsAliasConfigurationSignal(result.modelsAliases[0])).toBe(signal);
    expect(runtime.getModelsAliasRuntimeStatus(result.modelsAliases[0], { now: 1001 })).toEqual(before);
    expect(before.configVersion).toBe(version);
    expect(before.members[1].status).toBe("cooldown");
    expect(runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 1001 })).toMatchObject({ category: "success" });
  });
  it.each(["validation", "sql"])("leaves the entire DB and runtime intact on %s failure", async (kind) => {
    const alias = await createModelsAlias(config);
    const { signal, lease } = active(alias);
    const before = await database.exportDb();
    const status = runtime.getModelsAliasRuntimeStatus(alias, { now: 1001 });
    const payload = structuredClone(before);
    if (kind === "validation") payload.modelsAliases[0].primaryModel = "fixture/absent";
    else {
      const run = ref.db.run;
      vi.spyOn(ref.db, "run").mockImplementation((sql, params) => {
        if (sql.startsWith("INSERT INTO modelsAliases")) throw new Error("private SQL failure");
        return run(sql, params);
      });
      payload.modelsAliases[0].name = "Changed";
    }
    await expect(database.importDb(payload)).rejects.toThrow();
    expect(await database.exportDb()).toEqual(before);
    expect(signal.aborted).toBe(false);
    expect(runtime.getModelsAliasRuntimeStatus(alias, { now: 1001 })).toEqual(status);
    expect(runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 1001 })).toMatchObject({ category: "success" });
  });
  it.each([false, true])("uses transaction-time preimages across adapter await (noop=%s)", async (noop) => {
    const alias = await createModelsAlias(config);
    const payload = await database.exportDb();
    if (noop) payload.modelsAliases[0].strategy = "round-robin";
    const entered = deferred();
    const resume = deferred();
    let first = true;
    ref.adapter = async () => {
      if (first) { first = false; entered.resolve(); await resume.promise; }
      return ref.db;
    };
    const importing = database.importDb(payload);
    try {
      await entered.promise;
      const current = await updateModelsAlias(alias.id, { strategy: "round-robin" });
      const { signal, lease } = active(current);
      resume.resolve();
      await importing;
      expect(signal.aborted).toBe(!noop);
      const settled = runtime.settleAliasMemberAttempt(lease, { category: "success" }, { now: 1001 });
      if (noop) expect(settled).toMatchObject({ category: "success" });
      else expect(settled).toBeNull();
    } finally { resume.resolve(); }
  });
  it("invalidates only removed/changed IDs, preserving a separate unchanged active alias", async () => {
    const changed = await createModelsAlias(config);
    const unchanged = await createModelsAlias({ ...config, name: "Unchanged" });
    const old = active(changed);
    const kept = active(unchanged);
    const payload = await database.exportDb();
    payload.modelsAliases.find((alias) => alias.id === changed.id).name = "Replaced";
    await database.importDb(payload);
    expect(old.signal.aborted).toBe(true);
    expect(kept.signal.aborted).toBe(false);
    expect(runtime.settleAliasMemberAttempt(kept.lease, { category: "success" }, { now: 1001 })).toMatchObject({ category: "success" });
  });
  it("cancels an intervening new lease at the postcommit lazy-import handoff", async () => {
    const alias = await createModelsAlias(config);
    const old = active(alias);
    const payload = await database.exportDb();
    payload.modelsAliases[0].strategy = "round-robin";
    const transaction = ref.db.transaction;
    let intervening;
    let committed;
    ref.db.transaction = (fn) => {
      const result = transaction(fn);
      // A queued request runs after commit while the lazy import yields.
      queueMicrotask(() => {
        committed = getModelsAliasById(alias.id);
        const current = { ...alias, strategy: "round-robin" };
        intervening = active(current);
      });
      return result;
    };
    try {
      await database.importDb(payload);
      expect((await committed).strategy).toBe("round-robin");
      expect(old.signal.aborted).toBe(true);
      expect(intervening.signal.aborted).toBe(true);
      expect(runtime.settleAliasMemberAttempt(old.lease, { category: "success" })).toBeNull();
      expect(runtime.settleAliasMemberAttempt(intervening.lease, { category: "success" })).toBeNull();
    } finally { ref.db.transaction = transaction; }
  });
  it("captures preimages inside the synchronous transaction and never aborts within it", async () => {
    const alias = await createModelsAlias(config);
    const payload = await database.exportDb();
    const transaction = ref.db.transaction;
    let signal;
    let lease;
    let within = false;
    ref.db.transaction = (fn) => {
      ref.db.run("UPDATE modelsAliases SET strategy = 'round-robin' WHERE id = ?", [alias.id]);
      const concurrent = { ...alias, strategy: "round-robin" };
      ({ signal, lease } = active(concurrent));
      signal.addEventListener("abort", () => { expect(within).toBe(false); });
      return transaction(() => {
        within = true;
        try {
          const result = fn();
          expect(result).not.toBeInstanceOf(Promise);
          expect(signal.aborted).toBe(false);
          return result;
        } finally { within = false; }
      });
    };
    try {
      await database.importDb(payload);
      expect(signal.aborted).toBe(true);
      expect(runtime.settleAliasMemberAttempt(lease, { category: "success" })).toBeNull();
    } finally { ref.db.transaction = transaction; }
  });
});

describe("actual Combo routes share the alias namespace", () => {
  it.each(["POST", "PUT"])("returns safe typed 409 from actual repository %s collision", async (method) => {
    await createModelsAlias(config);
    const combo = await createCombo({ name: "Original", models: ["fixture/Primary", "fixture/Nested/Other"], kind: "llm" });
    const before = await getCombos();
    const response = method === "POST"
      ? await postCombo(request("/api/combos", "POST", { name: "Alias" }))
      : await putCombo(request(`/api/combos/${combo.id}`, "PUT", { name: "Alias" }), { params: Promise.resolve({ id: combo.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "alias_combo_name_conflict", error: "Models Alias or Combo name already exists" });
    expect(await getCombos()).toEqual(before);
  });
  it.each(["POST", "PUT"])("catches a %s collision appearing only inside the repo transaction", async (method) => {
    const combo = await createCombo({ name: "Original", models: ["fixture/Primary", "fixture/Nested/Other"] });
    const template = await createModelsAlias({ ...config, name: "Template" });
    const transaction = ref.db.transaction;
    ref.db.transaction = (fn) => {
      transaction(() => insertModelsAlias(ref.db, { ...template, id: "racing-alias", name: "LateAlias" }));
      return transaction(fn);
    };
    try {
      const response = method === "POST"
        ? await postCombo(request("/api/combos", "POST", { name: "LateAlias" }))
        : await putCombo(request(`/api/combos/${combo.id}`, "PUT", { name: "LateAlias" }), { params: Promise.resolve({ id: combo.id }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code: "alias_combo_name_conflict", error: "Models Alias or Combo name already exists" });
      expect(await getCombos()).toEqual([combo]);
    } finally { ref.db.transaction = transaction; }
  });
  it("preserves duplicate 400, validation, missing 404, media and success-only rotation", async () => {
    const combo = await createCombo({ name: "Original", models: ["a/A", "b/B"], kind: "image" });
    const other = await createCombo({ name: "Other" });
    await createModelsAlias(config);
    expect((await postCombo(request("/api/combos", "POST", { name: "Original" }))).status).toBe(400);
    expect((await putCombo(request("/api/combos/x", "PUT", { name: "Other" }), { params: Promise.resolve({ id: combo.id }) })).status).toBe(400);
    expect((await postCombo(request("/api/combos", "POST", { name: "Invalid/Name" }))).status).toBe(400);
    expect((await putCombo(request("/api/combos/x", "PUT", {}), { params: Promise.resolve({ id: "absent" }) })).status).toBe(404);
    expect(getRotatedModels(combo.models, "Original", "round-robin", 1)).toEqual(combo.models);
    expect((await putCombo(request("/api/combos/x", "PUT", { name: "Alias" }), { params: Promise.resolve({ id: combo.id }) })).status).toBe(409);
    expect(getRotatedModels(combo.models, "Original", "round-robin", 1)).toEqual(["b/B", "a/A"]);
    const response = await putCombo(request("/api/combos/x", "PUT", { name: "Renamed", kind: "image" }), { params: Promise.resolve({ id: combo.id }) });
    expect(response.status).toBe(200);
    expect(await getComboById(combo.id)).toMatchObject({ name: "Renamed", kind: "image", models: combo.models });
    expect(getRotatedModels(combo.models, "Original", "round-robin", 1)).toEqual(combo.models);
    expect(getRotatedModels(combo.models, "Renamed", "round-robin", 1)).toEqual(combo.models);
    expect(await getComboById(other.id)).toEqual(other);
  });
  it("does not expose unexpected DB details as a collision", async () => {
    const run = ref.db.run;
    vi.spyOn(ref.db, "run").mockImplementation((sql, params) => {
      if (sql.startsWith("INSERT INTO combos")) throw new Error("private credential detail");
      return run(sql, params);
    });
    const response = await postCombo(request("/api/combos", "POST", { name: "Safe" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to create combo" });
  });
});

describe("authenticated metadata for unsaved member selection", () => {
  it("enumerates exactly registered LLM identities and compatible node IDs/prefixes", async () => {
    const response = await listAliases(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    const eligible = REGISTRY.filter((entry) => (entry.serviceKinds || entry.media?.serviceKinds || ["llm"]).includes("llm") && (entry.transport || entry.transports));
    const keys = [...new Set(eligible.flatMap((entry) => [entry.id, entry.alias, ...(entry.aliases || [])].filter(Boolean)).concat(["openai-compatible-fixture", "fixture"]))].sort();
    expect(Object.keys(body).sort()).toEqual(["aliases", "providerMetadata"]);
    expect(body.aliases).toEqual([]);
    expect(Object.keys(body.providerMetadata).sort()).toEqual(keys);
    for (const [provider, value] of Object.entries(body.providerMetadata)) {
      expect(Object.keys(value)).toEqual(["outputObservability"]);
      expect(["buffered", "incremental"], provider).toContain(value.outputObservability);
    }
    for (const [id, alias, value] of [["cursor", "cu", "buffered"], ["kiro", "kr", "incremental"], ["grok-web", "gw", "buffered"], ["perplexity-web", "pw", "buffered"], ["bedrock", "br", "buffered"], ["bedrock-xai", "brx", "buffered"], ["zed", "zd", "buffered"], ["vertex", "vx", "incremental"], ["ollama-local", "ollama-local", "incremental"], ["qoder", "qd", "incremental"]]) {
      expect(body.providerMetadata[id]).toEqual({ outputObservability: value });
      expect(body.providerMetadata[alias]).toEqual(body.providerMetadata[id]);
    }
    for (const id of ["trae", "windsurf", "devin-cli", "local-device", "v1m", "elevenlabs"]) expect(body.providerMetadata[id]).toBeUndefined();
    expect(body.providerMetadata.tr).toEqual(body.providerMetadata.tokenrouter);
  });
  it("uses real member validation for compatible nodes without leaking account/configuration data", async () => {
    await createProviderNode({ id: "anthropic-compatible-private", type: "anthropic-compatible", prefix: "private", apiType: "messages", baseUrl: "https://secret.invalid" });
    await createProviderNode({ id: "openai-compatible-responses", type: "openai-compatible", prefix: "responses-fixture", apiType: "responses" });
    for (const node of [
      { id: "custom-embedding-fixture", type: "embedding", prefix: "media" },
      { id: "wrong-identity", type: "openai-compatible", prefix: "invalid" },
      { id: "openai-compatible-__placeholder__", type: "openai-compatible", prefix: "placeholder" },
      { id: "openai-compatible-", type: "openai-compatible", prefix: "empty" },
      { id: "openai-compatible-ambiguous-a", type: "openai-compatible", prefix: "ambiguous" },
      { id: "openai-compatible-ambiguous-b", type: "openai-compatible", prefix: "ambiguous" },
      { id: "openai-compatible-collision", type: "openai-compatible", prefix: "cu" },
    ]) await createProviderNode(node);
    await createProviderConnection({ provider: "cu", name: "private account", apiKey: "credential-fixture", providerSpecificData: { clientSecret: "private-client-secret" } });
    await addCustomModel({ providerAlias: "private", id: "Nested/New", type: "llm" });
    const alias = await createModelsAlias({ ...config, systemPrompt: "private saved dashboard prompt" });
    const body = await (await listAliases(request())).json();
    expect(body.aliases).toEqual([alias]);
    for (const prefix of ["anthropic-compatible-private", "private", "openai-compatible-responses", "responses-fixture"]) {
      expect(body.providerMetadata[prefix]).toEqual({ outputObservability: "incremental" });
      expect(await resolveAliasMembers([`${prefix}/Nested/New`])).toHaveLength(1);
    }
    for (const key of ["custom-embedding-fixture", "media", "wrong-identity", "invalid", "placeholder", "openai-compatible-__placeholder__", "openai-compatible-", "empty", "ambiguous"]) expect(body.providerMetadata[key]).toBeUndefined();
    expect(body.providerMetadata.cu).toEqual({ outputObservability: "buffered" });
    expect(JSON.stringify(body.providerMetadata)).not.toMatch(/secret|credential|private account|baseUrl|systemPrompt|Nested\/New/);
    await deleteProviderNode("anthropic-compatible-private");
    const next = await (await listAliases(request())).json();
    expect(next.providerMetadata.private).toBeUndefined();
    expect(next.providerMetadata["anthropic-compatible-private"]).toBeUndefined();
  });
  it("does not mistake an arbitrary custom media model for the node's LLM identity", async () => {
    await addCustomModel({ providerAlias: "fixture", id: "metadata-fixture", type: "embedding" });
    const body = await (await listAliases(request())).json();
    expect(body.providerMetadata.fixture).toEqual({ outputObservability: "incremental" });
    expect(body.providerMetadata["openai-compatible-fixture"]).toEqual(body.providerMetadata.fixture);
    await expect(resolveAliasMembers(["fixture/metadata-fixture"])).rejects.toThrow(/not an LLM model/);
  });
  it("authenticates before alias/node reads and leaves key quotas unchanged", async () => {
    ref.db.run("INSERT INTO apiKeys(id,key,name,isActive,createdAt,quotaTokens,quotaCost) VALUES(?,?,?,?,?,?,?)", ["inference-key", "inference-fixture", "fixture", 1, "2026-01-01", 37, 0.25]);
    const all = vi.spyOn(ref.db, "all");
    const response = await listAliases(request("/api/models-aliases", "GET", undefined, { authorization: "Bearer inference-fixture" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(all).not.toHaveBeenCalled();
    all.mockRestore();
    const before = ref.db.all("SELECT * FROM apiKeys");
    expect((await listAliases(request())).status).toBe(200);
    expect(ref.db.all("SELECT * FROM apiKeys")).toEqual(before);
  });
  it("returns a safe generic error when metadata reads fail", async () => {
    const all = ref.db.all;
    vi.spyOn(ref.db, "all").mockImplementation((sql, params) => {
      if (sql.includes("FROM providerNodes")) throw new Error("private metadata credential");
      return all(sql, params);
    });
    const response = await listAliases(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to fetch Models Aliases" });
  });
});

describe("supplementary existing deny-by-default dashboard guard proof", () => {
  it.each(["/api/models-aliases", "/api/models-aliases/id/runtime", "/api/models-aliases/id/runtime/reset", "/dashboard/models-aliases"])("denies inference bearer/no JWT and preserves session/login-disabled for %s", async (path) => {
    ref.db.run("INSERT INTO apiKeys(id,key,name,isActive,createdAt) VALUES(?,?,?,?,?)", ["guard-key", "inference-fixture", "fixture", 1, "2026-01-01"]);
    expect(await database.validateApiKey("inference-fixture")).toBe(true);
    for (const headers of [{}, { authorization: "Bearer inference-fixture" }]) {
      const denied = await proxy(new NextRequest(`http://localhost${path}`, { headers }));
      expect(denied.status).toBe(path.startsWith("/dashboard") ? 307 : 401);
      if (path.startsWith("/dashboard")) expect(denied.headers.get("location")).toBe("http://localhost/login");
      else expect(await denied.json()).toEqual({ error: "Unauthorized" });
    }
    const allowed = await proxy(new NextRequest(`http://localhost${path}`, { headers: { cookie: "auth_token=dashboard-fixture" } }));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    if (path.startsWith("/api")) {
      const cli = await proxy(new NextRequest(`http://localhost${path}`, { headers: { "x-9r-cli-token": "cli-fixture" } }));
      expect(cli.headers.get("x-middleware-next")).toBe("1");
    }
    await updateSettings({ requireLogin: false });
    const disabled = await proxy(new NextRequest(`http://localhost${path}`));
    expect(disabled.headers.get("x-middleware-next")).toBe("1");
  });
});

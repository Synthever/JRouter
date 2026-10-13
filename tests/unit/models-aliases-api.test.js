import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { createProviderNode } from "@/lib/db/repos/nodesRepo.js";
import { createCombo } from "@/lib/db/repos/combosRepo.js";
import { getModelsAliasById, getModelsAliases } from "@/lib/db/repos/modelsAliasesRepo.js";
import * as memberResolution from "@/lib/modelsAliases/members.js";
import { updateSettings } from "@/lib/db/repos/settingsRepo.js";
import * as runtime from "@/sse/services/modelsAliasRuntime.js";

const ref = vi.hoisted(() => ({ db: null, verify: vi.fn(), machineId: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ref.db }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: ref.verify }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: ref.machineId }));
const routes = {};
const config = { name: "DeepSeek/Flash", models: ["fixture/Nested/Flash", "fixture/Primary", "fixture/Nested/Flash"], primaryModel: "fixture/Primary" };

beforeAll(async () => {
  for (const [name, path] of [["collection", "../../src/app/api/models-aliases/route.js"], ["single", "../../src/app/api/models-aliases/[id]/route.js"]]) {
    try { routes[name] = await import(path); } catch (error) {
      if (!error.message.includes("models-aliases/") || !/Cannot find|Failed to load/.test(error.message)) throw error;
    }
  }
});
beforeEach(async () => {
  vi.clearAllMocks();
  ref.verify.mockImplementation(async (token) => token === "dashboard-fixture");
  ref.machineId.mockResolvedValue("cli-fixture");
  const events = ["beforeExit", "SIGINT", "SIGTERM"];
  const listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  ref.listeners = events.flatMap((event) => process.listeners(event).filter((listener) => !listeners.get(event).has(listener)).map((listener) => [event, listener]));
  for (const [name, table] of Object.entries(TABLES)) ref.db.exec(buildCreateTableSql(name, table));
  await createProviderNode({ id: "openai-compatible-api", type: "openai-compatible", prefix: "fixture" });
});
afterEach(() => {
  for (const alias of ref.db.all("SELECT id FROM modelsAliases")) runtime.invalidateModelsAliasRuntime(alias.id);
  ref.db.close();
  for (const [event, listener] of ref.listeners) process.removeListener(event, listener);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function request(method = "GET", body, headers = { cookie: "auth_token=dashboard-fixture" }) {
  return new Request("http://127.0.0.1/api/models-aliases", { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function invoke(name, method, req = request(), id = "missing") {
  const handler = routes[name]?.[method];
  expect(handler, `${name}.${method} route export`).toBeTypeOf("function");
  return handler(req, { params: Promise.resolve({ id }) });
}
async function create(input = config) {
  const response = await invoke("collection", "POST", request("POST", input));
  expect(response.status).toBe(201);
  return response.json();
}

describe("dashboard Models Aliases CRUD", () => {
  it("round-trips saved configuration through actual collection and single routes", async () => {
    expect(await (await invoke("collection", "GET")).json()).toEqual({ aliases: [], providerMetadata: expect.any(Object) });
    const alias = await create();
    expect(alias).toMatchObject({ name: "DeepSeek/Flash", models: ["fixture/Primary", "fixture/Nested/Flash"], strategy: "fallback", judgeModel: null, initialResponseTimeoutSeconds: 15 });
    expect(alias.id).toBeTruthy();
    expect(await (await invoke("single", "GET", request(), alias.id)).json()).toEqual(alias);
    expect(await (await invoke("collection", "GET")).json()).toEqual({ aliases: [alias], providerMetadata: expect.any(Object) });
    const edited = await invoke("single", "PUT", request("PUT", { name: "Renamed/Flash", strategy: "fusion", judgeModel: "fixture/Nested/Flash", promptInjectionEnabled: true, systemPrompt: "private persisted instruction" }), alias.id);
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ id: alias.id, createdAt: alias.createdAt, primaryModel: "fixture/Primary", models: ["fixture/Primary", "fixture/Nested/Flash"], strategy: "fusion", systemPrompt: "private persisted instruction" });
    const signal = runtime.getModelsAliasConfigurationSignal(await getModelsAliasById(alias.id));
    const deleted = await invoke("single", "DELETE", request("DELETE"), alias.id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });
    expect(signal.aborted).toBe(true);
    expect(await getModelsAliases()).toEqual([]);
  });
  it("keeps exact case-sensitive nested names in the shared namespace", async () => {
    await create();
    await create({ ...config, name: "deepseek/flash" });
    expect((await getModelsAliases()).map((alias) => alias.name).sort()).toEqual(["DeepSeek/Flash", "deepseek/flash"]);
  });
  it.each(["GET", "PUT", "DELETE"])("returns 404 for missing single %s", async (method) => {
    const response = await invoke("single", method, request(method, method === "PUT" ? {} : undefined));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Models Alias not found" });
  });
  it.each([
    ["invalid name", { name: "jrouter/Reserved" }],
    ["bare member", { models: ["Combo"], primaryModel: "Combo" }],
    ["missing primary", { primaryModel: "fixture/Missing" }],
    ["missing judge", { judgeModel: "fixture/Missing" }],
    ["invalid strategy", { strategy: "random" }],
    ["invalid timeout", { initialResponseTimeoutSeconds: 0 }],
    ["invalid prompt", { promptInjectionEnabled: "yes" }],
    ["unconfigured member", { models: ["unknown/Model"], primaryModel: "unknown/Model" }],
  ])("rejects %s without a write", async (_label, patch) => {
    const response = await invoke("collection", "POST", request("POST", { ...config, ...patch }));
    expect(response.status).toBe(400);
    expect(await getModelsAliases()).toEqual([]);
  });
  it("validates partial updates against current primary and configured providers", async () => {
    const alias = await create();
    for (const patch of [{ models: ["fixture/Nested/Flash"] }, { models: ["unknown/Model"], primaryModel: "unknown/Model" }]) {
      const response = await invoke("single", "PUT", request("PUT", patch), alias.id);
      expect(response.status).toBe(400);
      expect(await getModelsAliasById(alias.id)).toEqual(alias);
    }
  });
  it.each(["POST", "PUT"])("rejects malformed and nonobject JSON for %s", async (method) => {
    const alias = await create();
    for (const body of ["{", "[]", "null", "7", '"string"']) {
      const req = new Request("http://127.0.0.1/api/models-aliases", { method, headers: { cookie: "auth_token=dashboard-fixture" }, body });
      const response = await invoke(method === "POST" ? "collection" : "single", method, req, alias.id);
      expect(response.status).toBe(400);
      expect(await getModelsAliases()).toEqual([alias]);
    }
  });
  it("returns typed safe 409 for duplicate aliases and existing Combo names", async () => {
    const alias = await create();
    await createCombo({ name: "Combo/Existing" });
    for (const [name, method, input] of [["collection", "POST", config], ["collection", "POST", { ...config, name: "Combo/Existing" }], ["single", "PUT", { name: "Combo/Existing" }]]) {
      const response = await invoke(name, method, request(method, input), alias.id);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "alias_combo_name_conflict", error: expect.any(String) });
    }
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
  });
  it.each([["collection", "GET"], ["collection", "POST"], ["single", "GET"], ["single", "PUT"], ["single", "DELETE"]])("denies bearer inference credentials before %s %s reads or writes", async (name, method) => {
    const req = request(method, ["POST", "PUT"].includes(method) ? config : undefined, { authorization: "Bearer inference-fixture" });
    const json = vi.spyOn(req, "json");
    const reads = vi.spyOn(ref.db, "all");
    const singleReads = vi.spyOn(ref.db, "get");
    const writes = vi.spyOn(ref.db, "run");
    const response = await invoke(name, method, req);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(singleReads.mock.calls.every(([sql]) => sql.includes("FROM settings"))).toBe(true);
    expect(writes).not.toHaveBeenCalled();
  });
  it("preserves existing disabled-login and CLI authorization semantics", async () => {
    expect((await invoke("collection", "POST", request("POST", config, { "x-9r-cli-token": "cli-fixture" }))).status).toBe(201);
    await updateSettings({ requireLogin: false });
    expect((await invoke("collection", "GET", request("GET", undefined, {}))).status).toBe(200);
  });
  it("invalidates the concurrent config's runtime when restoring an earlier config", async () => {
    const alias = await create();
    const entered = deferred();
    const resume = deferred();
    const resolveMembers = memberResolution.resolveAliasMembers;
    const barrier = vi.spyOn(memberResolution, "resolveAliasMembers").mockImplementationOnce(async (models) => {
      entered.resolve();
      await resume.promise;
      return resolveMembers(models);
    });
    const firstPut = invoke("single", "PUT", request("PUT", { strategy: "fallback" }), alias.id);
    try {
      await entered.promise;
      expect((await invoke("single", "PUT", request("PUT", { strategy: "round-robin" }), alias.id)).status).toBe(200);
      const current = await getModelsAliasById(alias.id);
      const signal = runtime.getModelsAliasConfigurationSignal(current);
      let snapshot = runtime.getAliasCandidateSnapshot(current, { allowedMembers: current.models });
      const failed = runtime.tryClaimAliasMember(snapshot, current.primaryModel);
      expect(failed).not.toBeNull();
      runtime.settleAliasMemberAttempt(failed, { category: "transient" });
      expect(runtime.getModelsAliasRuntimeStatus(current).members[0].status).toBe("cooldown");
      snapshot = runtime.getAliasCandidateSnapshot(current, { allowedMembers: current.models });
      const lease = runtime.tryClaimAliasMember(snapshot, "fixture/Nested/Flash");
      expect(lease).not.toBeNull();
      resume.resolve();
      expect((await firstPut).status).toBe(200);
      expect((await getModelsAliasById(alias.id)).strategy).toBe("fallback");
      expect(signal.aborted).toBe(true);
      expect(runtime.settleAliasMemberAttempt(lease, { category: "success" })).toBeNull();
      expect(runtime.getModelsAliasRuntimeStatus(await getModelsAliasById(alias.id)).members[0].status).toBe("available");
    } finally {
      resume.resolve();
      barrier.mockRestore();
    }
  });
  it("preserves concurrent config runtime state when a PUT is a semantic no-op", async () => {
    const alias = await create();
    const entered = deferred();
    const resume = deferred();
    const resolveMembers = memberResolution.resolveAliasMembers;
    const barrier = vi.spyOn(memberResolution, "resolveAliasMembers").mockImplementationOnce(async (models) => {
      entered.resolve();
      await resume.promise;
      return resolveMembers(models);
    });
    const firstPut = invoke("single", "PUT", request("PUT", {}), alias.id);
    try {
      await entered.promise;
      expect((await invoke("single", "PUT", request("PUT", { strategy: "round-robin" }), alias.id)).status).toBe(200);
      const current = await getModelsAliasById(alias.id);
      const signal = runtime.getModelsAliasConfigurationSignal(current);
      let snapshot = runtime.getAliasCandidateSnapshot(current, { allowedMembers: current.models });
      const failed = runtime.tryClaimAliasMember(snapshot, current.primaryModel);
      expect(failed).not.toBeNull();
      runtime.settleAliasMemberAttempt(failed, { category: "transient" });
      const before = runtime.getModelsAliasRuntimeStatus(current);
      expect(before.members[0].status).toBe("cooldown");
      snapshot = runtime.getAliasCandidateSnapshot(current, { allowedMembers: current.models });
      const lease = runtime.tryClaimAliasMember(snapshot, "fixture/Nested/Flash");
      expect(lease).not.toBeNull();
      resume.resolve();
      expect((await firstPut).status).toBe(200);
      expect((await getModelsAliasById(alias.id)).strategy).toBe("round-robin");
      expect(signal.aborted).toBe(false);
      expect(runtime.settleAliasMemberAttempt(lease, { category: "success" })).toMatchObject({ category: "success" });
      expect(runtime.getModelsAliasRuntimeStatus(await getModelsAliasById(alias.id)).members[0]).toEqual(before.members[0]);
    } finally {
      resume.resolve();
      barrier.mockRestore();
    }
  });
  it("invalidates active configuration only after a successful semantic change", async () => {
    let alias = await create();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    const version = runtime.getModelsAliasRuntimeStatus(alias).configVersion;
    expect((await invoke("single", "PUT", request("PUT", { strategy: "fallback", systemPrompt: null }), alias.id)).status).toBe(200);
    alias = await getModelsAliasById(alias.id);
    expect(signal.aborted).toBe(false);
    expect(runtime.getModelsAliasRuntimeStatus(alias).configVersion).toBe(version);
    expect((await invoke("single", "PUT", request("PUT", { systemPrompt: "changed instruction" }), alias.id)).status).toBe(200);
    expect(signal.aborted).toBe(true);
    alias = await getModelsAliasById(alias.id);
    expect(runtime.getModelsAliasRuntimeStatus(alias).configVersion).not.toBe(version);
    const nextSignal = runtime.getModelsAliasConfigurationSignal(alias);
    expect((await invoke("single", "PUT", request("PUT", { strategy: "round-robin" }), alias.id)).status).toBe(200);
    expect(nextSignal.aborted).toBe(true);
  });
  it("hides failed writes and preserves the active configuration and lease", async () => {
    const alias = await create();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models });
    const lease = runtime.tryClaimAliasMember(snapshot, alias.primaryModel);
    const run = ref.db.run;
    ref.db.run = (sql, params) => {
      if (/^(UPDATE modelsAliases|DELETE FROM modelsAliases|INSERT INTO modelsAliases)/.test(sql)) throw new Error("private database credential detail");
      return run(sql, params);
    };
    try {
      for (const [name, method, input] of [["single", "PUT", { name: "Changed" }], ["single", "DELETE", undefined], ["collection", "POST", { ...config, name: "Other" }]]) {
        const response = await invoke(name, method, request(method, input), alias.id);
        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain("private");
        expect(signal.aborted).toBe(false);
        expect(await getModelsAliasById(alias.id)).toEqual(alias);
      }
      expect(runtime.settleAliasMemberAttempt(lease, { category: "success" })).toMatchObject({ category: "success" });
    } finally { ref.db.run = run; }
  });
  it("returns safe generic 500 when a CRUD read or authorization boundary fails", async () => {
    const alias = await create();
    const all = vi.spyOn(ref.db, "all").mockImplementation(() => { throw new Error("private database credential detail"); });
    let response = await invoke("collection", "GET");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    all.mockRestore();
    ref.verify.mockRejectedValue(new Error("private session detail"));
    response = await invoke("single", "GET", request(), alias.id);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});

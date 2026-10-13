import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { createProviderNode, deleteProviderNode } from "@/lib/db/repos/nodesRepo.js";
import { createModelsAlias, getModelsAliasById, updateModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import * as runtime from "@/sse/services/modelsAliasRuntime.js";

const ref = vi.hoisted(() => ({ db: null, pause: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => {
  if (ref.pause && ref.pause.skip-- === 0) {
    const pause = ref.pause;
    ref.pause = null;
    pause.entered();
    await pause.released;
  }
  return ref.db;
} }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (token) => token === "dashboard-fixture" }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "cli-fixture" }));
const routes = {};
let alias;
const P = "fixture/Primary";
const A = "fixture/Nested/Flash";
const B = "fixture/Other";

beforeAll(async () => {
  for (const [name, path] of [["status", "../../src/app/api/models-aliases/[id]/runtime/route.js"], ["reset", "../../src/app/api/models-aliases/[id]/runtime/reset/route.js"]]) {
    try { routes[name] = await import(path); } catch (error) {
      if (!error.message.includes("models-aliases/") || !/Cannot find|Failed to load/.test(error.message)) throw error;
    }
  }
});
beforeEach(async () => {
  const events = ["beforeExit", "SIGINT", "SIGTERM"];
  const listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  ref.listeners = events.flatMap((event) => process.listeners(event).filter((listener) => !listeners.get(event).has(listener)).map((listener) => [event, listener]));
  for (const [name, table] of Object.entries(TABLES)) ref.db.exec(buildCreateTableSql(name, table));
  await createProviderNode({ id: "openai-compatible-runtime-api", type: "openai-compatible", prefix: "fixture", baseUrl: "http://127.0.0.1/private-endpoint" });
  alias = await createModelsAlias({ name: "DeepSeek/Flash", models: [P, A, B], primaryModel: P, systemPrompt: "private prompt setting" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1000);
});
afterEach(() => {
  runtime.invalidateModelsAliasRuntime(alias.id);
  vi.useRealTimers();
  ref.db.close();
  for (const [event, listener] of ref.listeners) process.removeListener(event, listener);
});

function request(method = "GET", body, headers = { cookie: "auth_token=dashboard-fixture" }) {
  return new Request("http://127.0.0.1/api/models-aliases/runtime", { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function invoke(name, req = request(), id = alias.id) {
  const handler = routes[name]?.[name === "status" ? "GET" : "POST"];
  expect(handler, `${name} route export`).toBeTypeOf("function");
  return handler(req, { params: Promise.resolve({ id }) });
}
function fail(member = A) {
  const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models });
  const lease = runtime.tryClaimAliasMember(snapshot, member);
  expect(lease).not.toBeNull();
  runtime.settleAliasMemberAttempt(lease, { category: "provider", status: 503, error: "private provider credential detail" });
}
async function status() {
  const response = await invoke("status");
  expect(response.status).toBe(200);
  return response.json();
}

describe("dashboard Models Aliases runtime API", () => {
  it.each(["status", "reset"])("does not revive stale runtime when config changes during %s member validation", async (name) => {
    fail();
    const dto = await status();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    let entered;
    let release;
    const reached = new Promise((resolve) => { entered = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    ref.pause = { skip: 1, entered, released };
    const pending = invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined));
    await reached;
    alias = await updateModelsAlias(alias.id, { strategy: "round-robin" });
    runtime.invalidateModelsAliasRuntime(alias.id);
    const current = runtime.getModelsAliasRuntimeStatus(alias);
    release();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(signal.aborted).toBe(true);
    expect(runtime.getModelsAliasRuntimeStatus(alias).configVersion).toBe(current.configVersion);
  });
  it.each(["status", "reset"])("returns 404 if the alias is deleted during %s member validation", async (name) => {
    const dto = await status();
    let entered;
    let release;
    const reached = new Promise((resolve) => { entered = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    ref.pause = { skip: 1, entered, released };
    const pending = invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined));
    await reached;
    ref.db.run("DELETE FROM modelsAliases WHERE id = ?", [alias.id]);
    runtime.invalidateModelsAliasRuntime(alias.id);
    release();
    const response = await pending;
    expect(response.status).toBe(404);
    expect(await getModelsAliasById(alias.id)).toBeNull();
  });
  it.each(["status", "reset"])("classifies unexpected member-context database failures as 500 for %s", async (name) => {
    const dto = runtime.getModelsAliasRuntimeStatus(alias);
    const all = vi.spyOn(ref.db, "all").mockImplementation(() => { throw new Error("private database credential detail"); });
    try {
      const response = await invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private");
      expect(runtime.getModelsAliasRuntimeStatus(alias)).toEqual(dto);
    } finally { all.mockRestore(); }
  });
  it("returns the safe real DTO without configuration writes or exposing private data", async () => {
    fail();
    const writes = vi.spyOn(ref.db, "run");
    const dto = await status();
    expect(Object.keys(dto).sort()).toEqual(["aliasId", "configVersion", "configuredOrder", "effectiveOrder", "members", "serverNow"].sort());
    expect(dto).toMatchObject({ aliasId: alias.id, configVersion: expect.any(String), serverNow: 1000, configuredOrder: [P, A, B], effectiveOrder: [P, B, A], members: [{ modelId: P, status: "available", retryAt: null }, { modelId: A, status: "cooldown", retryAt: 31000 }, { modelId: B, status: "available", retryAt: null }] });
    expect(JSON.stringify(dto)).not.toMatch(/private|baseUrl|credential|systemPrompt/);
    expect(writes).not.toHaveBeenCalled();
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
  });
  it("restores configured order while preserving cooldown, version, signal and saved configuration", async () => {
    fail();
    const dto = await status();
    const signal = runtime.getModelsAliasConfigurationSignal(alias);
    const writes = vi.spyOn(ref.db, "run");
    const response = await invoke("reset", request("POST", { configVersion: dto.configVersion }));
    expect(response.status).toBe(200);
    const reset = await response.json();
    expect(reset).toMatchObject({ configVersion: dto.configVersion, configuredOrder: [P, A, B], effectiveOrder: [P, A, B], serverNow: 1000, members: dto.members });
    expect(signal.aborted).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
    expect(runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models }).candidates).toEqual([P, B]);
  });
  it("does not acquire or clear recovery leases while reading or resetting order", async () => {
    fail();
    vi.setSystemTime(31000);
    const dto = await status();
    expect(dto.members[1].status).toBe("recovering");
    const candidate = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models });
    const lease = runtime.tryClaimAliasMember(candidate, A);
    expect(lease).toMatchObject({ recovery: true });
    expect((await invoke("reset", request("POST", { configVersion: dto.configVersion }))).status).toBe(200);
    await status();
    const competing = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models });
    expect(runtime.tryClaimAliasMember(competing, A)).toBeNull();
    expect(runtime.releaseAliasMemberAttempt(lease)).toBe(true);
  });
  it("rejects a stale reset version without changing current order or clearing cooldown", async () => {
    fail();
    const before = await status();
    const response = await invoke("reset", request("POST", { configVersion: "stale-version" }));
    expect(response.status).toBe(409);
    expect(await status()).toEqual(before);
  });
  it("loads current saved configuration instead of accepting a cached pre-edit version", async () => {
    const before = await status();
    await updateModelsAlias(alias.id, { strategy: "round-robin" });
    const response = await invoke("reset", request("POST", { configVersion: before.configVersion }));
    expect(response.status).toBe(409);
    expect((await status()).configVersion).not.toBe(before.configVersion);
    expect((await getModelsAliasById(alias.id)).strategy).toBe("round-robin");
  });
  it("resets round-robin rotation without writing configured strategy", async () => {
    alias = await updateModelsAlias(alias.id, { strategy: "round-robin" });
    runtime.getAliasCandidateSnapshot(alias, { allowedMembers: alias.models });
    const dto = await status();
    expect(dto.effectiveOrder).toEqual([A, B, P]);
    const response = await invoke("reset", request("POST", { configVersion: dto.configVersion }));
    expect(response.status).toBe(200);
    expect((await response.json()).effectiveOrder).toEqual([P, A, B]);
    expect((await getModelsAliasById(alias.id)).strategy).toBe("round-robin");
  });
  it("rejects malformed, nonobject and missing/nonstring reset versions without resetting", async () => {
    fail();
    const before = await status();
    for (const body of ["{", "[]", "null", "7", "{}", '{"configVersion":null}', '{"configVersion":7}', '{"configVersion":""}']) {
      const req = new Request("http://127.0.0.1/api/models-aliases/runtime/reset", { method: "POST", headers: { cookie: "auth_token=dashboard-fixture" }, body });
      expect((await invoke("reset", req)).status).toBe(400);
      expect(await status()).toEqual(before);
    }
  });
  it.each(["status", "reset"])("returns 404 for unknown %s alias", async (name) => {
    const response = await invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: "missing" } : undefined), "missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Models Alias not found" });
  });
  it.each(["status", "reset"])("denies inference credentials before %s reads, parsing or state mutation", async (name) => {
    fail();
    const dto = runtime.getModelsAliasRuntimeStatus(alias);
    const req = request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined, { authorization: "Bearer inference-fixture" });
    const json = vi.spyOn(req, "json");
    const reads = vi.spyOn(ref.db, "all");
    const singleReads = vi.spyOn(ref.db, "get");
    const writes = vi.spyOn(ref.db, "run");
    const response = await invoke(name, req);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(singleReads.mock.calls.every(([sql]) => sql.includes("FROM settings"))).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    expect(runtime.getModelsAliasRuntimeStatus(alias)).toEqual(dto);
  });
  it.each(["status", "reset"])("surfaces removed configured providers as safe invalid/unavailable %s", async (name) => {
    const dto = await status();
    await deleteProviderNode("openai-compatible-runtime-api");
    const response = await invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Models Alias members are invalid or unavailable" });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(await getModelsAliasById(alias.id)).toEqual(alias);
  });
  it.each(["status", "reset"])("hides unexpected database failures for %s", async (name) => {
    const dto = runtime.getModelsAliasRuntimeStatus(alias);
    const get = ref.db.get;
    ref.db.get = (sql, params) => {
      if (sql.includes("FROM modelsAliases")) throw new Error("private database credential detail");
      return get(sql, params);
    };
    try {
      const response = await invoke(name, request(name === "status" ? "GET" : "POST", name === "reset" ? { configVersion: dto.configVersion } : undefined));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private");
      expect(runtime.getModelsAliasRuntimeStatus(alias)).toEqual(dto);
    } finally { ref.db.get = get; }
  });
});

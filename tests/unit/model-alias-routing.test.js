import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => {
  const fetch = vi.fn(); globalThis.fetch = fetch;
  return { fetch, db: null, adapterGate: null, usage: vi.fn(async () => {}), pxpipe: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => { await boundary.adapterGate?.(); return boundary.db; }, getAdapterSync: () => boundary.db }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveUsage: vi.fn(async () => {}), saveRequestUsage: (...args) => boundary.usage(...args) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }) }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: (...args) => boundary.pxpipe(...args) }));
const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
const { TABLES } = await import("@/lib/db/schema.js");
const { createModelsAlias, getModelsAliasById } = await import("@/lib/db/repos/modelsAliasesRepo.js");
const { resolvePublicLlmTarget, authorizeVirtualTarget } = await import("../../src/sse/services/publicLlmTarget.js");
const runtime = await import("../../src/sse/services/modelsAliasRuntime.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const provider = "openai-compatible-task8-routing";
const ids = ["fixture/primary", "fixture/a", "fixture/b", "fixture/c"];
const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), line: vi.fn(), errorLine: vi.fn() };
const encoder = new TextEncoder();
let aliases = [], calls = [];
function answer(model = "actual", text = "answer") { return new Response(JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { headers: { "content-type": "application/json" } }); }
function failure(status = 503, message = "upstream unavailable", headers = {}) { return new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json", ...headers } }); }
function controlled() { let controller; const cancel = vi.fn(); return { response: new Response(new ReadableStream({ start(c) { controller = c; }, cancel }), { headers: { "content-type": "text/event-stream" } }), send: event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)), close: () => controller.close(), cancel }; }
async function flush() { for (let i = 0; i < 150; i++) await Promise.resolve(); }
function addAccount(id = "account1", priority = 1, data = {}, p = provider) { boundary.db.run("INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)", [id, p, "apikey", id, priority, JSON.stringify({ apiKey: "fixture-token", providerSpecificData: { baseUrl: "http://127.0.0.1:20388/v1" }, ...data }), "fixture", "fixture"]); }
async function fixture(config = {}, admission = {}) {
  const alias = await createModelsAlias({ name: "Nested/Case", models: ids, primaryModel: ids[0], ...config }); aliases.push(alias);
  const authorized = await authorizeVirtualTarget(await resolvePublicLlmTarget(`jrouter/${alias.name}`), admission);
  return { alias, authorized };
}
async function run(authorized, body = { model: "jrouter/Nested/Case", stream: false, messages: [{ role: "user", content: "hello" }] }, signal) {
  const orchestrator = await import("../../src/sse/services/modelsAliasChat.js").catch(() => null);
  expect(orchestrator, "real Task8 orchestrator must exist").not.toBeNull();
  return orchestrator.handleModelsAliasChat({ authorized, body, request: new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", body: JSON.stringify(body), signal }), log });
}
beforeAll(async () => {
  boundary.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) boundary.db.exec(`CREATE TABLE ${name} (${Object.entries(table.columns).map(([k, v]) => `${k} ${v}`).join(",")})`);
});
afterAll(() => boundary.db.close());
beforeEach(() => {
  vi.clearAllMocks(); calls = []; boundary.adapterGate = null;
  for (const name of Object.keys(TABLES)) boundary.db.run(`DELETE FROM ${name}`);
  boundary.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?, 'openai-compatible', ?, 'fixture', 'fixture')", [provider, JSON.stringify({ prefix: "fixture", baseUrl: "http://127.0.0.1:20388/v1", apiType: "chat" })]);
  boundary.db.run("INSERT INTO settings(id,data) VALUES(1, ?)", [JSON.stringify({ requireApiKey: false, rtkEnabled: false, pxpipeEnabled: true, capacityAdapter: { vision: { enabled: true, models: ["openai/not-authorized"] } } })]);
  addAccount();
  boundary.fetch.mockReset().mockImplementation(async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body, signal: init.signal, auth: init.headers.Authorization }); return answer(body.model); });
  vi.stubGlobal("fetch", boundary.fetch);
});
afterEach(() => { for (const alias of aliases.splice(0)) runtime.invalidateModelsAliasRuntime(alias.id); boundary.adapterGate = null; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real Models Aliases orchestration", () => {
  it("rejects forged admission and unsupported target before credential selection", async () => {
    const { authorized } = await fixture(); const select = vi.spyOn(boundary.db, "all");
    expect((await run(structuredClone(authorized))).status).toBe(403);
    expect((await run({ target: { kind: "alias" }, members: ids, alias: true })).status).toBe(403);
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(select.mock.calls.some(([sql]) => sql.includes("FROM providerConnections"))).toBe(false);
  });
  it("fully blocked configured members fail real admission with zero credentials", async () => {
    await expect(fixture({}, { policy: { blockedModels: ids } })).rejects.toMatchObject({ status: 403 });
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("tries primary then fallback once, updating runtime but not configuration", async () => {
    const { alias, authorized } = await fixture(); const before = await getModelsAliasById(alias.id);
    boundary.fetch.mockImplementation(async (url, init) => { const body = JSON.parse(init.body); calls.push(body.model); return ["primary", "a"].includes(body.model) ? failure() : answer(body.model); });
    expect((await run(authorized)).status).toBe(200);
    expect(calls).toEqual(["primary", "a", "b"]);
    expect(runtime.getModelsAliasRuntimeStatus(alias).effectiveOrder).toEqual([ids[0], ids[2], ids[3], ids[1]]);
    expect(await getModelsAliasById(alias.id)).toEqual(before);
    await run(authorized); expect(calls).toEqual(["primary", "a", "b", "b"]);
    expect(boundary.pxpipe).not.toHaveBeenCalled();
  });
  it("round-robin rotates eligible members without legacy Combo rotation state", async () => {
    const { authorized } = await fixture({ strategy: "round-robin" });
    for (let i = 0; i < 5; i++) await run(authorized);
    expect(calls.map(c => c.body.model)).toEqual(["primary", "a", "b", "c", "primary"]);
  });
  it("round-robin skips cooled members immediately and preserves no-wait unavailability", async () => {
    vi.useFakeTimers(); const { alias, authorized } = await fixture({ strategy: "round-robin", models: ids.slice(0, 2) });
    let snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: ids.slice(0, 2) });
    runtime.settleAliasMemberAttempt(runtime.tryClaimAliasMember(snapshot, ids[0]), { category: "transient" });
    expect((await run(authorized)).status).toBe(200); expect(calls.map(call => call.body.model)).toEqual(["a"]);
    snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: ids.slice(0, 2) });
    runtime.settleAliasMemberAttempt(runtime.tryClaimAliasMember(snapshot, ids[1]), { category: "rate-limit", retryAfter: "120" });
    const before = Date.now(); const unavailable = await run(authorized);
    expect(unavailable.status).toBe(503); expect(unavailable.headers.get("retry-after")).not.toBeNull(); expect(Date.now()).toBe(before); expect(calls).toHaveLength(1);
  });
  it("allows exactly one recovering lease while concurrent requests use alternatives", async () => {
    vi.useFakeTimers(); const { alias, authorized } = await fixture();
    const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: ids });
    runtime.settleAliasMemberAttempt(runtime.tryClaimAliasMember(snapshot, ids[0]), { category: "transient" });
    await vi.advanceTimersByTimeAsync(30001);
    const held = controlled(); boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b.model); return b.model === "primary" ? held.response : answer(b.model); });
    const first = run(authorized); await flush(); const second = await run(authorized);
    expect(second.status).toBe(200); expect(calls).toEqual(["primary", "a"]);
    held.send({ choices: [{ delta: { content: "recovered" }, finish_reason: "stop" }] }); held.close(); await first;
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[0].status).toBe("available");
  });
  it.each(["client", "configuration"])("%s cancellation reaches upstream and stays health-neutral", async reason => {
    const { alias, authorized } = await fixture(); const caller = new AbortController(); const held = controlled();
    boundary.fetch.mockResolvedValue(held.response); const pending = run(authorized, undefined, caller.signal); await flush();
    if (reason === "client") caller.abort(); else runtime.invalidateModelsAliasRuntime(alias.id);
    expect((await pending).status).toBe(499); expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(held.cancel).toHaveBeenCalled();
    expect(runtime.getModelsAliasRuntimeStatus(alias).members.every(m => m.status === "available")).toBe(true);
  });
  it("deadline includes account switching and penalizes only initial non-readiness", async () => {
    vi.useFakeTimers(); addAccount("account2", 2); const { alias, authorized } = await fixture({ initialResponseTimeoutSeconds: 15 });
    let firstPreparation = true;
    boundary.adapterGate = () => { if (!firstPreparation) return; firstPreparation = false; return new Promise(resolve => setTimeout(resolve, 6000)); };
    boundary.fetch.mockImplementation((url, init) => {
      const b = JSON.parse(init.body); calls.push(b.model);
      if (b.model !== "primary") return Promise.resolve(answer(b.model));
      if (calls.length === 1) return Promise.resolve(failure());
      return new Promise((resolve, reject) => { const t = setTimeout(() => resolve(failure()), 9000); init.signal.addEventListener("abort", () => { clearTimeout(t); reject(init.signal.reason); }, { once: true }); });
    });
    const pending = run(authorized); await flush(); expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(6000); expect(calls).toEqual(["primary", "primary"]);
    await vi.advanceTimersByTimeAsync(9001);
    expect((await pending).status).toBe(200); expect(calls).toEqual(["primary", "primary", "a"]);
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[0].status).toBe("cooldown");
  });
  it("never switches account or member after valid output even on buffered late failure", async () => {
    addAccount("account2", 2); const { authorized } = await fixture(); const held = controlled(); boundary.fetch.mockResolvedValue(held.response);
    const pending = run(authorized); await flush(); held.send({ choices: [{ delta: { content: "started" } }] });
    held.send({ type: "error", status: 503, error: { message: "late failure" } }); held.close();
    expect((await pending).status).toBe(503); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(boundary.db.get("SELECT data FROM providerConnections WHERE id='account1'").data).modelLock_primary).toBeDefined();
  });
  it("keeps stream ownership through handoff and cancel aborts upstream", async () => {
    const { authorized } = await fixture(); const held = controlled(); let upstreamSignal;
    boundary.fetch.mockImplementation(async (url, init) => { upstreamSignal = init.signal; return held.response; });
    const pending = run(authorized, { model: "jrouter/Nested/Case", stream: true, messages: [{ role: "user", content: "hello" }] });
    await flush(); held.send({ choices: [{ delta: { content: "started" } }] }); const response = await pending;
    expect(upstreamSignal.aborted).toBe(false); await response.body.cancel("client stopped");
    expect(upstreamSignal.aborted).toBe(true); expect(held.cancel).toHaveBeenCalled();
  });
  it("caller abort after stream handoff releases recovery without a downstream read", async () => {
    vi.useFakeTimers(); const { alias, authorized } = await fixture({ models: [ids[0]] });
    const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: [ids[0]] });
    runtime.settleAliasMemberAttempt(runtime.tryClaimAliasMember(snapshot, ids[0]), { category: "transient" }); await vi.advanceTimersByTimeAsync(30001);
    const caller = new AbortController(); const held = controlled(); boundary.fetch.mockResolvedValue(held.response);
    const pending = run(authorized, { model: "jrouter/Nested/Case", stream: true, messages: [{ role: "user", content: "hello" }] }, caller.signal);
    await flush(); held.send({ choices: [{ delta: { content: "started" } }] }); const response = await pending;
    caller.abort(); await flush();
    expect(runtime.getAliasCandidateSnapshot(alias, { allowedMembers: [ids[0]] }).candidates).toContain(ids[0]);
    expect(held.cancel).toHaveBeenCalled(); await expect(response.body.cancel()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("early member failure can settle once without blocking a remaining authorized provider", async () => {
    const { authorized } = await fixture({}, { policy: { allowedModels: ["jrouter/Nested/Case"], blockedModels: [ids[0], ids[1]] } });
    expect((await run(authorized, { model: "openai/forged", stream: false, alias: true, executionOptions: { alias: true }, _alias: { model: ids[0] }, messages: [{ role: "user", content: "hello" }] })).status).toBe(200);
    expect(calls.map(call => call.body.model)).toEqual(["b"]);
  });
  it("post-handoff failure never member-fallbacks and records the actual failing runtime member", async () => {
    const { alias, authorized } = await fixture(); const held = controlled(); boundary.fetch.mockResolvedValue(held.response);
    const pending = run(authorized, { model: "jrouter/Nested/Case", stream: true, messages: [{ role: "user", content: "hello" }] }); await flush();
    held.send({ choices: [{ delta: { content: "started" } }] }); const response = await pending; const consume = response.text();
    held.send({ type: "error", status: 503, error: { message: "late failure" } }); held.close();
    const text = await consume; expect(text).toContain("started"); expect(text).toContain("late failure"); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[0].status).toBe("cooldown");
  });
  it("retains actual status and Retry-After instead of generic exhaustion503", async () => {
    const { alias, authorized } = await fixture({ models: [ids[0]] }); boundary.fetch.mockResolvedValue(failure(429, "quota", { "retry-after": "120" }));
    const response = await run(authorized); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("120");
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[0].status).toBe("cooldown");
  });
  it("blocks hard unsupported input rather than stripping or invoking an adapter", async () => {
    const { authorized } = await fixture(); const response = await run(authorized, { model: "jrouter/Nested/Case", messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "fixture", format: "wav" } }] }] });
    expect(response.status).toBe(400); expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("shares proactive/core refresh budget, never refreshing the same account twice", async () => {
    const model = "cline/openai/gpt-5.4";
    addAccount("oauth-proactive", 1, { apiKey: null, accessToken: "old-token", refreshToken: "fixture-refresh-proactive", expiresAt: "2000-01-01T00:00:00Z" }, "cline");
    const { authorized } = await fixture({ models: [model], primaryModel: model });
    const trace = [];
    boundary.fetch.mockImplementation(async (url, init) => {
      if (String(url).includes("/auth/refresh")) { trace.push("refresh"); return new Response(JSON.stringify({ data: { accessToken: "new-token", refreshToken: "rotated-token", expiresAt: "2099-01-01T00:00:00Z" } }), { headers: { "content-type": "application/json" } }); }
      trace.push("generation"); return failure(401, "expired token");
    });
    const response = await run(authorized);
    expect(response.status).toBe(401); expect(trace).toEqual(["refresh", "generation"]);
    expect(JSON.parse(boundary.db.get("SELECT data FROM providerConnections WHERE id='oauth-proactive'").data).refreshToken).toBe("rotated-token");
  });
  it("reactive refresh shares redispatch allowance and isolates both payloads", async () => {
    const model = "cline/openai/gpt-5.4";
    addAccount("oauth-reactive", 1, { apiKey: null, accessToken: "old-token", refreshToken: "fixture-refresh-reactive", expiresAt: "2099-01-01T00:00:00Z" }, "cline");
    const { authorized } = await fixture({ models: [model], primaryModel: model, promptInjectionEnabled: true, systemPrompt: "reactive instruction" });
    const trace = []; let generations = 0;
    boundary.fetch.mockImplementation(async (url, init) => {
      if (String(url).includes("/auth/refresh")) { trace.push("refresh"); return new Response(JSON.stringify({ data: { accessToken: "new-token", refreshToken: "rotated-reactive" } }), { headers: { "content-type": "application/json" } }); }
      trace.push(JSON.parse(init.body)); return ++generations === 1 ? failure(401, "expired token") : answer("upstream-cline");
    });
    expect((await run(authorized)).status).toBe(200); expect(trace).toHaveLength(3); expect(trace[1]).toBe("refresh");
    for (const payload of [trace[0], trace[2]]) expect(JSON.stringify(payload).match(/reactive instruction/g)).toHaveLength(1);
    expect(boundary.usage).toHaveBeenCalledTimes(1);
  });
  it("aborts reactive credential persistence at the actual awaiting adapter boundary, with no late write", async () => {
    const model = "cline/openai/gpt-5.4";
    addAccount("oauth-cancel", 1, { apiKey: null, accessToken: "old-token", refreshToken: "fixture-refresh-cancel", expiresAt: "2099-01-01T00:00:00Z" }, "cline");
    const { authorized } = await fixture({ models: [model], primaryModel: model }); const caller = new AbortController();
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }); const gate = new Promise(resolve => { release = resolve; });
    const write = vi.spyOn(boundary.db, "run");
    boundary.fetch.mockImplementation(async url => {
      if (String(url).includes("/auth/refresh")) {
        boundary.adapterGate = () => { enter(); return gate; };
        return new Response(JSON.stringify({ data: { accessToken: "cancelled-new", refreshToken: "cancelled-rotation" } }), { headers: { "content-type": "application/json" } });
      }
      return failure(401, "expired token");
    });
    const pending = run(authorized, undefined, caller.signal); await entered;
    caller.abort(); expect((await pending).status).toBe(499); release(); await flush();
    expect(write.mock.calls).toHaveLength(0);
    expect(JSON.parse(boundary.db.get("SELECT data FROM providerConnections WHERE id='oauth-cancel'").data).refreshToken).toBe("fixture-refresh-cancel");
    expect(boundary.fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a branded unsupported Combo and zero-member admission without selecting credentials", async () => {
    const { createAuthorizedVirtualTarget } = await import("@/lib/apiKeyPolicy/virtualTargets.js");
    const { authorized } = await fixture();
    const combo = createAuthorizedVirtualTarget({ ...authorized.target, kind: "combo" }, authorized.members);
    const empty = createAuthorizedVirtualTarget(authorized.target, []);
    const select = vi.spyOn(boundary.db, "all");
    expect((await run(combo)).status).toBe(400); expect((await run(empty)).status).toBe(403);
    expect(select.mock.calls).toHaveLength(0); expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("project preparation passes abort into its real shared transport before any generation", async () => {
    const model = "gemini-cli/gemini-2.5-pro";
    addAccount("project-cancel", 1, { apiKey: null, accessToken: "project-token", expiresAt: "2099-01-01T00:00:00Z" }, "gemini-cli");
    const { authorized, alias } = await fixture({ models: [model], primaryModel: model }); const caller = new AbortController(); let enter; const entered = new Promise(resolve => { enter = resolve; }); let sharedSignal;
    boundary.fetch.mockImplementation((url, init) => { sharedSignal = init.signal; enter(); return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })); });
    const pending = run(authorized, undefined, caller.signal); await entered; caller.abort(); expect((await pending).status).toBe(499); expect(sharedSignal.aborted).toBe(true); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[0].status).toBe("available");
  });
  it("project persistence passes signal through the real DB repository awaiting adapter", async () => {
    const model = "gemini-cli/gemini-2.5-pro";
    addAccount("project-persist", 1, { apiKey: null, accessToken: "project-token", expiresAt: "2099-01-01T00:00:00Z" }, "gemini-cli");
    const { authorized } = await fixture({ models: [model], primaryModel: model }); const caller = new AbortController(); let enter, release; const entered = new Promise(resolve => { enter = resolve; }); const gate = new Promise(resolve => { release = resolve; });
    const write = vi.spyOn(boundary.db, "run");
    boundary.fetch.mockImplementation(async () => { boundary.adapterGate = () => { enter(); return gate; }; return new Response(JSON.stringify({ cloudaicompanionProject: "fixture-project" }), { headers: { "content-type": "application/json" } }); });
    const pending = run(authorized, undefined, caller.signal); await entered; caller.abort(); expect((await pending).status).toBe(499); release(); await flush(); expect(write.mock.calls).toHaveLength(0); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(boundary.db.get("SELECT data FROM providerConnections WHERE id='project-persist'").data).projectId).toBeUndefined();
  });
  it("ordinary direct and nested Combo keep their provider path without alias streaming", async () => {
    boundary.db.run("INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES('inner','Inner',?,'fixture','fixture')", [JSON.stringify([ids[0]])]);
    boundary.db.run("INSERT INTO combos(id,name,models,createdAt,updatedAt) VALUES('outer','Outer',?,'fixture','fixture')", [JSON.stringify(["Inner"])]);
    for (const model of [ids[0], "Outer"]) {
      const body = { model, stream: false, messages: [{ role: "user", content: "hello" }] };
      const request = new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });
      const response = model === ids[0]
        ? (await (await import("../../src/sse/handlers/providerChat.js")).executeProviderChat({ body, member: { provider, model: "primary" }, request })).response
        : await handleChat(request);
      expect(response.status).toBe(200);
    }
    expect(calls.map(c => c.body.stream)).toEqual([false, false]);
    expect(boundary.pxpipe).toHaveBeenCalledTimes(2);
  });
  it.each(["missing", "inactive"])("falls back when the admitted primary account is %s without penalizing it", async availability => {
    const primaryProvider = "openai-compatible-task8-unavailable";
    const primary = "unavailable/primary";
    boundary.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?, 'openai-compatible', ?, 'fixture', 'fixture')", [primaryProvider, JSON.stringify({ prefix: "unavailable", baseUrl: "http://127.0.0.1:20388/v1", apiType: "chat" })]);
    if (availability === "inactive") addAccount("inactive-primary", 1, {}, primaryProvider);
    const { authorized, alias } = await fixture({ models: [primary, ids[1]], primaryModel: primary });
    const original = await getModelsAliasById(alias.id);
    if (availability === "inactive") boundary.db.run("UPDATE providerConnections SET isActive=0 WHERE id='inactive-primary'");
    const response = await run(authorized);
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("answer");
    expect(calls.map(call => call.body.model)).toEqual(["a"]);
    expect(boundary.usage).toHaveBeenCalledTimes(1);
    const status = runtime.getModelsAliasRuntimeStatus(alias);
    expect(status.effectiveOrder).toEqual([primary, ids[1]]);
    expect(status.members.every(member => member.status === "available")).toBe(true);
    expect(await getModelsAliasById(alias.id)).toEqual(original);
    const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: [primary, ids[1]] });
    const lease = runtime.tryClaimAliasMember(snapshot, primary);
    expect(lease).not.toBeNull();
    expect(runtime.releaseAliasMemberAttempt(lease)).toBe(true);
  });
});

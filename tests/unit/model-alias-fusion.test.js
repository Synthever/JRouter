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
const provider = "openai-compatible-task8-fusion";
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

describe("real alias fusion", () => {
  it("reuses one stored useful answer, with no repeat generation or usage", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b.model); return b.model === "primary" ? answer("upstream-primary", "stored answer") : answer("upstream-a", ""); });
    const response = await run(authorized);
    expect((await response.json()).choices[0].message.content).toBe("stored answer");
    expect(calls).toEqual(["primary", "a"]);
    expect(boundary.usage).toHaveBeenCalledTimes(1);
  });
  it("uses parsed useful quorum and cancels stragglers neutrally before judging", async () => {
    vi.useFakeTimers(); const { alias, authorized } = await fixture({ strategy: "fusion" });
    const held = controlled(); let signal;
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b); if (b.model === "c") { signal = init.signal; return held.response; } return answer(b.model, b.model === "a" ? "" : "useful"); });
    const pending = run(authorized); await flush();
    await vi.advanceTimersByTimeAsync(8001); const response = await pending;
    expect(response.status).toBe(200); expect(calls.map(b => b.model)).toEqual(["primary", "a", "b", "c", "primary"]);
    expect(signal.aborted).toBe(true); expect(held.cancel).toHaveBeenCalled();
    expect(runtime.getModelsAliasRuntimeStatus(alias).members[3].status).toBe("available");
    expect(boundary.usage).toHaveBeenCalledTimes(3);
    expect(boundary.usage.mock.calls.map(([usage]) => [usage.provider, usage.model, usage.connectionId])).toEqual([[provider, "primary", "account1"], [provider, "b", "account1"], [provider, "primary", "account1"]]);
  });
  it("tries eligible judge alternatives once and retains composed tools/history", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2), promptInjectionEnabled: true, systemPrompt: "one injected instruction" });
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b); const judge = b.messages.some(m => typeof m.content === "string" && m.content.includes("PANEL RESPONSES")); return judge && b.model === "primary" ? failure() : answer(b.model); });
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
    const body = { model: "jrouter/Nested/Case", stream: false, tools, messages: [{ role: "system", content: "client system" }, { role: "user", content: "hello" }, { role: "assistant", content: "context", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call1", content: "result" }, { role: "user", content: "answer" }] };
    const before = structuredClone(body); expect((await run(authorized, body)).status).toBe(200);
    expect(calls.map(b => b.model)).toEqual(["primary", "a", "primary", "a"]);
    for (const b of calls.slice(0, 2)) { expect(b.tools).toBeUndefined(); expect(JSON.stringify(b)).toContain("Tool result"); }
    for (const b of calls.slice(2)) { expect(b.tools).toEqual(tools); expect(JSON.stringify(b).match(/one injected instruction/g)).toHaveLength(1); expect(b.messages.some(m => m.role === "tool")).toBe(true); }
    expect(body).toEqual(before); expect(boundary.usage).toHaveBeenCalledTimes(3);
  });
  it("explicit eligible judge has priority and never selects outside admitted members", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 3), judgeModel: ids[2] }, { policy: { allowedModels: ["jrouter/Nested/Case"], blockedModels: [ids[1]] } });
    expect((await run(authorized)).status).toBe(200); expect(calls.map(call => call.body.model)).toEqual(["primary", "b", "b"]);
  });
  it("single stored answer streams via existing serializers, no second usage", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b.model); return b.model === "primary" ? answer("actual-primary", "stored stream") : failure(); });
    const response = await run(authorized, { model: "jrouter/Nested/Case", stream: true, messages: [{ role: "user", content: "hello" }] });
    expect(response.headers.get("content-type")).toContain("text/event-stream"); const text = await response.text();
    expect(text).toContain("stored stream"); expect(text).toContain("[DONE]"); expect(calls).toEqual(["primary", "a"]); expect(boundary.usage).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["/v1/messages", { system: "client", messages: [{ role: "user", content: "hello" }] }, "message_stop"],
    ["/v1/responses", { instructions: "client", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] }, "response.completed"],
    ["/v1beta/models/native:generateContent", { systemInstruction: { parts: [{ text: "client" }] }, contents: [{ role: "user", parts: [{ text: "hello" }] }] }, "finishReason"],
  ])("reuses single stored answer with protocol terminal at %s", async (endpoint, content, terminal) => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b); return b.model === "primary" ? answer("actual-primary", "preserved answer") : failure(); });
    const orchestrator = await import("../../src/sse/services/modelsAliasChat.js"); const body = { model: "jrouter/Nested/Case", stream: true, ...content };
    const response = await orchestrator.handleModelsAliasChat({ authorized, body, request: new Request(`http://127.0.0.1${endpoint}`, { method: "POST", body: JSON.stringify(body) }), log });
    const text = await response.text(); expect(text).toContain("preserved answer"); expect(text).toContain(terminal); expect(calls).toHaveLength(2); expect(boundary.usage).toHaveBeenCalledTimes(1);
  });
  it("malformed HTTP200 does not start useful quorum grace", async () => {
    vi.useFakeTimers(); const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 3) }); const held = controlled();
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b); if (b.model === "b") return held.response; return b.model === "primary" ? answer("primary", "one useful") : new Response("not JSON", { headers: { "content-type": "application/json" } }); });
    let ended = false; const pending = run(authorized).then(response => { ended = true; return response; }); await flush(); await vi.advanceTimersByTimeAsync(8001);
    expect(ended).toBe(false); expect(held.cancel).not.toHaveBeenCalled();
    held.send({ choices: [{ delta: { content: "second useful" }, finish_reason: "stop" }] }); held.close();
    expect((await pending).status).toBe(200); expect(calls).toHaveLength(4);
  });
  it("retains actual all-failed rate-limit response and Retry-After", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) }); boundary.fetch.mockImplementation(async () => failure(429, "quota", { "retry-after": "120" }));
    const response = await run(authorized); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("120");
  });
  it("client abort after one useful panel answer is terminal, never reused as success", async () => {
    const { alias, authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) }); const caller = new AbortController(); const held = controlled();
    boundary.fetch.mockImplementation(async (url, init) => JSON.parse(init.body).model === "primary" ? answer("actual", "stored") : held.response);
    const pending = run(authorized, undefined, caller.signal); await flush(); caller.abort();
    expect((await pending).status).toBe(499); expect(boundary.fetch).toHaveBeenCalledTimes(2);
    expect(runtime.getModelsAliasRuntimeStatus(alias).members.every(m => m.status === "available")).toBe(true);
  });
  it("hard collection cancels a recovering post-output panel and releases its lease immediately", async () => {
    vi.useFakeTimers(); const { alias, authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    const snapshot = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: ids.slice(0, 2) });
    runtime.settleAliasMemberAttempt(runtime.tryClaimAliasMember(snapshot, ids[1]), { category: "transient" }); await vi.advanceTimersByTimeAsync(30001);
    const held = controlled(); let signal;
    boundary.fetch.mockImplementation(async (url, init) => { if (JSON.parse(init.body).model === "primary") return answer("actual", "one"); signal = init.signal; return held.response; });
    const pending = run(authorized); await flush(); held.send({ choices: [{ delta: { content: "started" } }] }); await flush();
    await vi.advanceTimersByTimeAsync(90001); const response = await pending;
    expect(response.status).toBe(200); expect(signal.aborted).toBe(true); expect(held.cancel).toHaveBeenCalled();
    const next = runtime.getAliasCandidateSnapshot(alias, { allowedMembers: ids.slice(0, 2) });
    expect(next.candidates).toContain(ids[1]); expect(runtime.getModelsAliasRuntimeStatus(alias).members[1].status).toBe("recovering");
  });
  it("caller abort cancels all panels and does not generate a judge", async () => {
    const { alias, authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) }); const caller = new AbortController(); const held = [controlled(), controlled()];
    boundary.fetch.mockImplementation(async () => held[boundary.fetch.mock.calls.length - 1].response);
    const pending = run(authorized, undefined, caller.signal); await flush(); caller.abort();
    expect((await pending).status).toBe(499); expect(boundary.fetch).toHaveBeenCalledTimes(2); for (const h of held) expect(h.cancel).toHaveBeenCalled();
    expect(runtime.getModelsAliasRuntimeStatus(alias).members.every(m => m.status === "available")).toBe(true);
  });
  it("strips inline Responses tools from panels but preserves them for the judge", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    const body = { model: "jrouter/Nested/Case", stream: false, input: [
      { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] },
      { role: "user", content: "hello" },
    ] };
    const original = structuredClone(body);
    const { handleModelsAliasChat } = await import("../../src/sse/services/modelsAliasChat.js");
    const response = await handleModelsAliasChat({ authorized, body, request: new Request("http://127.0.0.1/v1/responses", { method: "POST", body: JSON.stringify(body) }), log });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    for (const call of calls.slice(0, 2)) {
      expect(call.body.tools).toBeUndefined();
      expect(JSON.stringify(call.body)).not.toContain("additional_tools");
    }
    expect(calls[2].body.tools.map(tool => tool.function.name)).toEqual(["lookup"]);
    expect(boundary.usage).toHaveBeenCalledTimes(3);
    expect(body).toEqual(original);
  });
  it("preserves string Responses input and both panel answers in the judge request", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2), promptInjectionEnabled: false });
    boundary.fetch.mockImplementation(async (url, init) => {
      const payload = JSON.parse(init.body); calls.push({ body: payload });
      return answer(payload.model, `source-${payload.model}`);
    });
    const body = { model: "jrouter/Nested/Case", stream: false, instructions: "client instruction", input: "original question" };
    const { handleModelsAliasChat } = await import("../../src/sse/services/modelsAliasChat.js");
    const response = await handleModelsAliasChat({ authorized, body, request: new Request("http://127.0.0.1/v1/responses", { method: "POST", body: JSON.stringify(body) }), log });
    expect(response.status).toBe(200);
    expect(calls.map(call => call.body.model)).toEqual(["primary", "a", "primary"]);
    const judge = calls[2].body.messages;
    expect(JSON.stringify(judge)).toContain("original question");
    expect(JSON.stringify(judge)).toContain("client instruction");
    expect(judge.at(-1).role).toBe("user");
    const synthesis = JSON.stringify(judge.at(-1).content);
    expect(synthesis).toContain("PANEL RESPONSES");
    expect(synthesis).toContain("source-primary");
    expect(synthesis).toContain("source-a");
    expect(boundary.usage).toHaveBeenCalledTimes(3);
    expect(body.input).toBe("original question");
  });
});

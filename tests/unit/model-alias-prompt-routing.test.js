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
const provider = "openai-compatible-task8-prompt";
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

describe("alias composed prompt and isolation", () => {
  it("composes once across members/accounts and never mutates body or raw logging input", async () => {
    addAccount("account2", 2); const { authorized } = await fixture({ models: ids.slice(0, 2), promptInjectionEnabled: true, systemPrompt: "injected once" });
    boundary.fetch.mockImplementation(async (url, init) => { const b = JSON.parse(init.body); calls.push(b); return b.model === "primary" ? failure() : answer(b.model); });
    const body = { model: "jrouter/Nested/Case", stream: false, messages: [{ role: "system", content: "client instruction" }, { role: "user", content: "hello" }] }; const before = structuredClone(body);
    const response = await run(authorized, body); expect(response.status).toBe(200); expect(calls.map(b => b.model)).toEqual(["primary", "primary", "a"]);
    for (const b of calls) { expect(JSON.stringify(b).match(/injected once/g)).toHaveLength(1); expect(JSON.stringify(b)).toContain("client instruction"); }
    expect(body).toEqual(before);
  });
  it.each([
    ["/v1/chat/completions", { messages: [{ role: "user", content: [{ type: "text", text: "question" }, { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }] }, { role: "assistant", content: [{ type: "text", text: "context" }, { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }], tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call1", content: "found" }, { role: "user", content: "final answer" }], tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }] }],
    ["/v1/messages", { messages: [{ role: "user", content: [{ type: "text", text: "question" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } }] }, { role: "assistant", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } }, { type: "tool_use", id: "call1", name: "lookup", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: "found" }] }], tools: [{ name: "lookup", input_schema: { type: "object", properties: {} } }] }],
    ["/v1/responses", { input: [{ role: "user", content: [{ type: "input_text", text: "question" }, { type: "input_image", image_url: "data:image/png;base64,ZmFrZQ==" }] }, { type: "function_call", call_id: "call1", name: "lookup", arguments: "{}" }, { type: "function_call_output", call_id: "call1", output: "found" }], tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] }],
    ["/v1beta/models/native:generateContent", { contents: [{ role: "user", parts: [{ text: "question" }, { inlineData: { mimeType: "image/png", data: "ZmFrZQ==" } }] }, { role: "model", parts: [{ functionCall: { name: "lookup", args: {} } }] }, { role: "user", parts: [{ functionResponse: { name: "lookup", response: { result: "found" } } }] }], tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object", properties: {} } }] }] }],
  ])("panel flattens tools without losing typed media and judge retains original at %s", async (endpoint, content) => {
    const models = ["fixture/gpt-4o", "fixture/gpt-4o-mini"]; const { authorized } = await fixture({ strategy: "fusion", models, primaryModel: models[0], promptInjectionEnabled: true, systemPrompt: "media instruction" });
    const orchestrator = await import("../../src/sse/services/modelsAliasChat.js"); const body = { model: "jrouter/Nested/Case", stream: false, ...content }; const before = structuredClone(body);
    const response = await orchestrator.handleModelsAliasChat({ authorized, body, request: new Request(`http://127.0.0.1${endpoint}`, { method: "POST", body: JSON.stringify(body) }), clientRawRequest: { endpoint, body }, log });
    expect(response.status).toBe(200); expect(calls).toHaveLength(3);
    for (const call of calls) { expect(JSON.stringify(call.body)).toContain("ZmFrZQ=="); expect(JSON.stringify(call.body).match(/media instruction/g)).toHaveLength(1); }
    for (const call of calls.slice(0, 2)) { expect(call.body.tools).toBeUndefined(); expect(JSON.stringify(call.body)).toContain("Tool result"); expect(JSON.stringify(call.body)).not.toContain("tool_calls"); }
    expect(calls[2].body.tools).toBeDefined(); expect(JSON.stringify(calls[2].body)).toContain("PANEL RESPONSES"); expect(body).toEqual(before);
  });
  it.each([
    ["/v1/chat/completions", { messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call1", content: [{ type: "text", text: "found" }, { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }] }, { role: "user", content: "answer" }] }],
    ["/v1/messages", { messages: [{ role: "user", content: "hello" }, { role: "assistant", content: [{ type: "tool_use", id: "call1", name: "lookup", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: [{ type: "text", text: "found" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } }] }] }] }],
  ])("retains tool-result media as typed blocks in panels at %s", async (endpoint, content) => {
    const models = ["fixture/gpt-4o", "fixture/gpt-4o-mini"]; const { authorized } = await fixture({ strategy: "fusion", models, primaryModel: models[0] });
    const orchestrator = await import("../../src/sse/services/modelsAliasChat.js"); const body = { model: "jrouter/Nested/Case", stream: false, ...content };
    const response = await orchestrator.handleModelsAliasChat({ authorized, body, request: new Request(`http://127.0.0.1${endpoint}`, { method: "POST", body: JSON.stringify(body) }), log });
    expect(response.status).toBe(200);
    for (const call of calls.slice(0, 2)) expect(call.body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).some(b => b.type === "image_url")).toBe(true);
  });
  it("legacy functions cannot escape panel tool-loop protection", async () => {
    const { authorized } = await fixture({ strategy: "fusion", models: ids.slice(0, 2) });
    const body = { model: "jrouter/Nested/Case", stream: false, functions: [{ name: "lookup", parameters: { type: "object" } }], function_call: "auto", messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "", function_call: { name: "lookup", arguments: "{}" } }, { role: "function", name: "lookup", content: "found" }, { role: "user", content: "answer" }] };
    expect((await run(authorized, body)).status).toBe(200);
    for (const call of calls.slice(0, 2)) { expect(call.body.functions).toBeUndefined(); expect(JSON.stringify(call.body)).not.toContain("function_call"); expect(JSON.stringify(call.body)).toContain("Called tools"); }
    expect(calls[2].body.functions).toBeDefined();
  });
  it("hard typed history is not silently stripped by an incapable primary", async () => {
    const models = [ids[0], "fixture/gpt-4o"]; const { authorized } = await fixture({ models, primaryModel: models[0] });
    const response = await run(authorized, { model: "jrouter/Nested/Case", stream: false, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }] }, { role: "assistant", content: "history" }, { role: "user", content: "continue" }] });
    expect(response.status).toBe(200); expect(calls.map(call => call.body.model)).toEqual(["gpt-4o"]); expect(JSON.stringify(calls[0].body)).toContain("ZmFrZQ==");
  });
  it.each([
    ["/v1/messages", { system: "client", messages: [{ role: "user", content: "hello" }] }],
    ["/v1/responses", { instructions: "client", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] }],
    ["/v1beta/models/native:generateContent", { systemInstruction: { parts: [{ text: "client" }] }, contents: [{ role: "user", parts: [{ text: "hello" }] }] }],
  ])("composes format-aware instructions once at %s", async (endpoint, content) => {
    const { authorized } = await fixture({ models: [ids[0]], promptInjectionEnabled: true, systemPrompt: "injected format" });
    const orchestrator = await import("../../src/sse/services/modelsAliasChat.js").catch(() => null); expect(orchestrator).not.toBeNull();
    const body = { model: "jrouter/Nested/Case", stream: false, ...content }; const before = structuredClone(body);
    const response = await orchestrator.handleModelsAliasChat({ authorized, body, request: new Request(`http://127.0.0.1${endpoint}`, { method: "POST", body: JSON.stringify(body) }), clientRawRequest: { endpoint, body }, log });
    expect(response.status).toBe(200); expect(JSON.stringify(calls[0].body).match(/injected format/g)).toHaveLength(1); expect(JSON.stringify(calls[0].body)).toContain("client"); expect(body).toEqual(before);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => { const fetch = vi.fn(); globalThis.fetch = fetch; return { fetch, db: null, session: vi.fn(async () => false) }; });
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => boundary.db, getAdapterSync: () => boundary.db }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }) }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn(), errorLine: vi.fn(), maskKey: () => "fixture", tagForSession: () => "fixture", fmtThink: () => "", nextTag: () => "fixture" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: (...args) => boundary.session(...args) }));
const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
const { TABLES, buildCreateTableSql } = await import("@/lib/db/schema.js");
const { createModelsAlias } = await import("@/lib/db/repos/modelsAliasesRepo.js");
const { invalidateModelsAliasRuntime } = await import("../../src/sse/services/modelsAliasRuntime.js");
const { POST: chat } = await import("../../src/app/api/v1/chat/completions/route.js");
const { withApiKeyPolicy } = await import("@/lib/apiKeyPolicy/gateway.js");
const policyContext = await import("@/lib/apiKeyPolicy/context.js");
const provider = "openai-compatible-task9";
let aliases = [], calls = [];
function request(body, path = "/v1/chat/completions", headers = {}, signal) { return new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal }); }
function body(model = "jrouter/Nested/Case", extra = {}) { return { model, stream: false, messages: [{ role: "user", content: "hello" }], ...extra }; }
function answer(model = "actual", text = "answer", usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) { return Response.json({ id: "chatcmpl-fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], ...(usage ? { usage } : {}) }); }
function settings(extra = {}) { boundary.db.run("INSERT OR REPLACE INTO settings(id,data) VALUES(1,?)", [JSON.stringify({ requireApiKey: false, requireLogin: true, rtkEnabled: false, ...extra })]); }
function account(p = provider, id = "account") { boundary.db.run("INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,'apikey',?,1,1,?,'fixture','fixture')", [id, p, id, JSON.stringify({ apiKey: "fixture-credential", providerSpecificData: { baseUrl: "http://127.0.0.1:20388/v1" } })]); }
function key(policy = {}, access = null) { boundary.db.run("INSERT INTO apiKeys(id,key,isActive,createdAt,policy,accessRestricted,accessAllow) VALUES('key','fixture-key',1,'fixture',?,?,?)", [JSON.stringify(policy), access ? 1 : 0, access ? JSON.stringify(access) : null]); return { Authorization: "Bearer fixture-key" }; }
function combo(name = "Outer", models = ["fixture/a"], extra = {}) { boundary.db.run("INSERT INTO combos(id,name,models,promptInjectionEnabled,systemPrompt,createdAt,updatedAt) VALUES(?,?,?,?,?,'fixture','fixture')", [name, name, JSON.stringify(models), extra.systemPrompt ? 1 : 0, extra.systemPrompt || null]); }
async function alias(config = {}) { const a = await createModelsAlias({ name: "Nested/Case", models: ["fixture/a","fixture/b"], primaryModel: "fixture/a", ...config }); aliases.push(a); return a; }
function fragmented(events) { const bytes = new TextEncoder().encode(events.map(e => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("")); let offset = 0; return new Response(new ReadableStream({ pull(c) { if (offset >= bytes.length) return c.close(); c.enqueue(bytes.slice(offset, offset += 3)); } }), { headers: { "content-type": "text/event-stream" } }); }
async function settle() { for(let i=0;i<100;i++) await Promise.resolve(); }
beforeAll(async () => { boundary.db = await createNodeSqliteAdapter(":memory:"); for (const [n,t] of Object.entries(TABLES)) boundary.db.exec(buildCreateTableSql(n,t)); });
afterAll(() => boundary.db.close());
beforeEach(() => { vi.clearAllMocks(); calls=[]; for(const n of Object.keys(TABLES)) boundary.db.run(`DELETE FROM ${n}`); settings(); boundary.db.run("INSERT INTO providerNodes(id,type,data,createdAt,updatedAt) VALUES(?,'openai-compatible',?,'fixture','fixture')", [provider, JSON.stringify({ prefix: "fixture", baseUrl: "http://127.0.0.1:20388/v1", apiType: "chat" })]); account(); boundary.db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)", [provider, JSON.stringify({ a: {input: 1, output: 2}, b: {input: 4, output: 8}, judge: {input: 1, output: 2} })]); boundary.fetch.mockReset().mockImplementation(async (url,init) => { if (!String(url).startsWith("http://127.0.0.1:20388/v1/")) throw new Error(`Unexpected fixture fetch ${url}`); const b=JSON.parse(init.body); calls.push({ url, body:b, signal:init.signal }); return answer(b.model); }); vi.stubGlobal("fetch",boundary.fetch); boundary.session.mockResolvedValue(false); });
afterEach(async () => { await settle(); for(const a of aliases.splice(0)) invalidateModelsAliasRuntime(a.id); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const { POST: messages } = await import("../../src/app/api/v1/messages/route.js");
const { POST: responses } = await import("../../src/app/api/v1/responses/route.js");
const { POST: compact } = await import("../../src/app/api/v1/responses/compact/route.js");
const { POST: count } = await import("../../src/app/api/v1/messages/count_tokens/route.js");
const { POST: gemini } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const { POST: ollama } = await import("../../src/app/api/v1/api/chat/route.js");
function geminiRequest(action="generateContent",extra={},signal) { const path=`jrouter/Nested/Case:${action}`;return [request({contents:[{role:"user",parts:[{text:"hello"}]}],...extra},`/v1beta/models/${path}`,{},signal),{params:Promise.resolve({path:path.split("/")})}]; }
describe("real public protocol routes",()=> {
 it.each([["Chat",chat,"/v1/chat/completions",{}],["Messages",messages,"/v1/messages",{max_tokens:50}],["Responses",responses,"/v1/responses",{input:"hello"}],["Compact",compact,"/v1/responses/compact",{input:"hello"}]])("%s returns canonical identity after actual translation",async(name,route,path,extra)=> {await alias();const r=await route(request(body(undefined,extra),path)); expect(r.status).toBe(200); const j=await r.json();expect(j.model).toBe("jrouter/Nested/Case");expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe("a"); });
 it.each(["generateContent","streamGenerateContent"])("Gemini %s resolves full case/slash target",async action=> {await alias();boundary.fetch.mockImplementation(async(url,init)=>{calls.push({body:JSON.parse(init.body)});return fragmented([{model:"a",choices:[{index:0,delta:{content:"café"},finish_reason:null}]},{model:"a",choices:[{index:0,delta:{},finish_reason:"stop"}]}]);}); const r=await gemini(...geminiRequest(action));expect(r.status).toBe(200);const text=await r.text();expect(text).toContain("café");expect(text).toContain('"modelVersion":"jrouter/Nested/Case"');expect(calls).toHaveLength(1); });
 it("count_tokens requires target but has no quota record",async()=>{await alias();const h=key({maxTokensQuota:1,rateLimitRpm:1}); const r=await count(request(body(),"/v1/messages/count_tokens",h));expect(r.status).toBe(200);expect((await r.json()).input_tokens).toBeGreaterThan(0);expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(0);expect((await count(request(body("fixture/a"),"/v1/messages/count_tokens",h))).status).toBe(403);expect(calls).toHaveLength(0); });
 it("Ollama preserves unsuccessful admission instead of successful empty NDJSON",async()=>{const r=await ollama(request(body("fixture/a"),"/v1/api/chat"));expect(r.status).toBe(403);expect((await r.json()).error.code).toBe("direct_model_not_allowed");expect(calls).toHaveLength(0);});
 it.each(["Gemini","Ollama"])("%s preserves fragmented UTF8, tools, reasoning and late error without replay",async format=> {await alias();boundary.fetch.mockImplementation(async(url,init)=>{calls.push({body:JSON.parse(init.body)});return fragmented([{model:"a",choices:[{index:0,delta:{content:"café",reasoning_content:"think",tool_calls:[{index:0,id:"call_fixture",function:{name:"lookup",arguments:'{"x":'}}]},finish_reason:null}]},{model:"a",choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:"tool_calls"}]},{type:"error",status:503,error:{message:"late fixture failure"}},"[DONE]"]);});const r=format==="Gemini"?await gemini(...geminiRequest("streamGenerateContent")):await ollama(request(body(undefined,{stream:true}),"/v1/api/chat"));const text=await r.text();expect(text).toContain("café");expect(text).toContain("lookup");expect(text).toContain("think");expect(text).toContain("late fixture failure");expect(text).toContain("jrouter/Nested/Case");expect(calls).toHaveLength(1);if(format==="Ollama") {const lines=text.trim().split("\n").map(JSON.parse);const errorAt=lines.findIndex(l=>l.error);expect(errorAt).toBeGreaterThan(-1);expect(lines.slice(errorAt+1).some(l=>l.done===true)).toBe(false);} });
 it.each(["Compact","Gemini"])("%s reconstruction preserves caller/config cancellation",async format=> {const a=await alias();const caller=new AbortController();let enter;const entered=new Promise(r=>enter=r);let upstream;boundary.fetch.mockImplementation((url,init)=>{upstream=init.signal;enter();return new Promise((resolve,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true}));}); const pending=format==="Compact"?compact(request(body(undefined,{input:"hi"}),"/v1/responses/compact",{},caller.signal)):gemini(...geminiRequest("generateContent",{},caller.signal));await entered;caller.abort();expect((await pending).status).toBe(499);expect(upstream.aborted).toBe(true);expect(a.id).toBeTruthy();});
 it("Gemini alias preserves typed image, function history and final tool output in executor payload",async()=> {await alias({models:["fixture/gpt-4o"],primaryModel:"fixture/gpt-4o"});const extra={tools:[{functionDeclarations:[{name:"lookup",parameters:{type:"object",properties:{x:{type:"number"}}}}]}],contents:[{role:"user",parts:[{inlineData:{mimeType:"image/png",data:"aGVsbG8="}},{text:"what is this"}]},{role:"model",parts:[{functionCall:{id:"call_fixture",name:"lookup",args:{x:1}}}]},{role:"user",parts:[{functionResponse:{id:"call_fixture",name:"lookup",response:{result:"final tool output"}}}]}]}; const r=await gemini(...geminiRequest("generateContent",extra));expect(r.status).toBe(200);await r.text();const payload=calls[0].body;expect(payload.tools[0].function.name).toBe("lookup");expect(JSON.stringify(payload)).toContain("data:image/png;base64,aGVsbG8=");expect(payload.messages.some(m=>m.tool_calls?.[0]?.id==="call_fixture")).toBe(true);expect(payload.messages.at(-1)).toMatchObject({role:"tool",tool_call_id:"call_fixture",content:'"final tool output"'}); });
 it("Gemini alias rejects unsupported parts rather than silently dropping them",async()=> {await alias();const r=await gemini(...geminiRequest("generateContent",{contents:[{role:"user",parts:[{executableCode:{language:"PYTHON",code:"print(1)"}}]}]}));expect(r.status).toBe(400);expect(calls).toHaveLength(0);});
 it("native Gemini AUDIO transport remains unchanged and is not direct-LLM banned",async()=> {account("gemini","gemini-account");const nativeBody={contents:[{parts:[{text:"Speak naturally: hello"}]}],generationConfig:{responseModalities:["AUDIO"],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:"Kore"}}},temperature:0.01,seed:123}};boundary.fetch.mockImplementation(async(url,init)=> {calls.push({url,body:JSON.parse(init.body),headers:init.headers});return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:"audio/pcm",data:"YQ=="}}]}}]});});const model="gemini-3.1-flash-tts-preview";const r=await gemini(request(nativeBody,`/v1beta/models/${model}:generateContent`),{params:Promise.resolve({path:[`${model}:generateContent`]})});expect(r.status).toBe(200);expect((await r.json()).candidates[0].content.parts[0].inlineData.mimeType).toBe("audio/pcm");expect(calls).toHaveLength(1);expect(calls[0].body).toEqual(nativeBody);expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);expect(calls[0].headers["x-goog-api-key"]).toBe("fixture-credential");});
  it.each([true, false])("Gemini executor preserves key output cap with generationConfig=%s", async hasConfig => {
    await alias();
    const headers = key({ maxOutputTokens: 10 });
    const payload = {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object", properties: {} } }] }],
      ...(hasConfig ? { generationConfig: { temperature: 0.2 } } : {}),
    };
    const response = await gemini(request(payload, "/v1beta/models/jrouter/Nested/Case:generateContent", headers), {
      params: Promise.resolve({ path: ["jrouter", "Nested", "Case:generateContent"] }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.max_tokens).toBe(10);
    expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(1);
    expect(boundary.db.get("SELECT actualTokens FROM apiKeyRequests").actualTokens).toBe(5);
  });
  it.each(["jrouter/Nested/Case", "Outer"])("Ollama JSON answer retains content, reasoning and tools for %s", async model => {
    if (model === "Outer") combo(); else await alias();
    boundary.fetch.mockImplementation(async (url, init) => {
      const payload = JSON.parse(init.body); calls.push({ body: payload });
      return Response.json({ id: "json-answer", model: payload.model, choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: "complete answer",
        tool_calls: [{ id: "call_fixture", type: "function", function: { name: "lookup", arguments: '{"x":1}' } }],
      } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
    });
    const response = await ollama(request(body(model, { stream: false }), "/v1/api/chat"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.model).toBe(model === "Outer" ? "jrouter/Outer" : model);
    expect(result.message.content).toBe("complete answer");
    expect(result.message.tool_calls).toEqual([{ function: { name: "lookup", arguments: { x: 1 } } }]);
    expect(result.done).toBe(true);
    expect(result.prompt_eval_count).toBeGreaterThanOrEqual(2);
    expect(result.eval_count).toBe(3);
    expect(calls).toHaveLength(1);
  });
  it("Ollama JSON preserves reasoning-only output under the existing core contract", async () => {
    await alias();
    boundary.fetch.mockImplementation(async (url, init) => {
      calls.push({ body: JSON.parse(init.body) });
      return Response.json({ model: "a", choices: [{ index: 0, finish_reason: "stop", message: {
        role: "assistant", content: "", reasoning_content: "complete reasoning",
      } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
    });
    const response = await ollama(request(body(undefined, { stream: false }), "/v1/api/chat"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.message.thinking).toBe("complete reasoning");
    expect(result.done).toBe(true);
    expect(result.eval_count).toBe(3);
    expect(calls).toHaveLength(1);
  });
  it.each([true, false])("Gemini JSON preserves two unindexed tool calls with usage=%s", async hasUsage => {
    await alias();
    boundary.fetch.mockImplementation(async (url, init) => {
      calls.push({ body: JSON.parse(init.body) });
      return Response.json({ id: "multi-tool", model: "a", choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: "", tool_calls: [
          { id: "call_lookup", type: "function", function: { name: "lookup", arguments: '{"x":1}' } },
          { id: "call_save", type: "function", function: { name: "save", arguments: '{"y":2}' } },
        ],
      } }], ...(hasUsage ? { usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } } : {}) });
    });
    const response = await gemini(...geminiRequest());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.modelVersion).toBe("jrouter/Nested/Case");
    const functions = result.candidates[0].content.parts.filter(part => part.functionCall).map(part => part.functionCall);
    expect(functions).toEqual([{ name: "lookup", args: { x: 1 } }, { name: "save", args: { y: 2 } }]);
    expect(calls).toHaveLength(1);
  });
});

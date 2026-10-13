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

describe("public LLM real admission and accounting", () => {
  it.each(["cbai/flash","codebuddy-intl/flash", "legacy-provider-alias", "fixture/a", `${provider}/a`])("rejects direct %s before bypass, credentials, pricing or quota", async model => {
    key({allowedModels:[model], maxCostUsd:1}); settings({ccFilterNaming:true});
    boundary.db.run("INSERT INTO kv(scope,key,value) VALUES('modelAliases','legacy-provider-alias',?)", [JSON.stringify("fixture/a")]);
    const spy=vi.spyOn(boundary.db,"all");
    const response=await chat(request(body(model,{_internal:true,executionOptions:{alias:true},messages:[{role:"user",content:"Please generate a short title for this conversation"}]}),undefined,{"x-9r-cli-token":"forged",Authorization:"Bearer fixture-key"}));
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("direct_model_not_allowed");
    expect(calls).toHaveLength(0); expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(0);
    expect(spy.mock.calls.some(([sql]) => sql.includes("FROM providerConnections") || sql.includes("scope = 'pricing'"))).toBe(false);
  });
  it.each([[undefined,400,"invalid_request"],["",400,"invalid_request"],["jrouter/Missing",404,"model_not_found"],["jrouter/nested/case",404,"model_not_found"],["fixture/a",403,"direct_model_not_allowed"]])("optional-key admission rejects %s",async (model,status,code) => { await alias(); const r=await chat(request({ ...body(), model })); expect(r.status).toBe(status); expect((await r.json()).error.code).toBe(code); expect(calls).toHaveLength(0); });
  it("auth and endpoint checks precede target lookup",async()=> { settings({requireApiKey:true}); const spy=vi.spyOn(boundary.db,"get"); expect((await chat(request(body("jrouter/Missing")))).status).toBe(401); expect(spy.mock.calls.some(([sql])=>sql.includes("FROM modelsAliases"))).toBe(false); key({allowedEndpoints:["audio"]}); expect((await chat(request(body("jrouter/Missing"),undefined,{Authorization:"Bearer fixture-key"}))).status).toBe(403); });
  it.each([[{allowedModels:["fixture/a"]},null],[{},["fixture/a"]],[{allowedModels:["jrouter/Nested/Case"]},["fixture/a"]]])("a member cannot grant its alias parent",async(policy,access)=> {await alias(); const headers=key(policy,access); const r=await chat(request(body(),undefined,headers)); expect(r.status).toBe(403); expect((await r.json()).error.code).toBe("model_not_allowed"); expect(calls).toHaveLength(0); expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(0); });
  it("prices only permitted leaves and records actual nonzero provider usage",async()=> {await alias(); const h=key({allowedModels:["jrouter/Nested/Case"],blockedModels:["fixture/a"],maxCostUsd:1,maxOutputTokens:10},["jrouter/Nested/Case"]); const r=await chat(request(body(),undefined,h)); expect(r.status).toBe(200); const json=await r.json(); expect(json.model).toBe("jrouter/Nested/Case"); expect(json.id).toBe("chatcmpl-fixture"); expect(calls.map(c=>c.body.model)).toEqual(["b"]); const reservation=boundary.db.get("SELECT * FROM apiKeyRequests"); expect(reservation.actualTokens).toBe(5); expect(reservation.isPending).toBe(0); expect(reservation.estimatedCost).toBeGreaterThan(0); expect(boundary.db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(5); expect(boundary.db.get("SELECT provider,model,promptTokens,completionTokens FROM usageHistory")).toEqual({provider,model:"b",promptTokens:2,completionTokens:3}); });
  it("no-key alias never manufactures accounting context or quota",async()=> {await alias(); boundary.fetch.mockImplementation(async(url,init)=>{expect(policyContext.getApiKeyPolicyContext()).toBeFalsy();calls.push(JSON.parse(init.body));return answer("a");}); const r=await chat(request(body())); expect((await r.json()).model).toBe("jrouter/Nested/Case"); await settle();expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(0);expect(boundary.db.get("SELECT promptTokens FROM usageHistory").promptTokens).toBe(2); });
  it.each([false,true])("nested public wrapper only inherits identical target (key=%s)",async keyed=> {await alias(); const h=keyed?key():{}; const r=await withApiKeyPolicy(request(body(),undefined,h),async()=> {const admitted=policyContext.getPublicLlmTargetContext?.();expect(admitted).toBeDefined(); const same=await withApiKeyPolicy(request(body(),undefined,h),()=>Response.json({ok:true}),{family:"chat",targetAdmission:"public-llm",publicTarget:admitted});expect(same.status).toBe(200); return chat(request(body("fixture/a"),undefined,h));},{family:"chat",targetAdmission:"public-llm"}); expect(r.status).toBe(403);expect((await r.json()).error.code).toBe("direct_model_not_allowed");expect(calls).toHaveLength(0);expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(keyed?1:0); });
  it.each(["Outer","jrouter/Outer"])("keeps shared nested Combo behavior with canonical %s",async model=> {combo("Inner",["fixture/a"],{systemPrompt:"inner instruction"});combo("Outer",["Inner"],{systemPrompt:"outer instruction"});const h=key({allowedModels:["Outer"]},["jrouter/Outer"]);const r=await chat(request(body(model),undefined,h));expect(r.status).toBe(200);expect((await r.json()).model).toBe("jrouter/Outer"); expect(JSON.stringify(calls[0].body)).toContain("inner instruction");expect(JSON.stringify(calls[0].body)).toContain("outer instruction");expect(calls[0].body.stream).toBe(false); });
  it("fusion charges panel and judge with actual provider attribution",async()=> {await alias({strategy:"fusion"});const h=key({allowedModels:["jrouter/Nested/Case"]});const r=await chat(request(body(),undefined,h));expect(r.status).toBe(200);expect((await r.json()).model).toBe("jrouter/Nested/Case");expect(calls.map(c=>c.body.model)).toEqual(["a","b","a"]);expect(boundary.db.get("SELECT quotaTokens FROM apiKeys").quotaTokens).toBe(15);expect(boundary.db.get("SELECT actualTokens FROM apiKeyRequests").actualTokens).toBe(15); });
  it.each([[false,false],[true,false],[false,true],[true,true]])("extra Combo judge needs its own two grants (%s,%s)",async(policyGrant,legacyGrant)=> {combo("Outer",["fixture/a","fixture/b"]);settings({comboStrategies:{Outer:{fallbackStrategy:"fusion",judgeModel:"fixture/judge"}}});const h=key({allowedModels:["Outer",...(policyGrant?["fixture/judge"]:[])]},["Outer",...(legacyGrant?["fixture/judge"]:[])]);const r=await chat(request(body("Outer"),undefined,h));await r.text();expect(calls.some(c=>c.body.model==="judge")).toBe(policyGrant&&legacyGrant); });
  it.each(["prompt", "members"])("nested Combo %s edit after admission never creates a hybrid request", async changedField => {
    combo("Inner", ["fixture/a"], { systemPrompt: "admitted instruction" });
    combo("Outer", ["Inner"]);
    const originalAll = boundary.db.all.bind(boundary.db);
    let changed = false;
    vi.spyOn(boundary.db, "all").mockImplementation((sql, params) => {
      const result = originalAll(sql, params);
      if (!changed && sql === "SELECT * FROM providerNodes") {
        changed = true;
        if (changedField === "prompt") boundary.db.run("UPDATE combos SET systemPrompt='changed instruction' WHERE name='Inner'");
        else boundary.db.run("UPDATE combos SET models=?,systemPrompt='changed instruction' WHERE name='Inner'", [JSON.stringify(["fixture/b"])]);
      }
      return result;
    });
    const response = await chat(request(body("Outer")));
    expect(changed).toBe(true);
    expect(response.status).toBe(200);
    await response.text();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("a");
    expect(JSON.stringify(calls[0].body)).toContain("admitted instruction");
    expect(JSON.stringify(calls[0].body)).not.toContain("changed instruction");
  });
});

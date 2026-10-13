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

const { POST: probe } = await import("../../src/app/api/models/test/route.js");
const { POST: providerProbe } = await import("../../src/app/api/providers/[id]/test-models/route.js");
const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
describe("dashboard-only private real provider probes",()=> {
 it.each(["single","provider"])("key-only %s probe denied before model or credentials",async which=> {const h=key();const spy=vi.spyOn(boundary.db,"get");const r=which==="single"?await probe(request({model:"fixture/a",kind:"llm"},"/api/models/test",h)):await providerProbe(request({},"/api/providers/account/test-models",h),{params:Promise.resolve({id:"account"})});expect(r.status).toBe(403);expect(calls).toHaveLength(0);expect(spy.mock.calls.some(([sql])=>sql.includes("FROM providerConnections"))).toBe(false);});
 it("helper cannot dispatch an unauthorized direct LLM",async()=> {await expect(pingModelByKind("fixture/a","llm",undefined,{request:request({})})).rejects.toMatchObject({status:403});expect(calls).toHaveLength(0);});
 it("authorized dashboard probe calls real provider/core privately with 1024 budget",async()=> {boundary.session.mockResolvedValue(true);const r=await probe(request({model:"fixture/a",kind:"llm"},"/api/models/test",{cookie:"auth_token=synthetic"}));expect(r.status).toBe(200);expect((await r.json()).ok).toBe(true);expect(calls).toHaveLength(1);expect(calls[0].url).toBe("http://127.0.0.1:20388/v1/chat/completions");expect(calls[0].body.max_tokens).toBe(1024);expect(calls[0].body.stream).toBe(false);expect(boundary.db.get("SELECT COUNT(*) AS n FROM apiKeyRequests").n).toBe(0);});
 it("authorized providers caller threads actual management Request to private callback",async()=> {boundary.session.mockResolvedValue(true);boundary.fetch.mockImplementation(async(url,init)=>{if(String(url).includes("/api/providers/account/models"))return Response.json({models:[{id:"a"}]});const b=JSON.parse(init.body);calls.push({url,body:b});return answer(b.model);});const r=await providerProbe(request({},"/api/providers/account/test-models",{cookie:"auth_token=synthetic"}),{params:Promise.resolve({id:"account"})});expect(r.status).toBe(200);expect((await r.json()).results[0].ok).toBe(true);expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe("a");});
  it.each(["client", "timeout"])("real private probe consumes %s cancellation before another dispatch", async source => {
    boundary.session.mockResolvedValue(true);
    const caller = new AbortController();
    if (source === "timeout") {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Probe timeout", "TimeoutError")), milliseconds);
        return controller.signal;
      });
    }
    let enter, release, upstream;
    const entered = new Promise(resolve => { enter = resolve; });
    boundary.fetch.mockImplementation((url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
      upstream = init.signal;
      enter();
      return new Promise((resolve, reject) => {
        release = () => resolve(answer("a"));
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    });
    const pending = probe(request({ model: "fixture/a", kind: "llm" }, "/api/models/test", { cookie: "auth_token=synthetic" }, caller.signal));
    try {
      await entered;
      if (source === "client") caller.abort(); else await vi.advanceTimersByTimeAsync(15001);
      await settle();
      expect(upstream.aborted).toBe(true);
      const response = await pending;
      expect((await response.json()).ok).toBe(false);
      expect(calls).toHaveLength(1);
    } finally {
      release?.();
      await pending.catch(() => {});
    }
  });
  it.each(["client", "timeout"])("real private probe cancels held JSON body on %s", async source => {
    boundary.session.mockResolvedValue(true);
    const caller = new AbortController();
    if (source === "timeout") {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Probe timeout", "TimeoutError")), milliseconds);
        return controller.signal;
      });
    }
    let enter, bodyController, cancelled = false;
    const entered = new Promise(resolve => { enter = resolve; });
    boundary.fetch.mockImplementation(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
      return new Response(new ReadableStream({
        start(controller) { bodyController = controller; controller.enqueue(new TextEncoder().encode('{"choices":[')); },
        pull() { enter(); },
        cancel() { cancelled = true; },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const pending = probe(request({ model: "fixture/a", kind: "llm" }, "/api/models/test", { cookie: "auth_token=synthetic" }, caller.signal));
    try {
      await entered;
      await settle();
      if (source === "client") caller.abort(); else await vi.advanceTimersByTimeAsync(15001);
      await settle();
      const response = await pending;
      expect((await response.json()).ok).toBe(false);
      expect(calls[0].signal.aborted).toBe(true);
      expect(cancelled).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      if (!cancelled) bodyController.close();
      await pending.catch(() => {});
    }
  });
  it.each([ ["client", "headers"], ["timeout", "headers"], ["client", "body"], ["timeout", "body"] ])("private OAuth probe cancels reactive refresh %s during %s", async (source, phase) => {
    boundary.session.mockResolvedValue(true);
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Probe timeout", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    boundary.db.run("INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES('oauth-probe','cline','oauth','OAuth fixture',1,1,?,'fixture','fixture')", [JSON.stringify({
      accessToken: "fixture-access", refreshToken: `fixture-reactive-${source}-${phase}`, expiresAt: "2099-01-01T00:00:00Z",
    })]);
    const caller = new AbortController();
    let enter, release, bodyController, refreshSignal, cancelled = false;
    const entered = new Promise(resolve => { enter = resolve; });
    const trace = [];
    boundary.fetch.mockImplementation(async (url, init) => {
      if (!String(url).includes("/auth/refresh")) {
        trace.push("generation");
        return Response.json({ error: { message: "expired fixture token" } }, { status: 401 });
      }
      trace.push("refresh");
      if (trace.filter(item => item === "refresh").length > 1) return new Response("", { status: 400 });
      refreshSignal = init.signal;
      if (phase === "headers") {
        enter();
        return new Promise((resolve, reject) => {
          release = () => resolve(new Response("", { status: 400 }));
          init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      return new Response(new ReadableStream({
        start(controller) { bodyController = controller; controller.enqueue(new TextEncoder().encode('{"data":')); },
        pull() { enter(); },
        cancel() { cancelled = true; },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const pending = probe(request({ model: "cline/openai/gpt-5.4", kind: "llm" }, "/api/models/test", { cookie: "auth_token=synthetic" }, caller.signal));
    try {
      await entered;
      await settle();
      if (source === "client") caller.abort(); else await vi.advanceTimersByTimeAsync(15001);
      expect((await (await pending).json()).ok).toBe(false);
      await settle();
      expect(refreshSignal?.aborted).toBe(true);
      if (phase === "body") expect(cancelled).toBe(true);
      release?.();
      await vi.advanceTimersByTimeAsync(6000);
      expect(trace).toEqual(["generation", "refresh"]);
      expect(JSON.parse(boundary.db.get("SELECT data FROM providerConnections WHERE id='oauth-probe'").data).refreshToken).toBe(`fixture-reactive-${source}-${phase}`);
    } finally {
      release?.();
      if (bodyController && !cancelled) bodyController.close();
      await vi.advanceTimersByTimeAsync(6000);
      await pending.catch(() => {});
    }
  });
});

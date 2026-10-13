import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
import { MimoFreeExecutor, __test__ } from "../../open-sse/executors/mimo-free.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";

const { bootstrapJwt, resetJwtCache, BOOTSTRAP_URL, CHAT_URL, MIMO_SYSTEM_MARKER } = __test__;
const attempts = [];
const pendingSources = [];
function jwt(seconds = 3600) {
  return `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url")}.fixture`;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function settled(promise) {
  return promise.then(value => ({ fulfilled: true, value }), reason => ({ fulfilled: false, reason }));
}
function attempt(timeout = 2000) {
  const value = createAliasAttempt({ initialResponseTimeoutMs: timeout });
  attempts.push(value);
  return value;
}
function budget(value = attempt(), account = "fixture-account") {
  const real = value.getAccountRecoveryBudget(account);
  return { claimRefresh: vi.fn(() => real.claimRefresh()), claimRedispatch: vi.fn(() => real.claimRedispatch()) };
}
async function turn() { await new Promise(resolve => setTimeout(resolve, 0)); }
async function until(check) {
  for (let i = 0; i < 40; i++) { if (check()) return; await turn(); }
  throw new Error("fixture lifecycle did not reach expected stage");
}
function pendingBody(cleanup = Promise.resolve()) {
  let controller;
  const cancel = vi.fn(() => cleanup);
  const response = new Response(new ReadableStream({ start(c) { controller = c; }, cancel }));
  const acquire = vi.spyOn(response.body, "getReader");
  pendingSources.push(() => { try { controller.error(new Error("fixture teardown")); } catch { /* Already closed. */ } });
  return { response, cancel, acquire, send(data) { controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close(); } };
}
async function seed(seconds = 3600) {
  const token = jwt(seconds);
  fetchMock.mockResolvedValueOnce(Response.json({ jwt: token }));
  expect(await bootstrapJwt()).toBe(token);
  return token;
}
beforeEach(() => { fetchMock.mockReset(); resetJwtCache(); });
afterEach(async () => {
  for (const value of attempts.splice(0)) { value.abort(); value.dispose(); }
  for (const close of pendingSources.splice(0)) close();
  await turn();
  vi.restoreAllMocks();
});

describe("MiMo Free shared bootstrap ownership", () => {
  it("shares cold preparation across canonical and mmf owners while an ordinary owner survives alias detach", async () => {
    const value = attempt(), cap = budget(value), caller = new AbortController();
    const wire = pendingBody();
    fetchMock.mockResolvedValueOnce(wire.response).mockResolvedValue(new Response("ok"));
    const canonical = getExecutor("mimo-free"), mmf = getExecutor("mmf");
    const first = settled(bootstrapJwt(null, { signal: caller.signal, recoveryBudget: cap }));
    const survivor = bootstrapJwt();
    await until(() => wire.acquire.mock.calls.length > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    caller.abort(null);
    expect(await first).toEqual({ fulfilled: false, reason: null });
    expect(wire.cancel).not.toHaveBeenCalled();
    const token = jwt(); wire.send({ jwt: token });
    expect(await survivor).toBe(token);
    const result = await mmf.execute({ model: "mimo-auto", body: { messages: [] }, credentials: {} });
    expect(result.headers.Authorization).toBe(`Bearer ${token}`);
    expect(canonical).not.toBe(mmf);
    expect(canonical.sessionId).not.toBe(mmf.sessionId);
    expect(mmf.sessionId).toMatch(/^ses_[a-z0-9]{24}$/);
    expect(cap.claimRefresh).not.toHaveBeenCalled();
    expect(await bootstrapJwt(null, { recoveryBudget: cap })).toBe(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("last owner cancels a native pending JSON body promptly, releases its lock and retains stale renewal provenance", async () => {
    await seed();
    const caller = new AbortController(), cap = budget(), wire = pendingBody(new Promise(() => {}));
    let operational, add, remove;
    fetchMock.mockImplementationOnce((url, options) => {
      operational = options.signal;
      if (operational) { add = vi.spyOn(operational, "addEventListener"); remove = vi.spyOn(operational, "removeEventListener"); }
      return Promise.resolve(wire.response);
    });
    const request = settled(bootstrapJwt(null, { signal: caller.signal, recoveryBudget: cap, forceRefresh: true }));
    await until(() => wire.acquire.mock.calls.length > 0);
    expect(operational).not.toBe(caller.signal);
    expect(add.mock.calls.some(([name]) => name === "abort")).toBe(true);
    caller.abort(null);
    expect(await request).toEqual({ fulfilled: false, reason: null });
    await turn();
    expect(wire.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(wire.response.body.locked).toBe(false);
    const proof = wire.response.body.getReader(); expect(await proof.read()).toEqual({ done: true, value: undefined }); proof.releaseLock();
    expect(operational.aborted).toBe(true);
    expect(add).toHaveBeenCalled();
    expect(remove.mock.calls.some(([name]) => name === "abort")).toBe(true);
    const denied = await bootstrapJwt(null, { recoveryBudget: cap });
    expect(typeof denied).toBe("symbol");
    expect(cap.claimRefresh.mock.results.map(r => r.value)).toEqual([true, false]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const replacement = jwt(4000); fetchMock.mockResolvedValueOnce(Response.json({ jwt: replacement }));
    expect(await bootstrapJwt(null, { recoveryBudget: budget() })).toBe(replacement);
  });

  it("obsolete late fetch is disposed without JSON consumption or publication over a replacement flight", async () => {
    const caller = new AbortController(), old = deferred(), replacement = deferred();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const first = settled(bootstrapJwt(null, { signal: caller.signal }));
    await until(() => fetchMock.mock.calls.length === 1); caller.abort(null);
    expect(await first).toEqual({ fulfilled: false, reason: null });
    const next = bootstrapJwt(), joined = bootstrapJwt();
    await until(() => fetchMock.mock.calls.length >= 2);
    const late = pendingBody(); const json = vi.spyOn(late.response, "json");
    old.resolve(late.response); await turn();
    expect(late.cancel).toHaveBeenCalledExactlyOnceWith(null); expect(json).not.toHaveBeenCalled(); expect(late.acquire).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const token = jwt(); replacement.resolve(Response.json({ jwt: token }));
    expect(await next).toBe(token); expect(await joined).toBe(token);
    expect(await bootstrapJwt()).toBe(token); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("each renewal owner pays before joining, spent waiters cannot borrow or invalidate an active renewal after explicit cache clear", async () => {
    await seed(100);
    const a = budget(), b = budget(), spent = budget(); expect(spent.claimRefresh()).toBe(true);
    const wire = pendingBody(); fetchMock.mockResolvedValueOnce(wire.response);
    const first = bootstrapJwt(null, { recoveryBudget: a });
    await until(() => wire.acquire.mock.calls.length > 0);
    resetJwtCache();
    const second = bootstrapJwt(null, { recoveryBudget: b });
    const denied = await bootstrapJwt(null, { recoveryBudget: spent, forceRefresh: true });
    expect(typeof denied).toBe("symbol");
    expect(a.claimRefresh.mock.results.map(r => r.value)).toEqual([true]);
    expect(b.claimRefresh.mock.results.map(r => r.value)).toEqual([true]);
    expect(spent.claimRefresh.mock.results.map(r => r.value)).toEqual([true, false]);
    expect(wire.cancel).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    const token = jwt(); wire.send({ jwt: token });
    expect(await first).toBe(token); expect(await second).toBe(token);
    expect(await bootstrapJwt(null, { recoveryBudget: spent })).toBe(token);
    expect(spent.claimRefresh).toHaveBeenCalledTimes(2);
  });

  it("preabort and member deadline stop actual fetch with exact reasons without caching a failed JSON fallback", async () => {
    const caller = new AbortController(); caller.abort(null); const cap = budget();
    expect(await settled(bootstrapJwt(null, { signal: caller.signal, recoveryBudget: cap }))).toEqual({ fulfilled: false, reason: null });
    expect(fetchMock).not.toHaveBeenCalled(); expect(cap.claimRefresh).not.toHaveBeenCalled();
    const value = attempt(20), wire = pendingBody(); fetchMock.mockResolvedValueOnce(wire.response);
    const request = settled(bootstrapJwt(null, { signal: value.signal }));
    await until(() => wire.acquire.mock.calls.length > 0);
    const result = await request;
    expect(result.fulfilled).toBe(false); expect(result.reason).toBe(value.signal.reason);
    expect(result.reason.reason).toBe("initial-output-deadline"); expect(wire.cancel).toHaveBeenCalledExactlyOnceWith(value.signal.reason);
    const fallback = deferred(), other = new AbortController(), json = vi.fn(() => fallback.promise);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json });
    const fallbackWait = settled(bootstrapJwt(null, { signal: other.signal })); await until(() => json.mock.calls.length > 0);
    other.abort(null); expect(await fallbackWait).toEqual({ fulfilled: false, reason: null });
    fallback.reject(new Error("late body reject")); await turn();
    await seed(); expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("supplementary ordinary wire and malformed bootstrap errors remain uncached and retryable", async () => {
    const proxy = { fixture: true };
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(bootstrapJwt(proxy)).rejects.toThrow("MiMo bootstrap failed: 403");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });
    await expect(bootstrapJwt()).rejects.toThrow(TypeError);
    fetchMock.mockResolvedValueOnce(Response.json(false));
    await expect(bootstrapJwt()).rejects.toThrow("MiMo bootstrap returned no JWT");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jwt: "unparseable-fixture" }) });
    expect(await bootstrapJwt()).toBe("unparseable-fixture"); expect(await bootstrapJwt()).toBe("unparseable-fixture");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, options, passedProxy] = fetchMock.mock.calls[0];
    expect(url).toBe(BOOTSTRAP_URL); expect(passedProxy).toBe(proxy); expect(fetchMock.mock.calls[0]).toHaveLength(3);
    expect(options.method).toBe("POST"); expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["User-Agent"]).toContain("Chrome/131.0.0.0");
    expect(JSON.parse(options.body).client).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fair ready-body draining yields to last-owner abort and closes the native source", async () => {
    const caller = new AbortController(), cancel = vi.fn(() => Promise.reject(new Error("cleanup failure")));
    let pulls = 0;
    const response = new Response(new ReadableStream({ pull(c) { if (++pulls > 1000) c.close(); else c.enqueue(new TextEncoder().encode(" ")); }, cancel }));
    fetchMock.mockResolvedValueOnce(response);
    const request = settled(bootstrapJwt(null, { signal: caller.signal }));
    const timer = setTimeout(() => caller.abort(null), 10);
    const result = await request; clearTimeout(timer);
    expect(result).toEqual({ fulfilled: false, reason: null }); await turn();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null); expect(response.body.locked).toBe(false);
  });
});

function request(executor = new MimoFreeExecutor(), changes = {}) {
  return executor.execute({ model: "mimo-auto", body: { messages: [{ role: "user", content: "fixture" }] }, credentials: {}, stream: false, ...changes });
}
function options(value = attempt(), cap = budget(value)) {
  return { alias: true, attempt: value, recoveryBudget: cap, forceUpstreamStreaming: true,
    allowNetworkReplay: false, retryPolicy: "single-attempt", preserveAliasInstructions: true };
}
function authBody(status = 403, cleanup = Promise.resolve()) {
  const cancel = vi.fn(() => cleanup);
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("original auth")); }, cancel }), { status });
  return { response, cancel };
}

describe("MiMo Free alias direct generation policy", () => {
  it("clones forced-stream alias JSON instructions per call, sharing bootstrap with ordinary canonical/mmf generation without singleton flags", async () => {
    const canonical = getExecutor("mimo-free"), mmf = getExecutor("mmf"), value = attempt(), cap = budget(value);
    const input = { model: "mimo-auto", stream: false, messages: [
      { role: "system", content: "client system" }, { role: "developer", content: "alias composed developer" },
      { role: "user", content: [{ type: "text", text: "typed client" }, { type: "image_url", image_url: { url: "data:fixture" } }] },
    ] };
    const original = structuredClone(input), credentials = { fixture: "not mutated" }, proxy = { fixture: true }, wire = pendingBody();
    fetchMock.mockResolvedValueOnce(wire.response).mockImplementation(() => Promise.resolve(new Response("ok")));
    const alias = request(canonical, { body: input, credentials, proxyOptions: proxy, executionOptions: options(value, cap) });
    const ordinary = request(mmf, { body: input, credentials, proxyOptions: proxy });
    await until(() => wire.acquire.mock.calls.length > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1); wire.send({ jwt: jwt() });
    const [a, b] = await Promise.all([alias, ordinary]);
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(cap.claimRefresh).not.toHaveBeenCalled();
    const aliasCall = fetchMock.mock.calls.find(call => call[0] === CHAT_URL && call[1].headers["x-session-affinity"] === canonical.sessionId);
    const ordinaryCall = fetchMock.mock.calls.find(call => call[0] === CHAT_URL && call[1].headers["x-session-affinity"] === mmf.sessionId);
    expect(aliasCall).toHaveLength(4); expect(aliasCall[3]).toEqual({ allowNetworkReplay: false }); expect(aliasCall[2]).toBe(proxy);
    expect(ordinaryCall).toHaveLength(3); expect(ordinaryCall[2]).toBe(proxy);
    expect(a.headers.Accept).toBe("text/event-stream"); expect(b.headers.Accept).toBe("application/json");
    expect(a.transformedBody.stream).toBe(true); expect(b.transformedBody.stream).toBe(false);
    expect(a.transformedBody.messages).toEqual([{ role: "system", content: MIMO_SYSTEM_MARKER }, ...original.messages]);
    expect(a.transformedBody.messages[1]).not.toBe(input.messages[0]);
    expect(a.transformedBody.messages[3].content).not.toBe(input.messages[2].content);
    expect(JSON.parse(aliasCall[1].body)).toEqual(a.transformedBody);
    expect(a.headers["X-Mimo-Source"]).toBe("mimocode-cli-free"); expect(a.headers["User-Agent"]).toContain("Chrome/131.0.0.0");
    expect(a.url).toBe(CHAT_URL); expect(input).toEqual(original); expect(credentials).toEqual({ fixture: "not mutated" });
    const marked = request(canonical, { body: a.transformedBody, executionOptions: options() });
    expect((await marked).transformedBody.messages.filter(m => m.role === "system" && m.content.includes(MIMO_SYSTEM_MARKER))).toHaveLength(1);
    expect(aliasCall[1].signal).toBe(value.signal);
  });

  it("cold alias auth recovery is four dispatches with one refresh and redispatch, second auth terminal and spent redispatch preserves original body", async () => {
    const value = attempt(), cap = budget(value), first = authBody(), final = new Response("terminal", { status: 401 });
    fetchMock.mockResolvedValueOnce(Response.json({ jwt: jwt() })).mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(Response.json({ jwt: jwt(4000) })).mockResolvedValueOnce(final);
    const result = await request(undefined, { executionOptions: options(value, cap) });
    expect(result.response).toBe(final); expect(await final.text()).toBe("terminal");
    expect(fetchMock).toHaveBeenCalledTimes(4); expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(cap.claimRefresh.mock.results.map(r => r.value)).toEqual([true]);
    expect(cap.claimRedispatch.mock.results.map(r => r.value)).toEqual([true]);
    expect(fetchMock.mock.calls[1][3]).toEqual({ allowNetworkReplay: false }); expect(fetchMock.mock.calls[3][3]).toEqual({ allowNetworkReplay: false });
    const independent = options(); expect(independent.recoveryBudget.claimRedispatch()).toBe(true);
    const rejected = new Response("preserved", { status: 403 });
    fetchMock.mockResolvedValueOnce(rejected).mockResolvedValueOnce(Response.json({ jwt: jwt(5000) }));
    const denied = await request(undefined, { executionOptions: independent });
    expect(denied.response).toBe(rejected); expect(await rejected.text()).toBe("preserved"); expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(independent.recoveryBudget.claimRefresh.mock.results.map(r => r.value)).toEqual([true]);
    expect(independent.recoveryBudget.claimRedispatch.mock.results.map(r => r.value)).toEqual([true, false]);
  });

  it("proactive renewal spends the same budget, subsequent auth preserves response and denied preparation is a local error without AUTH logging", async () => {
    await seed(100); const value = attempt(), cap = budget(value), log = { debug: vi.fn(), error: vi.fn() };
    const original = new Response("original 401", { status: 401 });
    fetchMock.mockResolvedValueOnce(Response.json({ jwt: jwt() })).mockResolvedValueOnce(original);
    const result = await request(undefined, { executionOptions: options(value, cap), log });
    expect(result.response).toBe(original); expect(await original.text()).toBe("original 401");
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(cap.claimRefresh.mock.results.map(r => r.value)).toEqual([true, false]);
    expect(cap.claimRedispatch).not.toHaveBeenCalled(); expect(log.error).not.toHaveBeenCalled();
    expect(log.debug.mock.calls.filter(([category]) => category === "AUTH")).toHaveLength(0);
    resetJwtCache(); await seed(100);
    const before = fetchMock.mock.calls.length;
    await expect(request(undefined, { executionOptions: options(value, cap), log })).rejects.toThrow(/MiMo.*recovery budget exhausted/);
    expect(fetchMock).toHaveBeenCalledTimes(before); expect(log.error).not.toHaveBeenCalled();
  });

  it("post-output, health probe, resolved503 and rejected native TLS are terminal while client body flags confer no policy", async () => {
    await seed();
    const value = attempt(), cap = budget(value);
    expect(value.markOutput({ choices: [{ delta: { content: "started" } }] }, "openai")).toBe(true);
    const original = new Response("post output", { status: 403 }); fetchMock.mockResolvedValueOnce(original);
    expect((await request(undefined, { executionOptions: options(value, cap) })).response).toBe(original);
    expect(await original.text()).toBe("post output"); expect(cap.claimRefresh).not.toHaveBeenCalled();
    const health = new Response("health", { status: 401 }); fetchMock.mockResolvedValueOnce(health);
    expect((await request(undefined, { healthProbe: true, executionOptions: options() })).response).toBe(health);
    const failed = new Response("capacity", { status: 503 }); fetchMock.mockResolvedValueOnce(failed);
    expect((await request(undefined, { executionOptions: options() })).response).toBe(failed);
    const tls = new TypeError("fetch failed", { cause: Object.assign(new Error("certificate expired"), { code: "CERT_HAS_EXPIRED" }) });
    fetchMock.mockRejectedValueOnce(tls);
    expect(await settled(request(undefined, { executionOptions: options() }))).toEqual({ fulfilled: false, reason: tls });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mockResolvedValueOnce(new Response("ordinary"));
    const body = { stream: false, _alias: true, executionOptions: { alias: true }, messages: [] };
    const ordinary = await request(undefined, { body });
    expect(ordinary.headers.Accept).toBe("application/json"); expect(ordinary.transformedBody.stream).toBe(false);
    expect(fetchMock.mock.calls[5]).toHaveLength(3);
    for (const opts of [{ retryPolicy: "single-attempt" }, { allowNetworkReplay: false }]) {
      fetchMock.mockResolvedValueOnce(new Response("terminal", { status: 503 }));
      await request(undefined, { executionOptions: opts });
      expect(fetchMock.mock.calls.at(-1)[3]).toEqual({ allowNetworkReplay: false });
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("caller/attempt cancellation guards late generation handoff and cooperative deadline fetch without auth-error conversion", async () => {
    await seed(); const caller = new AbortController(), value = attempt(), log = { debug: vi.fn(), error: vi.fn() }, late = deferred();
    fetchMock.mockReturnValueOnce(late.promise);
    const requestWait = settled(request(undefined, { signal: caller.signal, executionOptions: options(value), log }));
    await until(() => fetchMock.mock.calls.length === 2);
    const operational = fetchMock.mock.calls[1][1].signal;
    expect(operational).not.toBe(caller.signal); expect(operational).not.toBe(value.signal);
    caller.abort(null); const body = authBody(); late.resolve(body.response);
    expect(await requestWait).toEqual({ fulfilled: false, reason: null }); expect(body.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(log.error).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    const deadline = attempt(20);
    fetchMock.mockImplementationOnce((url, fetchOptions) => new Promise((resolve, reject) => {
      fetchOptions.signal.addEventListener("abort", () => reject(fetchOptions.signal.reason), { once: true });
    }));
    const expired = await settled(request(undefined, { executionOptions: options(deadline), log }));
    expect(expired.fulfilled).toBe(false); expect(expired.reason).toBe(deadline.signal.reason); expect(expired.reason.reason).toBe("initial-output-deadline");
    const already = new AbortController(); already.abort(null);
    expect(await settled(request(undefined, { signal: already.signal, executionOptions: options(), log }))).toEqual({ fulfilled: false, reason: null });
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(log.error).not.toHaveBeenCalled();
  });

  it("cancellation holding an auth response disposes it and pending renewal with null; failed local renewal instead preserves original HTTP body", async () => {
    await seed(); const caller = new AbortController(), value = attempt(), cap = budget(value), log = { debug: vi.fn(), error: vi.fn() };
    const original = authBody(401, new Promise(() => {})), wire = pendingBody(new Promise(() => {}));
    fetchMock.mockResolvedValueOnce(original.response).mockResolvedValueOnce(wire.response);
    const wait = settled(request(undefined, { signal: caller.signal, executionOptions: options(value, cap), log }));
    await until(() => wire.acquire.mock.calls.length > 0); caller.abort(null);
    expect(await wait).toEqual({ fulfilled: false, reason: null }); await turn();
    expect(original.cancel).toHaveBeenCalledExactlyOnceWith(null); expect(wire.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(wire.response.body.locked).toBe(false); expect(cap.claimRefresh.mock.results.map(r => r.value)).toEqual([true]);
    expect(cap.claimRedispatch).not.toHaveBeenCalled(); expect(log.error).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(3);
    resetJwtCache(); await seed();
    const preserved = new Response("kept failure", { status: 403 });
    fetchMock.mockResolvedValueOnce(preserved).mockResolvedValueOnce(Response.json({}));
    const result = await request(undefined, { executionOptions: options(), log });
    expect(result.response).toBe(preserved); expect(await preserved.text()).toBe("kept failure");
    expect(fetchMock).toHaveBeenCalledTimes(6); expect(log.error).not.toHaveBeenCalled();
  });

  it("supplementary ordinary four-call auth flow, default tuple, proxy shape, health suppression and AUTH failures are retained", async () => {
    const executor = new MimoFreeExecutor(), log = { debug: vi.fn(), error: vi.fn() }, proxy = { fixture: true };
    const firstJwt = jwt(), fresh = jwt(4000), last = new Response("ok");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jwt: firstJwt }) })
      .mockResolvedValueOnce(new Response("auth", { status: 403 }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jwt: fresh }) }).mockResolvedValueOnce(last);
    const input = { stream: false, messages: [{ role: "system", content: "client" }, { role: "user", content: "fixture" }] };
    const result = await request(executor, { body: input, proxyOptions: proxy, log });
    expect(result.response).toBe(last); expect(result.headers.Authorization).toBe(`Bearer ${fresh}`); expect(result.headers.Accept).toBe("application/json");
    expect(result.transformedBody.messages[1]).toBe(input.messages[0]); expect(input.messages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) { expect(call).toHaveLength(3); expect(call[2]).toBe(proxy); }
    expect(log.debug).toHaveBeenCalledWith("AUTH", "MiMo auth failed (403), re-bootstrapping...");
    expect(log.debug.mock.calls.filter(([category]) => category === "FETCH")).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(new Response("health", { status: 403 }));
    expect((await request(executor, { healthProbe: true })).response.status).toBe(403); expect(fetchMock).toHaveBeenCalledTimes(5);
    resetJwtCache(); fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(request(executor, { log })).rejects.toThrow("MiMo bootstrap failed: 403");
    expect(log.error).toHaveBeenCalledWith("AUTH", "MiMo bootstrap failed: MiMo bootstrap failed: 403");
  });
});

it("ordinary auth renewal denies a spent alias before joining while an admitted owner and ordinary survivor complete", async () => {
  const firstJwt = jwt(), fresh = jwt(5000), wire = pendingBody(), proxy = { fixture: true };
  const ordinaryLog = { debug: vi.fn(), error: vi.fn() }, aliasLog = { debug: vi.fn(), error: vi.fn() };
  const canonical = getExecutor("mimo-free"), mmf = getExecutor("mmf");
  const input = { stream: false, messages: [{ role: "user", content: "ordinary survivor" }] };
  const original = structuredClone(input), authorizations = [], waits = [];
  let bootstraps = 0, generations = 0, operational, deniedOutcome, released = false;
  fetchMock.mockImplementation((url, fetchOptions) => {
    if (url === BOOTSTRAP_URL) {
      if (++bootstraps === 1) return Response.json({ jwt: firstJwt });
      operational = fetchOptions.signal;
      return wire.response;
    }
    authorizations.push(fetchOptions.headers.Authorization);
    return new Response(++generations === 1 ? "auth" : "ordinary completed", { status: generations === 1 ? 403 : 200 });
  });
  try {
    expect(await bootstrapJwt(proxy)).toBe(firstJwt);
    const ordinary = settled(request(canonical, { body: input, proxyOptions: proxy, log: ordinaryLog }));
    waits.push(ordinary);
    await until(() => wire.acquire.mock.calls.length > 0);
    expect(wire.response.body.locked).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const spentAttempt = attempt(), spent = budget(spentAttempt, "spent");
    expect(Object.isFrozen(spentAttempt.getAccountRecoveryBudget("spent"))).toBe(true);
    expect(spent.claimRefresh()).toBe(true);
    const denied = settled(request(mmf, { proxyOptions: proxy, log: aliasLog,
      executionOptions: options(spentAttempt, spent) })).then(outcome => { deniedOutcome = outcome; return outcome; });
    waits.push(denied);
    await turn();
    const deniedBeforeRelease = deniedOutcome;
    const fetchesBeforeJoin = fetchMock.mock.calls.length;
    const aliasLogsBeforeJoin = aliasLog.debug.mock.calls.length + aliasLog.error.mock.calls.length;
    const admittedAttempt = attempt(), admitted = budget(admittedAttempt, "admitted");
    expect(Object.isFrozen(admittedAttempt.getAccountRecoveryBudget("admitted"))).toBe(true);
    const joined = settled(bootstrapJwt(proxy, { signal: admittedAttempt.signal, recoveryBudget: admitted }));
    waits.push(joined);
    const admittedBeforeRelease = admitted.claimRefresh.mock.results.map(result => result.value);
    const fetchesBeforeRelease = fetchMock.mock.calls.length;
    const ownerSurvived = !operational.aborted && wire.response.body.locked && wire.cancel.mock.calls.length === 0;
    wire.send({ jwt: fresh }); released = true;
    const [outcome, ordinaryOutcome, joinedOutcome] = await Promise.all([denied, ordinary, joined]);
    expect(outcome.fulfilled).toBe(false);
    expect(outcome.reason).toBeInstanceOf(Error);
    expect(outcome.reason.message).toBe("MiMo recovery budget exhausted before generation");
    expect(deniedBeforeRelease).toBe(outcome);
    expect(fetchesBeforeJoin).toBe(3); expect(aliasLogsBeforeJoin).toBe(0);
    expect(admittedBeforeRelease).toEqual([true]); expect(fetchesBeforeRelease).toBe(3);
    expect(ownerSurvived).toBe(true); expect(operational.aborted).toBe(false);
    expect(wire.cancel).not.toHaveBeenCalled(); expect(wire.response.body.locked).toBe(false);
    expect(ordinaryOutcome.fulfilled).toBe(true);
    expect(ordinaryOutcome.value.response.status).toBe(200);
    expect(await ordinaryOutcome.value.response.text()).toBe("ordinary completed");
    expect(ordinaryOutcome.value.headers.Authorization).toBe(`Bearer ${fresh}`);
    expect(ordinaryOutcome.value.headers.Accept).toBe("application/json");
    expect(ordinaryOutcome.value.transformedBody.messages).toEqual([{ role: "system", content: MIMO_SYSTEM_MARKER }, ...original.messages]);
    expect(input).toEqual(original);
    expect(joinedOutcome).toEqual({ fulfilled: true, value: fresh });
    expect(await bootstrapJwt(proxy, { recoveryBudget: spent })).toBe(fresh);
    expect(spent.claimRefresh.mock.results.map(result => result.value)).toEqual([true, false]);
    expect(spent.claimRedispatch).not.toHaveBeenCalled();
    expect(admitted.claimRefresh.mock.results.map(result => result.value)).toEqual([true]);
    expect(admitted.claimRedispatch).not.toHaveBeenCalled();
    expect(bootstraps).toBe(2); expect(generations).toBe(2); expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(authorizations).toEqual([`Bearer ${firstJwt}`, `Bearer ${fresh}`]);
    for (const call of fetchMock.mock.calls) { expect(call).toHaveLength(3); expect(call[2]).toBe(proxy); }
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([BOOTSTRAP_URL, CHAT_URL, BOOTSTRAP_URL, CHAT_URL]);
    expect(fetchMock.mock.calls[1][1].headers["x-session-affinity"]).toBe(canonical.sessionId);
    expect(fetchMock.mock.calls[3][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(aliasLog.debug).not.toHaveBeenCalled(); expect(aliasLog.error).not.toHaveBeenCalled();
    expect(ordinaryLog.debug.mock.calls).toEqual([
      ["FETCH", `MIMO-FREE → ${CHAT_URL} | body=${fetchMock.mock.calls[1][1].body.length}B`],
      ["AUTH", "MiMo auth failed (403), re-bootstrapping..."],
    ]);
    expect(ordinaryLog.error).not.toHaveBeenCalled();
  } finally {
    if (!released) { try { wire.send({ jwt: fresh }); } catch { /* Already closed. */ } }
    await Promise.all(waits);
  }
});

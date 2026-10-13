import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const RAW = '&&&START&&&{"code":0,"location":"https://fixture.invalid/sso?ticket=synthetic","ssecurity":"fixture-security","nonce":9223372036854775807}';
const SIGNED = "https://fixture.invalid/sso?ticket=synthetic&clientSign=mpa2ZgNwqdtXF7Rb9aUrSPNvhjY%3D";
const PASS = Object.freeze({ mimoPassToken: "synthetic-pass", mimoUserId: "42", mimoCUserId: "encoded-user", region: "cn" });
const encoder = new TextEncoder();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const outcome = promise => promise.then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
async function until(predicate) {
  for (let i = 0; i < 40 && !predicate(); i++) await tick();
  expect(predicate()).toBe(true);
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function phase1() { return new Response(RAW); }
function phase2(token = "session", sid = "mimopc") {
  return new Response("unused redirect bytes", { headers: [
    ["set-cookie", `${sid}_serviceToken=${token}; Path=/`],
    ["set-cookie", "fixture_ph=ph; Path=/"],
    ["set-cookie", "discard=not-forwarded; Path=/"],
  ] });
}
function pendingBody(nonsettling = false) {
  let source;
  const cancel = vi.fn(() => nonsettling ? new Promise(() => {}) : undefined);
  const body = new ReadableStream({ start(controller) { source = controller; }, cancel });
  return { response: new Response(body), body, cancel, finish() { source.enqueue(encoder.encode(RAW)); source.close(); } };
}
let attempts;
function policy() {
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000 });
  attempts.push(attempt);
  const real = attempt.getAccountRecoveryBudget("synthetic-account");
  const claims = { refresh: [], redispatch: [] };
  const recoveryBudget = {
    claimRefresh() { const allowed = real.claimRefresh(); claims.refresh.push(allowed); return allowed; },
    claimRedispatch() { const allowed = real.claimRedispatch(); claims.redispatch.push(allowed); return allowed; },
  };
  return { attempt, claims, recoveryBudget, signal: attempt.signal };
}
let account;
let XiaomiMimoExecutor;
beforeEach(async () => {
  vi.resetModules();
  proxyAwareFetch.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  attempts = [];
  account = await import("../../open-sse/shared/mimoAccount.js");
  ({ XiaomiMimoExecutor } = await import("../../open-sse/executors/xiaomi-mimo.js"));
});
afterEach(() => {
  attempts.forEach(attempt => { attempt.abort(); attempt.dispose(); });
  vi.restoreAllMocks();
});

describe("MiMo shared account-cookie policy", () => {
  it("pre-abort rejects null distinctly and missing scratch Desktop passJar never claims", async () => {
    const owner = policy();
    const controller = new AbortController();
    controller.abort(null);
    const result = await outcome(account.getMimoAccountCookie(null, null, { signal: controller.signal, recoveryBudget: owner.recoveryBudget, forceRefresh: true }));
    expect(result).toEqual({ status: "rejected", reason: null });
    expect(await account.getMimoAccountCookie(null, null, owner)).toBeNull();
    expect(await account.getMimoAccountUsage(null)).toEqual({ error: "no-session" });
    expect(owner.claims.refresh).toEqual([]);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("detaches one alias during a native phase1 read while a signal-less owner finishes the exact wire handshake", async () => {
    const owner = policy();
    const pending = pendingBody();
    proxyAwareFetch.mockResolvedValueOnce(pending.response).mockResolvedValueOnce(phase2());
    const canceled = outcome(account.getMimoAccountCookie(PASS, { proxyUrl: "synthetic" }, owner));
    const survivor = account.getMimoAccountCookie(PASS, { proxyUrl: "synthetic" });
    await until(() => pending.body.locked);
    owner.attempt.abort("configuration");
    let settled;
    canceled.then(value => { settled = value; });
    await until(() => settled !== undefined);
    expect(settled).toEqual({ status: "rejected", reason: owner.attempt.signal.reason });
    expect(pending.cancel).not.toHaveBeenCalled();
    expect(proxyAwareFetch.mock.calls[0][1].signal.aborted).toBe(false);
    pending.finish();
    expect(await survivor).toBe("userId=42; fixture_ph=ph; serviceToken=session");
    expect(await account.getMimoAccountCookie(PASS)).toBe("userId=42; fixture_ph=ph; serviceToken=session");
    expect(owner.claims.refresh).toEqual([]);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[0].slice(0, 3)).toEqual([
      "https://account.xiaomi.com/pass/serviceLogin?_locale=zh_CN&_snsNone=true&sid=mimopc&_json=true",
      { headers: { Cookie: "userId=42; passToken=synthetic-pass; cUserId=encoded-user", "User-Agent": "MiClaw/1.0", Accept: "application/json" }, signal: expect.any(AbortSignal) }, null,
    ]);
    expect(proxyAwareFetch.mock.calls[1]).toEqual([SIGNED, { redirect: "manual", headers: { "User-Agent": "MiClaw/1.0" }, signal: proxyAwareFetch.mock.calls[0][1].signal }, null]);
    expect(pending.body.locked).toBe(false);
    expect(console.log).toHaveBeenCalledWith("[mimoAccount] desktop 2-phase OK (sid=mimopc)");
  });

  it("last-owner null cancellation stops and unlocks phase1 despite a nonsettling source cancel", async () => {
    const pending = pendingBody(true);
    const controller = new AbortController();
    proxyAwareFetch.mockResolvedValueOnce(pending.response);
    const request = outcome(account.getMimoAccountCookie(PASS, null, { signal: controller.signal }));
    await until(() => pending.body.locked);
    const sharedSignal = proxyAwareFetch.mock.calls[0][1].signal;
    controller.abort(null);
    let settled;
    request.then(value => { settled = value; });
    await until(() => settled !== undefined && !pending.body.locked);
    expect(settled).toEqual({ status: "rejected", reason: null });
    expect(sharedSignal.aborted).toBe(true);
    expect(sharedSignal.reason).toBeNull();
    expect(pending.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(getEventListeners(sharedSignal, "abort")).toHaveLength(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("replacement"));
    expect(await account.getMimoAccountCookie(PASS)).toContain("serviceToken=replacement");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("late old fetch disposes its body without caching or deleting a replacement entry", async () => {
    const old = deferred();
    const replacement = pendingBody();
    const controller = new AbortController();
    proxyAwareFetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(replacement.response).mockResolvedValueOnce(phase2("new"));
    const first = outcome(account.getMimoAccountCookie(PASS, null, { signal: controller.signal }));
    await until(() => proxyAwareFetch.mock.calls.length === 1);
    controller.abort(null);
    let settled;
    first.then(value => { settled = value; });
    await until(() => settled !== undefined);
    expect(settled).toEqual({ status: "rejected", reason: null });
    const next = account.getMimoAccountCookie(PASS);
    await until(() => replacement.body.locked);
    const lateCancel = vi.fn();
    const lateBody = new ReadableStream({ start(c) { c.enqueue(encoder.encode(RAW)); }, cancel: lateCancel });
    old.resolve(new Response(lateBody));
    await until(() => lateCancel.mock.calls.length === 1);
    const joined = account.getMimoAccountCookie(PASS);
    await tick();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(lateCancel).toHaveBeenCalledExactlyOnceWith(null);
    replacement.finish();
    expect(await next).toContain("serviceToken=new");
    expect(await joined).toContain("serviceToken=new");
    expect(await account.getMimoAccountCookie(PASS)).toContain("serviceToken=new");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(console.log.mock.calls).toEqual([["[mimoAccount] desktop 2-phase OK (sid=mimopc)"]]);
  });

  it("bootstrap and live hits are free; forced and expired renewals claim each owner before joining without disturbing another account", async () => {
    const a = policy();
    const other = { ...PASS, mimoPassToken: "independent-pass" };
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("a"))
      .mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("b"));
    expect(await account.getMimoAccountCookie(PASS, null, a)).toContain("serviceToken=a");
    expect(await account.getMimoAccountCookie(other)).toContain("serviceToken=b");
    expect(await account.getMimoAccountCookie(PASS, null, a)).toContain("serviceToken=a");
    expect(a.claims.refresh).toEqual([]);
    a.recoveryBudget.claimRefresh();
    expect(await account.getMimoAccountCookie(PASS, null, { ...a, forceRefresh: true })).toBeNull();
    expect(await account.getMimoAccountCookie(PASS)).toContain("serviceToken=a");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
    const firstOwner = policy();
    const secondOwner = policy();
    const pending = pendingBody();
    proxyAwareFetch.mockResolvedValueOnce(pending.response).mockResolvedValueOnce(phase2("fresh"));
    const first = account.getMimoAccountCookie(PASS, null, { ...firstOwner, forceRefresh: true });
    await until(() => pending.body.locked);
    expect(await account.getMimoAccountCookie(PASS, null, a)).toBeNull();
    const second = account.getMimoAccountCookie(PASS, null, secondOwner);
    await tick();
    expect(firstOwner.claims.refresh).toEqual([true]);
    expect(secondOwner.claims.refresh).toEqual([true]);
    expect(a.claims.refresh).toEqual([true, false, false]);
    expect(await account.getMimoAccountCookie(other)).toContain("serviceToken=b");
    pending.finish();
    expect(await first).toContain("serviceToken=fresh");
    expect(await second).toContain("serviceToken=fresh");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(6);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 30 * 60 * 1000);
    const expired = policy();
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("ttl"));
    expect(await account.getMimoAccountCookie(PASS, null, expired)).toContain("serviceToken=ttl");
    expect(expired.claims.refresh).toEqual([true]);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(8);
  });

  it("canceled forced replacements keep established provenance and active recovery survives a local cache clear", async () => {
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("old"));
    await account.getMimoAccountCookie(PASS);
    const owner = policy();
    const pending = pendingBody(true);
    proxyAwareFetch.mockResolvedValueOnce(pending.response);
    const forced = outcome(account.getMimoAccountCookie(PASS, null, { ...owner, forceRefresh: true }));
    await until(() => pending.body.locked);
    owner.attempt.abort("configuration");
    expect((await forced).status).toBe("rejected");
    await until(() => !pending.body.locked);
    const spent = policy();
    spent.recoveryBudget.claimRefresh();
    expect(await account.getMimoAccountCookie(PASS, null, spent)).toBeNull();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    const retry = policy();
    const active = pendingBody();
    proxyAwareFetch.mockResolvedValueOnce(active.response).mockResolvedValueOnce(phase2("renewed"));
    const replacing = account.getMimoAccountCookie(PASS, null, retry);
    await until(() => active.body.locked);
    account.invalidateMimoAccountCookieCache();
    expect(await account.getMimoAccountCookie(PASS, null, spent)).toBeNull();
    expect(await account.getMimoAccountCookie(PASS, null, { ...spent, forceRefresh: true })).toBeNull();
    const joiner = policy();
    const joined = account.getMimoAccountCookie(PASS, null, joiner);
    await tick();
    expect(retry.claims.refresh).toEqual([true]);
    expect(joiner.claims.refresh).toEqual([true]);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
    active.finish();
    expect(await replacing).toContain("serviceToken=renewed");
    expect(await joined).toContain("serviceToken=renewed");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(5);
  });

  it("redirect bodies are disposed without waiting; a null-aborted late hop cannot absorb cookies or start another hop", async () => {
    const late = deferred();
    const cancelRedirect = vi.fn(() => new Promise(() => {}));
    const redirect = new Response(new ReadableStream({ cancel: cancelRedirect }), { status: 302, headers: { location: "/next" } });
    const controller = new AbortController();
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(redirect).mockReturnValueOnce(late.promise);
    const request = outcome(account.getMimoAccountCookie(PASS, null, { signal: controller.signal }));
    await until(() => proxyAwareFetch.mock.calls.length === 3);
    expect(cancelRedirect).toHaveBeenCalledTimes(1);
    controller.abort(null);
    let settled;
    request.then(value => { settled = value; });
    await until(() => settled !== undefined);
    expect(settled).toEqual({ status: "rejected", reason: null });
    const lateCancel = vi.fn(() => new Promise(() => {}));
    late.resolve(new Response(new ReadableStream({ cancel: lateCancel }), { status: 302, headers: { location: "/forbidden", "set-cookie": "serviceToken=late" } }));
    await until(() => lateCancel.mock.calls.length === 1);
    expect(lateCancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(console.log).not.toHaveBeenCalled();
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("valid"));
    expect(await account.getMimoAccountCookie(PASS)).toContain("serviceToken=valid");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(5);
  });

  it("supplementary: ready phase1 reads yield to cancellation and keep native lock/listeners clean", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const cancel = vi.fn(() => new Promise(() => {}));
    const body = new ReadableStream({ pull(c) { pulls++; c.enqueue(encoder.encode(" ")); }, cancel });
    proxyAwareFetch.mockResolvedValueOnce(new Response(body));
    const request = outcome(account.getMimoAccountCookie(PASS, null, { signal: controller.signal }));
    setTimeout(() => controller.abort(null), 0);
    expect(await request).toEqual({ status: "rejected", reason: null });
    await until(() => !body.locked);
    expect(pulls).toBeLessThanOrEqual(33);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(getEventListeners(proxyAwareFetch.mock.calls[0][1].signal, "abort")).toHaveLength(0);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});

function generationResponse(status = 200, cancel = vi.fn()) {
  return new Response(new ReadableStream({ cancel }), { status });
}
function execution(owner, overrides = {}) {
  return {
    model: "mimo-v2.6-pro", stream: false,
    body: { stream: false, messages: [{ role: "system", content: "client instruction" }, { role: "user", content: [{ type: "text", text: "synthetic question" }] }], reasoning_effort: "xhigh" },
    credentials: { apiKey: "synthetic-key", providerSpecificData: PASS, runtimeTransport: { format: "openai", baseUrl: "https://api.xiaomimimo.com/v1/chat/completions" } },
    executionOptions: { alias: true, retryPolicy: "single-attempt", allowNetworkReplay: false, forceUpstreamStreaming: true, preserveAliasInstructions: true, attempt: owner.attempt, recoveryBudget: owner.recoveryBudget },
    ...overrides,
  };
}
function generationCalls() { return proxyAwareFetch.mock.calls.filter(([, init]) => init.method === "POST"); }
function handshakeCalls() { return proxyAwareFetch.mock.calls.filter(([url]) => url.includes("/pass/serviceLogin")); }

describe("Xiaomi alias account recovery", () => {
  it("bootstrap then 401 permits one fresh handshake and one generation redispatch with cloned inputs and all options", async () => {
    const owner = policy();
    const dispose401 = vi.fn(() => new Promise(() => {}));
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("bootstrap"))
      .mockResolvedValueOnce(generationResponse(401, dispose401))
      .mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("fresh"))
      .mockResolvedValueOnce(generationResponse());
    const args = execution(owner);
    const originals = structuredClone({ body: args.body, credentials: args.credentials });
    const executor = new XiaomiMimoExecutor();
    const transform = vi.spyOn(executor, "transformRequest");
    const result = await executor.execute(args);
    expect(result.response.status).toBe(200);
    expect(owner.claims).toEqual({ refresh: [true], redispatch: [true] });
    expect(handshakeCalls()).toHaveLength(2);
    expect(generationCalls()).toHaveLength(2);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(6);
    expect(dispose401).toHaveBeenCalledTimes(1);
    expect({ body: args.body, credentials: args.credentials }).toEqual(originals);
    expect(transform.mock.calls).toHaveLength(2);
    expect(transform.mock.calls.every(call => call[4] === args.executionOptions)).toBe(true);
    for (const [index, call] of generationCalls().entries()) {
      const [url, init, proxy, options] = call;
      expect(url).toBe("https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions");
      expect(init.headers.Cookie).toContain(`serviceToken=${index ? "fresh" : "bootstrap"}`);
      expect(init.headers.Authorization).toBeUndefined();
      expect(init.headers.Accept).toBe("text/event-stream");
      expect(JSON.parse(init.body)).toMatchObject({ stream: true, output_config: { effort: "high" }, temperature: 1, top_p: 0.95, messages: originals.body.messages });
      expect(JSON.parse(init.body).reasoning_effort).toBeUndefined();
      expect(init.signal.aborted).toBe(false);
      expect(proxy).toBeNull();
      expect(options).toEqual({ allowNetworkReplay: false });
    }
  });

  it("an expired proactive renewal spends the same slot and preserves its first rejected 401 without another acquisition", async () => {
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("cached"));
    await account.getMimoAccountCookie(PASS);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 30 * 60 * 1000);
    const owner = policy();
    const cancel = vi.fn();
    const rejected = generationResponse(401, cancel);
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("proactive"))
      .mockResolvedValueOnce(rejected);
    const result = await new XiaomiMimoExecutor().execute(execution(owner));
    expect(result.response).toBe(rejected);
    expect(owner.claims).toEqual({ refresh: [true, false], redispatch: [] });
    expect(handshakeCalls()).toHaveLength(2);
    expect(generationCalls()).toHaveLength(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("a second 401 is terminal and spent redispatch keeps the original response after permitted refresh", async () => {
    const owner = policy();
    const second401 = generationResponse(401);
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("one"))
      .mockResolvedValueOnce(generationResponse(401))
      .mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("two"))
      .mockResolvedValueOnce(second401);
    expect((await new XiaomiMimoExecutor().execute(execution(owner))).response).toBe(second401);
    expect(owner.claims).toEqual({ refresh: [true], redispatch: [true] });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(6);
    const spent = policy();
    spent.recoveryBudget.claimRedispatch();
    const original = generationResponse(401);
    proxyAwareFetch.mockResolvedValueOnce(original).mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("three"));
    expect((await new XiaomiMimoExecutor().execute(execution(spent))).response).toBe(original);
    expect(spent.claims).toEqual({ refresh: [true], redispatch: [true, false] });
    expect(generationCalls()).toHaveLength(3);
    expect(handshakeCalls()).toHaveLength(3);
  });

  it("post-output and health-probe 401s preserve response with no refresh or redispatch", async () => {
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2());
    await account.getMimoAccountCookie(PASS);
    const owner = policy();
    const first401 = generationResponse(401);
    proxyAwareFetch.mockImplementation((url, init) => {
      if (init.method !== "POST") return url.includes("/pass/serviceLogin") ? phase1() : phase2("unexpected-refresh");
      owner.attempt.markOutput({ choices: [{ delta: { content: "already visible" } }] }, "openai");
      return first401;
    });
    expect((await new XiaomiMimoExecutor().execute(execution(owner))).response).toBe(first401);
    const probe = policy();
    const probe401 = generationResponse(401);
    proxyAwareFetch.mockResolvedValueOnce(probe401);
    expect((await new XiaomiMimoExecutor().execute(execution(probe, { healthProbe: true }))).response).toBe(probe401);
    expect(owner.claims).toEqual({ refresh: [], redispatch: [] });
    expect(probe.claims).toEqual({ refresh: [], redispatch: [] });
    expect(handshakeCalls()).toHaveLength(1);
    expect(generationCalls()).toHaveLength(2);
  });

  it("null cancellation while holding a 401 disposes it and stops the shared refresh body before redispatch", async () => {
    const owner = policy();
    const controller = new AbortController();
    const cancel401 = vi.fn(() => new Promise(() => {}));
    const pending = pendingBody(true);
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2())
      .mockResolvedValueOnce(generationResponse(401, cancel401)).mockResolvedValueOnce(pending.response);
    const request = outcome(new XiaomiMimoExecutor().execute(execution(owner, { signal: controller.signal })));
    await until(() => pending.body.locked);
    controller.abort(null);
    let settled;
    request.then(value => { settled = value; });
    await until(() => settled !== undefined);
    expect(settled).toEqual({ status: "rejected", reason: null });
    await until(() => !pending.body.locked);
    expect(cancel401).toHaveBeenCalledExactlyOnceWith(null);
    expect(pending.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(owner.claims).toEqual({ refresh: [true], redispatch: [] });
    expect(handshakeCalls()).toHaveLength(2);
    expect(generationCalls()).toHaveLength(1);
    expect(console.log.mock.calls.filter(([message]) => message.startsWith("[mimoAccount]"))).toEqual([["[mimoAccount] desktop 2-phase OK (sid=mimopc)"]]);
  });

  it("cloud alias forwarding preserves JSON/options and rejects a network generation once; late Base handoff is disposed", async () => {
    const owner = policy();
    const cloud = { apiKey: "synthetic-cloud", runtimeTransport: { format: "openai", baseUrl: "https://fixture.invalid/cloud", auth: { combined: true, header: "Authorization", scheme: "bearer" } } };
    const args = execution(owner, { model: "mimo-v2.5-pro", credentials: cloud });
    const originalBody = structuredClone(args.body);
    const executor = new XiaomiMimoExecutor();
    const transform = vi.spyOn(executor, "transformRequest");
    proxyAwareFetch.mockResolvedValueOnce(generationResponse(503));
    expect((await executor.execute(args)).response.status).toBe(503);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(transform.mock.calls[0][4]).toBe(args.executionOptions);
    expect(JSON.parse(generationCalls()[0][1].body)).toMatchObject({ stream: true, messages: originalBody.messages });
    expect(generationCalls()[0][0]).toBe("https://fixture.invalid/cloud");
    expect(generationCalls()[0][1].headers.Authorization).toBe("Bearer synthetic-cloud");
    expect(generationCalls()[0][3]).toEqual({ allowNetworkReplay: false });
    expect(args.body).toEqual(originalBody);
    const error = new Error("synthetic TLS/network failure");
    proxyAwareFetch.mockRejectedValueOnce(error);
    expect(await outcome(executor.execute(args))).toEqual({ status: "rejected", reason: error });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    const cancelLate = vi.fn(() => new Promise(() => {}));
    const late = generationResponse(200, cancelLate);
    proxyAwareFetch.mockImplementationOnce(() => {
      // Base has accepted headers; cancel in its awaited handoff to Xiaomi.
      const headers = late.headers;
      const get = headers.get.bind(headers);
      let queued = false;
      vi.spyOn(headers, "get").mockImplementation(name => {
        if (!queued) { queued = true; queueMicrotask(() => queueMicrotask(() => controller.abort(null))); }
        return get(name);
      });
      return late;
    });
    expect(await outcome(executor.execute({ ...args, signal: controller.signal }))).toEqual({ status: "rejected", reason: null });
    expect(cancelLate).toHaveBeenCalledExactlyOnceWith(null);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(owner.claims).toEqual({ refresh: [], redispatch: [] });
  });

  it("supplementary: ordinary signal-less 401 retains global clear/retry and failed/no-pass preparation degrades with original routing/logs", async () => {
    const executor = new XiaomiMimoExecutor();
    const credentials = { apiKey: "synthetic-key", providerSpecificData: PASS };
    const args = { model: "mimo-v2.6-pro", body: { messages: [{ role: "user", content: "synthetic" }] }, stream: false, credentials };
    proxyAwareFetch.mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("old"))
      .mockResolvedValueOnce(generationResponse(401))
      .mockResolvedValueOnce(phase1()).mockResolvedValueOnce(phase2("new"))
      .mockResolvedValueOnce(generationResponse());
    expect((await executor.execute(args)).response.status).toBe(200);
    expect(credentials.__mimoAccountCookie).toContain("serviceToken=new");
    expect(handshakeCalls()).toHaveLength(2);
    expect(generationCalls()).toHaveLength(2);
    expect(generationCalls().every(call => call.length === 3 && JSON.parse(call[1].body).stream !== true)).toBe(true);
    account.invalidateMimoAccountCookieCache();
    const networkError = new Error("synthetic handshake failure");
    proxyAwareFetch.mockRejectedValueOnce(networkError).mockResolvedValueOnce(generationResponse(401))
      .mockResolvedValueOnce(new Response('{"code":1}'));
    const freshCredentials = { apiKey: "synthetic-key", providerSpecificData: PASS };
    const failed = await executor.execute({ ...args, credentials: freshCredentials });
    expect(failed.response.status).toBe(401);
    expect(failed.url).toBe("https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions");
    expect(failed.headers.Authorization).toBe("Bearer synthetic-key");
    expect(freshCredentials.__mimoAccountCookie).toBeUndefined();
    expect(console.log.mock.calls.some(([message]) => message.startsWith("[mimoAccount] acquire threw: synthetic handshake failure |"))).toBe(true);
    expect(await account.getMimoAccountCookie(PASS)).toBeNull();
    expect(console.log.mock.calls.some(([message]) => message.startsWith("[mimoAccount] desktopPhase fail: phase1 sid=mimopc http=200 code=1"))).toBe(true);
    expect(handshakeCalls()).toHaveLength(4);
    expect(generationCalls()).toHaveLength(3);
    proxyAwareFetch.mockResolvedValueOnce(generationResponse(401));
    const noPass = { __mimoAccountCookie: "serviceToken=synthetic", apiKey: "synthetic-key" };
    expect((await executor.execute({ ...args, credentials: noPass })).response.status).toBe(401);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(10);
    expect(generationCalls()).toHaveLength(4);
  });
});

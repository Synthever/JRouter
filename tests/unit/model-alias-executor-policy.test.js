import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";

const options = { alias: true, retryPolicy: "single-attempt", allowNetworkReplay: false, forceUpstreamStreaming: true };
const request = (extra = {}) => ({ model: "fixture", body: { messages: [], stream: false }, stream: false, credentials: {}, ...extra });
const executor = () => new BaseExecutor("fixture", { baseUrls: ["https://one.invalid", "https://two.invalid"], retry: { 503: { attempts: 2, delayMs: 0 }, 429: { attempts: 1, delayMs: 0 }, 502: { attempts: 1, delayMs: 0 } } });
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response("{}")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Base per-call generation policy", () => {
  it.each([[503, { retryPolicy: "single-attempt" }], [429, { alias: true }]])("returns the first %s without configured retry or URL fallback", async (status, executionOptions) => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    const run = executor().execute(request({ executionOptions }));
    await vi.runAllTimersAsync();
    expect((await run).response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new Error("ambiguous ECONNRESET"), Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } })])("rethrows the original rejected generation with no proxy/TLS replay", async error => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(error);
    const proxyOptions = { strictProxy: true };
    const run = executor().execute(request({ proxyOptions, executionOptions: { alias: true } })).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await run).toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0].slice(2)).toEqual([proxyOptions, { allowNetworkReplay: false }]);
    expect(proxyOptions).toEqual({ strictProxy: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps ordinary retry counts isolated on the same singleton and ignores payload policy lookalikes", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url, init) => new Response("{}", { status: JSON.parse(init.body).kind === "alias" ? 503 : 502 }));
    const ex = executor();
    ex.config = { ...ex.config, baseUrls: ["https://one.invalid"] };
    const alias = ex.execute(request({ body: { kind: "alias" }, executionOptions: options }));
    const ordinary = ex.execute(request({ body: { kind: "ordinary", _alias: true, retryPolicy: "single-attempt", executionOptions: options }, credentials: { _alias: true } }));
    await vi.runAllTimersAsync();
    expect((await alias).response.status).toBe(503);
    expect((await ordinary).response.status).toBe(502);
    const calls = fetchMock.mock.calls;
    expect(calls.filter(([, init]) => JSON.parse(init.body).kind === "alias")).toHaveLength(1);
    const legacy = calls.filter(([, init]) => JSON.parse(init.body).kind === "ordinary");
    expect(legacy).toHaveLength(2);
    expect(legacy.every(call => call.length === 3)).toBe(true);
  });

  it("forwards explicit no-network-replay independently of alias policy", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    await executor().execute(request({ executionOptions: { allowNetworkReplay: false } }));
    expect(fetchMock.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
  });

  it.each(["request", "attempt"])("pre-aborted %s signal prevents transforms, timers and dispatch and preserves null", async source => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort(null);
    const ex = executor();
    const transform = vi.spyOn(ex, "transformRequest");
    const run = ex.execute(request({ signal: source === "request" ? controller.signal : undefined, executionOptions: { ...options, attempt: source === "attempt" ? { signal: controller.signal } : undefined } })).catch(e => e);
    expect(await run).toBeNull();
    expect(transform).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a late response without awaiting body cleanup and clears the connect timer", async () => {
    vi.useFakeTimers();
    const owner = new AbortController(), started = deferred(), work = deferred();
    const cancel = vi.fn(() => new Promise(() => {}));
    fetchMock.mockImplementation((url, init) => { started.resolve(init.signal); return work.promise; });
    const run = executor().execute(request({ executionOptions: { ...options, attempt: { signal: owner.signal } } })).catch(e => e);
    const dispatchedSignal = await started.promise;
    owner.abort(null);
    expect(dispatchedSignal.aborted).toBe(true);
    work.resolve({ status: 503, body: { cancel }, headers: new Headers() });
    expect(await run).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ordinary cancellation interrupts a retry sleep without fallback or another dispatch", async () => {
    vi.useFakeTimers();
    const owner = new AbortController(), sleeping = deferred();
    const reason = new Error("client left");
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    const run = executor().execute(request({ signal: owner.signal, log: { debug: () => sleeping.resolve() } })).catch(e => e);
    await sleeping.promise;
    owner.abort(reason);
    await vi.runAllTimersAsync();
    expect(await run).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forces outbound stream through Base and Default while cloning destructive per-attempt transforms", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    class DestructiveExecutor extends BaseExecutor {
      transformRequest(model, body, stream, credentials, executionOptions) {
        expect(stream).toBe(true);
        expect(executionOptions).toBe(options);
        body.messages[0].content.push({ type: "text", text: "transformed" });
        return body;
      }
    }
    const body = { stream: false, messages: [{ role: "system", content: [{ type: "text", text: "source" }] }] };
    const original = structuredClone(body);
    const ex = new DestructiveExecutor("fixture", { baseUrl: "https://one.invalid" });
    const first = await ex.execute(request({ body, executionOptions: options }));
    const second = await ex.execute(request({ body, executionOptions: options }));
    expect(body).toEqual(original);
    expect(first.transformedBody.messages[0].content).toHaveLength(2);
    expect(second.transformedBody).not.toBe(first.transformedBody);
    const generic = new DefaultExecutor("openai-compatible-fixture");
    await generic.execute(request({ body, executionOptions: options }));
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body).stream).toBe(true);
      expect(init.headers.Accept).toBe("text/event-stream");
    }
    expect(body).toEqual(original);
  });

  it("uses Gemini's streaming URL without inventing a stream body field", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    const ex = new DefaultExecutor("gemini");
    await ex.execute(request({ body: { contents: [] }, executionOptions: options }));
    expect(fetchMock.mock.calls[0][0]).toContain(":streamGenerateContent?alt=sse");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("stream");
  });
});

describe("Default refresh acquisition", () => {
  it("claims the shared account refresh once, preserves token shape, and denies a second acquisition", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const budget = attempt.getAccountRecoveryBudget("fixture");
    const claimRefresh = vi.fn(() => budget.claimRefresh());
    const ex = new DefaultExecutor("codex");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "fixture-new", expires_in: 3600 })));
    try {
      const refreshOptions = { signal: attempt.signal, recoveryBudget: { claimRefresh } };
      expect(await ex.refreshCredentials({ refreshToken: "fixture-old" }, null, null, refreshOptions)).toEqual({ accessToken: "fixture-new", refreshToken: "fixture-old", expiresIn: 3600 });
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].signal).toBe(attempt.signal);
      expect(await ex.refreshCredentials({ refreshToken: "fixture-old" }, null, null, refreshOptions)).toBeNull();
      expect(claimRefresh).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { attempt.dispose(); }
  });

  it("does not claim for missing tokens or no-op providers; failed acquisition still consumes allowance", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const budget = attempt.getAccountRecoveryBudget("failed");
    const claimRefresh = vi.fn(() => budget.claimRefresh());
    const opts = { recoveryBudget: { claimRefresh } };
    try {
      expect(await new DefaultExecutor("codex").refreshCredentials({}, null, null, opts)).toBeNull();
      expect(await new DefaultExecutor("kilocode").refreshCredentials({ refreshToken: "fixture" }, null, null, opts)).toBeNull();
      expect(claimRefresh).not.toHaveBeenCalled();
      fetchMock.mockRejectedValue(new Error("fixture failure"));
      expect(await new DefaultExecutor("codex").refreshCredentials({ refreshToken: "fixture" }, null, null, opts)).toBeNull();
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(await new DefaultExecutor("codex").refreshCredentials({ refreshToken: "fixture" }, null, null, opts)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { attempt.dispose(); }
  });

  it("preabort skips budget/fetch and postfetch cancellation skips JSON and success logging", async () => {
    const owner = new AbortController();
    owner.abort(null);
    const claimRefresh = vi.fn(() => true);
    const ex = new DefaultExecutor("codex"), log = { info: vi.fn(), error: vi.fn() };
    expect(await ex.refreshCredentials({ refreshToken: "fixture" }, log, null, { signal: owner.signal, recoveryBudget: { claimRefresh } }).catch(e => e)).toBeNull();
    expect(claimRefresh).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const lateOwner = new AbortController(), started = deferred(), work = deferred();
    const json = vi.fn(), cancel = vi.fn(async () => {});
    fetchMock.mockImplementation(() => { started.resolve(); return work.promise; });
    const run = ex.refreshCredentials({ refreshToken: "fixture" }, log, null, { signal: lateOwner.signal }).catch(e => e);
    await started.promise;
    lateOwner.abort("late");
    work.resolve({ ok: true, json, body: { cancel } });
    expect(await run).toBe("late");
    expect(json).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("cancels an owned pending body reader instead of only racing its JSON promise", async () => {
    const owner = new AbortController(), reading = deferred();
    const canceled = vi.fn();
    const body = new ReadableStream({ pull() { reading.resolve(); }, cancel: canceled }, { highWaterMark: 0 });
    fetchMock.mockResolvedValue(new Response(body));
    const run = new DefaultExecutor("claude").refreshCredentials({ refreshToken: "fixture" }, null, null, { signal: owner.signal }).catch(e => e);
    await reading.promise;
    expect(body.locked).toBe(true);
    owner.abort(null);
    expect(await run).toBeNull();
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it.each(["iflow", "kiro", "cline", "kimi"])("%s concrete refresh forwards cancellation without swallowing the reason", async provider => {
    const owner = new AbortController(), started = deferred();
    fetchMock.mockImplementation((url, init) => {
      started.resolve(init.signal);
      return new Promise((resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("masked fetch")), { once: true }));
    });
    const run = new DefaultExecutor(provider).refreshCredentials({ refreshToken: "fixture", providerSpecificData: { deviceId: "fixture-device" } }, null, null, { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort("original");
    expect(signal).toBe(owner.signal);
    expect(await run).toBe("original");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("guards cancellation after body await before returning rotated tokens or logging", async () => {
    const owner = new AbortController(), log = { info: vi.fn(), error: vi.fn() };
    const cancel = vi.fn(async () => {});
    fetchMock.mockResolvedValue({ ok: true, body: { cancel }, json: async () => {
      owner.abort("body completed too late");
      return { access_token: "fixture-stale", refresh_token: "fixture-stale-rotation" };
    } });
    const result = await new DefaultExecutor("codex").refreshCredentials({ refreshToken: "fixture" }, log, null, { signal: owner.signal }).catch(e => e);
    expect(result).toBe("body completed too late");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("direct refresh helper claims once and preserves cancellation over a masked transport failure", async () => {
    const owner = new AbortController(), started = deferred();
    const claimRefresh = vi.fn(() => true);
    fetchMock.mockImplementation((url, init) => {
      started.resolve();
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("masked direct failure")), { once: true }));
    });
    const result = new DefaultExecutor("codex").refreshWithForm("https://refresh.invalid", { refresh_token: "fixture" }, null, { signal: owner.signal, recoveryBudget: { claimRefresh } }).catch(e => e);
    await started.promise;
    owner.abort(null);
    expect(await result).toBeNull();
    expect(claimRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains ordinary null-on-error and signal-less fetch defaults", async () => {
    fetchMock.mockRejectedValue(new Error("ordinary error"));
    const log = { error: vi.fn() };
    expect(await new DefaultExecutor("codex").refreshCredentials({ refreshToken: "fixture" }, log)).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(3);
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });
});

describe("Default refresh R1 compatibility", () => {
  it("rejects successful null form payloads directly and logs the public Codex error once", async () => {
    const ex = new DefaultExecutor("codex"), log = { info: vi.fn(), error: vi.fn() };
    fetchMock.mockResolvedValueOnce(new Response("null"));
    await expect.soft(ex.refreshWithForm("https://refresh.invalid", { refresh_token: "fixture" })).rejects.toBeInstanceOf(TypeError);
    fetchMock.mockResolvedValueOnce(new Response("null"));
    expect(await ex.refreshCredentials({ refreshToken: "fixture" }, log)).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("TOKEN", expect.stringContaining("codex refresh error:"));
    expect(log.info).not.toHaveBeenCalled();
  });

  it("retains the successful false token shape, refresh fallback and success log", async () => {
    fetchMock.mockResolvedValueOnce(new Response("false"));
    const log = { info: vi.fn(), error: vi.fn() };
    expect(await new DefaultExecutor("codex").refreshCredentials({ refreshToken: "fixture" }, log)).toStrictEqual({ accessToken: undefined, refreshToken: "fixture", expiresIn: undefined });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("TOKEN", "codex refreshed");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("retains Cline's successful null optional token shape and success log", async () => {
    fetchMock.mockResolvedValueOnce(new Response("null"));
    const log = { info: vi.fn(), error: vi.fn() };
    expect(await new DefaultExecutor("cline").refreshCredentials({ refreshToken: "fixture" }, log)).toStrictEqual({ accessToken: undefined, refreshToken: "fixture", expiresIn: undefined });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("TOKEN", "cline refreshed");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("keeps non-OK responses and denied acquisitions null without token logs", async () => {
    const ex = new DefaultExecutor("codex"), log = { info: vi.fn(), error: vi.fn() };
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 400 }));
    expect(await ex.refreshWithForm("https://refresh.invalid", { refresh_token: "fixture" })).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 400 }));
    expect(await ex.refreshCredentials({ refreshToken: "fixture" }, log)).toBeNull();
    const directClaim = vi.fn(() => false), publicClaim = vi.fn(() => false);
    expect(await ex.refreshWithForm("https://refresh.invalid", { refresh_token: "fixture" }, null, { recoveryBudget: { claimRefresh: directClaim } })).toBeNull();
    expect(await ex.refreshCredentials({ refreshToken: "fixture" }, log, null, { recoveryBudget: { claimRefresh: publicClaim } })).toBeNull();
    expect(directClaim).toHaveBeenCalledTimes(1);
    expect(publicClaim).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

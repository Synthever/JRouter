import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.fetch(...args),
}));

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function logSpy() {
  return { info: vi.fn(), error: vi.fn() };
}

function nativeResponse(body, { status = 200 } = {}) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

let GithubExecutor;
let createAliasAttempt;
let proxyOptions;
let executor;

beforeEach(async () => {
  vi.resetModules();
  ({ GithubExecutor } = await import("../../open-sse/executors/github.js"));
  ({ createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js"));
  executor = new GithubExecutor();
  proxyOptions = { proxy: "fixture-proxy" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("concrete GitHub refresh acquisition budget", () => {
  it("claims before one successful Copilot request and denies reuse without another dispatch", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:one");
    const independentBudget = attempt.getAccountRecoveryBudget("github:two");
    const signal = attempt.signal;
    const log = logSpy();
    const fetch = vi.fn(async () => nativeResponse(JSON.stringify({ token: "copilot-new", expires_at: 123 })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshCopilotToken("gh-old", log, proxyOptions, { signal, recoveryBudget: budget }))
        .resolves.toEqual({ token: "copilot-new", expiresAt: 123 });
      await expect(executor.refreshCopilotToken("gh-two", log, proxyOptions, { recoveryBudget: independentBudget }))
        .resolves.toEqual({ token: "copilot-new", expiresAt: 123 });
      await expect(executor.refreshCopilotToken("gh-old", log, proxyOptions, { signal, recoveryBudget: budget }))
        .resolves.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
      expect(fetch.mock.calls[1][0]).toBe("https://api.github.com/copilot_internal/v2/token");
      expect(fetch.mock.calls[1][1].headers.Authorization).toBe("token gh-two");
      expect(fetch.mock.calls[0][1].signal).toBe(signal);
      expect(fetch.mock.calls[0][1].headers.Authorization).toBe("token gh-old");
      expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
      expect(log.info).toHaveBeenCalledTimes(2);
      expect(log.info).toHaveBeenNthCalledWith(1, "TOKEN", "Copilot token refreshed");
      expect(log.info).toHaveBeenNthCalledWith(2, "TOKEN", "Copilot token refreshed");
      expect(log.error).not.toHaveBeenCalled();
      expect(budget.claimRefresh()).toBe(false);
    } finally { attempt.dispose(); }
  });

  it("spends the account slot on a failed Copilot response and does not fall through to OAuth", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:failed-copilot");
    const log = logSpy();
    const fetch = vi.fn(async () => nativeResponse("denied", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, {
        signal: attempt.signal, recoveryBudget: budget,
      })).resolves.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
      expect(log.error).toHaveBeenCalledExactlyOnceWith("TOKEN", "Copilot token refresh failed: 401 denied");
      expect(budget.claimRefresh()).toBe(false);
    } finally { attempt.dispose(); }
  });

  it("retains the ordinary three-request fallback, proxy contract, payloads, shape and TOKEN logs", async () => {
    const log = logSpy();
    const fetch = vi.fn()
      .mockResolvedValueOnce(nativeResponse("unavailable", { status: 503 }))
      .mockResolvedValueOnce(nativeResponse(JSON.stringify({ access_token: "gh-new", refresh_token: "gh-rotated", expires_in: 3600 })))
      .mockResolvedValueOnce(nativeResponse(JSON.stringify({ token: "copilot-new", expires_at: 456 })));
    vi.stubGlobal("fetch", fetch);

    await expect(executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions))
      .resolves.toEqual({ accessToken: "gh-new", refreshToken: "gh-rotated", expiresIn: 3600, copilotToken: "copilot-new", copilotTokenExpiresAt: 456 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      "https://api.github.com/copilot_internal/v2/token",
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/copilot_internal/v2/token",
    ]);
    const first = fetch.mock.calls[0];
    expect(first[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "token gh-old" }) }));
    expect(first[2]).toBe(proxyOptions);
    const oauth = fetch.mock.calls[1];
    expect(oauth[1].method).toBe("POST");
    expect(oauth[1].headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
    expect(new URLSearchParams(oauth[1].body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(oauth[1].body).get("refresh_token")).toBe("gh-refresh");
    expect(oauth[2]).toBe(proxyOptions);
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe("token gh-new");
    expect(fetch.mock.calls[2][2]).toBe(proxyOptions);
    expect(log.error).toHaveBeenCalledExactlyOnceWith("TOKEN", "Copilot token refresh failed: 503 unavailable");
    expect(log.info).toHaveBeenNthCalledWith(1, "TOKEN", "GitHub token refreshed");
    expect(log.info).toHaveBeenNthCalledWith(2, "TOKEN", "Copilot token refreshed");
  });

  it("budgets a direct GitHub OAuth request and keeps form/proxy behavior", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:oauth");
    const log = logSpy();
    const fetch = vi.fn(async () => nativeResponse(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 99 })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshGitHubToken("old-refresh", log, proxyOptions, { recoveryBudget: budget }))
        .resolves.toEqual({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 99 });
      await expect(executor.refreshGitHubToken("old-refresh", log, proxyOptions, { signal: attempt.signal, recoveryBudget: budget }))
        .resolves.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe("https://github.com/login/oauth/access_token");
      expect(fetch.mock.calls[0][1].method).toBe("POST");
      expect(fetch.mock.calls[0][1].signal).toBeUndefined();
      expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
      expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("refresh_token")).toBe("old-refresh");
      expect(log.info).toHaveBeenCalledExactlyOnceWith("TOKEN", "GitHub token refreshed");
    } finally { attempt.dispose(); }
  });

  it("keeps the cancellable three-request legacy sequence when no account budget is supplied", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const log = logSpy();
    const fetch = vi.fn()
      .mockResolvedValueOnce(nativeResponse("unavailable", { status: 503 }))
      .mockResolvedValueOnce(nativeResponse(JSON.stringify({ access_token: "gh-new", expires_in: 2 })))
      .mockResolvedValueOnce(nativeResponse(JSON.stringify({ token: "copilot-new", expires_at: 3 })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: attempt.signal }))
        .resolves.toEqual({ accessToken: "gh-new", refreshToken: "gh-refresh", expiresIn: 2, copilotToken: "copilot-new", copilotTokenExpiresAt: 3 });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls.every(call => call[1].signal === attempt.signal)).toBe(true);
      expect(fetch.mock.calls.every(call => call[2] === proxyOptions)).toBe(true);
    } finally { attempt.dispose(); }
  });

  it("does not claim or fetch for opted-in missing handles or pre-aborted attempts", async () => {
    const source = new AbortController();
    source.abort("already-aborted");
    const abortedAttempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000, clientSignal: source.signal });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const missingBudget = attempt.getAccountRecoveryBudget("github:missing");
    const abortedBudget = abortedAttempt.getAccountRecoveryBudget("github:preabort");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshCredentials({}, logSpy(), proxyOptions, { signal: attempt.signal, recoveryBudget: missingBudget })).resolves.toBeNull();
      const missingCopilotBudget = attempt.getAccountRecoveryBudget("github:missing-copilot");
      const missingOAuthBudget = attempt.getAccountRecoveryBudget("github:missing-oauth");
      await expect(executor.refreshCopilotToken(undefined, logSpy(), proxyOptions, { signal: attempt.signal, recoveryBudget: missingCopilotBudget })).resolves.toBeNull();
      await expect(executor.refreshGitHubToken(null, logSpy(), proxyOptions, { signal: attempt.signal, recoveryBudget: missingOAuthBudget })).resolves.toBeNull();
      await expect(executor.refreshCopilotToken(undefined, logSpy(), proxyOptions, { signal: abortedAttempt.signal, recoveryBudget: abortedBudget }))
        .rejects.toBe(abortedAttempt.signal.reason);
      expect(fetch).not.toHaveBeenCalled();
      expect(missingBudget.claimRefresh()).toBe(true);
      expect(missingCopilotBudget.claimRefresh()).toBe(true);
      expect(missingOAuthBudget.claimRefresh()).toBe(true);
      expect(abortedBudget.claimRefresh()).toBe(false);
    } finally { attempt.dispose(); abortedAttempt.dispose(); }
  });

  it("skips an absent Copilot access token and returns the established-account OAuth partial result", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:established");
    const fetch = vi.fn(async () => nativeResponse(JSON.stringify({ access_token: "gh-new", refresh_token: "gh-rotated", expires_in: 60 })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(executor.refreshCredentials({ refreshToken: "gh-refresh" }, logSpy(), proxyOptions, { signal: attempt.signal, recoveryBudget: budget }))
        .resolves.toEqual({ accessToken: "gh-new", refreshToken: "gh-rotated", expiresIn: 60 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].method).toBe("POST");
      expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
    } finally { attempt.dispose(); }
  });
});

describe("GitHub refresh cancellation and compatibility", () => {
  it("cancels a pending native Copilot JSON reader on null abort and releases its listener and lock", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:copilot-body");
    const controller = new AbortController();
    const underlyingCancel = vi.fn(() => new Promise(() => {}));
    const response = new Response(new ReadableStream({ cancel: underlyingCancel }));
    const fetch = vi.fn(async () => response);
    const log = logSpy();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", fetch);
    try {
      const pending = executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: controller.signal, recoveryBudget: budget });
      await vi.waitFor(() => expect(response.body.locked).toBe(true));
      controller.abort(null);
      await expect(pending.then(value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason })))
        .resolves.toEqual({ state: "rejected", reason: null });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(underlyingCancel).toHaveBeenCalledExactlyOnceWith(null);
      expect(response.body.locked).toBe(false);
      const added = add.mock.calls.filter(([type]) => type === "abort");
      const removed = remove.mock.calls.filter(([type]) => type === "abort");
      expect(added).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(removed[0][1]).toBe(added[0][1]);
      const reader = response.body.getReader();
      try { expect(await reader.read()).toEqual({ done: true, value: undefined }); }
      finally { reader.releaseLock(); }
      expect(response.body.locked).toBe(false);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    } finally { attempt.dispose(); }
  }, 1000);

  it("cancels a pending native GitHub OAuth JSON reader with the exact null reason", async () => {
    const controller = new AbortController();
    let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; } }));
    const fetch = vi.fn(async () => response);
    const log = logSpy();
    vi.stubGlobal("fetch", fetch);
    const pending = executor.refreshGitHubToken("refresh", log, proxyOptions, { signal: controller.signal });
    await vi.waitFor(() => expect(response.body.locked).toBe(true));
    controller.abort(null);
    await expect(pending).rejects.toBe(null);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
    expect(response.body.locked).toBe(false);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("cancels a pending Copilot non-OK text body without converting cancellation to TOKEN failure", async () => {
    const controller = new AbortController();
    let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 401 });
    const fetch = vi.fn(async () => response);
    const log = logSpy();
    vi.stubGlobal("fetch", fetch);
    const pending = executor.refreshCopilotToken("gh-old", log, proxyOptions, { signal: controller.signal });
    await vi.waitFor(() => expect(response.body.locked).toBe(true));
    controller.abort("stop-body");
    await expect(pending).rejects.toBe("stop-body");
    expect(canceled).toBe(true);
    expect(response.body.locked).toBe(false);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("disposes of a late response body after abort without reading or publishing it", async () => {
    const controller = new AbortController();
    const headers = deferred();
    let canceled = false;
    const response = new Response(new ReadableStream({ cancel() { canceled = true; } }));
    const fetch = vi.fn(() => headers.promise);
    const log = logSpy();
    vi.stubGlobal("fetch", fetch);
    const pending = executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: controller.signal });
    controller.abort("late-headers");
    headers.resolve(response);
    await expect(pending).rejects.toBe("late-headers");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
    expect(response.body.locked).toBe(false);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("rechecks cancellation across the awaited wrapper handoff before returning refreshed credentials", async () => {
    const controller = new AbortController();
    const reason = { canceled: "handoff" };
    const log = logSpy();
    log.info.mockImplementation(() => queueMicrotask(() => controller.abort(reason)));
    const fetch = vi.fn(async () => nativeResponse(JSON.stringify({ token: "copilot", expires_at: 10 })));
    vi.stubGlobal("fetch", fetch);
    const pending = executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: controller.signal });
    await expect(pending).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledExactlyOnceWith("TOKEN", "Copilot token refreshed");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("yields while consuming a continuously ready native body so a queued abort cancels before publication", async () => {
    const controller = new AbortController();
    let canceled = false;
    let reads = 0;
    const response = new Response(new ReadableStream({
      pull(stream) {
        reads += 1;
        stream.enqueue(new TextEncoder().encode(" ".repeat(64)));
      },
      cancel() { canceled = true; },
    }));
    const fetch = vi.fn(async () => response);
    const log = logSpy();
    vi.stubGlobal("fetch", fetch);
    const pending = executor.refreshCopilotToken("gh-old", log, proxyOptions, { signal: controller.signal });
    setTimeout(() => controller.abort("yielded"), 0);
    await expect(pending).rejects.toBe("yielded");
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(64);
    expect(canceled).toBe(true);
    expect(response.body.locked).toBe(false);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("preserves signal-less successful-null and false JSON behavior and legacy error logging", async () => {
    const nullLog = logSpy();
    vi.stubGlobal("fetch", vi.fn(async () => nativeResponse("null")));
    await expect(executor.refreshCopilotToken("gh-old", nullLog, proxyOptions)).resolves.toBeNull();
    expect(nullLog.error).toHaveBeenCalledTimes(1);
    expect(nullLog.error.mock.calls[0][0]).toBe("TOKEN");
    expect(nullLog.error.mock.calls[0][1]).toMatch(/^Copilot refresh error:/);

    const falseLog = logSpy();
    vi.stubGlobal("fetch", vi.fn(async () => nativeResponse("false")));
    await expect(executor.refreshCopilotToken("gh-old", falseLog, proxyOptions))
      .resolves.toEqual({ token: undefined, expiresAt: undefined });
    expect(falseLog.info).toHaveBeenCalledExactlyOnceWith("TOKEN", "Copilot token refreshed");
  });
});

describe("GitHub refresh missed-registration and pending-fetch proofs", () => {
  it("cancels the acquired native body when getReader aborts before listener registration", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new Error("fixture cleanup rejection")));
    const response = new Response(new ReadableStream({ cancel }));
    const getReader = response.body.getReader.bind(response.body);
    const acquire = vi.spyOn(response.body, "getReader").mockImplementation(options => {
      const reader = getReader(options);
      controller.abort(null);
      return reader;
    });
    const fetch = vi.fn(async () => response);
    const log = logSpy();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", fetch);
    const outcome = await executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: controller.signal })
      .then(value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason }));
    expect(outcome).toEqual({ state: "rejected", reason: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(response.body.locked).toBe(false);
    const added = add.mock.calls.filter(([type]) => type === "abort");
    const removed = remove.mock.calls.filter(([type]) => type === "abort");
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null);
    const reader = getReader();
    try { expect(await reader.read()).toEqual({ done: true, value: undefined }); }
    finally { reader.releaseLock(); }
    expect(response.body.locked).toBe(false);
  });

  it("cancels the fallback raw body when its getReader accessor aborts before listener registration", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new Error("fixture cleanup rejection")));
    const body = { cancel };
    Object.defineProperty(body, "getReader", { get() { controller.abort(null); return undefined; } });
    const json = vi.fn();
    const text = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true, body, json, text }));
    const log = logSpy();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", fetch);
    const outcome = await executor.refreshCredentials({ accessToken: "gh-old", refreshToken: "gh-refresh" }, log, proxyOptions, { signal: controller.signal })
      .then(value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason }));
    expect(outcome).toEqual({ state: "rejected", reason: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    const added = add.mock.calls.filter(([type]) => type === "abort");
    const removed = remove.mock.calls.filter(([type]) => type === "abort");
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("rejects a still-pending concrete refresh fetch with literal null without fallback or publication", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 30_000 });
    const budget = attempt.getAccountRecoveryBudget("github:pending-fetch-null");
    const claimRefresh = vi.fn(() => budget.claimRefresh());
    const recoveryBudget = Object.freeze({ claimRefresh });
    const controller = new AbortController();
    const entered = deferred();
    let onAbort;
    const fetch = vi.fn((url, { signal }) => new Promise((_, reject) => {
      onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entered.resolve();
    }));
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const credentials = Object.freeze({ accessToken: "gh-old", refreshToken: "gh-refresh" });
    const log = logSpy();
    vi.stubGlobal("fetch", fetch);
    try {
      const pending = executor.refreshCredentials(credentials, log, proxyOptions, { signal: controller.signal, recoveryBudget })
        .then(value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason }));
      await entered.promise;
      expect(controller.signal.aborted).toBe(false);
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(claimRefresh).toHaveReturnedWith(true);
      expect(claimRefresh.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
      controller.abort(null);
      expect(await pending).toEqual({ state: "rejected", reason: null });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
      expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
      expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(budget.claimRefresh()).toBe(false);
      expect(add).toHaveBeenCalledExactlyOnceWith("abort", onAbort, { once: true });
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", onAbort);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
      expect(credentials).toEqual({ accessToken: "gh-old", refreshToken: "gh-refresh" });
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      attempt.dispose();
    }
  }, 1000);

  it("uses the real initial member deadline to cancel a still-pending concrete refresh fetch", async () => {
    const entered = deferred();
    let onAbort;
    const fetch = vi.fn((url, { signal }) => new Promise((_, reject) => {
      onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entered.resolve();
    }));
    const log = logSpy();
    const credentials = Object.freeze({ accessToken: "gh-old", refreshToken: "gh-refresh" });
    vi.stubGlobal("fetch", fetch);
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 25 });
    const budget = attempt.getAccountRecoveryBudget("github:pending-fetch-deadline");
    const claimRefresh = vi.fn(() => budget.claimRefresh());
    const recoveryBudget = Object.freeze({ claimRefresh });
    const add = vi.spyOn(attempt.signal, "addEventListener");
    const remove = vi.spyOn(attempt.signal, "removeEventListener");
    try {
      const pending = executor.refreshCredentials(credentials, log, proxyOptions, { signal: attempt.signal, recoveryBudget })
        .then(value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason }));
      await entered.promise;
      expect(attempt.signal.aborted).toBe(false);
      expect(attempt.outputStarted).toBe(false);
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(claimRefresh).toHaveReturnedWith(true);
      expect(claimRefresh.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
      const outcome = await pending;
      expect(outcome.state).toBe("rejected");
      expect(outcome.reason).toBe(attempt.signal.reason);
      expect(outcome.reason.reason).toBe("initial-output-deadline");
      expect(attempt.signal.aborted).toBe(true);
      expect(attempt.outputStarted).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
      expect(fetch.mock.calls[0][1].signal).toBe(attempt.signal);
      expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
      expect(claimRefresh).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledExactlyOnceWith("abort", onAbort, { once: true });
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", onAbort);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
      expect(credentials).toEqual({ accessToken: "gh-old", refreshToken: "gh-refresh" });
    } finally {
      attempt.signal.removeEventListener("abort", onAbort);
      attempt.dispose();
    }
  }, 1000);
});

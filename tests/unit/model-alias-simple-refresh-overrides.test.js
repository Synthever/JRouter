import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ proxyFetch: vi.fn(), machineId: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: boundary.proxyFetch }));
vi.mock("../../open-sse/shared/machineId.js", () => ({ getConsistentMachineId: boundary.machineId }));

const attempts = [];
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

async function policy(provider) {
  const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 20000 });
  attempts.push(attempt);
  const budget = attempt.getAccountRecoveryBudget(`${provider}:fixture`);
  // The real budget is frozen; observe calls through a delegating options object.
  return { attempt, recoveryBudget: { claimRefresh: () => budget.claimRefresh() } };
}

async function loadGoogle(provider) {
  const mod = provider === "antigravity"
    ? await import("../../open-sse/executors/antigravity.js")
    : await import("../../open-sse/executors/gemini-cli.js");
  const executor = new mod.default();
  const fetch = provider === "antigravity" ? boundary.proxyFetch : vi.fn();
  if (provider === "gemini-cli") vi.stubGlobal("fetch", fetch);
  return { executor, fetch };
}

function tokenResponse(tokens = { access_token: "fresh", expires_in: 3600 }) {
  return new Response(JSON.stringify(tokens), { headers: { "Content-Type": "application/json" } });
}

function logFixture() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

beforeEach(() => {
  vi.resetModules();
  boundary.proxyFetch.mockReset();
  boundary.machineId.mockReset();
  boundary.proxyFetch.mockResolvedValue(new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } }));
});
afterEach(() => {
  attempts.splice(0).forEach(attempt => attempt.dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const contents = [{ role: "user", parts: [{ text: "hello" }] }];
const model = "gemini-2.5-flash";
const requestId = "agent/fixture/123/trajectory/1";
const googleBodies = [
  ["antigravity", "provider envelope", { model, requestId, request: { contents, sessionId: "-123" } }, {
    model, requestId, project: "fixture-project", userAgent: "antigravity",
    request: { contents, sessionId: "-123", generationConfig: {} },
  }],
  ["gemini-cli", "unwrapped payload", { contents }, { project: "fixture-project", model, request: { contents } }],
  ["gemini-cli", "provider envelope", { project: "fixture-project", model, request: { contents } }, {
    project: "fixture-project", model, request: { contents },
  }],
];

describe("Google streaming URL without a stream body flag", () => {
  it.each(googleBodies)("%s alias keeps the exact %s JSON and caller input", async (provider, shape, input, expected) => {
    const { executor } = await loadGoogle(provider);
    const body = structuredClone(input), original = structuredClone(input);
    const { attempt, recoveryBudget } = await policy(provider);
    const result = await executor.execute({
      model, body, stream: false, credentials: { accessToken: "fixture", projectId: "fixture-project" },
      executionOptions: { alias: true, attempt, recoveryBudget, forceUpstreamStreaming: true },
    });
    expect(boundary.proxyFetch).toHaveBeenCalledTimes(1);
    const [url, init, proxy, options] = boundary.proxyFetch.mock.calls[0];
    expect(url).toContain(":streamGenerateContent?alt=sse");
    expect(JSON.parse(init.body)).toEqual(expected);
    expect(JSON.parse(init.body)).not.toHaveProperty("stream");
    expect(JSON.parse(init.body).request).not.toHaveProperty("stream");
    expect(body).toEqual(original);
    expect(result.response.status).toBe(200);
    expect(proxy).toBeNull();
    expect(options).toEqual({ allowNetworkReplay: false });
  });

  it.each(googleBodies)("%s ordinary nonstreaming preserves the %s transform and endpoint", async (provider, shape, input, expected) => {
    const { executor } = await loadGoogle(provider);
    const body = structuredClone(input);
    await executor.execute({ model, body, stream: false, credentials: { accessToken: "fixture", projectId: "fixture-project" } });
    const [url, init] = boundary.proxyFetch.mock.calls[0];
    expect(url).toMatch(/:generateContent$/);
    expect(JSON.parse(init.body)).toEqual(expected);
    expect(boundary.proxyFetch.mock.calls[0]).toHaveLength(3);
  });
});

for (const [provider, label] of [["antigravity", "Antigravity"], ["gemini-cli", "Gemini CLI"]]) {
  describe(`${label} local refresh policy`, () => {
    const credentials = { refreshToken: "fixture-refresh", projectId: "fixture-project" };
    const proxyOptions = { strictProxy: true };

    it("claims once at the actual form request and forwards the same signal", async () => {
      const { executor, fetch } = await loadGoogle(provider);
      const { attempt, recoveryBudget } = await policy(provider);
      const claim = vi.spyOn(recoveryBudget, "claimRefresh"), log = logFixture();
      fetch.mockImplementation(async () => {
        expect(claim).toHaveBeenCalledTimes(1);
        return tokenResponse();
      });
      const result = await executor.refreshCredentials(credentials, log, proxyOptions, { signal: attempt.signal, recoveryBudget });
      expect(result).toEqual({ accessToken: "fresh", refreshToken: "fixture-refresh", expiresIn: 3600, projectId: "fixture-project" });
      expect(claim).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init.signal).toBe(attempt.signal);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
      expect(Object.fromEntries(init.body)).toEqual({
        grant_type: "refresh_token", refresh_token: "fixture-refresh",
        client_id: executor.config.clientId, client_secret: executor.config.clientSecret,
      });
      expect(fetch.mock.calls[0]).toHaveLength(provider === "antigravity" ? 3 : 2);
      if (provider === "antigravity") expect(fetch.mock.calls[0][2]).toBe(proxyOptions);
      else expect(boundary.proxyFetch).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith("TOKEN", `${label} refreshed`);
      expect(log.error).not.toHaveBeenCalled();
      expect(await executor.refreshCredentials(credentials, log, proxyOptions, { signal: attempt.signal, recoveryBudget })).toBeNull();
      expect(claim).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("returns null for missing refreshToken without claiming or fetching", async () => {
      const { executor, fetch } = await loadGoogle(provider);
      const { attempt, recoveryBudget } = await policy(provider);
      const claim = vi.spyOn(recoveryBudget, "claimRefresh");
      expect(await executor.refreshCredentials({}, null, proxyOptions, { signal: attempt.signal, recoveryBudget })).toBeNull();
      expect(claim).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects pre-aborted entry even without refreshToken before claiming", async () => {
      const { executor, fetch } = await loadGoogle(provider);
      const { recoveryBudget } = await policy(provider), owner = new AbortController(), log = logFixture();
      const claim = vi.spyOn(recoveryBudget, "claimRefresh");
      owner.abort();
      await expect(executor.refreshCredentials({}, log, proxyOptions, { signal: owner.signal, recoveryBudget })).rejects.toBe(owner.signal.reason);
      expect(claim).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    });

    it("does not start a late response body or log success after header cancellation", async () => {
      const { executor, fetch } = await loadGoogle(provider);
      const owner = new AbortController(), started = deferred(), headers = deferred(), log = logFixture();
      const json = vi.fn(async () => ({ access_token: "late" }));
      fetch.mockImplementation(() => { started.resolve(); return headers.promise; });
      const result = executor.refreshCredentials(credentials, log, proxyOptions, { signal: owner.signal }).catch(error => error);
      await started.promise;
      owner.abort();
      headers.resolve({ ok: true, json });
      expect(await result).toBe(owner.signal.reason);
      expect(json).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    });

    it.each(["resolved", "rejected"])("rethrows cancellation after a %s pending JSON read without auth logging", async settlement => {
      const { executor, fetch } = await loadGoogle(provider);
      const owner = new AbortController(), reading = deferred(), body = deferred(), log = logFixture();
      fetch.mockResolvedValue({ ok: true, json: () => { reading.resolve(); return body.promise; } });
      const result = executor.refreshCredentials(credentials, log, proxyOptions, { signal: owner.signal }).catch(error => error);
      await reading.promise;
      owner.abort();
      if (settlement === "resolved") body.resolve({ access_token: "late" });
      else body.reject(new Error("body interrupted"));
      expect(await result).toBe(owner.signal.reason);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("preserves omitted-policy success, token rotation and ordinary error logging", async () => {
      const { executor, fetch } = await loadGoogle(provider), log = logFixture();
      fetch.mockResolvedValueOnce(tokenResponse({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 }));
      expect(await executor.refreshCredentials(credentials, log)).toEqual({ accessToken: "fresh", refreshToken: "rotated", expiresIn: 3600, projectId: "fixture-project" });
      expect(log.info).toHaveBeenCalledWith("TOKEN", `${label} refreshed`);
      fetch.mockRejectedValueOnce(new Error("fixture failure"));
      expect(await executor.refreshCredentials(credentials, log)).toBeNull();
      expect(log.error).toHaveBeenCalledWith("TOKEN", `${label} refresh error: fixture failure`);
      const json = vi.fn();
      fetch.mockResolvedValueOnce({ ok: false, json });
      expect(await executor.refreshCredentials(credentials, log)).toBeNull();
      expect(json).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledTimes(1);
    });
  });
}

async function loadGrok() {
  const { GrokCliExecutor } = await import("../../open-sse/executors/grok-cli.js");
  return new GrokCliExecutor();
}

function grokFetch(tokenWork) {
  const fetch = vi.fn((url, init) => {
    if (String(url).includes(".well-known/openid-configuration")) {
      return Promise.resolve(tokenResponse({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/oauth2/token" }));
    }
    return tokenWork(url, init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Grok refresh fourth-argument manager handoff", () => {
  const credentials = { connectionId: "fixture", refreshToken: "fixture-refresh" };

  it("leaves the single claim to the real manager and retains global-fetch dedup", async () => {
    const executor = await loadGrok(), first = await policy("grok-cli"), second = await policy("grok-cli");
    const claims = [vi.spyOn(first.recoveryBudget, "claimRefresh"), vi.spyOn(second.recoveryBudget, "claimRefresh")];
    const started = deferred(), work = deferred();
    const fetch = grokFetch((url, init) => { started.resolve(init); return work.promise; });
    const a = executor.refreshCredentials(credentials, null, { strictProxy: true }, { signal: first.attempt.signal, recoveryBudget: first.recoveryBudget });
    const b = executor.refreshCredentials(credentials, null, { strictProxy: true }, { signal: second.attempt.signal, recoveryBudget: second.recoveryBudget });
    const init = await started.promise;
    work.resolve(tokenResponse());
    const [one, two] = await Promise.all([a, b]);
    expect(one.accessToken).toBe("fresh");
    expect(two).toEqual(one);
    claims.forEach(claim => expect(claim).toHaveBeenCalledTimes(1));
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(first.attempt.signal);
    expect(new URLSearchParams(init.body).get("refresh_token")).toBe("fixture-refresh");
    expect(fetch).toHaveBeenCalledTimes(2); // One discovery and one token acquisition, not per waiter.
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
    expect((await executor.refreshCredentials(credentials, null, null, { signal: first.attempt.signal, recoveryBudget: first.recoveryBudget })).accessToken).toBe("fresh");
    claims.forEach(claim => expect(claim).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("denies a spent fourth-argument budget locally and leaves missing-token allowance intact", async () => {
    const executor = await loadGrok(), { attempt, recoveryBudget } = await policy("grok-cli");
    const fetch = grokFetch(async () => tokenResponse());
    expect(await executor.refreshCredentials({}, null, null, { signal: attempt.signal, recoveryBudget })).toBeNull();
    expect(recoveryBudget.claimRefresh()).toBe(true);
    expect(await executor.refreshCredentials(credentials, null, {}, { signal: attempt.signal, recoveryBudget })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("guards pre-aborted entry before the missing-token return", async () => {
    const executor = await loadGrok(), owner = new AbortController();
    const fetch = grokFetch(async () => tokenResponse());
    owner.abort();
    await expect(executor.refreshCredentials({}, null, null, { signal: owner.signal })).rejects.toBe(owner.signal.reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the actual shared token request without auth failure logging", async () => {
    const executor = await loadGrok(), owner = new AbortController(), started = deferred(), work = deferred(), log = logFixture();
    grokFetch((url, init) => { started.resolve(init.signal); return work.promise; });
    const result = executor.refreshCredentials(credentials, log, {}, { signal: owner.signal }).catch(error => error);
    const signal = await started.promise;
    owner.abort();
    work.resolve(tokenResponse());
    expect(await result).toBe(owner.signal.reason);
    expect(signal.aborted).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("keeps omitted options working through the existing global-fetch helper", async () => {
    const executor = await loadGrok(), fetch = grokFetch(async () => tokenResponse());
    expect((await executor.refreshCredentials(credentials)).accessToken).toBe("fresh");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
  });
});

function grokArgs(signal, credentials = { accessToken: "fixture" }) {
  return {
    model: "grok-build", body: { input: [{ role: "user", content: "hello" }] }, stream: false, credentials,
    executionOptions: { alias: true, attempt: { signal }, forceUpstreamStreaming: true },
  };
}

describe("Grok execution identity cancellation", () => {
  it("checks entry before machine lookup or assigning a credential device identity", async () => {
    const executor = await loadGrok(), owner = new AbortController();
    executor._agentId = "prior";
    owner.abort();
    await expect(executor.execute(grokArgs(owner.signal, { accessToken: "fixture", providerSpecificData: { deviceId: "replacement" } }))).rejects.toBe(owner.signal.reason);
    expect(executor._agentId).toBe("prior");
    expect(boundary.machineId).not.toHaveBeenCalled();
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
  });

  it.each(["resolved", "rejected"])("a %s deferred machine identity after abort never mutates agentId or generates", async settlement => {
    const executor = await loadGrok(), owner = new AbortController(), started = deferred(), identity = deferred();
    boundary.machineId.mockImplementation(() => { started.resolve(); return identity.promise; });
    const result = executor.execute(grokArgs(owner.signal)).catch(error => error);
    await started.promise;
    expect(executor._agentId).toBeNull();
    owner.abort();
    if (settlement === "resolved") identity.resolve("0123456789abcdef0123456789abcdef");
    else identity.reject(new Error("identity unavailable"));
    const rejection = await result;
    expect(rejection).toBe(owner.signal.reason);
    expect(rejection.name).toBe("AbortError");
    expect(executor._agentId).toBeNull();
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
  });

  it("keeps the successful machine lookup and real Base generation path", async () => {
    const executor = await loadGrok(), owner = new AbortController();
    boundary.machineId.mockResolvedValue("0123456789abcdef0123456789abcdef");
    const result = await executor.execute(grokArgs(owner.signal));
    expect(result.response.status).toBe(200);
    expect(boundary.machineId).toHaveBeenCalledWith("grok-cli-agent");
    expect(boundary.proxyFetch).toHaveBeenCalledTimes(1);
    const [url, init] = boundary.proxyFetch.mock.calls[0];
    expect(url).toBe("https://cli-chat-proxy.grok.com/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-build", stream: true, store: false });
  });
});

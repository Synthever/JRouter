import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("refresh acquisition", () => {
  it("claims each owner's real account budget once while preserving another waiter", async () => {
    const { refreshProviderCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const a = new AbortController(), started = deferred(), work = deferred();
    const firstAttempt = createAliasAttempt({ initialResponseTimeoutMs: 1000, clientSignal: a.signal });
    const secondAttempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const firstBudget = firstAttempt.getAccountRecoveryBudget("codex:account");
    const secondBudget = secondAttempt.getAccountRecoveryBudget("codex:account");
    let sharedSignal;
    const fetch = vi.fn((url, options) => { sharedSignal = options.signal; started.resolve(); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const creds = { connectionId: "account", refreshToken: "old" };
    try {
      const first = refreshProviderCredentials("codex", creds, null, { signal: firstAttempt.signal, recoveryBudget: firstBudget }).catch(e => e);
      const second = refreshProviderCredentials("codex", creds, null, { signal: secondAttempt.signal, recoveryBudget: secondBudget });
      await started.promise;
      a.abort(new Error("left"));
      expect(await first).toBe(firstAttempt.signal.reason);
      expect(sharedSignal.aborted).toBe(false);
      work.resolve(new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated" })));
      expect((await second).accessToken).toBe("fresh");
      expect(firstBudget.claimRefresh()).toBe(false);
      expect(secondBudget.claimRefresh()).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      // Successful cache reads do not need another remote allowance.
      expect((await refreshProviderCredentials("codex", creds, null, { recoveryBudget: secondBudget })).accessToken).toBe("fresh");
    } finally { firstAttempt.dispose(); secondAttempt.dispose(); }
  });

  it("does not cache null, errors or canceled stale refreshes as success", async () => {
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const nullWork = vi.fn(async () => null);
    await dedupRefresh("p", "null", nullWork);
    await dedupRefresh("p", "null", nullWork);
    expect(nullWork).toHaveBeenCalledTimes(2);
    const errors = vi.fn(async () => ({ error: "invalid_grant" }));
    await dedupRefresh("p", "err", errors);
    await dedupRefresh("p", "err", errors);
    expect(errors).toHaveBeenCalledTimes(2);
    const owner = new AbortController(), stale = deferred();
    const canceled = dedupRefresh("p", "cancel", () => stale.promise, null, { signal: owner.signal }).catch(e => e);
    owner.abort("canceled");
    expect(await canceled).toBe("canceled");
    const fresh = await dedupRefresh("p", "cancel", async () => ({ accessToken: "new" }));
    stale.resolve({ accessToken: "stale" });
    await stale.promise;
    expect(await dedupRefresh("p", "cancel", async () => { throw new Error("duplicate"); })).toEqual(fresh);
  });

  it("retains the 10s success TTL and consumes failed acquisition without a new retry", async () => {
    vi.useFakeTimers();
    const { dedupRefresh } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 20000 });
    try {
      const budget = attempt.getAccountRecoveryBudget("p:account");
      const work = vi.fn(async () => ({ accessToken: "ok" }));
      await dedupRefresh("p", "success", work, null, { recoveryBudget: budget });
      await dedupRefresh("p", "success", work, null, { recoveryBudget: budget });
      expect(work).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10001);
      expect(await dedupRefresh("p", "success", work, null, { recoveryBudget: budget })).toBeNull();
      expect(work).toHaveBeenCalledTimes(1);
      const failedBudget = attempt.getAccountRecoveryBudget("p:failed");
      const fail = vi.fn(async () => { throw new Error("remote failed"); });
      await expect(dedupRefresh("p", "failure", fail, null, { recoveryBudget: failedBudget })).rejects.toThrow("remote failed");
      expect(await dedupRefresh("p", "failure", fail, null, { recoveryBudget: failedBudget })).toBeNull();
      expect(fail).toHaveBeenCalledTimes(1);
    } finally { attempt.dispose(); }
  });
});

describe("concrete provider cancellation", () => {
  it.each([
    ["generic Codex form", m => m.refreshAccessToken("codex", "fixture", {}, null, opts)],
    ["Claude", m => m.refreshClaudeOAuthToken("fixture", null, opts)],
    ["iFlow", m => m.refreshIflowToken("fixture", null, opts)],
    ["GitHub", m => m.refreshGitHubToken("fixture", null, opts)],
    ["Kimi", m => m.refreshKimiToken("fixture", {}, null, opts)],
    ["Cline", m => m.refreshClineToken("fixture", null, opts)],
    ["Google", m => m.refreshGoogleToken("fixture", "client", "secret", null, opts)],
    ["Codex", m => m.refreshCodexToken("fixture", null, opts)],
    ["Kiro social", m => m.refreshKiroToken("fixture", {}, null, { strictProxy: true }, opts)],
    ["Kiro IDC", m => m.refreshKiroToken("fixture", { authMethod: "idc", clientId: "c", clientSecret: "s", region: "us-east-1" }, null, null, opts)],
    ["Kiro external IdP", m => m.refreshKiroToken("fixture", { authMethod: "external_idp", clientId: "c", tokenEndpoint: "https://login.microsoftonline.com/fixture/oauth2/token", scope: "fixture" }, null, null, opts)],
    ["xAI delegate", m => m.refreshXaiToken("fixture", null, opts)],
    ["Copilot", m => m.refreshCopilotToken("fixture", null, opts)],
    ["CodeBuddy CN", m => m.refreshCodebuddyToken("fixture", null, opts)],
    ["CodeBuddy Intl", m => m.refreshCodebuddyIntlToken("fixture", null, opts)],
    ["Trae", m => m.refreshTraeToken("fixture", {}, null, opts)],
    ["MiniMax CN", m => m.refreshMiniMaxCodeToken("minimax-code", "fixture", null, opts)],
    ["MiniMax global", m => m.refreshMiniMaxCodeToken("minimax-code-global", "fixture", null, opts)],
  ])("%s passes actual shared abort to fetch and does not classify it as auth/null", async (name, call) => {
    const owner = new AbortController();
    opts = { signal: owner.signal };
    const started = deferred();
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
    const fetch = vi.fn((url, init) => {
      started.resolve(init.signal);
      return new Promise((resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    vi.stubGlobal("fetch", fetch);
    if (name === "Trae") {
      // Trae is hidden from the active registry; use its real local configuration.
      const { PROVIDER_OAUTH } = await import("../../open-sse/config/providers.js");
      const { default: trae } = await import("../../open-sse/providers/registry/trae.js");
      PROVIDER_OAUTH.trae = trae.oauth;
    }
    const mod = await import("../../open-sse/services/tokenRefresh/providers.js");
    const result = call(mod).catch(e => e);
    const sharedSignal = await started.promise;
    owner.abort(new Error("canceled"));
    expect(await result).toBe(owner.signal.reason);
    expect(sharedSignal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.doUnmock("../../open-sse/utils/proxyFetch.js");
  });
});
let opts;

describe("post-fetch cancellation checkpoints", () => {
  async function observeAcquisitionSettlement() {
    const shared = await import("../../open-sse/utils/sharedOperation.js");
    const join = shared.joinSharedOperation, settled = deferred();
    vi.spyOn(shared, "joinSharedOperation").mockImplementation((map, key, start, options) =>
      join(map, key, signal => {
        const work = start(signal);
        Promise.resolve(work).then(settled.resolve, settled.resolve);
        return work;
      }, options));
    return settled;
  }

  it("MiniMax never starts a late response body after its last owner cancels", async () => {
    const settled = await observeAcquisitionSettlement();
    const { refreshMiniMaxCodeToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const started = deferred(), work = deferred(), owner = new AbortController();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const json = vi.fn(async () => ({ access_token: "stale", refresh_token: "stale-rotation" }));
    const reason = new Error("MiniMax fetch canceled");
    const result = refreshMiniMaxCodeToken("minimax-code", "fixture", null, { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort(reason);
    expect(await result).toBe(reason);
    expect(signal.aborted).toBe(true);
    work.resolve({ ok: true, json });
    expect(await settled.promise).toBe(reason); // Drain the real acquisition, not just the detached waiter.
    expect(json).not.toHaveBeenCalled();
    fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: "new", refresh_token: "new-rotation" })));
    expect((await refreshMiniMaxCodeToken("minimax-code", "fixture")).accessToken).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("Vertex never starts a late response body after cancellation (ok=%s)", async ok => {
    vi.doMock("jose", () => ({
      importPKCS8: vi.fn(async () => ({})),
      SignJWT: class { setProtectedHeader() { return this; } setIssuer() { return this; } setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } async sign() { return "fixture-jwt"; } },
    }));
    try {
      const settled = await observeAcquisitionSettlement();
      const { refreshVertexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const started = deferred(), work = deferred(), owner = new AbortController();
      const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
      vi.stubGlobal("fetch", fetch);
      const json = vi.fn(async () => ({ access_token: "stale", expires_in: 3600 }));
      const text = vi.fn(async () => "late error");
      const sa = { client_email: "fixture@example.invalid", private_key: "fixture-key" };
      const reason = new Error("Vertex fetch canceled");
      const result = refreshVertexToken(sa, null, { signal: owner.signal }).catch(e => e);
      const signal = await started.promise;
      owner.abort(reason);
      expect(await result).toBe(reason);
      expect(signal.aborted).toBe(true);
      work.resolve({ ok, json, text });
      expect(await settled.promise).toBe(reason);
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: "new", expires_in: 3600 })));
      expect((await refreshVertexToken(sa)).accessToken).toBe("new");
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { vi.doUnmock("jose"); }
  });

  it("xAI never reads late discovery or caches fallback or dispatches tokens after cancellation", async () => {
    const started = deferred(), work = deferred(), owner = new AbortController();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const { discoverEndpoints, XaiService } = await import("../../src/lib/oauth/services/xai.js");
    const json = vi.fn(async () => ({ authorization_endpoint: "https://stale.x.ai/authorize", token_endpoint: "https://stale.x.ai/token" }));
    const reason = new Error("xAI discovery fetch canceled");
    const result = new XaiService().refreshAccessToken("fixture", { signal: owner.signal }).catch(e => e);
    expect(await started.promise).toBe(owner.signal);
    owner.abort(reason);
    work.resolve({ ok: true, json });
    expect(await result).toBe(reason); // This service settles only after the discovery continuation.
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response(JSON.stringify({ authorization_endpoint: "https://new.x.ai/authorize", token_endpoint: "https://new.x.ai/token" })));
    expect((await discoverEndpoints()).tokenUrl).toBe("https://new.x.ai/token");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("discovery cancellation", () => {
  it("xAI cancellation cannot cache fallback or dispatch a token request afterward", async () => {
    const started = deferred(), work = deferred(), owner = new AbortController();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const { discoverEndpoints, XaiService } = await import("../../src/lib/oauth/services/xai.js");
    const result = new XaiService().refreshAccessToken("fixture", { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort(new Error("discovery canceled"));
    work.reject(owner.signal.reason);
    expect(await result).toBe(owner.signal.reason);
    expect(signal).toBe(owner.signal);
    fetch.mockResolvedValue(new Response(JSON.stringify({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" })));
    expect((await discoverEndpoints()).tokenUrl).toBe("https://auth.x.ai/token");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("Kiro canceled token-body read does not dispatch follow-up profile discovery", async () => {
    const owner = new AbortController(), body = deferred(), reading = deferred();
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
    const fetch = vi.fn(async () => ({ ok: true, json: () => { reading.resolve(); return body.promise; } }));
    vi.stubGlobal("fetch", fetch);
    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const result = refreshKiroToken("fixture", {}, null, null, { signal: owner.signal }).catch(e => e);
    await reading.promise;
    owner.abort("gone");
    body.resolve({ accessToken: "late" });
    expect(await result).toBe("gone");
    await body.promise;
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.doUnmock("../../open-sse/utils/proxyFetch.js");
  });

  it("Kiro profile fetch receives cancellation and never returns a canceled profile", async () => {
    const started = deferred(), work = deferred(), owner = new AbortController();
    vi.stubGlobal("fetch", vi.fn((url, init) => { started.resolve(init.signal); return work.promise; }));
    const { fetchKiroProfileArn } = await import("../../src/lib/oauth/providerHelpers.js");
    const result = fetchKiroProfileArn("fixture", { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort("profile canceled");
    work.resolve(new Response(JSON.stringify({ profiles: [{ arn: "late-profile" }] })));
    expect(await result).toBe("profile canceled");
    expect(signal).toBe(owner.signal);
  });
});

describe("local rotating persistence", () => {
  async function loadLocal(latest = null) {
    const db = { getProviderConnectionById: vi.fn(async () => latest), updateProviderConnection: vi.fn(async () => ({ id: "account" })) };
    vi.doMock("../../src/lib/localDb.js", () => db);
    vi.doMock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
    return { db, mod: await import("../../src/sse/services/tokenRefresh.js") };
  }

  it("persists once for surviving/background owners, and cached reads do not persist again", async () => {
    const { db, mod } = await loadLocal();
    const work = deferred(), started = deferred(), owner = new AbortController();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const creds = { connectionId: "account", refreshToken: "old", accessToken: "expired", expiresAt: new Date(0).toISOString() };
    const first = mod.checkAndRefreshToken("codex", creds, { signal: owner.signal }).catch(e => e);
    const second = mod.checkAndRefreshToken("codex", creds);
    const signal = await started.promise;
    owner.abort("left");
    expect(await first).toBe("left");
    expect(signal.aborted).toBe(false);
    work.resolve(new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 })));
    expect((await second).refreshToken).toBe("rotated");
    expect((await mod.checkAndRefreshToken("codex", creds)).refreshToken).toBe("rotated");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("persists distinct refresh-token rotations with the same access token within the marker TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00.000Z"));
    let current = { connectionId: "account", accessToken: "expired", refreshToken: "R0", expiresAt: new Date(0).toISOString(), lastRefreshAt: new Date().toISOString() };
    const { db, mod } = await loadLocal();
    db.getProviderConnectionById.mockImplementation(async () => ({ ...current }));
    db.updateProviderConnection.mockImplementation(async (id, updates) => {
      current = { ...current, ...updates };
      return { id, ...current };
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "T", refresh_token: "R1", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "T", refresh_token: "R2", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetch);
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const attempts = Array.from({ length: 4 }, () => createAliasAttempt({ initialResponseTimeoutMs: 20000 }));
    const budgets = attempts.map(attempt => attempt.getAccountRecoveryBudget("codex:account"));
    const options = index => ({ force: true, signal: attempts[index].signal, recoveryBudget: budgets[index] });
    try {
      const firstInput = { ...current };
      expect((await mod.checkAndRefreshToken("codex", firstInput, options(0))).refreshToken).toBe("R1");
      expect(budgets[0].claimRefresh()).toBe(false);
      expect(current.refreshToken).toBe("R1");
      expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
      // Adopt R0's cached result while the DB still holds that same R1 generation.
      expect((await mod.checkAndRefreshToken("codex", firstInput, options(2))).refreshToken).toBe("R1");
      expect(budgets[2].claimRefresh()).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);

      const secondInput = { ...current };
      expect((await mod.checkAndRefreshToken("codex", secondInput, options(1))).refreshToken).toBe("R2");
      expect(budgets[1].claimRefresh()).toBe(false);
      expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).refresh_token)).toEqual(["R0", "R1"]);
      expect(db.updateProviderConnection).toHaveBeenCalledTimes(2);
      expect(current.refreshToken).toBe("R2");
      expect(current.accessToken).toBe("T");
      // Never replay the older R1 result over a DB already holding R2.
      expect((await mod.checkAndRefreshToken("codex", secondInput, options(3))).refreshToken).toBe("R2");
      expect(budgets[3].claimRefresh()).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(db.updateProviderConnection).toHaveBeenCalledTimes(2);
      expect(current.refreshToken).toBe("R2");
    } finally { attempts.forEach(attempt => attempt.dispose()); }
  });

  it("does not write credentials after the last remote owner cancels", async () => {
    const { db, mod } = await loadLocal();
    const started = deferred(), work = deferred(), owner = new AbortController();
    vi.stubGlobal("fetch", vi.fn((url, init) => { started.resolve(init.signal); return work.promise; }));
    const result = mod.checkAndRefreshToken("codex", { connectionId: "account", refreshToken: "old", expiresAt: new Date(0).toISOString() }, { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort("gone");
    expect(await result).toBe("gone");
    work.resolve(new Response(JSON.stringify({ access_token: "late", refresh_token: "late-rotation" })));
    await work.promise;
    expect(signal.aborted).toBe(true);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("adopts fresh DB credentials without using the concrete account allowance", async () => {
    const { db, mod } = await loadLocal({ refreshToken: "rotated", accessToken: "fresh", expiresAt: new Date(Date.now() + 86400000).toISOString(), lastRefreshAt: new Date().toISOString() });
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const budget = attempt.getAccountRecoveryBudget("codex:account");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      expect((await mod.checkAndRefreshToken("codex", { connectionId: "account", refreshToken: "old", expiresAt: new Date(0).toISOString() }, { signal: attempt.signal, recoveryBudget: budget })).accessToken).toBe("fresh");
      expect(budget.claimRefresh()).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(db.updateProviderConnection).not.toHaveBeenCalled();
    } finally { attempt.dispose(); }
  });
});

describe("shared project ownership", () => {
  it("preserves a second owner and caches only a live successful project", async () => {
    const mod = await import("../../open-sse/services/projectId.js"); mod.stopCacheCleanup();
    const owner = new AbortController(), work = deferred(), started = deferred();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const first = mod.getProjectIdForConnection("project", "fixture", "gemini-cli", { signal: owner.signal }).catch(e => e);
    const second = mod.getProjectIdForConnection("project", "fixture");
    const signal = await started.promise;
    owner.abort("left");
    expect(await first).toBe("left"); expect(signal.aborted).toBe(false);
    work.resolve(new Response(JSON.stringify({ cloudaicompanionProject: "real-project" })));
    expect(await second).toBe("real-project");
    expect(await mod.getProjectIdForConnection("project", "fixture")).toBe("real-project");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["remove", "expired"])("%s evicts ownership and a stale completion cannot repopulate cache", async lifecycle => {
    vi.useFakeTimers();
    const mod = await import("../../open-sse/services/projectId.js"); mod.stopCacheCleanup();
    const stale = deferred(), started = deferred();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return stale.promise; });
    vi.stubGlobal("fetch", fetch);
    const first = mod.getProjectIdForConnection("project", "fixture").catch(e => e);
    const signal = await started.promise;
    if (lifecycle === "remove") mod.removeConnection("project");
    else { vi.advanceTimersByTime(120001); mod.cleanupNow(); }
    expect(signal.aborted).toBe(true);
    expect(await first).toBe(signal.reason);
    fetch.mockResolvedValue(new Response(JSON.stringify({ cloudaicompanionProject: "new" })));
    expect(await mod.getProjectIdForConnection("project", "fixture")).toBe("new");
    stale.resolve(new Response(JSON.stringify({ cloudaicompanionProject: "stale" })));
    await stale.promise;
    expect(await mod.getProjectIdForConnection("project", "fixture")).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels onboard retry sleeps without another request or timer", async () => {
    vi.useFakeTimers();
    const mod = await import("../../open-sse/services/projectId.js"); mod.stopCacheCleanup();
    const owner = new AbortController(), sleeping = deferred();
    vi.spyOn(console, "log").mockImplementation(text => { if (text.includes("not done yet")) sleeping.resolve(); });
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValue(new Response(JSON.stringify({ done: false })));
    vi.stubGlobal("fetch", fetch);
    const result = mod.getProjectIdForConnection("project", "fixture", "gemini-cli", { signal: owner.signal }).catch(e => e);
    await sleeping.promise;
    owner.abort("sleep canceled");
    expect(await result).toBe("sleep canceled");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("remaining refresh boundaries", () => {
  it("Vertex bootstrap is preparation but replacing a cached session consumes its account allowance", async () => {
    vi.useFakeTimers();
    vi.doMock("jose", () => ({
      importPKCS8: vi.fn(async () => ({})),
      SignJWT: class { setProtectedHeader() { return this; } setIssuer() { return this; } setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } async sign() { return "fixture-jwt"; } },
    }));
    const { refreshVertexToken } = await import("../../open-sse/services/tokenRefresh.js");
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000000 });
    const budget = attempt.getAccountRecoveryBudget("vertex:account");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "minted", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetch);
    const sa = { client_email: "fixture@example.invalid", private_key: "fixture-key" };
    try {
      expect((await refreshVertexToken(sa, null, { signal: attempt.signal, recoveryBudget: budget })).accessToken).toBe("minted");
      expect(budget.claimRefresh()).toBe(true); // bootstrap did not claim
      vi.advanceTimersByTime(3600000);
      expect(await refreshVertexToken(sa, null, { signal: attempt.signal, recoveryBudget: budget })).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { attempt.dispose(); vi.doUnmock("jose"); }
  });

  it("Vertex cancellation reaches mint fetch and cannot publish a stale cache entry", async () => {
    vi.doMock("jose", () => ({
      importPKCS8: vi.fn(async () => ({})),
      SignJWT: class { setProtectedHeader() { return this; } setIssuer() { return this; } setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; } async sign() { return "fixture-jwt"; } },
    }));
    const { refreshVertexToken } = await import("../../open-sse/services/tokenRefresh.js");
    const started = deferred(), work = deferred(), owner = new AbortController();
    const fetch = vi.fn((url, init) => { started.resolve(init.signal); return work.promise; });
    vi.stubGlobal("fetch", fetch);
    const sa = { client_email: "fixture@example.invalid", private_key: "fixture-key" };
    const result = refreshVertexToken(sa, null, { signal: owner.signal }).catch(e => e);
    const signal = await started.promise;
    owner.abort("mint canceled");
    work.resolve(new Response(JSON.stringify({ access_token: "stale", expires_in: 3600 })));
    expect(await result).toBe("mint canceled");
    expect(signal.aborted).toBe(true);
    fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: "new", expires_in: 3600 })));
    expect((await refreshVertexToken(sa)).accessToken).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.doUnmock("jose");
  });

  it("MiniMax retains its 30s timeout while honoring shared ownership", async () => {
    const { refreshMiniMaxCodeToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const started = deferred();
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      started.resolve(init.signal);
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }));
    const result = refreshMiniMaxCodeToken("minimax-code", "fixture");
    const signal = await started.promise;
    timeout.abort(new DOMException("timed out", "TimeoutError"));
    expect(await result).toBeNull(); // ordinary timeout retains fail-open behavior
    expect(signal.aborted).toBe(true);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30000);
  });

  it("refreshWithRetry cancels its sleep before another callback", async () => {
    vi.useFakeTimers();
    const { refreshWithRetry } = await import("../../open-sse/services/tokenRefresh.js");
    const owner = new AbortController(), sleeping = deferred(), work = vi.fn(async () => null);
    const result = refreshWithRetry(work, 3, { debug: () => sleeping.resolve() }, { signal: owner.signal }).catch(e => e);
    await sleeping.promise;
    owner.abort("stop retry");
    expect(await result).toBe("stop retry");
    expect(vi.getTimerCount()).toBe(0);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("a pre-aborted unsupported provider is cancellation, not a null auth result", async () => {
    const { refreshAccessToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const owner = new AbortController(); owner.abort("before dispatch");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(refreshAccessToken("unknown", "fixture", {}, null, { signal: owner.signal })).rejects.toBe("before dispatch");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("ownership edge seams", () => {
  it("credential locks detach canceled owners and use a shared callback signal", async () => {
    const { withCredentialRefreshLock } = await import("../../open-sse/services/oauthCredentialManager.js");
    const owner = new AbortController(), work = deferred(); let signal;
    const first = withCredentialRefreshLock("codex", { connectionId: "account" }, s => { signal = s; return work.promise; }, { signal: owner.signal }).catch(e => e);
    const second = withCredentialRefreshLock("codex", { connectionId: "account" }, () => { throw new Error("duplicate"); });
    owner.abort("left lock");
    expect(await first).toBe("left lock"); expect(signal.aborted).toBe(false);
    work.resolve("rotated"); expect(await second).toBe("rotated");
  });

  it("a spent second owner cannot borrow an in-flight first owner's refresh allowance", async () => {
    const { refreshProviderCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");
    const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
    const first = createAliasAttempt({ initialResponseTimeoutMs: 1000 }), second = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const work = deferred(), started = deferred();
    const fetch = vi.fn(() => { started.resolve(); return work.promise; }); vi.stubGlobal("fetch", fetch);
    const creds = { connectionId: "account", refreshToken: "fixture" };
    const spent = second.getAccountRecoveryBudget("codex:account"); spent.claimRefresh();
    try {
      const result = refreshProviderCredentials("codex", creds, null, { signal: first.signal, recoveryBudget: first.getAccountRecoveryBudget("codex:account") });
      await started.promise;
      expect(await refreshProviderCredentials("codex", creds, null, { signal: second.signal, recoveryBudget: spent })).toBeNull();
      work.resolve(new Response(JSON.stringify({ access_token: "fresh" })));
      expect((await result).accessToken).toBe("fresh"); expect(fetch).toHaveBeenCalledTimes(1);
    } finally { first.dispose(); second.dispose(); }
  });

  it("xAI discovery propagates cancellation to token fetch after successful discovery", async () => {
    const owner = new AbortController(), tokenStarted = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" })))
      .mockImplementation((url, init) => { tokenStarted.resolve(init); return new Promise((resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true })); });
    vi.stubGlobal("fetch", fetch);
    const { XaiService } = await import("../../src/lib/oauth/services/xai.js");
    const result = new XaiService().refreshAccessToken("fixture", { signal: owner.signal }).catch(e => e);
    const init = await tokenStarted.promise; owner.abort("token canceled");
    expect(await result).toBe("token canceled"); expect(init.signal).toBe(owner.signal);
    expect(new URLSearchParams(init.body).get("grant_type")).toBe("refresh_token"); expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("repository persistence cancellation boundary", () => {
  async function loadBoundary() {
    const adapterReady = deferred(), adapterRequested = deferred();
    const row = {
      id: "account", provider: "codex", authType: "oauth", name: "Fixture", email: null,
      priority: 1, isActive: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({ accessToken: "expired", refreshToken: "old", providerSpecificData: { retained: true } }),
    };
    const db = { get: vi.fn(() => row), run: vi.fn(), transaction: vi.fn(fn => fn()) };
    const getAdapter = vi.fn(() => { adapterRequested.resolve(); return adapterReady.promise; });
    vi.doMock("../../src/lib/db/driver.js", () => ({ getAdapter }));
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    return { adapterReady, adapterRequested, db, getAdapter, repo };
  }

  async function loadLocalBoundary() {
    const boundary = await loadBoundary();
    const write = vi.spyOn(boundary.repo, "updateProviderConnection");
    // Keep the write real; the pre-refresh credential read is a lifecycle fixture.
    vi.doMock("../../src/lib/localDb.js", () => ({
      getProviderConnectionById: vi.fn(async () => null), updateProviderConnection: write,
    }));
    vi.doMock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
    return { ...boundary, write, mod: await import("../../src/sse/services/tokenRefresh.js") };
  }

  afterEach(() => {
    vi.doUnmock("../../src/lib/db/driver.js");
    vi.doUnmock("../../src/lib/localDb.js");
    vi.doUnmock("../../src/sse/utils/logger.js");
  });

  it("rejects cancellation after the adapter await before any transaction or write", async () => {
    const { adapterReady, adapterRequested, db, repo } = await loadBoundary();
    const owner = new AbortController(), reason = new Error("before transaction");
    const result = repo.updateProviderConnection("account", { accessToken: "fixture" }, { signal: owner.signal });
    const rejected = expect(result).rejects.toBe(reason);
    await adapterRequested.promise;
    owner.abort(reason);
    adapterReady.resolve(db);
    await rejected;
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it("rejects pre-aborted updates without requesting an adapter", async () => {
    const { db, getAdapter, repo, adapterReady } = await loadBoundary();
    adapterReady.resolve(db);
    const owner = new AbortController(), reason = { canceled: "before adapter" };
    owner.abort(reason);
    await expect(repo.updateProviderConnection("account", { accessToken: "fixture" }, { signal: owner.signal })).rejects.toBe(reason);
    expect(getAdapter).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it("preserves signal-less atomic merge, update payload and missing-row return", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00.000Z"));
    const { adapterReady, db, getAdapter, repo } = await loadBoundary();
    adapterReady.resolve(db);
    const result = await repo.updateProviderConnection("account", { accessToken: "fresh", refreshToken: "rotated" });
    expect(result).toEqual({
      id: "account", provider: "codex", authType: "oauth", name: "Fixture", email: null,
      priority: 1, isActive: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z",
      accessToken: "fresh", refreshToken: "rotated", providerSpecificData: { retained: true },
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledWith("SELECT * FROM providerConnections WHERE id = ?", ["account"]);
    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain("ON CONFLICT(id) DO UPDATE SET");
    expect(params).toEqual([
      "account", "codex", "oauth", "Fixture", null, 1, 1,
      JSON.stringify({ accessToken: "fresh", refreshToken: "rotated", providerSpecificData: { retained: true } }),
      "2026-01-01T00:00:00.000Z", "2026-10-12T00:00:00.000Z",
    ]);
    db.get.mockReturnValueOnce(null);
    expect(await repo.updateProviderConnection("missing", { accessToken: "unused" })).toBeNull();
    expect(getAdapter).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it("the local credential wrapper forwards cancellation to the real repository", async () => {
    const { adapterReady, adapterRequested, db, write, mod } = await loadLocalBoundary();
    const owner = new AbortController(), reason = new Error("local adapter canceled");
    const result = mod.updateProviderCredentials("account", { accessToken: "fresh", refreshToken: "rotated" }, { signal: owner.signal });
    const rejected = expect(result).rejects.toBe(reason);
    await adapterRequested.promise;
    owner.abort(reason);
    adapterReady.resolve(db);
    await rejected;
    expect(write).toHaveBeenCalledWith("account", { accessToken: "fresh", refreshToken: "rotated" }, { signal: owner.signal });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it("last persistence-owner cancellation prevents writes and does not publish a persisted marker", async () => {
    const { adapterReady, adapterRequested, db, write, mod } = await loadLocalBoundary();
    const owner = new AbortController(), reason = new Error("last persistence owner left");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetch);
    const creds = { connectionId: "account", accessToken: "expired", refreshToken: "old", expiresAt: new Date(0).toISOString() };
    const result = mod.checkAndRefreshToken("codex", creds, { signal: owner.signal }).catch(e => e);
    await adapterRequested.promise;
    const delegateResult = write.mock.results[0].value;
    const rejectedDelegate = expect(delegateResult).rejects.toBe(reason);
    owner.abort(reason);
    expect(await result).toBe(reason);
    adapterReady.resolve(db);
    await rejectedDelegate;
    const sharedSignal = write.mock.calls[0][2]?.signal;
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    expect(sharedSignal).not.toBe(owner.signal);
    expect(sharedSignal.aborted).toBe(true);
    expect(sharedSignal.reason).toBe(reason);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
    expect(creds.accessToken).toBe("expired");
    expect((await mod.checkAndRefreshToken("codex", creds)).refreshToken).toBe("rotated");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(["signaled", "signal-less"])("a surviving %s persistence owner commits once after another owner cancels", async ownership => {
    const { adapterReady, adapterRequested, db, write, mod } = await loadLocalBoundary();
    const owner = new AbortController(), survivor = ownership === "signaled" ? new AbortController() : null;
    const joined = deferred();
    const shared = await import("../../open-sse/utils/sharedOperation.js");
    const join = shared.joinSharedOperation;
    vi.spyOn(shared, "joinSharedOperation").mockImplementation((map, key, start, options) => {
      const result = join(map, key, start, options);
      if (key === JSON.stringify(["codex", "account", "fresh", "rotated"]) && options.signal === survivor?.signal) joined.resolve();
      return result;
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetch);
    const creds = { connectionId: "account", accessToken: "expired", refreshToken: "old", expiresAt: new Date(0).toISOString() };
    const first = mod.checkAndRefreshToken("codex", creds, { signal: owner.signal }).catch(e => e);
    await adapterRequested.promise;
    const second = mod.checkAndRefreshToken("codex", creds, survivor ? { signal: survivor.signal } : {});
    await joined.promise;
    owner.abort("individual owner left");
    expect(await first).toBe("individual owner left");
    const sharedSignal = write.mock.calls[0][2]?.signal;
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    expect(sharedSignal).not.toBe(owner.signal);
    expect(sharedSignal).not.toBe(survivor?.signal);
    expect(sharedSignal.aborted).toBe(false);
    adapterReady.resolve(db);
    expect((await second).refreshToken).toBe("rotated");
    expect((await mod.checkAndRefreshToken("codex", creds)).refreshToken).toBe("rotated");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(db.run.mock.calls[0][1][7]).refreshToken).toBe("rotated");
  });
});

describe("shared operation owners", () => {
  it("detaches one canceled owner without aborting the other", async () => {
    const { joinSharedOperation } = await import("../../open-sse/utils/sharedOperation.js");
    const map = new Map(), a = new AbortController(), b = new AbortController();
    const work = deferred();
    let sharedSignal;
    const start = vi.fn(signal => { sharedSignal = signal; return work.promise; });
    const first = joinSharedOperation(map, "account", start, { signal: a.signal }).catch(e => e);
    const second = joinSharedOperation(map, "account", start, { signal: b.signal });
    const reason = new Error("owner left");
    a.abort(reason);
    expect(await first).toBe(reason);
    expect(sharedSignal.aborted).toBe(false);
    work.resolve("rotated");
    expect(await second).toBe("rotated");
    expect(start).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(0);
  });

  it("aborts the last owner and ignores stale settlement after replacement", async () => {
    const { joinSharedOperation } = await import("../../open-sse/utils/sharedOperation.js");
    const map = new Map(), owner = new AbortController(), old = deferred(), fresh = deferred();
    let signal;
    const first = joinSharedOperation(map, "k", s => { signal = s; return old.promise; }, { signal: owner.signal }).catch(e => e);
    owner.abort("gone");
    expect(await first).toBe("gone");
    expect(signal.aborted).toBe(true);
    const second = joinSharedOperation(map, "k", () => fresh.promise);
    old.resolve("stale");
    await old.promise;
    expect(map.size).toBe(1);
    fresh.resolve("new");
    expect(await second).toBe("new");
  });

  it("retains a signal-less background owner and rejects pre-aborted callers without starting", async () => {
    const { joinSharedOperation } = await import("../../open-sse/utils/sharedOperation.js");
    const map = new Map(), owner = new AbortController(), work = deferred();
    let signal;
    const first = joinSharedOperation(map, "k", s => { signal = s; return work.promise; }, { signal: owner.signal }).catch(e => e);
    const background = joinSharedOperation(map, "k", () => { throw new Error("duplicate"); });
    owner.abort("left");
    expect(await first).toBe("left");
    expect(signal.aborted).toBe(false);
    const start = vi.fn();
    await expect(joinSharedOperation(map, "pre", start, { signal: owner.signal })).rejects.toBe("left");
    expect(start).not.toHaveBeenCalled();
    work.resolve("ok");
    expect(await background).toBe("ok");
  });
});

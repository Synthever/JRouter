import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { createServer } from "node:http";

const boundary = vi.hoisted(() => ({ proxyFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: boundary.proxyFetch }));
vi.mock("jose", () => ({
  importPKCS8: vi.fn(async () => ({})),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return "synthetic-assertion"; }
  },
}));
const attempts = [];
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function policy(timeout = 20000) {
  const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: timeout });
  attempts.push(attempt);
  const budget = attempt.getAccountRecoveryBudget("fixture");
  return { alias: true, attempt, recoveryBudget: { claimRefresh: vi.fn(() => budget.claimRefresh()) }, forceUpstreamStreaming: true };
}
function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 }));
}
beforeEach(() => {
  vi.resetModules();
  boundary.proxyFetch.mockReset();
  boundary.proxyFetch.mockImplementation(async () => new Response("data: {}\n\n"));
});
afterEach(() => {
  attempts.splice(0).forEach(attempt => attempt.dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mini(provider = "minimax-code") {
  const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");
  return new MinimaxCodeExecutor(provider);
}
describe("MiniMax refusal and delegated recovery", () => {
  it.each(["deadline", "null caller reason"])("cancels a pending native refusal reader promptly with %s despite pending cleanup", async mode => {
    const executor = await mini(), cleanup = deferred(), reading = deferred();
    const cancel = vi.fn(() => cleanup.promise);
    let controller;
    const body = new ReadableStream({ start(value) { controller = value; }, pull() { reading.resolve(); }, cancel });
    boundary.proxyFetch.mockResolvedValue(new Response(body, { status: 403 }));
    const executionOptions = await policy(mode === "deadline" ? 50 : 20000);
    const owner = new AbortController();
    let settled = false, outcome;
    const work = executor.execute({ model: "MiniMax-M3", body: { messages: [] }, stream: false,
      credentials: { accessToken: "fixture" }, signal: mode === "deadline" ? undefined : owner.signal, executionOptions,
    }).then(value => { settled = true; outcome = value; }, error => { settled = true; outcome = error; });
    await reading.promise;
    await turn();
    expect(body.locked).toBe(true);
    if (mode === "deadline") await new Promise(resolve => setTimeout(resolve, 90));
    else owner.abort(null);
    await turn();
    try {
      expect(settled).toBe(true);
      const reason = mode === "deadline" ? executionOptions.attempt.signal.reason : null;
      expect(outcome).toBe(reason);
      expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
      expect(body.locked).toBe(false);
      const requestSignal = boundary.proxyFetch.mock.calls[0][1].signal;
      expect(requestSignal.aborted).toBe(true);
      expect(getEventListeners(requestSignal, "abort")).toHaveLength(0);
      expect(getEventListeners(executionOptions.attempt.signal, "abort")).toHaveLength(0);
    } finally { cleanup.resolve(); if (!settled) controller.close(); await work; }
  });

  it.each(["minimax-code", "minimax-code-global"])("%s leaves admission to the real helper and keeps cache reuse/missing-token budgets", async provider => {
    const executor = await mini(provider), executionOptions = await policy();
    const fetch = vi.fn(async () => tokenResponse());
    vi.stubGlobal("fetch", fetch);
    const options = { signal: executionOptions.attempt.signal, recoveryBudget: executionOptions.recoveryBudget };
    expect(await executor.refreshCredentials({}, null, null, options)).toBeNull();
    expect(options.recoveryBudget.claimRefresh).not.toHaveBeenCalled();
    expect(await executor.refreshCredentials({ refreshToken: "fixture-refresh" }, null, null, options)).toMatchObject({ accessToken: "fresh", refreshToken: "rotated" });
    expect(options.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`https://account.minimax.${provider.endsWith("global") ? "io" : "cn"}/oauth2/token`);
    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("client_id")).toBe("mcode-public");
    expect((await executor.refreshCredentials({ refreshToken: "fixture-refresh" }, null, null, options)).accessToken).toBe("fresh");
    expect(options.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(1);
    expect(await executor.refreshCredentials({ refreshToken: "another-refresh" }, null, null, options)).toBeNull();
    expect(options.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    const owner = new AbortController(); owner.abort(null);
    await expect(executor.refreshCredentials({}, null, null, { signal: owner.signal })).rejects.toBeNull();
  });

  it("supplemental: keeps quota mappings, refusal headers and failed ordinary text fallback", async () => {
    const { normalizeQuotaResponse } = await import("../../open-sse/executors/minimax-code.js");
    const owner = new AbortController();
    for (const [status, text, expected] of [[402, '{"base_resp":{"status_msg":"credit exhausted"}}', 429], [403, "invalid token", 403], [429, "slow down", 429]]) {
      const result = await normalizeQuotaResponse(new Response(text, { status, headers: { "content-length": "10", "content-encoding": "gzip", "x-fixture": "retained" } }), owner.signal);
      expect(result.status).toBe(expected);
      expect(result.headers.get("content-length")).toBeNull();
      expect(result.headers.get("content-encoding")).toBeNull();
      expect(result.headers.get("x-fixture")).toBe("retained");
      expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
      if (expected === 429 && status === 402) expect((await result.json()).error.message).toBe("usage limit reached: credit exhausted");
      else expect(await result.text()).toBe(text);
    }
    const result = await normalizeQuotaResponse({ status: 403, headers: new Headers(), text: async () => { throw new Error("ordinary read failed"); } });
    expect(result.status).toBe(403);
    expect(await result.text()).toBe("");
  });

  it("supplemental: real Default generation forwards policy without draining successful streams", async () => {
    const executor = await mini(), executionOptions = await policy();
    const body = { messages: [{ role: "user", content: "hello" }] }, original = structuredClone(body);
    const response = new Response(new ReadableStream({ pull() {} }));
    boundary.proxyFetch.mockResolvedValue(response);
    const result = await executor.execute({ model: "MiniMax-M3", body, stream: false, credentials: { accessToken: "fixture" }, executionOptions });
    expect(result.response).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(JSON.parse(boundary.proxyFetch.mock.calls[0][1].body).stream).toBe(true);
    expect(boundary.proxyFetch.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
    expect(body).toEqual(original);
    await response.body.cancel();
  });
});

async function vertex(provider = "vertex") {
  const { VertexExecutor } = await import("../../open-sse/executors/vertex.js");
  return new VertexExecutor(provider);
}
const geminiBody = { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { temperature: 0.2 } };
const vertexCredentials = { accessToken: "fixture", providerSpecificData: { projectId: "fixture-project", location: "europe-west4" } };
describe("Vertex direct generation policy", () => {
  it.each(["vertex", "vertex-partner"])("%s forces only its own streaming surface and preserves ordinary three-argument dispatch", async provider => {
    const executor = await vertex(provider), executionOptions = await policy();
    const body = provider === "vertex" ? structuredClone(geminiBody) : { model: "publishers/meta/models/llama", messages: [{ role: "user", content: "hello" }], stream: false };
    const original = structuredClone(body), credentials = structuredClone(vertexCredentials);
    const result = await executor.execute({ model: "gemini-fixture", body, stream: false, credentials, executionOptions });
    const [url, init, proxy, options] = boundary.proxyFetch.mock.calls[0];
    expect(options).toEqual({ allowNetworkReplay: false });
    expect(proxy).toBeNull();
    expect(init.signal).toBe(executionOptions.attempt.signal);
    expect(init.headers.Authorization).toBe("Bearer fixture");
    expect(init.headers.Accept).toBe("text/event-stream");
    if (provider === "vertex") {
      expect(url).toBe("https://aiplatform.googleapis.com/v1/projects/fixture-project/locations/europe-west4/publishers/google/models/gemini-fixture:streamGenerateContent?alt=sse");
      expect(JSON.parse(init.body)).toEqual(original);
      expect(JSON.parse(init.body)).not.toHaveProperty("stream");
    } else {
      expect(url).toBe("https://aiplatform.googleapis.com/v1/projects/fixture-project/locations/global/endpoints/openapi/chat/completions");
      expect(JSON.parse(init.body)).toEqual({ ...original, stream: true });
    }
    expect(result).toEqual({ response: await boundary.proxyFetch.mock.results[0].value, url, headers: init.headers, transformedBody: JSON.parse(init.body) });
    expect(body).toEqual(original);
    expect(credentials).toEqual(vertexCredentials);
    await executor.execute({ model: "gemini-fixture", body: structuredClone(original), stream: false, credentials: structuredClone(vertexCredentials) });
    const [ordinaryUrl, ordinaryInit] = boundary.proxyFetch.mock.calls[1];
    expect(boundary.proxyFetch.mock.calls[1]).toHaveLength(3);
    expect(ordinaryInit.headers).not.toHaveProperty("Accept");
    expect(JSON.parse(ordinaryInit.body)).toEqual(original);
    if (provider === "vertex") expect(ordinaryUrl).toMatch(/:generateContent$/);
  });

  it("guards pre-aborted entry before project preparation or credential mutation", async () => {
    const executor = await vertex("vertex-partner"), executionOptions = await policy();
    const fetch = vi.fn(async () => tokenResponse()); vi.stubGlobal("fetch", fetch);
    executionOptions.attempt.abort("collection");
    await expect(executor.execute({ model: "fixture", body: {}, stream: false, credentials: { apiKey: "fixture-raw" }, executionOptions })).rejects.toBe(executionOptions.attempt.signal.reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
  });

  it("cancels a raw response arriving after caller cancellation without waiting for cleanup", async () => {
    const executor = await vertex(), executionOptions = await policy(), owner = new AbortController();
    const cancel = vi.fn(() => new Promise(() => {}));
    const response = new Response(new ReadableStream({ cancel }));
    boundary.proxyFetch.mockImplementation(async () => { owner.abort(null); return response; });
    await expect(executor.execute({ model: "fixture", body: structuredClone(geminiBody), stream: false, credentials: structuredClone(vertexCredentials), signal: owner.signal, executionOptions })).rejects.toBeNull();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(boundary.proxyFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

const adcCredentials = () => ({ apiKey: JSON.stringify({ type: "authorized_user", client_id: "synthetic-client", client_secret: "synthetic-secret", refresh_token: "synthetic-refresh", quota_project_id: "fixture-project" }) });
const saCredentials = () => ({ apiKey: JSON.stringify({ type: "service_account", client_email: "synthetic@fixture.invalid", private_key: "synthetic-signing-boundary", project_id: "fixture-project" }) });
async function pendingNativeJSON() {
  const nativeFetch = globalThis.fetch, reading = deferred(), closed = deferred();
  const server = createServer((req, res) => {
    req.resume();
    res.on("close", () => closed.resolve());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"pending":');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const fetch = vi.fn(async (url, init) => {
    const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/fixture`, init);
    const json = response.json.bind(response);
    vi.spyOn(response, "json").mockImplementation(() => { reading.resolve(); return json(); });
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, reading, closed, async close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

describe("Vertex preparation recovery and native cancellation", () => {
  it("ADC execute claims exactly once through the real Google helper, clones credentials and policy refresh reuses its result", async () => {
    const executor = await vertex(), executionOptions = await policy(), credentials = adcCredentials();
    const original = structuredClone(credentials), fetch = vi.fn(async () => tokenResponse());
    vi.stubGlobal("fetch", fetch);
    const result = await executor.execute({ model: "fixture", body: structuredClone(geminiBody), stream: false, credentials, executionOptions });
    expect(executionOptions.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(1);
    expect(credentials).toEqual(original);
    expect(result.headers.Authorization).toBe("Bearer fresh");
    expect(fetch.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(fetch.mock.calls[0][1].body)).toEqual({ grant_type: "refresh_token", refresh_token: "synthetic-refresh", client_id: "synthetic-client", client_secret: "synthetic-secret" });
    const options = { signal: executionOptions.attempt.signal, recoveryBudget: executionOptions.recoveryBudget };
    expect((await executor.refreshCredentials(credentials, null, null, options)).accessToken).toBe("fresh");
    expect(executionOptions.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const changed = JSON.parse(credentials.apiKey); changed.refresh_token = "another-refresh";
    expect(await executor.refreshCredentials({ apiKey: JSON.stringify(changed) }, null, null, options)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(executionOptions.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(2);
    expect(await executor.refreshCredentials(credentials)).toBeNull();
  });

  it.each(["ADC", "SA"])("%s deadline cancels actual pending native token JSON before credential mutation or generation", async kind => {
    const executor = await vertex(), executionOptions = await policy(150), credentials = kind === "ADC" ? adcCredentials() : saCredentials();
    const original = structuredClone(credentials), fixture = await pendingNativeJSON();
    let settled = false, outcome;
    const work = executor.execute({ model: "fixture", body: structuredClone(geminiBody), stream: false, credentials, executionOptions })
      .then(value => { settled = true; outcome = value; }, error => { settled = true; outcome = error; });
    try {
      await fixture.reading.promise;
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(settled).toBe(true);
      expect(outcome).toBe(executionOptions.attempt.signal.reason);
      expect(outcome.reason).toBe("initial-output-deadline");
      expect(fixture.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      await fixture.closed.promise;
      expect(credentials).toEqual(original);
      expect(boundary.proxyFetch).not.toHaveBeenCalled();
      expect(executionOptions.recoveryBudget.claimRefresh).toHaveBeenCalledTimes(kind === "ADC" ? 1 : 0);
    } finally { await fixture.close(); await work; }
  });

  it("SA bootstrap stays helper-owned, cache hits do not claim, expired replacement respects a denied budget", async () => {
    const executor = await vertex(), credentials = saCredentials(), owner = new AbortController();
    const recoveryBudget = { claimRefresh: vi.fn(() => false) }, fetch = vi.fn(async () => tokenResponse());
    vi.stubGlobal("fetch", fetch);
    const options = { signal: owner.signal, recoveryBudget };
    const result = await executor.refreshCredentials(credentials, null, null, options);
    expect(result.accessToken).toBe("fresh");
    expect(recoveryBudget.claimRefresh).not.toHaveBeenCalled();
    expect(await executor.refreshCredentials(credentials, null, null, options)).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 4000000);
    expect(await executor.refreshCredentials(credentials, null, null, options)).toBeNull();
    expect(recoveryBudget.claimRefresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    owner.abort(null);
    await expect(executor.refreshCredentials({}, null, null, options)).rejects.toBeNull();
  });

  it("raw partner probe binds actual native JSON to the attempt deadline without publishing canceled credentials", async () => {
    const executor = await vertex("vertex-partner"), executionOptions = await policy(150), fixture = await pendingNativeJSON();
    const credentials = { apiKey: "synthetic-probe" }, original = structuredClone(credentials);
    let settled = false, outcome;
    const work = executor.execute({ model: "fixture", body: { messages: [] }, stream: false, credentials, executionOptions })
      .then(value => { settled = true; outcome = value; }, error => { settled = true; outcome = error; });
    try {
      await fixture.reading.promise;
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(settled).toBe(true);
      expect(outcome).toBe(executionOptions.attempt.signal.reason);
      expect(fixture.fetch.mock.calls[0][1].signal).toBe(executionOptions.attempt.signal);
      expect(fixture.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      await fixture.closed.promise;
      expect(credentials).toEqual(original);
      expect(boundary.proxyFetch).not.toHaveBeenCalled();
    } finally { await fixture.close(); await work; }
  });

  it("a late probe JSON success after cancellation cannot fill the shared cache", async () => {
    const executor = await vertex("vertex-partner"), executionOptions = await policy(), reading = deferred(), json = deferred();
    const credentials = { apiKey: "synthetic-late-probe" }, original = structuredClone(credentials);
    const fetch = vi.fn(async () => ({ json: () => { reading.resolve(); return json.promise; } }));
    vi.stubGlobal("fetch", fetch);
    const work = executor.execute({ model: "fixture", body: { messages: [] }, stream: false, credentials, executionOptions }).catch(error => error);
    await reading.promise;
    executionOptions.attempt.abort("configuration");
    json.resolve({ error: { message: "projects/late-project/locations/global" } });
    expect(await work).toBe(executionOptions.attempt.signal.reason);
    expect(credentials).toEqual(original);
    expect(boundary.proxyFetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue({ json: async () => ({ error: { message: "projects/fresh-project/locations/global" } }) });
    const result = await executor.execute({ model: "fixture", body: { messages: [] }, stream: false, credentials: structuredClone(original) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.url).toContain("projects/fresh-project/");
  });
});

describe("CN per-call instruction preservation", () => {
  it("sends composed typed instructions unchanged only with the trusted option on the same executor", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const executor = new CodeBuddyExecutor(), executionOptions = await policy();
    const messages = [
      { role: "system", content: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI. " + "source instruction ".repeat(140) }, { type: "text", text: "alias instruction" }] },
      { role: "developer", content: [{ type: "text", text: "developer instruction" }] },
      { role: "user", content: "hello" },
    ];
    const body = { messages, reasoning_effort: "high", tools: [{ type: "function", function: { name: "fixture", parameters: { type: "object" } } }] };
    const original = structuredClone(body);
    await executor.execute({ model: "fixture", body, stream: false, credentials: { accessToken: "fixture" }, executionOptions: { ...executionOptions, preserveAliasInstructions: true } });
    const alias = JSON.parse(boundary.proxyFetch.mock.calls[0][1].body);
    expect(alias.messages).toEqual(messages);
    expect(alias.tools).toEqual(original.tools);
    expect(alias.reasoning_summary).toBe("auto");
    expect(alias.stream).toBe(true);
    expect(body).toEqual(original);
    const ordinary = { ...structuredClone(original), preserveAliasInstructions: true, executionOptions: { preserveAliasInstructions: true } };
    await executor.execute({ model: "fixture", body: ordinary, stream: false, credentials: { accessToken: "fixture" } });
    const payload = JSON.parse(boundary.proxyFetch.mock.calls[1][1].body);
    expect(payload.messages[0].content).toEqual([{ type: "text", text: "You are a helpful AI assistant that helps with software engineering tasks." }]);
    expect(payload.messages.slice(1)).toEqual(messages.slice(1));
    expect(boundary.proxyFetch.mock.calls[1]).toHaveLength(3);
  });
});

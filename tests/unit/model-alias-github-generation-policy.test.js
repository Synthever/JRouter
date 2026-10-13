import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";

const policy = { alias: true, retryPolicy: "single-attempt", allowNetworkReplay: false, forceUpstreamStreaming: true, preserveAliasInstructions: true };
const endpointError = "not accessible via the /chat/completions endpoint";
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise.then(value => ({ value })), new Promise(resolve => { timer = setTimeout(() => resolve({ stalled: true }), 80); })]); }
  finally { clearTimeout(timer); }
}
async function pipelineSettled() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function output(model) {
  const events = model.includes("claude")
    ? [{ type: "message_start", message: { id: "fixture", model, usage: { input_tokens: 2, output_tokens: 0 } } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ready" } }]
    : [{ type: "response.output_text.delta", delta: "ready" }];
  return new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
}
const request = (extra = {}) => ({ model: "gpt-5-fixture", body: { stream: false, messages: [{ role: "user", content: "hello" }] }, stream: false, credentials: { copilotToken: "synthetic" }, ...extra });
function executor(model) {
  const ex = new GithubExecutor();
  ex.config = { ...ex.config, retry: { 503: { attempts: 1, delayMs: 0 }, 502: { attempts: 1, delayMs: 0 } } };
  if (model && !model.includes("claude")) ex.knownCodexModels.add(model);
  return ex;
}
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async () => new Response("{}", { status: 503 })); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("GitHub per-call generation policy", () => {
  it("keeps actual chat alias failures single while ordinary body flags retain configured retries", async () => {
    vi.useFakeTimers();
    const ex = executor();
    const alias = ex.execute(request({ executionOptions: policy }));
    const ordinary = ex.execute(request({ body: { messages: [], _alias: true, retryPolicy: "single-attempt" } }));
    await vi.runAllTimersAsync();
    expect((await alias).response.status).toBe(503);
    expect((await ordinary).response.status).toBe(503);
    expect(fetchMock.mock.calls.filter(c => c.length === 4)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(c => c.length === 3)).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    const failure = Object.assign(new TypeError("ambiguous transport"), { cause: { code: "CERT_HAS_EXPIRED" } });
    fetchMock.mockReset().mockRejectedValue(failure);
    const run = ex.execute(request({ executionOptions: policy })).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await run).toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["gpt-5-codex-fixture", "claude-sonnet-fixture"])("%s direct route clones alias body and forces headers without losing translator fields", async model => {
    const ex = executor(model);
    const body = { stream: false, max_tokens: 64, messages: [{ role: "system", content: [{ type: "text", text: "instruction" }] }, { role: "user", content: [{ type: "text", text: "typed" }] }], tools: [{ type: "function", function: { name: "fixture.tool", parameters: { type: "object", properties: {} } } }] };
    const original = structuredClone(body);
    const proxyOptions = { strictProxy: true };
    const result = await ex.execute(request({ model, body, proxyOptions, executionOptions: policy }));
    const call = fetchMock.mock.calls[0];
    expect.soft(call.slice(2)).toEqual([proxyOptions, { allowNetworkReplay: false }]);
    expect.soft(call[1].headers.Accept).toBe("text/event-stream");
    const sent = JSON.parse(call[1].body);
    expect(sent.model).toBe(model);
    expect(sent.stream).toBe(true);
    expect(body).toEqual(original);
    if (model.includes("claude")) {
      expect(sent.max_tokens).toBe(32000);
      expect(sent.system[1].text).toBe("instruction");
      expect(sent.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
      expect(sent.tools[0].name).toBe("fixture.tool");
      expect(sent).not.toHaveProperty("_toolNameMap");
      expect.soft(result.transformedBody.tools[0].input_schema).not.toBe(body.tools[0].function.parameters);
    } else {
      expect(sent.max_output_tokens).toBe(64);
      expect(sent.instructions).toBe("instruction");
      expect(sent.tools[0].name).toBe("fixture.tool");
      expect.soft(result.transformedBody.tools[0].parameters).not.toBe(body.tools[0].function.parameters);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const status of [429, 401, 403, 404, 400]) {
      const rawResponse = new Response(status === 400 ? "unrelated bad request" : endpointError, { status });
      fetchMock.mockReset().mockResolvedValue(rawResponse);
      expect((await ex.execute(request({ model, executionOptions: policy }))).response).toBe(rawResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const failure = Object.assign(new TypeError("ambiguous TLS failure"), { cause: { code: "CERT_HAS_EXPIRED" } });
    fetchMock.mockReset().mockRejectedValue(failure);
    await expect(ex.execute(request({ model, executionOptions: policy }))).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("direct ordinary and independent single-attempt calls keep three args and JSON Accept; explicit false alone disables replay", async () => {
    const model = "gpt-5-codex-fixture", ex = executor(model);
    const calls = [undefined, { retryPolicy: "single-attempt" }, { allowNetworkReplay: false }];
    for (const executionOptions of calls) {
      await ex.execute(request({ model, executionOptions }));
    }
    expect(fetchMock.mock.calls.map(c => c.length)).toEqual([3, 3, 4]);
    expect(fetchMock.mock.calls[2][3]).toEqual({ allowNetworkReplay: false });
    expect(fetchMock.mock.calls.every(c => c[1].headers.Accept === "application/json")).toBe(true);
    expect(fetchMock.mock.calls.every(c => JSON.parse(c[1].body).stream === true)).toBe(true);
  });

  it("alias and independent single-attempt require endpoint evidence while ordinary generic unsupported still negotiates", async () => {
    for (const executionOptions of [policy, { retryPolicy: "single-attempt" }, undefined]) {
      fetchMock.mockReset().mockImplementation(async () => new Response("The requested model is not supported", { status: 400, headers: { "x-fixture": "intact" } }));
      const ex = executor();
      const result = await ex.execute(request({ executionOptions }));
      const ordinary = executionOptions === undefined;
      expect.soft(fetchMock).toHaveBeenCalledTimes(ordinary ? 2 : 1);
      expect.soft(ex.knownCodexModels.has("gpt-5-fixture")).toBe(ordinary);
      expect(result.response.status).toBe(400);
      expect(result.response.headers.get("x-fixture")).toBe("intact");
      expect(await result.response.text()).toBe("The requested model is not supported");
    }
  });

  it("explicit endpoint negotiation shares attempt/deadline, publishes only live route knowledge and selected 400 stays terminal", async () => {
    const ex = executor(), attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const deadline = attempt.deadlineAt;
    const budget = { claimRefresh: vi.fn(), claimRedispatch: vi.fn() };
    const executionOptions = { ...policy, attempt, recoveryBudget: budget };
    const direct = vi.spyOn(ex, "executeWithResponsesEndpoint");
    const body = request().body, original = structuredClone(body);
    fetchMock.mockImplementation(async () => new Response(endpointError, { status: 400 }));
    try {
      const result = await ex.execute(request({ body, executionOptions }));
      expect(result.response.status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(c => c[0])).toEqual([ex.config.baseUrl, ex.config.responsesUrl]);
      expect(fetchMock.mock.calls.every(c => c[3]?.allowNetworkReplay === false)).toBe(true);
      expect.soft(fetchMock.mock.calls[1][1].signal).toBe(attempt.signal);
      expect(direct.mock.calls[0][0].executionOptions).toBe(executionOptions);
      expect(attempt.deadlineAt).toBe(deadline);
      expect(attempt.outputStarted).toBe(false);
      expect(budget.claimRefresh).not.toHaveBeenCalled();
      expect(budget.claimRedispatch).not.toHaveBeenCalled();
      expect(body).toEqual(original);
      expect(ex.knownCodexModels.has("gpt-5-fixture")).toBe(true);
      await ex.execute(request({ executionOptions }));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][0]).toBe(ex.config.responsesUrl);
    } finally { attempt.dispose(); }
  });

  it("post-output descriptor, health probe and miscached Gemini never negotiate", async () => {
    for (const extra of [{ executionOptions: { ...policy, attempt: { outputStarted: true } } }, { executionOptions: policy, healthProbe: true }, { model: "gemini-fixture", executionOptions: policy }]) {
      const ex = executor();
      ex.knownCodexModels.add("gemini-fixture");
      fetchMock.mockReset().mockImplementation(async () => new Response(endpointError, { status: 400 }));
      const result = await ex.execute(request(extra));
      expect.soft(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(ex.config.baseUrl);
      expect(result.response.status).toBe(400);
      expect(await result.response.text()).toBe(endpointError);
    }
  });

  it("pending native negotiation inspection cancels owned reader with null and cannot publish a cached route", async () => {
    const owner = new AbortController(), reading = deferred(), cancel = vi.fn(() => new Promise(() => {}));
    const raw = new ReadableStream({ pull() { reading.resolve(); }, cancel }, { highWaterMark: 0 });
    fetchMock.mockResolvedValue(new Response(raw, { status: 400 }));
    const ex = executor();
    const run = ex.execute(request({ executionOptions: { ...policy, attempt: { signal: owner.signal } } })).catch(e => e);
    await reading.promise;
    owner.abort(null);
    const outcome = await bounded(run);
    expect.soft(outcome).toEqual({ value: null });
    expect.soft(cancel).toHaveBeenCalledWith(null);
    expect.soft(raw.locked).toBe(false);
    expect(ex.knownCodexModels.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continuously ready negotiation bytes cannot starve the existing initial deadline", async () => {
    vi.useFakeTimers();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10 });
    const cancel = vi.fn();
    let pulls = 0;
    const raw = new ReadableStream({ pull(controller) { pulls++; vi.setSystemTime(Date.now() + 3); controller.enqueue(new TextEncoder().encode(pulls === 1 ? endpointError : " ")); if (pulls === 10) controller.close(); }, cancel }, { highWaterMark: 0 });
    fetchMock.mockResolvedValue(new Response(raw, { status: 400 }));
    const ex = executor();
    try {
      const outcome = await ex.execute(request({ executionOptions: { ...policy, attempt } })).catch(e => e);
      expect.soft(outcome).toBe(attempt.signal.reason);
      expect.soft(attempt.signal.aborted).toBe(true);
      expect.soft(pulls).toBeLessThan(10);
      expect.soft(cancel).toHaveBeenCalledTimes(1);
      expect.soft(raw.locked).toBe(false);
      expect.soft(ex.knownCodexModels.size).toBe(0);
      expect.soft(fetchMock).toHaveBeenCalledTimes(1);
    } finally { attempt.dispose(); }
  });

  it.each(["gpt-5-codex-fixture", "claude-sonnet-fixture"])("%s preabort and late headers cancel without using the body or losing null", async model => {
    const ex = executor(model), owner = new AbortController();
    owner.abort(null);
    expect.soft(await ex.execute(request({ model, executionOptions: { ...policy, attempt: { signal: owner.signal } } })).catch(e => e)).toBeNull();
    expect.soft(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockReset();
    const late = new AbortController(), started = deferred(), work = deferred(), cancel = vi.fn(() => new Promise(() => {}));
    const raw = new ReadableStream({ cancel });
    fetchMock.mockImplementation((url, init) => { started.resolve(init.signal); return work.promise; });
    const run = ex.execute(request({ model, signal: late.signal, executionOptions: policy })).catch(e => e);
    const signal = await started.promise;
    late.abort(null);
    expect(signal.aborted).toBe(true);
    work.resolve(new Response(raw, { status: 400 }));
    expect.soft(await bounded(run)).toEqual({ value: null });
    expect.soft(cancel).toHaveBeenCalledWith(null);
    expect.soft(raw.locked).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["gpt-5-codex-fixture", "claude-sonnet-fixture"])("%s converted pending reader propagates request+attempt abort to native body and releases ownership", async model => {
    const ex = executor(model), requestOwner = new AbortController(), attemptOwner = new AbortController(), reading = deferred(), cancel = vi.fn();
    const raw = new ReadableStream({ pull() { reading.resolve(); }, cancel }, { highWaterMark: 0 });
    fetchMock.mockResolvedValue(new Response(raw));
    const result = await ex.execute(request({ model, signal: requestOwner.signal, executionOptions: { ...policy, attempt: { signal: attemptOwner.signal } } }));
    const reader = result.response.body.getReader();
    const pending = reader.read().then(value => ({ resolved: value }), error => ({ error }));
    await reading.promise;
    const source = model.includes("claude") ? requestOwner : attemptOwner;
    source.abort(null);
    expect.soft(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect.soft(await bounded(pending)).toEqual({ value: { error: null } });
    await pipelineSettled();
    expect.soft(cancel).toHaveBeenCalledWith(null);
    expect.soft(raw.locked).toBe(false);
    reader.releaseLock();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("post-fetch handoff guards cancellation before returning any HTTP body", async () => {
    for (const model of ["gpt-5-codex-fixture", "claude-sonnet-fixture", "gpt-5-fixture"]) {
      const owner = new AbortController(), cancel = vi.fn();
      const raw = new ReadableStream({ cancel });
      const response = new Response(raw, { status: 401 });
      fetchMock.mockReset().mockImplementation(() => {
        queueMicrotask(() => queueMicrotask(() => owner.abort(null)));
        return Promise.resolve(response);
      });
      const ex = executor(model.includes("codex") ? model : undefined);
      const outcome = await ex.execute(request({ model, signal: owner.signal, executionOptions: policy })).catch(e => e);
      expect.soft(outcome).toBeNull();
      expect.soft(cancel).toHaveBeenCalledWith(null);
      expect(raw.locked).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("ready error bytes yield to request cancellation before route publication", async () => {
    const owner = new AbortController(), cancel = vi.fn();
    let pulls = 0;
    const raw = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(pulls === 1 ? endpointError : " ")); if (pulls === 200) controller.close(); }, cancel }, { highWaterMark: 0 });
    fetchMock.mockResolvedValue(new Response(raw, { status: 400 }));
    const ex = executor();
    const timer = setTimeout(() => owner.abort(null), 0);
    try {
      const result = await ex.execute(request({ signal: owner.signal, executionOptions: policy })).catch(e => e);
      expect.soft(result).toBeNull();
      expect.soft(cancel).toHaveBeenCalledWith(null);
      expect.soft(pulls).toBeLessThan(200);
      expect.soft(raw.locked).toBe(false);
      expect.soft(ex.knownCodexModels.size).toBe(0);
      expect.soft(fetchMock).toHaveBeenCalledTimes(1);
    } finally { clearTimeout(timer); }
  });

  it("real converted output remains pull-driven and downstream cancellation reaches both native pipelines", async () => {
    for (const model of ["gpt-5-codex-fixture", "claude-sonnet-fixture"]) {
      const ex = executor(model), cancel = vi.fn();
      let sent = false;
      const raw = new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(output(model)); } }, cancel }, { highWaterMark: 0 });
      fetchMock.mockReset().mockResolvedValue(new Response(raw));
      const result = await ex.execute(request({ model, executionOptions: policy }));
      const reader = result.response.body.getReader();
      let text = "";
      while (!text.includes("ready")) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain("ready");
      expect(await bounded(reader.cancel("downstream"))).toEqual({ value: undefined });
      await pipelineSettled();
      expect(cancel).toHaveBeenCalledWith("downstream");
      expect(raw.locked).toBe(false);
      reader.releaseLock();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const model = "gpt-5-codex-fixture", ex = executor(model), failure = new Error("native stream failed");
    fetchMock.mockReset().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(failure); } })));
    const result = await ex.execute(request({ model, executionOptions: policy }));
    await expect(result.response.text()).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import { setImmediate as nextTurn } from "node:timers";

describe("GitHub Task6B3a N1/N2 regressions", () => {
  it("N1 observes the abort promise when the deadline crosses before the first inspection race", async () => {
    vi.useFakeTimers();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const cancel = vi.fn();
    const raw = new ReadableStream({ cancel });
    const response = new Response(raw, { status: 400 });
    const nativeGetReader = raw.getReader.bind(raw);
    const getReader = vi.spyOn(raw, "getReader").mockImplementation((...args) => {
      expect(attempt.signal.aborted).toBe(false);
      expect(Date.now()).toBeLessThan(attempt.deadlineAt);
      const reader = nativeGetReader(...args);
      vi.setSystemTime(attempt.deadlineAt);
      return reader;
    });
    fetchMock.mockResolvedValueOnce(response);
    const ex = executor();
    const unhandled = [];
    const onUnhandled = reason => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const outcome = await ex.execute(request({ executionOptions: { ...policy, attempt } })).then(
        value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason })
      );
      expect(outcome.state).toBe("rejected");
      expect(outcome.reason).toBe(attempt.signal.reason);
      expect(attempt.signal.aborted).toBe(true);
      expect(attempt.signal.reason.reason).toBe("initial-output-deadline");
      await new Promise(resolve => nextTurn(resolve));
      expect.soft(unhandled).toEqual([]);
      expect(getReader).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledExactlyOnceWith(attempt.signal.reason);
      expect(raw.locked).toBe(false);
      expect(ex.knownCodexModels.size).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
      attempt.dispose();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("N2 rejects the outer Base chat handoff with null and cancels the unused HTTP body without waiting", async () => {
    const owner = new AbortController(), cancel = vi.fn(() => new Promise(() => {}));
    const raw = new ReadableStream({ cancel });
    const response = new Response(raw, { status: 401 });
    fetchMock.mockImplementationOnce(() => {
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => owner.abort(null))));
      return Promise.resolve(response);
    });
    const ex = executor();
    const settled = ex.execute(request({ signal: owner.signal, executionOptions: policy })).then(
      value => ({ state: "fulfilled", value }), reason => ({ state: "rejected", reason })
    );
    const outcome = await bounded(settled);
    expect(outcome).not.toHaveProperty("stalled");
    expect(owner.signal.aborted).toBe(true);
    expect(owner.signal.reason).toBe(null);
    expect(outcome.value.state).toBe("rejected");
    expect(outcome.value.reason).toBe(owner.signal.reason);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(raw.locked).toBe(false);
    expect(ex.knownCodexModels.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

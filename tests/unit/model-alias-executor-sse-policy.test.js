import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/translator/concerns/image.js", () => ({ fetchImageAsBase64: vi.fn() }));

const encoder = new TextEncoder();
const attempts = [];
const sse = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const nd = (event) => `${JSON.stringify(event)}\n`;
const overload = sse({ type: "error", error: { code: "server_is_overloaded", message: "server_is_overloaded" } });
const commandError = nd({ type: "error", error: { statusCode: 503, message: "overloaded", type: "server_error" } });
function alias(timeout = 1000) {
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: timeout });
  attempts.push(attempt);
  return { alias: true, attempt, retryPolicy: "single-attempt", allowNetworkReplay: false, forceUpstreamStreaming: true };
}
function args(executionOptions = null, signal) {
  return { model: "gpt-5.5", body: { model: "gpt-5.5", input: "hi", messages: [] }, stream: false, credentials: {}, executionOptions, signal };
}
function response(text) {
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}
async function settled(promise) {
  return promise.then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
}

beforeEach(() => { proxyAwareFetch.mockReset(); fetchImageAsBase64.mockReset(); });
afterEach(() => { for (const attempt of attempts.splice(0)) attempt.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function controlled(prefix = "") {
  let controller;
  const cancel = vi.fn(() => new Promise(() => {}));
  const body = new ReadableStream({ start(c) { controller = c; if (prefix) c.enqueue(encoder.encode(prefix)); }, cancel });
  return { response: new Response(body, { headers: { "content-type": "text/event-stream" } }), body, cancel, push(text) { controller.enqueue(encoder.encode(text)); }, close() { controller.close(); } };
}
async function boundary() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

const providers = [["CommandCode", CommandCodeExecutor, nd({ type: "text-delta", text: "hello" })], ["Codex", CodexExecutor, sse({ type: "response.output_text.delta", delta: "hello" })]];

describe("inspection readiness and reader ownership", () => {
  it("both executors latch complete output before EOF and keep replay cancellable after deadline", async () => {
    vi.useFakeTimers();
    for (const [, Executor, text] of providers) {
      const options = alias(100);
      const request = new AbortController();
      const add = vi.spyOn(options.attempt.signal, "addEventListener");
      const remove = vi.spyOn(options.attempt.signal, "removeEventListener");
      const source = controlled(text);
      proxyAwareFetch.mockResolvedValue(source.response);
      const result = await new Executor().execute(args(options, request.signal));
      expect(options.attempt.outputStarted).toBe(true);
      await vi.advanceTimersByTimeAsync(101);
      expect(options.attempt.signal.aborted).toBe(false);
      const readResult = settled(result.response.text());
      request.abort(null);
      expect(await readResult).toEqual({ status: "rejected", reason: null });
      expect(source.cancel).toHaveBeenCalledWith(null);
      expect(source.body.locked).toBe(false);
      expect(add).toHaveBeenCalled();
      for (const [type, listener] of add.mock.calls) expect(remove.mock.calls.some(call => call[0] === type && call[1] === listener)).toBe(true);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      proxyAwareFetch.mockClear();
    }
  });

  it("both executors cancel pending inspection with original null reason without awaiting source cleanup", async () => {
    for (const [, Executor] of providers) {
      const request = new AbortController();
      const source = controlled();
      proxyAwareFetch.mockResolvedValue(source.response);
      const pending = settled(new Executor().execute(args(alias(), request.signal)));
      await boundary(); request.abort(null);
      expect(await pending).toEqual({ status: "rejected", reason: null });
      expect(source.cancel).toHaveBeenCalledWith(null);
      expect(source.body.locked).toBe(false);
    }
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("both executors ignore empty/malformed/finish frames and enforce elapsed deadline on ready reads", async () => {
    for (const [, Executor] of providers) {
      const options = alias(1000);
      let count = 0;
      const cancel = vi.fn();
      const metadata = Executor === CommandCodeExecutor
        ? nd({ type: "text-delta", text: "" }) + nd({ type: "tool-input-start", id: "bad" }) + nd({ type: "tool-input-delta", id: "bad", delta: "{}" }) + nd({ type: "tool-call", toolCallId: "malformed", input: {} }) + nd({ type: "finish" })
        : sse({ type: "response.output_text.delta", delta: "" }) + sse({ type: "response.completed", response: { output: [] } });
      const body = new ReadableStream({ pull(c) { if (++count === 3) vi.spyOn(Date, "now").mockReturnValue(options.attempt.deadlineAt + 1); c.enqueue(encoder.encode(metadata)); }, cancel });
      proxyAwareFetch.mockResolvedValue(new Response(body, { headers: { "content-type": Executor === CommandCodeExecutor ? "application/x-ndjson" : "text/event-stream" } }));
      const outcome = await settled(new Executor().execute(args(options)));
      expect(outcome.status).toBe("rejected");
      expect(outcome.reason.reason).toBe("initial-output-deadline");
      expect(options.attempt.outputStarted).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    }
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("both executors pass the attempt signal into the native generation request", async () => {
    for (const [, Executor] of providers) {
      const options = alias();
      proxyAwareFetch.mockResolvedValue(response(Executor === CommandCodeExecutor ? nd({ type: "text-delta", text: "ready" }) : sse({ type: "response.output_text.delta", delta: "ready" })));
      const result = await new Executor().execute(args(options));
      const signal = proxyAwareFetch.mock.calls[0][1].signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal).not.toBe(options.attempt.signal);
      expect(signal.aborted).toBe(false);
      expect(options.attempt.outputStarted).toBe(true);
      await result.response.body.cancel("test cleanup");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      proxyAwareFetch.mockClear();
    }
  });

  it("Codex parses split multiline semantic frames before errors and replays every byte once", async () => {
    const options = alias();
    const prefix = 'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"server_is_overloaded is content"}\r\n';
    const source = controlled(prefix);
    proxyAwareFetch.mockResolvedValue(source.response);
    const pending = new CodexExecutor().execute(args(options));
    await boundary();
    expect(options.attempt.outputStarted).toBe(false);
    source.push("\r\n" + overload); source.close();
    const result = await pending;
    expect(options.attempt.outputStarted).toBe(true);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe(prefix + "\r\n" + overload);
    expect(source.body.locked).toBe(false);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("CommandCode removes inspection signal listeners at upstream EOF", async () => {
    const options = alias();
    const add = vi.spyOn(options.attempt.signal, "addEventListener");
    const remove = vi.spyOn(options.attempt.signal, "removeEventListener");
    proxyAwareFetch.mockResolvedValue(response(nd({ type: "text-delta", text: "done" })));
    const result = await new CommandCodeExecutor().execute(args(options));
    expect(options.attempt.outputStarted).toBe(true);
    await result.response.body.cancel("test cleanup");
    for (const [type, listener] of add.mock.calls) expect(remove.mock.calls.some(call => call[0] === type && call[1] === listener)).toBe(true);
  });

  it("CommandCode translates tool state once and preserves later terminal error without retry", async () => {
    const options = alias();
    const packet = nd({ type: "tool-input-start", id: "tool", toolName: "search" }) + nd({ type: "tool-input-delta", id: "tool", delta: '{"q":1}' }) + commandError;
    proxyAwareFetch.mockResolvedValue(response(packet));
    const result = await new CommandCodeExecutor().execute(args(options));
    expect(options.attempt.outputStarted).toBe(true);
    expect(result.response.status).toBe(200);
    await expect(result.response.text()).rejects.toThrow("CommandCode error");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const nextOptions = alias();
    proxyAwareFetch.mockResolvedValue(response(packet.replace(commandError, nd({ type: "finish", finishReason: "tool-calls" }))));
    const next = await new CommandCodeExecutor().execute(args(nextOptions));
    const events = (await next.response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const calls = events.flatMap(event => event.choices[0].delta.tool_calls || []);
    expect(calls.filter(call => call.function.name === "search")).toHaveLength(1);
    expect(calls.map(call => call.function.arguments).join("")).toBe('{"q":1}');
  });

  it("both protocols latch real reasoning/refusal/function output and release EOF listeners", async () => {
    for (const [Executor, event, encode] of [
      [CommandCodeExecutor, { type: "reasoning-delta", text: "think" }, nd],
      [CodexExecutor, { type: "response.reasoning_summary_text.delta", delta: "think" }, sse],
      [CodexExecutor, { type: "response.refusal.delta", delta: "no" }, sse],
      [CodexExecutor, { type: "response.output_item.added", item: { type: "function_call", name: "search", arguments: "" } }, sse],
    ]) {
      const options = alias();
      const add = vi.spyOn(options.attempt.signal, "addEventListener");
      const remove = vi.spyOn(options.attempt.signal, "removeEventListener");
      const original = response(encode(event));
      proxyAwareFetch.mockResolvedValue(original);
      const result = await new Executor().execute(args(options));
      expect(options.attempt.outputStarted).toBe(true);
      await result.response.text();
      expect(original.body.locked).toBe(false);
      for (const [type, listener] of add.mock.calls) expect(remove.mock.calls.some(call => call[0] === type && call[1] === listener)).toBe(true);
    }
  });
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function imageBody() { return { model: "gpt-5.5", input: [{ role: "user", content: [{ type: "image_url", image_url: "https://synthetic.invalid/image" }] }] }; }

describe("concrete preparation and refresh delegates", () => {
  it("both executors preabort before generation or image acquisition", async () => {
    for (const [, Executor] of providers) {
      const request = new AbortController(); request.abort(null);
      const call = args(alias(), request.signal); call.body = imageBody();
      const before = structuredClone(call.body);
      expect(await settled(new Executor().execute(call))).toEqual({ status: "rejected", reason: null });
      expect(call.body).toEqual(before);
    }
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("Codex owns entry image body and forwards combined signal; canceled late image never dispatches", async () => {
    const request = new AbortController();
    const options = alias();
    const call = args(options, request.signal); call.body = imageBody();
    const before = structuredClone(call.body);
    const work = deferred();
    fetchImageAsBase64.mockReturnValue(work.promise);
    const executor = new CodexExecutor();
    const pending = settled(executor.execute(call));
    await boundary();
    const imageOptions = fetchImageAsBase64.mock.calls[0][1];
    expect(imageOptions.signal).toBeInstanceOf(AbortSignal);
    options.attempt.abort("collection");
    expect(imageOptions.signal.aborted).toBe(true);
    work.resolve({ url: "data:image/png;base64,fixture" });
    expect((await pending).status).toBe("rejected");
    expect(call.body).toEqual(before);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    fetchImageAsBase64.mockResolvedValue(null);
    const ordinary = args(); ordinary.body = imageBody();
    proxyAwareFetch.mockResolvedValue(response(sse({ type: "response.output_text.delta", delta: "ok" })));
    const result = await executor.execute(ordinary);
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).input[0].content[0]).toEqual({ type: "input_image", image_url: "https://synthetic.invalid/image", detail: "auto" });
    await result.response.text();
  });

  it("Codex actual refresh producer owns one shared-account claim and denied second acquisition", async () => {
    const options = alias();
    const budget = options.attempt.getAccountRecoveryBudget("codex:one");
    const claim = vi.fn(() => budget.claimRefresh());
    const nativeFetch = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", nativeFetch);
    const executor = new CodexExecutor();
    const credentials = { refreshToken: "task6b1-failed", connectionId: "fixture" };
    const refreshOptions = { signal: options.attempt.signal, recoveryBudget: { claimRefresh: claim } };
    expect(await executor.refreshCredentials(credentials, null, null, refreshOptions)).toBeNull();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(await executor.refreshCredentials(credentials, null, null, refreshOptions)).toBeNull();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    nativeFetch.mockResolvedValue(new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated" })));
    const freshBudget = options.attempt.getAccountRecoveryBudget("codex:two");
    const fresh = await executor.refreshCredentials({ refreshToken: "task6b1-success" }, null, null, { signal: options.attempt.signal, recoveryBudget: freshBudget });
    expect(fresh.accessToken).toBe("fresh");
    expect(freshBudget.claimRefresh()).toBe(false);
  });

  it("Codex refresh forwards preabort and prevents canceled pending body or late publication", async () => {
    const executor = new CodexExecutor();
    const request = new AbortController(); request.abort(null);
    const claim = vi.fn(() => true);
    const nativeFetch = vi.fn(); vi.stubGlobal("fetch", nativeFetch);
    const opts = { signal: request.signal, recoveryBudget: { claimRefresh: claim } };
    expect(await settled(executor.refreshCredentials({ refreshToken: "task6b1-preabort" }, null, null, opts))).toEqual({ status: "rejected", reason: null });
    expect(await executor.refreshCredentials({}, null, null, { recoveryBudget: { claimRefresh: claim } })).toBeNull();
    expect(nativeFetch).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
    const active = new AbortController();
    const source = controlled();
    const log = { info: vi.fn(), error: vi.fn() };
    let nativeSignal;
    nativeFetch.mockImplementation(async (_url, init) => {
      nativeSignal = init.signal;
      return { ok: true, async json() {
        const reader = source.body.getReader();
        const onAbort = () => { void reader.cancel(init.signal.reason).catch(() => {}); reader.releaseLock(); };
        init.signal.addEventListener("abort", onAbort, { once: true });
        try { await reader.read(); init.signal.throwIfAborted(); return {}; }
        finally { init.signal.removeEventListener("abort", onAbort); if (source.body.locked) reader.releaseLock(); }
      } };
    });
    const pending = settled(executor.refreshCredentials({ refreshToken: "task6b1-body" }, log, null, { signal: active.signal }));
    await boundary(); active.abort(null);
    expect(await pending).toEqual({ status: "rejected", reason: null });
    expect(nativeSignal.aborted).toBe(true);
    expect(log.info).not.toHaveBeenCalled();
    const late = new AbortController();
    nativeFetch.mockResolvedValue({ ok: true, async json() { late.abort("late"); return { access_token: "stale" }; } });
    expect(await settled(executor.refreshCredentials({ refreshToken: "task6b1-late" }, log, null, { signal: late.signal }))).toEqual({ status: "rejected", reason: "late" });
    expect(log.info).not.toHaveBeenCalled();
  });

  it("inspection preserves null cancellation over masked reader failure for both executors", async () => {
    for (const [, Executor] of providers) {
      const request = new AbortController();
      const source = controlled();
      const bodyReader = source.body.getReader.bind(source.body);
      vi.spyOn(source.body, "getReader").mockImplementation(() => {
        const reader = bodyReader();
        const read = reader.read.bind(reader);
        reader.read = () => { const pending = read(); request.abort(null); return pending.then(() => { throw new Error("masked"); }); };
        return reader;
      });
      proxyAwareFetch.mockResolvedValue(source.response);
      expect(await settled(new Executor().execute(args(alias(), request.signal)))).toEqual({ status: "rejected", reason: null });
      expect(source.cancel).toHaveBeenCalledWith(null);
      expect(source.body.locked).toBe(false);
    }
  });

  it("Codex capacity remains 503 and bounded no-output peek keeps cancellation ownership", async () => {
    const executor = new CodexExecutor();
    const capacity = "Selected model is at capacity. Please try a different model.";
    proxyAwareFetch.mockResolvedValue(response(sse({ type: "error", error: { message: capacity } })));
    const failed = await executor.execute(args(alias()));
    expect(failed.response.status).toBe(503);
    expect((await failed.response.json()).error.message).toBe(capacity);
    const options = alias();
    const source = controlled(":" + "x".repeat(256 * 1024) + "\n\n");
    proxyAwareFetch.mockResolvedValue(source.response);
    const result = await executor.execute(args(options));
    expect(options.attempt.outputStarted).toBe(false);
    await result.response.body.cancel("consumer");
    expect(source.cancel).toHaveBeenCalledWith("consumer");
    expect(source.body.locked).toBe(false);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});

describe("ordinary cancellation compatibility", () => {
  it("both executors cancel ordinary retries without scheduling sleeps", async () => {
    vi.useFakeTimers();
    for (const [Executor, error] of [[CommandCodeExecutor, commandError], [CodexExecutor, overload]]) {
      const request = new AbortController();
      const executor = new Executor();
      executor.config = { ...executor.config, retry: { ...executor.config.retry, 503: { attempts: 1, delayMs: 10 } } };
      proxyAwareFetch.mockImplementation(async () => response(error));
      const call = args(null, request.signal);
      call.log = { debug() { request.abort(null); } };
      const pending = settled(executor.execute(call));
      await boundary();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(3100);
      expect(await pending).toEqual({ status: "rejected", reason: null });
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      proxyAwareFetch.mockClear();
    }
  });

});

describe("real SSE execute retry layers", () => {
  it("both aliases preserve real early 503 status/message and dispatch once", async () => {
    for (const [, Executor] of providers) {
      const executor = new Executor();
      proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: "synthetic unavailable" } }), { status: 503 }));
      const result = await executor.execute(args(alias()));
      expect(result.response.status).toBe(503);
      expect(await result.response.text()).toContain("synthetic unavailable");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      expect(proxyAwareFetch.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
      expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).stream).toBe(true);
      expect(proxyAwareFetch.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
      proxyAwareFetch.mockClear();
    }
  });

  it.each([["CommandCode", CommandCodeExecutor, commandError, 3], ["Codex", CodexExecutor, overload, 2]])("%s isolates simultaneous alias and ordinary dispatch policies", async (_, Executor, error, ordinaryCount) => {
    vi.useFakeTimers();
    const executor = new Executor();
    executor.config = { ...executor.config, retry: { ...executor.config.retry, 503: { attempts: 1, delayMs: 10 } } };
    const options = alias(10000);
    const source = args(options);
    const before = structuredClone(source.body);
    proxyAwareFetch.mockImplementation(async () => response(error));
    const aliasCall = executor.execute(source);
    const ordinaryArgs = args(); ordinaryArgs.body.marker = "ordinary";
    const ordinaryCall = executor.execute(ordinaryArgs);
    await vi.advanceTimersByTimeAsync(3100);
    const [a, o] = await Promise.all([aliasCall, ordinaryCall]);
    expect(a.response.status).toBe(503); expect(o.response.status).toBe(503);
    const aliasFetches = proxyAwareFetch.mock.calls.filter(call => call[3]?.allowNetworkReplay === false);
    const ordinaryFetches = proxyAwareFetch.mock.calls.filter(call => call.length === 3);
    expect(aliasFetches).toHaveLength(1); expect(ordinaryFetches).toHaveLength(ordinaryCount);
    expect(JSON.parse(aliasFetches[0][1].body).stream).toBe(true);
    expect(aliasFetches[0][1].headers.Accept).toBe("text/event-stream");
    expect(source.body).toEqual(before);
    expect(await a.response.text()).toContain("overloaded");
  });

  it.each([["CommandCode", CommandCodeExecutor, commandError], ["Codex", CodexExecutor, overload]])("%s independent single-attempt descriptor suppresses only extra retry", async (_, Executor, error) => {
    vi.useFakeTimers();
    proxyAwareFetch.mockImplementation(async () => response(error));
    const executor = new Executor();
    executor.config = { ...executor.config, retry: { ...executor.config.retry, 503: { attempts: 1, delayMs: 10 } } };
    const pending = executor.execute(args({ retryPolicy: "single-attempt" }));
    await vi.advanceTimersByTimeAsync(3100);
    const result = await pending;
    expect(result.response.status).toBe(503);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0]).toHaveLength(3);
  });
});

describe("Codex semantic alias raw SSE errors and mixed delimiters", () => {
  it.each([
    ["overload", "server_is_overloaded"],
    ["capacity", "selected model is at capacity"],
  ])("maps non-JSON event:error %s payload to 503 once", async (_, payload) => {
    const source = controlled(`event: error\ndata: ${payload}\n\n`);
    source.close();
    proxyAwareFetch.mockResolvedValue(source.response);
    const result = await new CodexExecutor().execute(args(alias()));
    expect(result.response.status).toBe(503);
    expect((await result.response.json()).error.message.toLowerCase()).toContain(payload);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves user-visible overload keywords in semantic output", async () => {
    const text = sse({ type: "response.output_text.delta", delta: "server_is_overloaded is literal user-visible text" });
    const source = controlled(text);
    source.close();
    proxyAwareFetch.mockResolvedValue(source.response);
    const options = alias();
    const result = await new CodexExecutor().execute(args(options));
    expect(result.response.status).toBe(200);
    expect(options.attempt.outputStarted).toBe(true);
    expect(await result.response.text()).toBe(text);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["LF+CR", "\n\r"],
    ["CRLF+CR", "\r\n\r"],
  ])("parses %s blank separators across chunk boundaries", async (_, delimiter) => {
    const outputPrefix = `event: response.output_text.delta\r\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "ready" })}`;
    const outputSource = controlled(outputPrefix + delimiter.slice(0, -1));
    proxyAwareFetch.mockResolvedValue(outputSource.response);
    const outputOptions = alias();
    const outputPending = new CodexExecutor().execute(args(outputOptions));
    await boundary();
    outputSource.push(delimiter.slice(-1) + overload);
    outputSource.close();
    const outputResult = await outputPending;
    expect(outputOptions.attempt.outputStarted).toBe(true);
    expect(outputResult.response.status).toBe(200);
    expect(await outputResult.response.text()).toBe(outputPrefix + delimiter + overload);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

    proxyAwareFetch.mockClear();
    const rawError = `event: error\r\ndata: server_is_overloaded${delimiter}`;
    const errorSource = controlled(rawError.slice(0, -1));
    proxyAwareFetch.mockResolvedValue(errorSource.response);
    const errorPending = new CodexExecutor().execute(args(alias()));
    await boundary();
    errorSource.push(rawError.slice(-1));
    errorSource.close();
    const errorResult = await errorPending;
    expect(errorResult.response.status).toBe(503);
    expect((await errorResult.response.json()).error.message).toContain("server_is_overloaded");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => {
  const fetch = vi.fn();
  globalThis.fetch = fetch;
  return { success: vi.fn(), logger: vi.fn(), fetch };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveUsage: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: (...args) => lifecycle.logger(...args),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");
const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");
const { createSSEStream } = await import("../../open-sse/utils/stream.js");

const encoder = new TextEncoder();
const attempts = [];
const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), line: vi.fn(), errorLine: vi.fn() };
const chat = (delta, finish_reason = null) => ({ id: "chatcmpl-fixture", model: "actual-model", choices: [{ index: 0, delta, finish_reason }] });
const frame = (event, newline = "\n") => `data: ${JSON.stringify(event)}${newline}${newline}`;
const complete = () => new Response(JSON.stringify({ model: "actual-model", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
function controlled(contentType = "text/event-stream") {
  let controller;
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(c) { controller = c; }, cancel });
  return { response: new Response(stream, { headers: contentType ? { "content-type": contentType } : {} }),
    send: (text) => controller.enqueue(typeof text === "string" ? encoder.encode(text) : text),
    close: () => controller.close(), fail: (error) => controller.error(error), cancel };
}
async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
function options(overrides = {}) {
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 15000 });
  attempts.push(attempt);
  return { alias: true, attempt, recoveryBudget: attempt.getAccountRecoveryBudget("fixture"), forceUpstreamStreaming: true, ...overrides };
}
function request(executionOptions = options(), overrides = {}) {
  return handleChatCore({ body: { model: "virtual", stream: true, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "openai-compatible-chat-fixture", model: "fixture" },
    credentials: { apiKey: "fixture-only", providerSpecificData: { baseUrl: "http://127.0.0.1:20388/v1" } },
    executionOptions, log, onRequestSuccess: lifecycle.success, ...overrides });
}
beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.logger.mockImplementation(async () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
  lifecycle.fetch.mockReset().mockImplementation(async () => complete());
  vi.stubGlobal("fetch", lifecycle.fetch);
});
afterEach(() => { for (const attempt of attempts.splice(0)) attempt.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual alias chat core and collectors", () => {
  it("ignores payload/credential alias lookalikes and preserves ordinary success", async () => {
    const result = await request(null, { body: { stream: false, executionOptions: { alias: true }, alias: true, messages: [{ role: "user", content: "hello" }] } });
    expect(result.success).toBe(true);
    expect(result.outputStarted).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).not.toBe(true);
  });

  it("pre-aborts before logger or fetch and retains exact null cancellation", async () => {
    const caller = new AbortController(); caller.abort(null);
    const result = await request(options(), { signal: caller.signal });
    expect(fetch).not.toHaveBeenCalled(); expect(lifecycle.logger).not.toHaveBeenCalled();
    expect(result.success).toBe(false); expect(result.failure.error).toBe(null); expect(result.outputStarted).toBe(false);
  });

  it("keeps heartbeat/role pending then replays UTF8 real output once", async () => {
    const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    let settled = false;
    const pending = request().then((r) => { settled = true; return r; });
    upstream.send(": ping\r\n\r\n" + frame(chat({ role: "assistant" }), "\r\n"));
    await flush(); expect(settled).toBe(false); expect(lifecycle.success).not.toHaveBeenCalled();
    const bytes = encoder.encode(frame(chat({ content: "hé世界" }), "\r\n"));
    for (const byte of bytes) upstream.send(new Uint8Array([byte]));
    const result = await pending; expect(result.outputStarted).toBe(true);
    upstream.send(frame(chat({}, "stop")) + "data: [DONE]\n\n"); upstream.close();
    const text = await result.response.text(); expect(text.match(/hé世界/g)).toHaveLength(1);
  });

  it("forces upstream SSE for JSON clients and stops only the initial timer", async () => {
    vi.useFakeTimers(); const execution = options(); const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    let settled = false;
    const pending = request(execution, { body: { stream: false, messages: [{ role: "user", content: "hello" }] } }).then((r) => { settled = true; return r; });
    upstream.send(frame(chat({ reasoning_content: "thinking" })));
    await flush(); expect(execution.attempt.outputStarted).toBe(true); expect(settled).toBe(false);
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);
    await vi.advanceTimersByTimeAsync(20000); expect(execution.attempt.signal.aborted).toBe(false);
    upstream.send(frame(chat({ content: "answer" })) + frame(chat({}, "stop")) + "data: [DONE]\n\n"); upstream.close();
    const result = await pending; expect(result.success, result.error).toBe(true); expect(result.outputStarted).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("answer");
  });

  it("rejects metadata-only 200 without callback or semantic latch", async () => {
    fetch.mockResolvedValue(new Response(frame(chat({ role: "assistant" })) + frame(chat({}, "stop")) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    const result = await request(); expect(result.success).toBe(false); expect(result.outputStarted).toBe(false);
    expect(result.failure.code).toBe("ALIAS_NO_OUTPUT"); expect(lifecycle.success).not.toHaveBeenCalled();
  });

  it("retains structured pre-output and late errors rather than synthesized text", async () => {
    for (const late of [false, true]) {
      const raw = (late ? frame(chat({ content: "answer" })) : "") + frame({ type: "error", status: 429, error: { message: "quota", code: "limited" } });
      fetch.mockResolvedValue(new Response(raw, { headers: { "content-type": "text/event-stream" } }));
      const result = await request(options(), { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
      expect(result.success).toBe(false); expect(result.status).toBe(429); expect(result.outputStarted).toBe(late);
      expect(result.failure.detail.code).toBe("limited");
      expect(await result.response.text()).not.toContain("[Error]");
    }
    expect(lifecycle.success).not.toHaveBeenCalled();
  });

  it("observes valid multiline SSE JSON as one complete strict alias event", async () => {
    for (const [firstNewline, secondNewline] of [["\r\n", "\r\n"], ["\r", "\r"], ["\r", "\n"]]) {
      const upstream = controlled(); fetch.mockResolvedValue(upstream.response); const execution = options();
      const pending = request(execution, { body: { stream: true, messages: [{ role: "user", content: "hello" }] } });
      upstream.send(frame(chat({ content: "answer" }))); const result = await pending;
      const collected = result.response.text();
      upstream.send(`event: error${firstNewline}data: {"error":${firstNewline}`); await flush();
      upstream.send(`data: {"message":"quota","code":"limited"}}${secondNewline}${secondNewline}`);
      upstream.close();
      const forwarded = await collected;
      expect(forwarded.match(/answer/g)).toHaveLength(1);
      expect(result.failure).toMatchObject({ code: "ALIAS_PROTOCOL_ERROR", detail: { code: "limited" } });
      expect(forwarded).not.toContain("Invalid provider SSE JSON");
    }
  });

  it("forwards same-chunk answer before a later structured SSE failure", async () => {
    const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request();
    upstream.send(frame(chat({ content: "ordered answer" })) + frame({ type: "error", status: 503, error: { message: "upstream unavailable", code: "upstream_down" } }));
    upstream.close();
    const result = await pending;
    const text = await result.response.text();
    expect(text.match(/ordered answer/g)).toHaveLength(1);
    expect(text.indexOf("ordered answer")).toBeLessThan(text.indexOf("upstream unavailable"));
    expect(text).toContain("upstream unavailable");
    expect(result.failure).toMatchObject({ code: "ALIAS_PROTOCOL_ERROR", status: 503, outputStarted: true,
      detail: { code: "upstream_down", status: 503, message: "upstream unavailable: upstream_down" } });
  });

  it("counts strict alias SSE lines against the byte limit using UTF-8", async () => {
    const data = JSON.stringify({ choices: [{ delta: { content: "é" }, finish_reason: "stop" }] });
    const line = `data: ${data}`;
    const byteLength = encoder.encode(line).byteLength;
    const input = encoder.encode(`${line}\n\n`);
    expect(data.length).toBeLessThan(encoder.encode(data).byteLength);
    const createStrictStream = aliasObserverFrameLimit => createSSEStream({ strict: true, targetFormat: "openai", sourceFormat: "openai", aliasObserverFrameLimit });

    const atLimit = createStrictStream(byteLength);
    const atLimitReader = atLimit.readable.getReader();
    const atLimitWriter = atLimit.writable.getWriter();
    const output = atLimitReader.read();
    await atLimitWriter.write(input);
    await atLimitWriter.close();
    expect(new TextDecoder().decode((await output).value)).toContain("é");
    await atLimitReader.cancel();

    const overLimit = createStrictStream(byteLength - 1);
    const overLimitReader = overLimit.readable.getReader();
    const overLimitWriter = overLimit.writable.getWriter();
    const writeFailure = expect(overLimitWriter.write(input)).rejects.toMatchObject({ code: "ALIAS_FRAME_LIMIT" });
    await expect(overLimitReader.read()).rejects.toMatchObject({ code: "ALIAS_FRAME_LIMIT" });
    await writeFailure;
  });

  it("omits secret-shaped values from actual HTTP error metadata", async () => {
    const cases = [
      { field: "code", value: ["AIza", "SyD", "abcdefghijklmnopqr", "stuvwxyz0123456789"].join("") },
      { field: "type", value: ["ghp_", "a".repeat(36)].join("") },
      { field: "detail", value: `provider:${["AIza", "SyD", "abcdefghijklmnopqr", "stuvwxyz0123456789"].join("")}` },
      { field: "detail", value: `api_key=${"secret_".repeat(5)}` },
      { field: "detail", value: `provider API key: ${"secret_".repeat(5)}` },
    ];
    for (const { field, value } of cases) {
      const error = { message: "provider rejected request" };
      error[field] = value;
      fetch.mockResolvedValue(new Response(JSON.stringify({ error }), { status: 502, headers: { "content-type": "application/json", "retry-after": "15" } }));
      const result = await request();
      expect(JSON.stringify(result.failure)).not.toContain(value);
      expect(await result.response.text()).not.toContain(value);
      expect(result.failure).toMatchObject({ category: "provider", status: 502, retryAfter: "15" });
    }
  });

  it("preserves safe structured metadata from actual upstream HTTP errors", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: {
      type: "rate_limit_error", code: "too_many_requests", message: "slow down",
    } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "120" } }));
    const result = await request();
    expect(result.success).toBe(false); expect(result.status).toBe(429);
    expect(result.failure).toMatchObject({ category: "provider", status: 429, code: "too_many_requests",
      detail: { code: "too_many_requests", type: "rate_limit_error" }, retryAfter: "120" });
    expect(result.failure.error).toContain("slow down");
    expect(await result.response.text()).toContain("slow down");
  });

  it("retains native Claude and Gemini SSE through existing translators", async () => {
    const fixtures = [
      { provider: "anthropic-compatible-fixture", format: "claude", raw: frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer" } }) + frame({ type: "message_stop" }) },
      { provider: "gemini", format: "gemini", raw: frame({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }] }) },
    ];
    for (const fixture of fixtures) {
      fetch.mockResolvedValue(new Response(fixture.raw.replaceAll("\n", "\r\n"), { headers: { "content-type": "text/event-stream" } }));
      const result = await request(options(), { modelInfo: { provider: fixture.provider, model: "fixture" }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
      expect(result.success).toBe(true); expect(result.outputStarted).toBe(true);
      expect((await result.response.json()).choices[0].message.content).toBe("answer");
    }
  });

  it("observes Responses incrementally and preserves actual model, usage and late error", async () => {
    const upstream = controlled(); const observer = vi.fn(); const signal = new AbortController();
    const pending = convertResponsesStreamToJson(upstream.response.body, { signal: signal.signal, onEvent: observer, strict: true });
    upstream.send(frame({ type: "response.output_text.delta", delta: "answer", output_index: 0 })); await flush();
    expect(observer).toHaveBeenCalled();
    upstream.send(frame({ type: "response.completed", response: { model: "actual-model", output: [{ type: "message", content: [{ type: "output_text", text: "answer" }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, cached_tokens: 3 } } })); upstream.close();
    const result = await pending; expect(result.model).toBe("actual-model"); expect(result.usage.cached_tokens).toBe(3); expect(result.output[0].content[0].text).toBe("answer");
    const errorStream = controlled(); const failed = convertResponsesStreamToJson(errorStream.response.body, { strict: true });
    errorStream.send(frame({ type: "response.failed", response: { error: { message: "late", code: "failed" }, status_code: 503 } })); errorStream.close();
    await expect(failed).rejects.toMatchObject({ detail: { status: 503 } });
  });

  it("reactively refreshes once with the real Default helper and shared budget", async () => {
    const execution = options(); const refreshed = vi.fn(); const original = { accessToken: "old-fixture", refreshToken: "rt-fixture", providerSpecificData: {} };
    let generations = 0; let refreshes = 0;
    fetch.mockImplementation(async (url) => {
      if (String(url).includes("oauth")) { refreshes++; return new Response(JSON.stringify({ access_token: "new-fixture", refresh_token: "new-rt" }), { headers: { "content-type": "application/json" } }); }
      generations++; return generations === 1 ? new Response('{"error":{"message":"auth","code":"invalid_api_key","type":"authentication_error"}}', { status: 401, headers: { "content-type": "application/json", "retry-after": "30" } }) : new Response(JSON.stringify({ type: "message", model: "actual-model", content: [{ type: "text", text: "ok" }] }), { headers: { "content-type": "application/json" } });
    });
    const result = await request(execution, { modelInfo: { provider: "claude", model: "fixture" }, credentials: original, onCredentialsRefreshed: refreshed });
    expect(result.success).toBe(true); expect(generations).toBe(2); expect(refreshes).toBe(1); expect(refreshed).toHaveBeenCalledTimes(1);
    expect(execution.recoveryBudget.claimRefresh()).toBe(false); expect(execution.recoveryBudget.claimRedispatch()).toBe(false);
    expect(original.accessToken).toBe("old-fixture");
    const spent = options(); spent.recoveryBudget.claimRefresh(); generations = 0; refreshes = 0; fetch.mockClear();
    fetch.mockResolvedValue(new Response('{"error":{"message":"denied","code":"invalid_api_key","type":"authentication_error"}}', { status: 401, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const denied = await request(spent, { modelInfo: { provider: "claude", model: "fixture" }, credentials: original });
    expect(denied.status).toBe(401); expect(denied.failure.status).toBe(401);
    expect(denied.failure).toMatchObject({ code: "invalid_api_key", detail: { code: "invalid_api_key", type: "authentication_error" }, retryAfter: "30" });
    expect(fetch).toHaveBeenCalledTimes(1); expect(original.accessToken).toBe("old-fixture");
    expect(refreshes).toBe(0);
    expect(spent.recoveryBudget.claimRedispatch()).toBe(true);
    expect(getExecutor("claude")).toBeInstanceOf(DefaultExecutor);
  });

  it("does not create per-request log files for alias attempts", async () => {
    const result = await request(options());
    expect(result.success).toBe(true); expect(lifecycle.logger).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips PXPIPE for alias only without changing ordinary transform", async () => {
    const transform = vi.fn(async ({ body }) => ({ applied: false, body })); const onPxpipeEvent = vi.fn();
    const body = { stream: false, messages: [{ role: "user", content: "x".repeat(1000) }] };
    await request(options(), { modelInfo: { provider: "anthropic-compatible-fixture", model: "fixture" }, body, pxpipeEnabled: true, pxpipeMinChars: 1, pxpipeTransform: transform, onPxpipeEvent });
    expect(transform).not.toHaveBeenCalled(); expect(onPxpipeEvent).toHaveBeenCalledWith(expect.objectContaining({ applied: false, reason: "alias-cancellation-unsupported" }));
    await request(null, { modelInfo: { provider: "anthropic-compatible-fixture", model: "fixture" }, body, pxpipeEnabled: true, pxpipeMinChars: 1, pxpipeTransform: transform });
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("buffered JSON waits for complete answer and cancels at member deadline", async () => {
    vi.useFakeTimers(); const execution = options(); const upstream = controlled("application/json"); fetch.mockResolvedValue(upstream.response);
    const pending = request(execution, { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    upstream.send('{"choices":[{"message":{"content":"partial'); await flush(); expect(execution.attempt.outputStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(15000); const result = await pending;
    expect(result.success).toBe(false); expect(result.failure.cancelReason).toBe("initial-output-deadline"); expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("consumes real CommandCode normalized SSE instead of its request format", async () => {
    fetch.mockResolvedValue(new Response('{"type":"text-delta","text":"answer"}\n{"type":"finish","finishReason":"stop"}\n', { headers: { "content-type": "application/x-ndjson" } }));
    const result = await request(options(), { modelInfo: { provider: "commandcode", model: "fixture" }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    expect(result.success, result.error).toBe(true); expect(result.outputStarted).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("answer");
  });

  it("keeps the real Kiro private-output latch through integrity EOF failure", async () => {
    function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
    function binary(type, payload) {
      const entries = [[":event-type", type], [":message-type", "event"]].map(([name, value]) => {
        const key = encoder.encode(name); const text = encoder.encode(value); const bytes = new Uint8Array(key.length + text.length + 4);
        bytes[0] = key.length; bytes.set(key, 1); bytes[key.length + 1] = 7;
        new DataView(bytes.buffer).setUint16(key.length + 2, text.length); bytes.set(text, key.length + 4); return bytes;
      });
      const data = encoder.encode(JSON.stringify(payload)); const hsize = entries.reduce((n, item) => n + item.length, 0);
      const bytes = new Uint8Array(16 + hsize + data.length); const view = new DataView(bytes.buffer);
      view.setUint32(0, bytes.length); view.setUint32(4, hsize); let at = 12;
      for (const entry of entries) { bytes.set(entry, at); at += entry.length; } bytes.set(data, at);
      view.setUint32(8, crc(bytes.subarray(0, 8))); view.setUint32(bytes.length - 4, crc(bytes.subarray(0, -4))); return bytes;
    }
    for (const corrupt of [false, true]) {
      const upstream = controlled("application/octet-stream"); fetch.mockResolvedValue(upstream.response); const execution = options();
      const pending = request(execution, { modelInfo: { provider: "kiro", model: "fixture" }, credentials: { accessToken: "fixture-only", providerSpecificData: { vercelRelayUrl: "http://127.0.0.1:20388" } }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
      upstream.send(binary("assistantResponseEvent", { content: "validated answer" })); await flush();
      expect(fetch).toHaveBeenCalled();
      expect(execution.attempt.outputStarted).toBe(true);
      if (corrupt) { const bad = binary("assistantResponseEvent", { content: "bad" }); bad[bad.length - 1] ^= 0xff; upstream.send(bad); }
      upstream.close(); const result = await pending;
      expect(result.outputStarted).toBe(true); expect(result.success, result.error).toBe(!corrupt);
      if (!corrupt) expect((await result.response.json()).choices[0].message.content).toContain("validated answer");
      else expect(result.failure.code).toBe("ALIAS_PROTOCOL_ERROR");
    }
  });

  it("cancels actual Headroom preparation before provider dispatch", async () => {
    const execution = options(); let compressionSignal;
    fetch.mockImplementation(async (url, init) => {
      if (!String(url).includes("/compress")) throw new Error("unexpected generation");
      compressionSignal = init.signal;
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    const pending = request(execution, { headroomEnabled: true, headroomCompressUserMessages: true, headroomUrl: "http://127.0.0.1:20388" });
    await flush(); expect(compressionSignal).toBeDefined(); execution.attempt.abort("collection");
    const result = await pending; expect(result.failure.cancelReason).toBe("collection"); expect(compressionSignal.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels credential persistence without a redispatch or late success", async () => {
    const execution = options(); let release; const persistence = vi.fn(() => new Promise(r => { release = r; }));
    fetch.mockImplementation(async url => String(url).includes("oauth")
      ? new Response('{"access_token":"refreshed"}', { headers: { "content-type": "application/json" } })
      : new Response('{"error":{"message":"auth"}}', { status: 401, headers: { "content-type": "application/json" } }));
    const pending = request(execution, { modelInfo: { provider: "claude", model: "fixture" }, credentials: { refreshToken: "rt-fixture", providerSpecificData: {} }, onCredentialsRefreshed: persistence });
    await flush(); expect(persistence).toHaveBeenCalledTimes(1); execution.attempt.abort("client");
    const result = await pending; expect(result.success).toBe(false); release(); await flush();
    expect(fetch).toHaveBeenCalledTimes(2); expect(lifecycle.success).not.toHaveBeenCalled();
  });

  it("caller abort cancels pending raw readiness with an exact reason", async () => {
    const caller = new AbortController(); const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request(options(), { signal: caller.signal }); await flush();
    const reason = new Error("caller cancelled"); caller.abort(reason);
    const result = await pending; expect(result.failure.error).toBe(reason); expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("late streaming protocol errors stay terminal and retain internal metadata", async () => {
    const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request(); upstream.send(frame(chat({ content: "answer" })));
    const result = await pending; const collected = result.response.text();
    upstream.send(frame({ type: "error", status: 402, error: { code: "billing", message: "payment" } })); upstream.close();
    const text = await collected; expect(text).toContain("payment"); expect(text).not.toContain("[Error]");
    expect(result.failure).toMatchObject({ status: 402, outputStarted: true, detail: { code: "billing" } });
  });

  it("content-type-less actual Responses contract aggregates without dropping deltas", async () => {
    const upstream = controlled(""); fetch.mockResolvedValue(upstream.response);
    const execution = options(); const pending = request(execution, { modelInfo: { provider: "openai-compatible-responses-fixture", model: "fixture" }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    upstream.send(frame({ type: "response.output_text.delta", delta: "answer" })); await flush();
    expect(execution.attempt.outputStarted).toBe(true);
    upstream.send(frame({ type: "response.completed", response: { model: "actual-model", output: [{ type: "message", content: [{ type: "output_text", text: "answer" }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } })); upstream.close();
    const result = await pending; expect(result.success, result.error).toBe(true); expect(result.outputStarted).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("answer");
  });

  it("late parse and incomplete EOF failures retain output latch for JSON", async () => {
    for (const tail of ["data: {broken}\n\n", ""]) {
      fetch.mockResolvedValue(new Response(frame(chat({ tool_calls: [{ index: 0, function: { name: "run", arguments: "{}" } }] })) + tail, { headers: { "content-type": "text/event-stream" } }));
      const result = await request(options(), { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
      expect(result.success).toBe(false); expect(result.outputStarted).toBe(true);
      expect(result.failure.code).toBe(tail ? "ALIAS_INVALID_JSON" : "ALIAS_INCOMPLETE_STREAM");
    }
  });

  it("uses the actual native response format when inspecting late wrapped Gemini errors", async () => {
    const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request(options(), { modelInfo: { provider: "gemini", model: "fixture" }, body: { stream: true, contents: [{ role: "user", parts: [{ text: "hello" }] }] } });
    upstream.send(frame({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }));
    const result = await pending; const collected = result.response.text();
    upstream.send(frame({ response: { error: { code: 403, message: "denied" } } })); upstream.close();
    expect(await collected).toContain("denied"); expect(result.failure).toMatchObject({ status: 403, outputStarted: true });
  });

  it("shares trusted options and clones dispatch bodies across real auth redispatch", async () => {
    const executor = getExecutor("claude"); const execute = vi.spyOn(executor, "execute"); const refresh = vi.spyOn(executor, "refreshCredentials");
    const execution = options(); const source = { stream: false, messages: [{ role: "user", content: "hello" }] }; const snapshot = structuredClone(source);
    let generations = 0;
    fetch.mockImplementation(async url => {
      if (String(url).includes("oauth")) return new Response('{"access_token":"refreshed"}', { headers: { "content-type": "application/json" } });
      return ++generations === 1 ? new Response('{"error":{"message":"auth"}}', { status: 401 })
        : new Response('{"type":"message","content":[{"type":"text","text":"answer"}]}', { headers: { "content-type": "application/json" } });
    });
    const result = await request(execution, { modelInfo: { provider: "claude", model: "fixture" }, body: source, credentials: { refreshToken: "fixture-rt", providerSpecificData: {} } });
    expect(result.success).toBe(true); expect(source).toEqual(snapshot);
    expect(execute).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1);
    const [first, second] = execute.mock.calls.map(call => call[0]);
    expect(first.executionOptions).toBe(execution); expect(second.executionOptions).toBe(execution);
    expect(first.body).not.toBe(second.body); expect(first.body).toEqual(second.body); expect(second.signal).toBe(first.signal);
    expect(refresh.mock.calls[0][3].recoveryBudget).toBe(execution.recoveryBudget);
  });

  it("cancels an abandoned auth response even when redispatch transport fails", async () => {
    const execution = options(); const discarded = vi.fn(); let generation = 0;
    fetch.mockImplementation(async url => {
      if (String(url).includes("oauth")) return new Response('{"access_token":"refreshed"}', { headers: { "content-type": "application/json" } });
      if (++generation > 1) throw new Error("transport failure");
      return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode('{"error":{"message":"original auth failure"}}')); c.close(); }, cancel: discarded }), { status: 401, headers: { "content-type": "application/json", "retry-after": "120" } });
    });
    const result = await request(execution, { modelInfo: { provider: "claude", model: "fixture" }, credentials: { refreshToken: "fixture-rt", providerSpecificData: {} } });
    expect(result.status).toBe(401); expect(result.failure.retryAfter).toBe("120"); expect(result.error).toContain("original auth failure");
    expect(generation).toBe(2); expect(execution.recoveryBudget.claimRedispatch()).toBe(false);
  });

  it("preserves actual buffered model and reported usage without alias estimation", async () => {
    fetch.mockResolvedValue(new Response('{"model":"actual-model","choices":[{"message":{"content":"answer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}', { headers: { "content-type": "application/json" } }));
    const result = await request(options(), { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    const json = await result.response.json(); expect(json.model).toBe("actual-model"); expect(json.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
  });

  it("honors explicit alias native Gemini JSON clients over forced SSE", async () => {
    fetch.mockResolvedValue(new Response(frame({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }), { headers: { "content-type": "text/event-stream" } }));
    const result = await request(options(), { modelInfo: { provider: "gemini", model: "fixture" }, body: { stream: false, contents: [{ role: "user", parts: [{ text: "hello" }] }] } });
    expect(result.response.headers.get("content-type")).toContain("application/json");
    const json = await result.response.json(); expect((json.response || json).candidates[0].content.parts[0].text).toBe("answer");
  });

  it("rejects malformed data-only Responses after a real output latch", async () => {
    const raw = frame({ type: "response.reasoning_summary_text.delta", delta: "reason" }) + "data: {invalid}\n\n";
    fetch.mockResolvedValue(new Response(raw, { headers: { "content-type": "text/event-stream" } }));
    const result = await request(options(), { modelInfo: { provider: "openai-compatible-responses-fixture", model: "fixture" }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    expect(result.success).toBe(false); expect(result.outputStarted).toBe(true); expect(result.failure.code).toBe("ALIAS_INVALID_JSON");
  });

  it("cancels an unfinished HTTP auth error body at the shared initial deadline", async () => {
    vi.useFakeTimers(); const execution = options(); const upstream = controlled("application/json");
    fetch.mockResolvedValue(new Response(upstream.response.body, { status: 401, headers: { "content-type": "application/json" } }));
    const pending = request(execution); upstream.send('{"error":{"message":"unfinished'); await flush();
    await vi.advanceTimersByTimeAsync(15000); const result = await pending;
    expect(result.failure.cancelReason).toBe("initial-output-deadline"); expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps Responses reasoning-only answers in actual Chat JSON aggregation", async () => {
    const output = [{ type: "reasoning", summary: [{ type: "summary_text", text: "reasoning answer" }] }];
    fetch.mockResolvedValue(new Response(frame({ type: "response.reasoning_summary_text.delta", delta: "reasoning answer" }) + frame({ type: "response.completed", response: { model: "actual-model", output } }), { headers: { "content-type": "text/event-stream" } }));
    const result = await request(options(), { modelInfo: { provider: "openai-compatible-responses-fixture", model: "fixture" }, body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    expect(result.success).toBe(true); expect(result.outputStarted).toBe(true);
    expect((await result.response.json()).choices[0].message.reasoning_content).toBe("reasoning answer");
  });

  it("keeps alias aggregation reasoning even when the final answer contains text", async () => {
    fetch.mockResolvedValue(new Response(frame(chat({ reasoning_content: "reason" })) + frame(chat({ content: "answer" })) + frame(chat({}, "stop")), { headers: { "content-type": "text/event-stream" } }));
    const result = await request(options(), { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    expect((await result.response.json()).choices[0].message).toMatchObject({ content: "answer", reasoning_content: "reason" });
  });

  it("retains Retry-After and provider status on denied auth recovery", async () => {
    fetch.mockResolvedValue(new Response('{"error":{"message":"denied"}}', { status: 403, headers: { "content-type": "application/json", "retry-after": "120" } }));
    const result = await request(); expect(result.status).toBe(403); expect(result.failure.retryAfter).toBe("120");
    expect(result.failure.outputStarted).toBe(false);
  });

  it("keeps the existing stall watchdog while alias JSON aggregation waits for EOF", async () => {
    vi.useFakeTimers(); const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const execution = options(); const pending = request(execution, { body: { stream: false, messages: [{ role: "user", content: "hello" }] } });
    upstream.send(frame(chat({ content: "answer" }))); await flush(); expect(execution.attempt.outputStarted).toBe(true);
    await vi.advanceTimersByTimeAsync(600000); const result = await pending;
    expect(result.success).toBe(false); expect(result.outputStarted).toBe(true); expect(result.failure.code).toBe("ALIAS_STREAM_STALL");
    expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("retains the existing stall watchdog and emits terminal error bytes", async () => {
    vi.useFakeTimers(); const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request(); upstream.send(frame(chat({ content: "answer" })));
    const result = await pending; const text = result.response.text(); await flush();
    await vi.advanceTimersByTimeAsync(600000);
    expect(await text).toContain("stream stall timeout"); expect(result.failure.category).toBe("provider");
    expect(result.failure.outputStarted).toBe(true); expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("caller abort stops returned translated stream and rejects exact null reason", async () => {
    const caller = new AbortController(); const upstream = controlled(); fetch.mockResolvedValue(upstream.response);
    const pending = request(options(), { signal: caller.signal }); upstream.send(frame(chat({ content: "answer" })));
    const result = await pending; const reader = result.response.body.getReader(); await reader.read();
    caller.abort(null); await expect(reader.read()).rejects.toBe(null); await flush(); expect(upstream.cancel).toHaveBeenCalledTimes(1);
  });

  it("frames only exact SSE media types through the actual streaming core", async () => {
    for (const [contentType, shouldFrame] of [
      ["text/event-stream; charset=utf-8", true],
      ["text/event-stream+json; charset=utf-8", false],
    ]) {
      const upstream = controlled(contentType); fetch.mockResolvedValue(upstream.response);
      const pending = request(); upstream.send(frame(chat({ content: "initial answer" })));
      const result = await pending; const collected = result.response.text();
      upstream.send(frame(chat({ content: "later answer" })) + frame({ type: "error", status: 503, error: { message: "later failure", code: "later_failure" } }));
      upstream.close();
      const text = await collected;
      expect(text).toContain("initial answer");
      expect(text.includes("later answer"), contentType).toBe(shouldFrame);
      expect(result.failure).toMatchObject({ code: "ALIAS_PROTOCOL_ERROR", status: 503, outputStarted: true });
    }
    const { createStreamController, pipeWithDisconnect } = await import("../../open-sse/utils/streamHandler.js");
    const raw = frame(chat({ content: "answer" })) + frame(chat({}, "stop"));
    for (const [contentType, alias, chunkCount] of [
      ["  TeXt/EvEnT-StReAm ; charset=utf-8", true, 2],
      ["text/event-stream+json", true, 1],
      ["application/json", true, 1],
      ["", true, 1],
      ["text/event-stream", false, 1],
    ]) {
      const upstream = controlled(contentType); upstream.send(raw); upstream.close();
      const output = pipeWithDisconnect(upstream.response, new TransformStream(), createStreamController({ log }), null, 30000, { alias });
      const reader = output.getReader(); const chunks = [];
      while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
      expect(chunks, `${contentType || "missing type"}, alias=${alias}`).toHaveLength(chunkCount);
      expect(await new Response(new Blob(chunks)).text()).toBe(raw);
    }
  });

  it("uses numeric HTTP status as the safe fallback for secret-shaped provider messages", async () => {
    const secret = ["AIza", "SyD", "abcdefghijklmnopqr", "stuvwxyz0123456789"].join("");
    for (const [body, contentType, status] of [
      [`provider rejected: ${secret}`, "text/plain", 502],
      [JSON.stringify({ error: { message: `provider rejected: ${secret}` } }), "application/json", 503],
    ]) {
      fetch.mockResolvedValue(new Response(body, { status, headers: { "content-type": contentType } }));
      const result = await request();
      const publicBody = await result.response.text();
      expect(result.success).toBe(false);
      expect(result.status).toBe(status); expect(result.response.status).toBe(status);
      expect(result.failure).toMatchObject({ category: "provider", status, outputStarted: false });
      expect(JSON.stringify(result.failure)).not.toContain(secret);
      expect(publicBody).not.toContain(secret);
      expect(result.error).toBe(`[${status}]: Upstream error: ${status}`);
      expect(publicBody).toContain(`Upstream error: ${status}`);
    }
  });
});

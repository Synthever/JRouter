import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { createAliasAttempt } = await import("../../open-sse/services/aliasAttempt.js");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const attempts = [];
const controllers = [];
const credentials = { accessToken: "fixture", providerSpecificData: { kiroToolCallRepair: true } };
const body = { conversationState: { currentMessage: { userInputMessage: { content: "base", modelId: "fixture" } } } };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function frame(type, payload, messageType = "event") {
  const headers = concat([[":event-type", type], [":message-type", messageType]].map(([name, value]) => {
    const key = encoder.encode(name);
    const text = encoder.encode(value);
    const bytes = new Uint8Array(1 + key.length + 3 + text.length);
    bytes[0] = key.length;
    bytes.set(key, 1);
    bytes[key.length + 1] = 7;
    new DataView(bytes.buffer).setUint16(key.length + 2, text.length, false);
    bytes.set(text, key.length + 4);
    return bytes;
  }));
  const json = encoder.encode(JSON.stringify(payload));
  const bytes = new Uint8Array(16 + headers.length + json.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, false);
  view.setUint32(4, headers.length, false);
  bytes.set(headers, 12);
  bytes.set(json, 12 + headers.length);
  view.setUint32(8, crc32(bytes.subarray(0, 8)), false);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(0, -4)), false);
  return bytes;
}
function corrupt() {
  const bytes = frame("assistantResponseEvent", { content: "unvalidated" });
  bytes[bytes.length - 1] ^= 0xff;
  return bytes;
}
function response(frames) {
  return new Response(new ReadableStream({ start(controller) {
    for (const bytes of frames) controller.enqueue(bytes);
    controller.close();
  } }));
}
function controlled(frames = [], cancelResult) {
  let controller;
  const cancel = vi.fn(() => cancelResult);
  const value = new Response(new ReadableStream({ start(c) {
    controller = c;
    for (const bytes of frames) c.enqueue(bytes);
  }, cancel }));
  return { value, cancel, enqueue: bytes => controller.enqueue(bytes), close: () => controller.close(), error: error => controller.error(error) };
}
function attempt(timeout = 15000) {
  const value = createAliasAttempt({ initialResponseTimeoutMs: timeout });
  attempts.push(value);
  return value;
}
function abortController() {
  const value = new AbortController();
  controllers.push(value);
  return value;
}
function alias(value = attempt()) {
  return { alias: true, attempt: value, retryPolicy: "single-attempt", allowNetworkReplay: false, forceUpstreamStreaming: true };
}
function execute(executor = new KiroExecutor(), options = {}) {
  return executor.execute({ model: "kr/claude-opus-4.8", body, stream: true, credentials, ...options });
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function sseError(text) {
  const event = text.split("\n").find(line => line.startsWith("data: {") && JSON.parse(line.slice(6)).error);
  expect(event).toBeDefined();
  return JSON.parse(event.slice(6)).error;
}

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error("Unexpected generation"));
});
afterEach(async () => {
  for (const value of controllers.splice(0)) if (!value.signal.aborted) value.abort("test cleanup");
  for (const value of attempts.splice(0)) { value.abort("client"); value.dispose(); }
  await flush();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Kiro decoded readiness and owned cancellation", () => {
  it("waits for a complete UTF8 CRC frame, then clears only the initial deadline behind the private gate", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", "60000");
    const bytes = frame("assistantResponseEvent", { content: "validated 漢字" });
    const upstream = controlled([bytes.slice(0, -2)]);
    const value = attempt();
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(undefined, { executionOptions: alias(value) });
    const reader = result.response.body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(": kiro-validation\n\n");
    await flush();
    expect(value.outputStarted).toBe(false);
    upstream.enqueue(bytes.slice(-2));
    await flush();
    expect(value.outputStarted).toBe(true);
    let visible = false;
    const pending = reader.read().then(part => { visible = true; return part; });
    await vi.advanceTimersByTimeAsync(16000);
    expect(value.signal.aborted).toBe(false);
    expect(visible).toBe(true);
    expect(decoder.decode((await pending).value)).toBe(": kiro-validation\n\n");
    const answer = reader.read();
    upstream.close();
    expect(decoder.decode((await answer).value)).toContain("validated 漢字");
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
    value.dispose();
    expect(upstream.value.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["reasoningContentEvent", "codeEvent"])("observes real %s before EOF without publishing answer bytes", async type => {
    const upstream = controlled([frame(type, type === "reasoningContentEvent" ? { text: "reason" } : { content: "code" })]);
    const value = attempt();
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(undefined, { executionOptions: alias(value) });
    await flush();
    expect(value.outputStarted).toBe(true);
    upstream.close();
    const text = await result.response.text();
    expect(text).toContain(type === "reasoningContentEvent" ? '"reasoning_content":"reason"' : '"content":"code"');
  });

  it("observes tools only at existing complete-input validation and never observes invalid fragments", async () => {
    for (const valid of [true, false]) {
      const upstream = controlled([frame("toolUseEvent", { name: "tool_call", input: valid ? { name: "read_file", arguments: {} } : '{"name":' })]);
      const value = attempt();
      fetchMock.mockResolvedValueOnce(upstream.value);
      const result = await execute(undefined, { executionOptions: alias(value) });
      await flush();
      expect(value.outputStarted).toBe(false);
      upstream.close();
      const text = await result.response.text();
      expect(value.outputStarted).toBe(valid);
      if (valid) expect(text).toContain('"name":"tool_call"');
      else expect(sseError(text).details.terminal_provenance).toBe("invalid_tool_call");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a decoded-output latch after late corruption even with an incomplete server descriptor", async () => {
    const upstream = controlled([frame("assistantResponseEvent", { content: "private valid output" })]);
    const value = attempt();
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(undefined, { executionOptions: { attempt: value } });
    await flush();
    expect(value.outputStarted).toBe(true);
    upstream.enqueue(corrupt());
    const text = await result.response.text();
    expect(sseError(text).details.terminal_provenance).toBe("corrupt_eventstream_frame");
    expect(text).not.toContain("private valid output");
    expect(value.outputStarted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstream.cancel).toHaveBeenCalledTimes(1);
    expect(upstream.value.body.locked).toBe(false);
  });

  it("checks elapsed initial deadlines in ready-read and multi-frame loops without counting metadata or empty deltas", async () => {
    for (const multiFrame of [true, false]) {
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now++);
      const value = attempt(100);
      const frames = Array.from({ length: 300 }, (_, index) => frame(
        ["metadataEvent", "assistantResponseEvent", "codeEvent", "messageStopEvent", "unknownEvent"][index % 5],
        { content: "", stopReason: "end_turn" }
      ));
      const upstream = controlled(multiFrame ? [concat(frames)] : frames);
      fetchMock.mockResolvedValueOnce(upstream.value);
      const result = await execute(undefined, { executionOptions: alias(value) });
      const rejected = result.response.text().then(() => null, error => error);
      expect(await rejected).toBe(value.signal.reason);
      expect(now).toBeGreaterThanOrEqual(value.deadlineAt);
      expect(value.signal.aborted).toBe(true);
      expect(value.signal.reason.reason).toBe("initial-output-deadline");
      expect(value.outputStarted).toBe(false);
      expect(upstream.cancel).toHaveBeenCalledTimes(1);
      expect(upstream.value.body.locked).toBe(false);
      vi.restoreAllMocks();
    }
    vi.useFakeTimers();
    const value = attempt();
    const upstream = controlled([concat(Array.from({ length: 200 }, () => frame("metadataEvent", {})))]);
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(undefined, { executionOptions: alias(value) });
    const rejected = result.response.text().then(() => "resolved", error => error);
    for (let i = 0; i < 20; i++) await flush();
    expect(value.outputStarted).toBe(false);
    value.abort("collection");
    expect(await rejected).toBe(value.signal.reason);
    await flush();
    value.dispose();
    expect(upstream.value.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves request null and attempt cancellation after headers through both real readers and native fetch signal", async () => {
    vi.useFakeTimers();
    for (const source of ["request", "attempt"]) {
      const upstream = controlled();
      const value = attempt();
      const request = abortController();
      const add = vi.spyOn(request.signal, "addEventListener");
      const remove = vi.spyOn(request.signal, "removeEventListener");
      const executor = new KiroExecutor();
      const transform = vi.spyOn(executor, "transformEventStreamToSSE");
      fetchMock.mockResolvedValueOnce(upstream.value);
      const result = await execute(executor, { signal: request.signal, executionOptions: alias(value) });
      const reader = result.response.body.getReader();
      await reader.read();
      const rejection = reader.read().then(() => "resolved", error => error);
      if (source === "request") request.abort(null);
      else value.abort("configuration");
      const reason = source === "request" ? null : value.signal.reason;
      expect(await rejection).toBe(reason);
      await flush();
      expect(fetchMock.mock.calls.at(-1)[1].signal.reason).toBe(reason);
      expect(upstream.cancel).toHaveBeenCalledExactlyOnceWith(reason);
      expect(upstream.value.body.locked).toBe(false);
      expect(transform.mock.results[0].value.body.locked).toBe(false);
      for (const [event, listener] of add.mock.calls) expect(remove.mock.calls.some(call => call[0] === event && call[1] === listener)).toBe(true);
      reader.releaseLock();
      value.dispose();
      expect(vi.getTimerCount()).toBe(0);
      vi.restoreAllMocks();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("downstream cancel(null) promptly stops validation and binary ownership despite nonsettling source cleanup", async () => {
    vi.useFakeTimers();
    const upstream = controlled([], new Promise(() => {}));
    const value = attempt();
    const executor = new KiroExecutor();
    const transform = vi.spyOn(executor, "transformEventStreamToSSE");
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(executor, { executionOptions: alias(value) });
    const binaryOptions = transform.mock.calls[0][2];
    const add = vi.spyOn(binaryOptions.signal, "addEventListener");
    const remove = vi.spyOn(binaryOptions.signal, "removeEventListener");
    await result.response.body.cancel(null);
    await flush();
    expect(fetchMock.mock.calls[0][1].signal.reason).toBe(null);
    for (const [event, listener] of add.mock.calls) expect(remove.mock.calls.some(call => call[0] === event && call[1] === listener)).toBe(true);
    expect(upstream.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(upstream.value.body.locked).toBe(false);
    expect(transform.mock.results[0].value.body.locked).toBe(false);
    value.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps alias TTFT and postoutput stall watchdog failures terminal while releasing both readers", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS", "20");
    vi.stubEnv("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", "20");
    for (const semantic of [false, true]) {
      const upstream = controlled(semantic ? [frame("assistantResponseEvent", { content: "private stalled output" })] : []);
      const value = attempt();
      const executor = new KiroExecutor();
      const transform = vi.spyOn(executor, "transformEventStreamToSSE");
      fetchMock.mockResolvedValueOnce(upstream.value);
      const result = await execute(executor, { executionOptions: alias(value) });
      const text = result.response.text();
      await flush();
      expect(value.outputStarted).toBe(semantic);
      await vi.advanceTimersByTimeAsync(25);
      expect(sseError(await text)).toMatchObject({ code: "kiro_missing_terminal", details: { terminal_provenance: "transport_read_error" } });
      expect(value.signal.aborted).toBe(false);
      expect(value.outputStarted).toBe(semantic);
      expect(upstream.cancel).toHaveBeenCalledTimes(1);
      expect(upstream.value.body.locked).toBe(false);
      expect(transform.mock.results[0].value.body.locked).toBe(false);
      value.dispose();
      expect(vi.getTimerCount()).toBe(0);
      vi.restoreAllMocks();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes late read and upstream protocol errors terminal with the valid-output latch intact", async () => {
    for (const failure of ["read", "event"]) {
      const upstream = controlled([frame("assistantResponseEvent", { content: "private before failure" })]);
      const value = attempt();
      fetchMock.mockResolvedValueOnce(upstream.value);
      const result = await execute(undefined, { executionOptions: alias(value) });
      await flush();
      expect(value.outputStarted).toBe(true);
      if (failure === "read") upstream.error(new Error("fixture socket reset"));
      else upstream.enqueue(frame("InternalServerException", { message: "fixture exception" }, "exception"));
      const text = await result.response.text();
      expect(sseError(text).details.terminal_provenance).toBe(failure === "read" ? "upstream_read_error" : "upstream_eventstream_error");
      expect(text).not.toContain("private before failure");
      expect(value.outputStarted).toBe(true);
      expect(upstream.value.body.locked).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preabort dispatches nothing and cancellation before late headers leaves no unused HTTP body", async () => {
    const request = abortController();
    request.abort(null);
    await expect(execute(undefined, { signal: request.signal, executionOptions: alias() })).rejects.toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
    const late = abortController();
    const upstream = controlled();
    fetchMock.mockImplementationOnce(async () => { late.abort(null); return upstream.value; });
    await expect(execute(undefined, { signal: late.signal, executionOptions: alias() })).rejects.toBe(null);
    expect(upstream.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(upstream.value.body.locked).toBe(false);
    const registration = abortController();
    const unused = controlled();
    const add = registration.signal.addEventListener.bind(registration.signal);
    vi.spyOn(registration.signal, "addEventListener").mockImplementation((...args) => {
      registration.abort(null);
      return add(...args);
    });
    fetchMock.mockResolvedValueOnce(unused.value);
    const result = await execute(undefined, { signal: registration.signal, executionOptions: alias() });
    await expect(result.response.text()).rejects.toBe(null);
    expect(unused.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(unused.value.body.locked).toBe(false);
  });
});

describe("Kiro centralized refresh option consumer", () => {
  function refreshFixture(token) {
    return { refreshToken: token, providerSpecificData: { authMethod: "idc", region: "us-west-2", clientId: "fixture-client", clientSecret: "fixture-only", profileArn: "fixture-profile" } };
  }
  it("forwards one shared account budget without double claiming and keeps missing/preaborted refresh remote-free", async () => {
    const executor = new KiroExecutor();
    const value = attempt();
    const budget = value.getAccountRecoveryBudget("fixture-account");
    const claim = vi.fn(() => budget.claimRefresh());
    const options = { signal: value.signal, recoveryBudget: { claimRefresh: claim } };
    const proxy = { fixture: "proxy-options" };
    fetchMock.mockResolvedValueOnce(Response.json({ accessToken: "fresh-fixture", refreshToken: "rotated-fixture", expiresIn: 300 }));
    expect(await executor.refreshCredentials(refreshFixture("refresh-budget-1"), null, proxy, options)).toMatchObject({ accessToken: "fresh-fixture", expiresIn: 300 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://oidc.us-west-2.amazonaws.com/token");
    expect(fetchMock.mock.calls[0][2]).toBe(proxy);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ refreshToken: "refresh-budget-1", grantType: "refresh_token" });
    expect(await executor.refreshCredentials(refreshFixture("refresh-budget-2"), null, proxy, options)).toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(await executor.refreshCredentials({}, null, proxy, options)).toBe(null);
    expect(claim).toHaveBeenCalledTimes(2);
    const stop = abortController();
    stop.abort(null);
    await expect(executor.refreshCredentials(refreshFixture("refresh-preabort"), null, proxy, { ...options, signal: stop.signal })).rejects.toBe(null);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves postfetch/prebody and late-publication cancellation without logging while ordinary errors remain null", async () => {
    const executor = new KiroExecutor();
    const log = { error: vi.fn(), info: vi.fn() };
    for (const phase of ["postfetch", "late-body"]) {
      const stop = abortController();
      const json = vi.fn(async () => { stop.abort(null); return { accessToken: "must-not-publish", expiresIn: 300 }; });
      fetchMock.mockImplementationOnce(async () => {
        if (phase === "postfetch") stop.abort(null);
        return { ok: true, json };
      });
      await expect(executor.refreshCredentials(refreshFixture(`refresh-cancel-${phase}`), log, null, { signal: stop.signal })).rejects.toBe(null);
      expect(fetchMock.mock.calls.at(-1)[1].signal.aborted).toBe(true);
      expect(fetchMock.mock.calls.at(-1)[1].signal.reason).toBe(null);
      expect(json).toHaveBeenCalledTimes(phase === "postfetch" ? 0 : 1);
      expect(log.error).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
    }
    fetchMock.mockRejectedValueOnce(new Error("ordinary refresh failure"));
    expect(await executor.refreshCredentials(refreshFixture("refresh-ordinary"), log)).toBe(null);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Kiro server-owned alias integrity policy", () => {
  it.each([
    ["missing terminal", () => [], "empty_response_eof"],
    ["invalid tool", () => [frame("toolUseEvent", { name: "tool_call", input: { arguments: {} } })], "invalid_tool_call"],
    ["short final", () => [frame("assistantResponseEvent", { content: "Let me check the remaining failures." })], "clean_eventstream_eof"],
    ["ellipsis", () => [frame("assistantResponseEvent", { content: "..." })], "clean_eventstream_eof"],
    ["CRC", () => [corrupt()], "corrupt_eventstream_frame"]
  ])("keeps %s strict without another alias generation", async (_name, frames, provenance) => {
    const upstream = response(frames());
    fetchMock.mockResolvedValueOnce(upstream);
    const result = await execute(undefined, { executionOptions: alias() });
    const text = await result.response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
    const codes = { "missing terminal": "kiro_missing_terminal", "invalid tool": "invalid_kiro_tool_call", "short final": "kiro_short_final", ellipsis: "kiro_ellipsis", CRC: "kiro_missing_terminal" };
    expect(sseError(text)).toMatchObject({ code: codes[_name], type: "upstream_error", details: { terminal_provenance: provenance } });
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(upstream.body.locked).toBe(false);
  });

  it("honors independent single-attempt without forcing proxy no-replay", async () => {
    fetchMock.mockResolvedValueOnce(response([frame("metadataEvent", { stopReason: "malformed_model_output" })]));
    const text = await (await execute(undefined, { executionOptions: { retryPolicy: "single-attempt" } })).response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(3);
    expect(sseError(text).details.stop_disposition).toBe("retryable_protocol_failure");
  });

  it("isolates concurrent alias and ordinary repair on one executor", async () => {
    const executor = new KiroExecutor();
    const original = structuredClone(body);
    fetchMock.mockImplementation((_url, init) => {
      const payload = JSON.parse(init.body);
      const repaired = payload.conversationState.currentMessage.userInputMessage.content !== "base";
      return Promise.resolve(response([frame("assistantResponseEvent", { content: repaired ? "Recovered." : "..." })]));
    });
    const [aliased, ordinary] = await Promise.all([
      execute(executor, { executionOptions: alias(), stream: false }),
      execute(executor, { body: { ...body, _alias: true, retryPolicy: "single-attempt" } })
    ]);
    const [aliasText, ordinaryText] = await Promise.all([aliased.response.text(), ordinary.response.text()]);
    expect(sseError(aliasText)).toMatchObject({ type: "upstream_error" });
    expect(ordinaryText).toContain("Recovered.");
    expect(fetchMock.mock.calls.filter(call => call[3]?.allowNetworkReplay === false)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(call => call.length === 3)).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    expect(body).toEqual(original);
    const probe = await execute(executor, { healthProbe: true });
    expect(sseError(await probe.response.text()).code).toBe("kiro_unknown_stop_reason");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Kiro Task6B2 fix1 regressions", () => {
  it("R1 gives queued cancellation a turn before post-latch ready frames drain", async () => {
    vi.useFakeTimers();
    const value = attempt();
    const request = abortController();
    const upstream = controlled([frame("assistantResponseEvent", { content: "private latched output" })]);
    const getReader = upstream.value.body.getReader.bind(upstream.value.body);
    let binaryReads;
    vi.spyOn(upstream.value.body, "getReader").mockImplementation((...args) => {
      const reader = getReader(...args);
      binaryReads = vi.spyOn(reader, "read");
      return reader;
    });
    const executor = new KiroExecutor();
    const transform = vi.spyOn(executor, "transformEventStreamToSSE");
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(executor, { signal: request.signal, executionOptions: alias(value) });
    const reader = result.response.body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(": kiro-validation\n\n");
    await flush();
    expect(value.outputStarted).toBe(true);
    expect(binaryReads).toHaveBeenCalledTimes(2);
    const settled = reader.read().then(part => ({ state: "fulfilled", part }), reason => ({ state: "rejected", reason }));
    const timers = vi.spyOn(globalThis, "setTimeout");
    let readsAtCancellation;
    const cancel = () => {
      readsAtCancellation = binaryReads.mock.calls.length;
      request.abort(null);
    };
    setTimeout(cancel, 0);
    upstream.enqueue(concat(Array.from({ length: 300 }, () => frame("metadataEvent", {}))));
    upstream.enqueue(frame("assistantResponseEvent", { content: "must not reach the tail" }));
    const yielded = () => timers.mock.calls.some(([callback, delay]) => delay === 0 && callback !== cancel);
    for (let index = 0; index < 50 && !yielded() && binaryReads.mock.calls.length === 2; index++) await flush();
    expect(yielded() || binaryReads.mock.calls.length > 2).toBe(true);
    expect(binaryReads).toHaveBeenCalledTimes(2);
    await vi.advanceTimersToNextTimerAsync();
    expect(readsAtCancellation).toBe(2);
    expect(await settled).toEqual({ state: "rejected", reason: null });
    await flush();
    expect(value.outputStarted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.reason).toBe(null);
    expect(upstream.cancel).toHaveBeenCalledExactlyOnceWith(null);
    expect(upstream.value.body.locked).toBe(false);
    expect(transform.mock.results[0].value.body.locked).toBe(false);
    reader.releaseLock();
    value.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("R2 reports collected semantic progress after the postoutput stall watchdog", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", "20");
    const value = attempt();
    const upstream = controlled([frame("assistantResponseEvent", { content: "private known semantic output" })]);
    const executor = new KiroExecutor();
    const transform = vi.spyOn(executor, "transformEventStreamToSSE");
    fetchMock.mockResolvedValueOnce(upstream.value);
    const result = await execute(executor, { executionOptions: alias(value) });
    const pending = result.response.text();
    await flush();
    expect(value.outputStarted).toBe(true);
    await vi.advanceTimersByTimeAsync(25);
    const text = await pending;
    const error = sseError(text);
    expect(error).toMatchObject({ code: "kiro_missing_terminal", details: {
      attempt: "initial", terminal_provenance: "transport_read_error", transport_state: "upstream_error",
      stop_disposition: "terminal_incomplete", response_state: "text_reasoning"
    } });
    expect(error.details.event_counts).toBe(null);
    expect(error.details.incomplete_frame_bytes).toBe(null);
    expect(text).not.toContain("private known semantic output");
    expect(value.outputStarted).toBe(true);
    expect(value.signal.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstream.cancel).toHaveBeenCalledTimes(1);
    expect(upstream.value.body.locked).toBe(false);
    expect(transform.mock.results[0].value.body.locked).toBe(false);
    value.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["client cancelled", null])("C1 wraps ordinary repair-fetch cancellation reason %s", async reason => {
    vi.useFakeTimers();
    const request = abortController();
    const add = vi.spyOn(request.signal, "addEventListener");
    const remove = vi.spyOn(request.signal, "removeEventListener");
    let entered;
    const pendingRepair = new Promise(resolve => { entered = resolve; });
    const first = response([frame("assistantResponseEvent", { content: "..." })]);
    fetchMock.mockResolvedValueOnce(first);
    fetchMock.mockImplementationOnce((_url, init) => new Promise((resolve, reject) => {
      const onAbort = () => {
        init.signal.removeEventListener("abort", onAbort);
        reject(init.signal.reason);
      };
      init.signal.addEventListener("abort", onAbort, { once: true });
      entered(init.signal);
    }));
    const result = await execute(undefined, { signal: request.signal });
    const settled = result.response.text().then(text => ({ state: "fulfilled", text }), error => ({ state: "rejected", error }));
    const nativeSignal = await pendingRepair;
    expect(nativeSignal.aborted).toBe(false);
    request.abort(reason);
    const outcome = await settled;
    expect(outcome.state).toBe("rejected");
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error.name).toBe("AbortError");
    expect(outcome.error.message).toBe(reason || "Request aborted");
    expect(nativeSignal.aborted).toBe(true);
    expect(nativeSignal.reason).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.body.locked).toBe(false);
    const abortListeners = add.mock.calls.filter(([event]) => event === "abort");
    expect(abortListeners.length).toBeGreaterThan(0);
    for (const [event, listener] of abortListeners) {
      expect(remove.mock.calls.some(call => call[0] === event && call[1] === listener)).toBe(true);
    }
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});

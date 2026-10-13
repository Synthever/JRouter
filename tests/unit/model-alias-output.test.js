import { afterEach, describe, expect, it, vi } from "vitest";
import { createAliasAttempt } from "../../open-sse/services/aliasAttempt.js";
import { gateAliasResponse, isQualifyingModelOutput, readAliasProtocolError } from "../../open-sse/utils/aliasOutput.js";

function sseResponse(chunks, headers = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", ...headers } });
}

async function readAll(response) {
  return new Uint8Array(await response.arrayBuffer());
}

afterEach(() => vi.useRealTimers());

async function isPending(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  return !settled;
}

function controlledResponse(contentType = "text/event-stream", cancel = () => {}) {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; }, cancel });
  return { body, controller, response: new Response(body, { headers: { "content-type": contentType } }) };
}

function readyHeartbeatResponse({ limit = 2048, onPull = () => {}, cancel = () => {} } = {}) {
  const encoder = new TextEncoder();
  const output = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n';
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      onPull(pulls);
      if (pulls <= limit) controller.enqueue(encoder.encode(": ping\n\n"));
      else {
        controller.enqueue(encoder.encode(output));
        controller.close();
      }
    },
    cancel,
  });
  return { body, output, get pulls() { return pulls; }, response: new Response(body, { headers: { "content-type": "text/event-stream" } }) };
}

it("rejects overdue output during a finite ready heartbeat prelude before timer tasks", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000 });
  let cancelReason;
  const fixture = readyHeartbeatResponse({
    onPull(pulls) { if (pulls === 3) vi.setSystemTime(attempt.deadlineAt + 1); },
    cancel(reason) { cancelReason = reason; },
  });
  const result = await gateAliasResponse(fixture.response, { attempt, format: "openai", maxPreludeBytes: 8 }).catch((error) => error);
  try {
    expect(result).toBe(attempt.signal.reason);
    expect(result).toMatchObject({ reason: "initial-output-deadline" });
    expect(attempt.outputStarted).toBe(false);
    expect(cancelReason).toBe(result);
    expect(fixture.body.locked).toBe(false);
    expect(fixture.pulls).toBeLessThan(2048);
  } finally {
    if (result instanceof Response) await result.body.cancel().catch(() => {});
    attempt.dispose();
  }
});

it("yields ready pre-output heartbeats to timer-driven client cancellation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const client = new AbortController();
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000, clientSignal: client.signal });
  let cancelReason;
  const fixture = readyHeartbeatResponse({ cancel(reason) { cancelReason = reason; } });
  const cancellation = setTimeout(() => client.abort("ready-prelude-cancelled"), 0);
  const result = await gateAliasResponse(fixture.response, { attempt, format: "openai", maxPreludeBytes: 8 }).catch((error) => error);
  try {
    expect(result).toBe(attempt.signal.reason);
    expect(result).toMatchObject({ reason: "client", cause: "ready-prelude-cancelled" });
    expect(attempt.outputStarted).toBe(false);
    expect(cancelReason).toBe(result);
    expect(fixture.body.locked).toBe(false);
    expect(fixture.pulls).toBeLessThan(2048);
  } finally {
    clearTimeout(cancellation);
    if (result instanceof Response) await result.body.cancel().catch(() => {});
    attempt.dispose();
  }
});

it("bounds retained bytes across a long ready heartbeat prelude", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fixture = readyHeartbeatResponse();
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000 });
  try {
    const result = await gateAliasResponse(fixture.response, { attempt, format: "openai", maxPreludeBytes: 8 });
    expect(await result.text()).toBe(": ping\n\n" + fixture.output);
    expect(attempt.outputStarted).toBe(true);
    expect(fixture.pulls).toBe(2049);
    expect(fixture.body.locked).toBe(false);
  } finally {
    attempt.dispose();
  }
});

it("rejects late buffered completion before timer tasks", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000 });
  const body = new ReadableStream({
    pull(controller) {
      vi.setSystemTime(attempt.deadlineAt + 1);
      controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"late"}}]}'));
      controller.close();
    },
  });
  const result = await gateAliasResponse(new Response(body), { attempt, format: "openai" }).catch((error) => error);
  try {
    expect(result).toBe(attempt.signal.reason);
    expect(result).toMatchObject({ reason: "initial-output-deadline" });
    expect(attempt.outputStarted).toBe(false);
    expect(body.locked).toBe(false);
  } finally {
    attempt.dispose();
  }
});

it("enforces elapsed time before waiting on an oversized ready frame", async () => {
  vi.useFakeTimers();
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
  let cancelReason;
  const body = new ReadableStream({
    pull(controller) {
      vi.setSystemTime(attempt.deadlineAt + 1);
      controller.enqueue(new TextEncoder().encode(`data: {"metadata":"${"x".repeat(128)}"}\n\n`));
    },
    cancel(reason) { cancelReason = reason; },
  });
  let settled = false;
  const outcome = gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai", maxFrameBytes: 32 }).catch((error) => {
    settled = true;
    return error;
  });
  try {
    for (let i = 0; i < 64; i += 1) await Promise.resolve();
    const settledBeforeTimers = settled;
    await vi.advanceTimersByTimeAsync(100);
    const failure = await outcome;
    expect(settledBeforeTimers).toBe(true);
    expect(failure).toBe(attempt.signal.reason);
    expect(failure).toMatchObject({ reason: "initial-output-deadline" });
    expect(cancelReason).toBe(failure);
    expect(body.locked).toBe(false);
    expect(attempt.outputStarted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    attempt.dispose();
  }
});

it("continues streaming beyond the initial deadline after valid output", async () => {
  vi.useFakeTimers();
  const fixture = controlledResponse();
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
  const first = 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n';
  const tail = 'data: {"choices":[{"delta":{"content":" tail"}}]}\n\n';
  try {
    const pending = gateAliasResponse(fixture.response, { attempt, format: "openai" });
    fixture.controller.enqueue(new TextEncoder().encode(first));
    const response = await pending;
    await vi.advanceTimersByTimeAsync(10000);
    expect(attempt.signal.aborted).toBe(false);
    fixture.controller.enqueue(new TextEncoder().encode(tail));
    fixture.controller.close();
    expect(await response.text()).toBe(first + tail);
    expect(attempt.outputStarted).toBe(true);
    expect(fixture.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    attempt.dispose();
  }
});

it("does not await a non-cooperative source cancellation on deadline", async () => {
  vi.useFakeTimers();
  let canceled = false;
  const fixture = controlledResponse("text/event-stream", () => {
    canceled = true;
    return new Promise(() => {});
  });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
  const pending = gateAliasResponse(fixture.response, { attempt, format: "openai" });
  const outcome = pending.catch((error) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(await isPending(outcome)).toBe(false);
  expect(canceled).toBe(true);
  expect((await outcome).reason).toBe("initial-output-deadline");
  attempt.dispose();
});

it("preserves flat Responses error code and message without inventing HTTP status", () => {
  for (const [status, expectedStatus] of [[undefined, null], [429, 429], ["429", null]]) {
    const event = { type: "error", code: "rate_limit_exceeded", message: "Too many requests", param: null, status };
    expect(readAliasProtocolError(event, "responses")).toEqual({ format: "responses", code: "rate_limit_exceeded", message: "Too many requests", status: expectedStatus, eventType: "error" });
    expect(isQualifyingModelOutput(event, "responses")).toBe(false);
  }
  expect(readAliasProtocolError({ type: "error", code: "outer", message: "outer", error: { code: "nested_code", message: "nested" } }, "responses")).toEqual({ format: "responses", code: "nested_code", message: "nested: nested_code", status: null, eventType: "error" });
});

it("rejects flat Responses SSE errors with provider detail and no output latch", async () => {
  let cancelReason;
  const fixture = controlledResponse("text/event-stream", (reason) => { cancelReason = reason; });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  try {
    const outcome = gateAliasResponse(fixture.response, { attempt, format: "responses" }).catch((error) => error);
    fixture.controller.enqueue(new TextEncoder().encode('event: error\ndata: {"type":"error","code":"rate_limit_exceeded","message":"Too many requests","param":null}\n\n'));
    const failure = await outcome;
    expect(failure).toMatchObject({ code: "ALIAS_PROTOCOL_ERROR", protocolError: true, message: "Too many requests", detail: { code: "rate_limit_exceeded", message: "Too many requests", status: null, eventType: "error" } });
    expect(attempt.outputStarted).toBe(false);
    expect(cancelReason).toBe(failure);
    expect(fixture.body.locked).toBe(false);
  } finally {
    attempt.dispose();
  }
});

it("qualifies Responses refusal fields while rejecting empty and failed refusals", () => {
  const refusal = "I cannot help with that request.";
  const item = (value) => ({ type: "message", content: [{ type: "refusal", refusal: value }] });
  expect(isQualifyingModelOutput({ output: [item(refusal)] }, "responses")).toBe(true);
  expect(isQualifyingModelOutput({ type: "response.refusal.done", refusal }, "responses")).toBe(true);
  expect(isQualifyingModelOutput({ type: "response.refusal.delta", delta: refusal }, "responses")).toBe(true);
  expect(isQualifyingModelOutput({ output: [item("")] }, "responses")).toBe(false);
  expect(isQualifyingModelOutput({ type: "response.refusal.done", refusal: "" }, "responses")).toBe(false);
  expect(isQualifyingModelOutput({ type: "response.refusal.done", refusal, error: { message: "failed" } }, "responses")).toBe(false);
});

it("latches completed refusal-only Responses JSON and replays exact bytes", async () => {
  const bytes = new TextEncoder().encode(' {"object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"I cannot help. café 🌱"}]}]}\n');
  const source = new Response(bytes, { headers: { "content-type": "application/json" } });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  try {
    const result = await gateAliasResponse(source, { attempt, format: "responses" });
    expect(await readAll(result)).toEqual(bytes);
    expect(attempt.outputStarted).toBe(true);
    expect(source.body.locked).toBe(false);
  } finally {
    attempt.dispose();
  }
});

it("latches refusal-done Responses SSE and replays exact bytes", async () => {
  const frame = 'event: response.refusal.done\ndata: {"type":"response.refusal.done","refusal":"I cannot help. café 🌱"}\n\n';
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  try {
    const result = await gateAliasResponse(sseResponse([frame]), { attempt, format: "responses" });
    expect(await readAll(result)).toEqual(new TextEncoder().encode(frame));
    expect(attempt.outputStarted).toBe(true);
  } finally {
    attempt.dispose();
  }
});

it("recognizes completed Responses JSON and wrapped Gemini output", async () => {
  for (const [format, payload] of [
    ["openai-responses", { object: "response", output: [{ type: "message", content: [{ type: "output_text", text: "answer" }] }] }],
    ["gemini-cli", { response: { candidates: [{ content: { parts: [{ text: "answer" }] } }] } }],
  ]) {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const result = await gateAliasResponse(new Response(JSON.stringify(payload)), { attempt, format });
    expect(await result.json()).toEqual(payload);
    expect(attempt.outputStarted).toBe(true);
    attempt.dispose();
  }
});

it("fails closed on malformed protocol shapes and error-with-content", () => {
  for (const [format, event] of [
    ["openai", { choices: {} }], ["openai", { choices: [{ delta: { tool_calls: {} } }] }],
    ["responses", { response: { output: {} } }], ["responses", { type: "response.output_item.added", item: { type: "reasoning", summary: {}, content: {} } }],
    ["responses", { output: {} }], ["gemini", { candidates: {} }],
    ["gemini-cli", { response: { candidates: [{ content: { parts: {} } }] } }],
    ["ollama", { message: { tool_calls: {} } }], ["ollama", { tool_calls: {} }],
    ["openai", { error: { message: "busy" }, choices: [{ delta: { content: "[Error] busy" } }] }],
    ["responses", { response: { error: { message: "busy" }, output: [{ type: "function_call", name: "lookup" }] } }],
    ["gemini-cli", { response: { error: { code: 503, message: "busy" }, candidates: [{ content: { parts: [{ text: "[Error] busy" }] } }] } }],
  ]) expect(isQualifyingModelOutput(event, format)).toBe(false);
});

it("qualifies whitespace text and refuses ID-only non-function tool metadata", () => {
  expect(isQualifyingModelOutput({ choices: [{ delta: { content: " " } }] }, "openai")).toBe(true);
  expect(isQualifyingModelOutput({ choices: [{ delta: { tool_calls: [{ type: "custom", function: { name: "not-a-function" } }] } }] }, "openai")).toBe(false);
});

it("retains a large legitimate metadata frame and replays it once", async () => {
  const prelude = `data: ${JSON.stringify({ metadata: "x".repeat(300000) })}\n\n`;
  const output = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n';
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  const response = await gateAliasResponse(sseResponse([prelude.slice(0, 250000), prelude.slice(250000), output]), { attempt, format: "openai" });
  expect(await response.text()).toBe(prelude + output);
  attempt.dispose();
});

it("deadline survives repeated heartbeat intervals and clears cancellation work", async () => {
  vi.useFakeTimers();
  let interval;
  let beats = 0;
  let canceled = false;
  const fixture = controlledResponse("text/event-stream", () => { canceled = true; clearInterval(interval); });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
  const pending = gateAliasResponse(fixture.response, { attempt, format: "openai", maxPreludeBytes: 8 }).catch((error) => error);
  interval = setInterval(() => {
    beats += 1;
    fixture.controller.enqueue(new TextEncoder().encode(": ping\n\n"));
  }, 10);
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).reason).toBe("initial-output-deadline");
  expect(beats).toBeGreaterThan(1);
  expect(canceled).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  attempt.dispose();
});

it("cancels and unlocks the returned reader and preserves late protocol errors", async () => {
  let cancelReason;
  const fixture = controlledResponse("text/event-stream", (reason) => {
    cancelReason = reason;
    return new Promise(() => {});
  });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  const pending = gateAliasResponse(fixture.response, { attempt, format: "openai" });
  fixture.controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n'));
  const response = await pending;
  const reader = response.body.getReader();
  await reader.read();
  const waiting = reader.read();
  const cancellation = reader.cancel("consumer-stopped");
  expect(await isPending(cancellation)).toBe(false);
  await cancellation;
  expect(await waiting).toEqual({ done: true, value: undefined });
  expect(cancelReason).toBe("consumer-stopped");
  expect(fixture.body.locked).toBe(false);
  expect(attempt.outputStarted).toBe(true);
  reader.releaseLock();
  attempt.dispose();

  const late = controlledResponse();
  const lateAttempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  const output = 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n';
  const error = 'event: error\ndata: {"error":{"message":"late failure"}}\n\n';
  const gated = gateAliasResponse(late.response, { attempt: lateAttempt, format: "openai" });
  late.controller.enqueue(new TextEncoder().encode(output));
  const replay = await gated;
  late.controller.enqueue(new TextEncoder().encode(error));
  late.controller.close();
  expect(await replay.text()).toBe(output + error);
  expect(lateAttempt.outputStarted).toBe(true);
  expect(late.body.locked).toBe(false);
  lateAttempt.dispose();
});

it("rejects a protocol error without awaiting its first non-cooperative cancellation", async () => {
  vi.useFakeTimers();
  let cancelReason;
  const fixture = controlledResponse("text/event-stream", (reason) => {
    cancelReason = reason;
    return new Promise(() => {});
  });
  const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
  const outcome = gateAliasResponse(fixture.response, { attempt, format: "openai" }).catch((error) => error);
  fixture.controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"busy","code":"overloaded"}}\n\n'));
  const pending = await isPending(outcome);
  attempt.dispose();
  expect(pending).toBe(false);
  const failure = await outcome;
  expect(failure).toMatchObject({ code: "ALIAS_PROTOCOL_ERROR", detail: { code: "overloaded" } });
  expect(cancelReason).toBe(failure);
  expect(fixture.body.locked).toBe(false);
  expect(attempt.outputStarted).toBe(false);
});

it("unlocks owned readers after buffered completion, replay EOF and failures", async () => {
  for (const [contentType, payload, failureCode] of [
    ["application/json", '{"choices":[{"message":{"content":"ok"}}]}', null],
    ["application/json", "{", "ALIAS_INVALID_JSON"],
    ["text/event-stream", 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', null],
    ["text/event-stream", 'data: {"choices":[{"delta":{"content":"ok"}}]}', null],
    ["text/event-stream", ": heartbeat\n\n", "ALIAS_NO_OUTPUT"],
  ]) {
    const fixture = controlledResponse(contentType);
    fixture.controller.enqueue(new TextEncoder().encode(payload));
    fixture.controller.close();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    if (failureCode) {
      await expect(gateAliasResponse(fixture.response, { attempt, format: "openai" })).rejects.toMatchObject({ code: failureCode });
    } else {
      const replay = await gateAliasResponse(fixture.response, { attempt, format: "openai" });
      expect(await replay.text()).toBe(payload);
    }
    expect(fixture.body.locked).toBe(false);
    attempt.dispose();
  }
});

it("preserves read failures and abort provenance while releasing readers and listeners", async () => {
  for (const mode of ["before-output", "after-output", "abort-after-output"]) {
    const fixture = controlledResponse();
    const client = new AbortController();
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000, clientSignal: client.signal });
    const add = vi.spyOn(attempt.signal, "addEventListener");
    const remove = vi.spyOn(attempt.signal, "removeEventListener");
    const failure = new Error("upstream read failed");
    const gated = gateAliasResponse(fixture.response, { attempt, format: "openai" });
    const before = gated.catch((error) => error);
    if (mode === "before-output") {
      fixture.controller.error(failure);
      expect(await before).toBe(failure);
    } else {
      fixture.controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
      const response = await gated;
      const reader = response.body.getReader();
      await reader.read();
      const outcome = reader.read().catch((error) => error);
      if (mode === "abort-after-output") client.abort("caller-left");
      else fixture.controller.error(failure);
      expect(await outcome).toBe(mode === "abort-after-output" ? attempt.signal.reason : failure);
      if (mode === "abort-after-output") expect(attempt.signal.reason).toMatchObject({ reason: "client", cause: "caller-left" });
      expect(attempt.outputStarted).toBe(true);
      reader.releaseLock();
    }
    expect(fixture.body.locked).toBe(false);
    for (const [type, listener] of add.mock.calls) {
      expect(remove.mock.calls.some(([removedType, removedListener]) => removedType === type && removedListener === listener)).toBe(true);
    }
    add.mockRestore();
    remove.mockRestore();
    attempt.dispose();
  }
});

describe("semantic model output", () => {
  it.each([
    ["openai", { choices: [{ delta: { content: "hello" } }] }],
    ["openai", { choices: [{ delta: { reasoning_content: "thinking" } }] }],
    ["openai", { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "lookup" } }] } }] }],
    ["openai", { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] }],
    ["claude", { type: "content_block_start", content_block: { type: "tool_use", id: "call-1", name: "lookup" } }],
    ["claude", { type: "content_block_start", content_block: { type: "thinking", thinking: "hmm" } }],
    ["claude", { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } }],
    ["responses", { type: "response.output_text.delta", delta: "hello" }],
    ["responses", { type: "response.output_text.done", text: "hello" }],
    ["responses", { type: "response.reasoning_summary_text.delta", delta: "thinking" }],
    ["responses", { type: "response.reasoning_summary_text.done", text: "thinking" }],
    ["responses", { type: "response.output_item.added", item: { type: "function_call", name: "lookup" } }],
    ["responses", { type: "response.output_item.done", item: { type: "function_call", name: "lookup" } }],
    ["responses", { type: "response.output_item.added", item: { type: "reasoning", summary: [{ text: "thinking" }] } }],
    ["responses", { type: "response.function_call_arguments.done", arguments: "{}" }],
    ["gemini", { candidates: [{ content: { parts: [{ text: "hello" }] } }] }],
    ["gemini", { candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: {} } }] } }] }],
    ["ollama", { message: { content: "hello" } }],
    ["ollama", { message: { tool_calls: [{ function: { name: "lookup" } }] } }],
  ])("qualifies semantic output for %s", (format, event) => {
    expect(isQualifyingModelOutput(event, format)).toBe(true);
  });

  it.each([
    ["openai", { id: "chat-1", choices: [{ delta: { role: "assistant" } }] }],
    ["openai", { choices: [{ delta: { content: "" } }] }],
    ["openai", { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function" }] } }] }],
    ["openai", { choices: [{ delta: {}, finish_reason: "stop" }] }],
    ["openai", { usage: { total_tokens: 1 } }],
    ["claude", { type: "message_start", message: { id: "msg", role: "assistant" } }],
    ["claude", { type: "content_block_start", content_block: { type: "text", text: "" } }],
    ["claude", { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "" } }],
    ["claude", { type: "message_delta", delta: { stop_reason: "end_turn" } }],
    ["responses", { type: "response.created", response: { id: "resp" } }],
    ["responses", { type: "response.output_item.added", item: { type: "message", id: "msg" } }],
    ["responses", { type: "response.function_call_arguments.delta", delta: "" }],
    ["responses", { type: "response.output_item.added", item: { type: "function_call", call_id: "metadata-only" } }],
    ["gemini", { candidates: [{ content: { parts: [{ text: "" }] } }] }],
    ["gemini", { candidates: [{ finishReason: "STOP" }] }],
    ["ollama", { message: { role: "assistant", content: "" } }],
    ["ollama", { done: true, eval_count: 1 }],
  ])("does not accept metadata or empty payload for %s", (format, event) => {
    expect(isQualifyingModelOutput(event, format)).toBe(false);
  });

  it.each([
    ["openai", { error: { message: "upstream unavailable", code: "overloaded" } }],
    ["claude", { type: "error", error: { type: "overloaded_error", message: "try later" } }],
    ["responses", { type: "response.failed", response: { status: "failed", error: { message: "failed" } } }],
    ["gemini", { error: { code: 503, message: "busy", status: "UNAVAILABLE" } }],
    ["ollama", { error: "model unavailable" }],
  ])("recognizes %s protocol failures before output fabrication", (format, event) => {
    expect(readAliasProtocolError(event, format)).toMatchObject({ format });
    expect(isQualifyingModelOutput(event, format)).toBe(false);
  });

  it("allows only valid completed buffered JSON to satisfy readiness", async () => {
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const response = await gateAliasResponse(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "answer" } }] })), { attempt, format: "openai", mode: "buffered" });

    expect(attempt.outputStarted).toBe(true);
    expect(await response.json()).toEqual({ choices: [{ message: { role: "assistant", content: "answer" } }] });
    attempt.dispose();
  });

  it("retains first-output readiness when the client requires a buffered answer but upstream can stream", async () => {
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; } });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const pending = gateAliasResponse(new Response(stream, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai", mode: "buffered" });
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first token"}}]}\n\n'));
    const gated = await pending;

    expect(attempt.outputStarted).toBe(true);
    expect(gated.headers.get("content-type")).toContain("text/event-stream");
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":" rest"}}]}\n\n'));
    controller.close();
    expect(new TextDecoder().decode(await readAll(gated))).toContain("first token");
    attempt.dispose();
  });

  it("does not treat malformed or error JSON as output", async () => {
    const malformedAttempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    await expect(gateAliasResponse(new Response("{"), { attempt: malformedAttempt, format: "openai", mode: "buffered" })).rejects.toThrow();
    expect(malformedAttempt.outputStarted).toBe(false);
    malformedAttempt.dispose();

    const errorAttempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    await expect(gateAliasResponse(new Response(JSON.stringify({ error: { message: "failed" } })), { attempt: errorAttempt, format: "openai", mode: "buffered" })).rejects.toMatchObject({ protocolError: true });
    expect(errorAttempt.outputStarted).toBe(false);
    errorAttempt.dispose();
  });

  it("parses a valid SSE error body on non-2xx status before considering output", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: error\ndata: {"type":"error","error":{"message":"upstream busy","code":"overloaded"}}\n\n'));
        controller.close();
      },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    await expect(gateAliasResponse(new Response(body, { status: 503, headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai" })).rejects.toMatchObject({ protocolError: true });
    expect(attempt.outputStarted).toBe(false);
    attempt.dispose();
  });

  it("reads every byte-fragmented UTF-8 SSE boundary and replays the exact original bytes once", async () => {
    const encoder = new TextEncoder();
    const text = `: ping\r\n\r\ndata: {"id":"x","choices":[{"delta":{"role":"assistant"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"café 🌱"}}]}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const bytes = encoder.encode(text);

    for (let split = 0; split <= bytes.length; split += 1) {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      });
      const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
      const gated = await gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream", "content-length": String(bytes.length), "x-fixture": "keep" } }), { attempt, format: "openai" });

      expect(gated.headers.get("content-length")).toBeNull();
      expect(gated.headers.get("x-fixture")).toBe("keep");
      expect(new TextDecoder().decode(await readAll(gated))).toBe(text);
      expect(attempt.outputStarted).toBe(true);
      attempt.dispose();
    }
  });

  it("aborts and disposes the upstream reader on initial deadline before output", async () => {
    vi.useFakeTimers();
    let canceled = false;
    const body = new ReadableStream({
      pull() {},
      cancel() { canceled = true; },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
    const pending = gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai" });
    const rejection = expect(pending).rejects.toMatchObject({ reason: "initial-output-deadline" });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(attempt.signal.aborted).toBe(true);
    expect(canceled).toBe(true);
    attempt.dispose();
  });

  it("rejects protocol errors before synthesizing apparent content", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"overloaded"}}\n\n'));
        controller.close();
      },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    await expect(gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai" })).rejects.toMatchObject({ protocolError: true });
    expect(attempt.outputStarted).toBe(false);
    attempt.dispose();
  });

  it("rejects an EOF with no semantic output and drops metadata-only prelude", async () => {
    const body = sseResponse([
      ": keepalive\n\n",
      'data: {"id":"only","choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    await expect(gateAliasResponse(body, { attempt, format: "openai" })).rejects.toMatchObject({ code: "ALIAS_NO_OUTPUT" });
    expect(attempt.outputStarted).toBe(false);
    attempt.dispose();
  });

  it("waits until the configured deadline for a frame larger than its retention bound", async () => {
    vi.useFakeTimers();
    let canceled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"metadata":"${"x".repeat(128)}"}\n\n`));
      },
      cancel() { canceled = true; },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
    const pending = gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai", maxFrameBytes: 32 });
    const rejected = expect(pending).rejects.toMatchObject({ reason: "initial-output-deadline" });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(attempt.signal.aborted).toBe(true);
    expect(canceled).toBe(true);
    attempt.dispose();
    vi.useRealTimers();
  });

  it("waits for a large valid output frame instead of rejecting at an undocumented cap", async () => {
    const payload = `data: {"choices":[{"delta":{"content":"${"x".repeat(256)}"}}]}\n\n`;
    const body = sseResponse([payload]);
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 1000 });
    const gated = await gateAliasResponse(body, { attempt, format: "openai", maxFrameBytes: 1024 });

    expect(attempt.outputStarted).toBe(true);
    expect(new TextDecoder().decode(await readAll(gated))).toBe(payload);
    attempt.dispose();
  });

  it("does not let a heartbeat extend the initial deadline", async () => {
    vi.useFakeTimers();
    let canceled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(": keepalive\n\n")); },
      cancel() { canceled = true; },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 100 });
    const pending = gateAliasResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai", maxPreludeBytes: 8 });
    const rejected = expect(pending).rejects.toMatchObject({ reason: "initial-output-deadline" });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(attempt.signal.aborted).toBe(true);
    expect(canceled).toBe(true);
    attempt.dispose();
    vi.useRealTimers();
  });

  it("bounds repeated heartbeat prelude state without accumulating frames", async () => {
    let sent = 0;
    let enqueued = false;
    const stream = new ReadableStream({
      pull(value) {
        if (sent < 24) {
          sent += 1;
          value.enqueue(new TextEncoder().encode(": pulse\n\n"));
          return;
        }
        if (!enqueued) {
          enqueued = true;
          value.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        }
        value.close();
      },
    });
    const attempt = createAliasAttempt({ initialResponseTimeoutMs: 10000 });
    const gated = await gateAliasResponse(new Response(stream, { headers: { "content-type": "text/event-stream" } }), { attempt, format: "openai", maxPreludeBytes: 64 });

    expect(attempt.outputStarted).toBe(true);
    expect(await readAll(gated)).toEqual(expect.any(Uint8Array));
    expect(sent).toBe(24);
    attempt.dispose();
  });
});

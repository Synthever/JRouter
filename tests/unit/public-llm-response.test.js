import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const publicId = "jrouter/deepseek/flash";
const upstreamId = "cbai/flash";
const loadAdapter = () => import("../../src/sse/services/publicLlmResponse.js");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sse(payload, ending = "\n\n", event = "") {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}${ending}`;
}

describe("public streaming response adapter", () => {
  it("rewrites native SSE identities without touching deltas or error data", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    const cases = [
      [FORMATS.OPENAI, { model: upstreamId, ...content }, { model: publicId, ...content }],
      [FORMATS.CLAUDE, { type: "message_start", message: { model: upstreamId, ...content } }, { type: "message_start", message: { model: publicId, ...content } }],
      [FORMATS.OPENAI_RESPONSES, { type: "response.created", response: { model: upstreamId, ...content } }, { type: "response.created", response: { model: publicId, ...content } }],
      [FORMATS.OPENAI_RESPONSE, { type: "response.completed", response: { model: upstreamId, ...content } }, { type: "response.completed", response: { model: publicId, ...content } }],
      [FORMATS.GEMINI, { modelVersion: upstreamId, ...content }, { modelVersion: publicId, ...content }],
      [FORMATS.GEMINI_CLI, { response: { modelVersion: upstreamId, ...content } }, { response: { modelVersion: publicId, ...content } }],
    ];
    for (const [format, payload, expected] of cases) {
      const untouched = sse({ type: "error", error: { message: upstreamId } }) + "event: error\ndata: {\"model\":\"cbai/flash\"}\n\n";
      const response = byteResponse(sse(payload) + untouched, 3, "text/event-stream");
      const result = await adaptPublicLlmResponse(response, { publicId, format });
      expect(await result.text()).toBe(sse(expected) + untouched);
    }
  });

  it("handles every SSE byte boundary, multiline data, CRLF and one EOF frame/DONE", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    const prefix = ': café 🦊\r\nid: keep\r\nretry: 12\r\nevent: chunk\r\n';
    const payload = { model: upstreamId, choices: [{ delta: { content: "é🦊" } }], usage: { model: upstreamId } };
    const passthrough = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n: ping\n\ndata: not-json\n\ndata: {broken\n\ndata: {"error":{"model":"cbai/flash"}}\n\n';
    const input = prefix + 'data: {"model":"cbai/flash",\r\ndata: "choices":[{"delta":{"content":"é🦊"}}],"usage":{"model":"cbai/flash"}}\r\n\r\n' + passthrough + "data: [DONE]";
    const expected = prefix + `data: ${JSON.stringify({ ...payload, model: publicId })}\r\ndata: \r\n\r\n` + passthrough + "data: [DONE]";
    for (let split = 0; split <= encoder.encode(input).length; split++) {
      const result = await adaptPublicLlmResponse(byteResponse(input, split, "text/event-stream"), { publicId, format: FORMATS.OPENAI });
      expect(await result.text(), `split ${split}`).toBe(expected);
    }
    const finalFrame = sse(payload, "");
    const result = await adaptPublicLlmResponse(byteResponse(finalFrame, 1, "text/event-stream"), { publicId, format: FORMATS.OPENAI });
    expect(await result.text()).toBe(sse({ ...payload, model: publicId }, ""));
  });

  it("handles every NDJSON byte boundary and preserves the existing terminal record once", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    const records = [
      { model: upstreamId, message: { content: "é🦊", model: upstreamId }, done: false },
      { model: upstreamId, done: true, done_reason: "stop", eval_count: 3 },
    ];
    const unchanged = '\nnot-json\n{"error":"cbai/flash","model":"cbai/flash"}\n';
    const input = JSON.stringify(records[0]) + "\r\n" + unchanged + JSON.stringify(records[1]);
    const expected = JSON.stringify({ ...records[0], model: publicId }) + "\r\n" + unchanged + JSON.stringify({ ...records[1], model: publicId });
    for (let split = 0; split <= encoder.encode(input).length; split++) {
      const result = await adaptPublicLlmResponse(byteResponse(input, split, "application/x-ndjson"), { publicId, format: FORMATS.OLLAMA });
      expect(await result.text(), `split ${split}`).toBe(expected);
    }
  });

  it("reads only on demand and preserves streaming status and headers", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    let pulls = 0;
    const input = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(encoder.encode(sse({ model: upstreamId }) + sse({ model: upstreamId })));
      },
    }, { highWaterMark: 0 });
    const response = new Response(input, { status: 202, statusText: "Streaming", headers: { "Content-Type": "text/event-stream", "Content-Encoding": "gzip", "Content-Length": "999", "X-Account": "account-1" } });
    response.text = () => { throw new Error("whole-stream buffering forbidden"); };
    const result = await adaptPublicLlmResponse(response, { publicId, format: FORMATS.OPENAI });
    expect(pulls).toBe(0);
    expect(result.status).toBe(202);
    expect(result.statusText).toBe("Streaming");
    expect(Object.fromEntries(result.headers)).toEqual({ "content-type": "text/event-stream", "x-account": "account-1" });
    const reader = result.body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(sse({ model: publicId }));
    expect(pulls).toBe(1);
    expect(decoder.decode((await reader.read()).value)).toBe(sse({ model: publicId }));
    expect(pulls).toBe(1);
    await reader.cancel("finished");
    expect(input.locked).toBe(false);
  });

  it("forwards the original downstream cancellation reason during a pending read", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    let pulls = 0;
    let cancellation;
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    const input = new ReadableStream({
      pull() { pulls++; started(); },
      cancel(reason) { cancellation = reason; },
    }, { highWaterMark: 0 });
    const result = await adaptPublicLlmResponse(new Response(input, { headers: { "Content-Type": "text/event-stream" } }), { publicId, format: FORMATS.OPENAI });
    const reader = result.body.getReader();
    const pending = reader.read();
    await reading;
    const reason = { why: "client disconnected" };
    await reader.cancel(reason);
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(cancellation).toBe(reason);
    expect(pulls).toBe(1);
    expect(input.locked).toBe(false);
  });

  it("propagates upstream stream failures without synthetic output", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    for (const contentType of ["text/event-stream", "application/x-ndjson"]) {
      const failure = new Error("upstream failed");
      let emitted = false;
      const frame = contentType === "text/event-stream" ? sse({ model: upstreamId }) : JSON.stringify({ model: upstreamId }) + "\n";
      const input = new ReadableStream({
        pull(controller) {
          if (emitted) controller.error(failure);
          else { emitted = true; controller.enqueue(encoder.encode(frame)); }
        },
      }, { highWaterMark: 0 });
      const result = await adaptPublicLlmResponse(new Response(input, { headers: { "Content-Type": contentType } }), { publicId, format: FORMATS.OLLAMA });
      const reader = result.body.getReader();
      expect(decoder.decode((await reader.read()).value)).toBe(frame.replace(upstreamId, publicId));
      await expect(reader.read()).rejects.toBe(failure);
      expect(input.locked).toBe(false);
    }
  });
});

function byteResponse(text, split, contentType) {
  const bytes = encoder.encode(text);
  const chunks = [bytes.slice(0, split), bytes.slice(split)].filter(chunk => chunk.length);
  return new Response(new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(chunks.shift());
      else controller.close();
    },
  }), { headers: { "Content-Type": contentType } });
}

describe("public JSON response adapter", () => {
  it("preserves successful status and headers but removes stale decoded-body headers", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    const payload = { model: upstreamId, ...content };
    const response = new Response(JSON.stringify(payload), {
      status: 201, statusText: "Created upstream",
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": "123", "Content-Encoding": "gzip", "X-Account": "account-1" },
    });
    const result = await adaptPublicLlmResponse(response, { publicId, format: FORMATS.OPENAI });
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(201);
    expect(result.statusText).toBe("Created upstream");
    expect(Object.fromEntries(result.headers)).toEqual({ "content-type": "application/json; charset=utf-8", "x-account": "account-1" });
    expect(await result.json()).toEqual({ ...payload, model: publicId });
  });

  it("returns non-OK, bodiless and unsupported responses without consuming them", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    const cases = [
      [new Response(JSON.stringify({ model: upstreamId }), { status: 429, statusText: "Slow down", headers: { "Content-Type": "application/json", "Retry-After": "3" } }), FORMATS.OPENAI],
      [new Response(null, { status: 204 }), FORMATS.OPENAI],
      [new Response(upstreamId, { headers: { "Content-Type": "text/plain" } }), FORMATS.OPENAI],
      [new Response(JSON.stringify({ model: upstreamId }), { headers: { "Content-Type": "application/json" } }), "unknown"],
    ];
    for (const [response, format] of cases) {
      expect(await adaptPublicLlmResponse(response, { publicId, format })).toBe(response);
      expect(response.bodyUsed).toBe(false);
    }
    expect(await cases[0][0].json()).toEqual({ model: upstreamId });
  });

  it("surfaces malformed JSON instead of inventing a response", async () => {
    const { adaptPublicLlmResponse } = await loadAdapter();
    await expect(adaptPublicLlmResponse(new Response('{"model":', { headers: { "Content-Type": "application/json" } }), { publicId, format: FORMATS.OPENAI }))
      .rejects.toBeInstanceOf(SyntaxError);
  });
});

const content = {
  choices: [{ message: { content: upstreamId, tool_calls: [{ id: upstreamId, model: upstreamId }] } }],
  usage: { model: upstreamId, total_tokens: 7 },
  metadata: { model: upstreamId, modelVersion: upstreamId, provider: "cbai", connectionId: "account-1" },
};

describe("public model field allowlist", () => {
  it("clones only protocol identity paths and leaves content and accounting untouched", async () => {
    const { rewritePublicModelFields } = await loadAdapter();
    const cases = [
      [FORMATS.OPENAI, { model: upstreamId, ...content }, "model"],
      [FORMATS.OPENAI, { object: "chat.completion.chunk", model: upstreamId, ...content }, "model"],
      [FORMATS.CLAUDE, { type: "message", model: upstreamId, ...content }, "model"],
      [FORMATS.CLAUDE, { type: "message_start", message: { model: upstreamId, ...content }, ...content }, "message.model"],
      [FORMATS.OPENAI_RESPONSES, { object: "response", model: upstreamId, ...content }, "model"],
      [FORMATS.OPENAI_RESPONSE, { type: "response.completed", response: { model: upstreamId, ...content }, ...content }, "response.model"],
      ...[FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY].flatMap(format => [
        [format, { modelVersion: upstreamId, ...content }, "modelVersion"],
        [format, { response: { modelVersion: upstreamId, ...content }, ...content }, "response.modelVersion"],
      ]),
      [FORMATS.OLLAMA, { model: upstreamId, done: false, ...content }, "model"],
      [FORMATS.OLLAMA, { model: upstreamId, done: true, done_reason: "stop", ...content }, "model"],
    ];
    for (const [format, payload, path] of cases) {
      const before = structuredClone(payload);
      const result = rewritePublicModelFields(payload, publicId, format);
      const [key, nested] = path.split(".");
      const expected = nested
        ? { ...payload, [key]: { ...payload[key], [nested]: publicId } }
        : { ...payload, [key]: publicId };
      expect(result).toEqual(expected);
      expect(result).not.toBe(payload);
      expect(payload).toEqual(before);
      expect(result.choices).toBe(payload.choices);
      expect(result.usage).toBe(payload.usage);
      expect(result.metadata).toBe(payload.metadata);
      if (nested) {
        expect(result[key]).not.toBe(payload[key]);
        expect(result[key].choices).toBe(payload[key].choices);
      }
    }
    for (const type of ["response.created", "response.in_progress", "response.completed", "response.failed", "response.incomplete", "response.queued"]) {
      for (const format of [FORMATS.OPENAI_RESPONSE, FORMATS.OPENAI_RESPONSES]) {
        expect(rewritePublicModelFields({ type, response: { model: upstreamId } }, publicId, format))
          .toEqual({ type, response: { model: publicId } });
      }
    }
  });

  it("passes through absent, inherited, error, delta and unknown-schema identities", async () => {
    const { rewritePublicModelFields } = await loadAdapter();
    const cases = [
      [FORMATS.OPENAI, { choices: [{ delta: { model: upstreamId } }] }],
      [FORMATS.OPENAI, { error: { message: upstreamId, model: upstreamId }, model: upstreamId }],
      [FORMATS.OPENAI, Object.create({ model: upstreamId })],
      [FORMATS.CLAUDE, { type: "content_block_delta", model: upstreamId, message: { model: upstreamId } }],
      [FORMATS.CLAUDE, { type: "message_start", message: { content: upstreamId } }],
      [FORMATS.OPENAI_RESPONSES, { type: "response.output_text.delta", response: { model: upstreamId }, delta: upstreamId }],
      [FORMATS.OPENAI_RESPONSE, { type: "error", response: { model: upstreamId } }],
      [FORMATS.GEMINI, { metadata: { modelVersion: upstreamId } }],
      [FORMATS.OLLAMA, { done: true }],
      ["unknown", { model: upstreamId, modelVersion: upstreamId, response: { model: upstreamId } }],
      [FORMATS.OPENAI, null],
      [FORMATS.OPENAI, [content]],
      [FORMATS.OPENAI, upstreamId],
      [FORMATS.OPENAI, { model: publicId }],
    ];
    for (const [format, payload] of cases) {
      expect(rewritePublicModelFields(payload, publicId, format)).toBe(payload);
    }
  });
});

it("resets an error classification with a bare SSE event field", async () => {
  const { adaptPublicLlmResponse } = await loadAdapter();
  for (const newline of ["\n", "\r\n"]) {
    const reset = `event: error${newline}event${newline}`;
    const error = `event${newline}event: error${newline}`;
    const data = `data: {"model":"cbai/flash","choices":[]}${newline}${newline}`;
    const expected = `data: {"model":"jrouter/deepseek/flash","choices":[]}${newline}${newline}`;
    const result = await adaptPublicLlmResponse(
      byteResponse(reset + data + error + data, reset.length - 1, "text/event-stream"),
      { publicId, format: FORMATS.OPENAI },
    );
    expect(await result.text()).toBe(reset + expected + error + data);
  }
});

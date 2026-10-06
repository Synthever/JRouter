import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let adapter;
let db;
let GET;
let saveUsageStats;
let buildOnStreamComplete;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jrouter-latest-requests-"));
  vi.stubEnv("DATA_DIR", tempDir);
  vi.stubEnv("ENABLE_REQUEST_LOGS", "false");
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ GET } = await import("../../src/app/api/usage/request-logs/route.js"));
  ({ saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js"));
  ({ buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js"));
});

beforeEach(() => {
  adapter.exec("DELETE FROM usageHistory; DELETE FROM usageDaily;");
});

afterAll(() => {
  adapter?.close();
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function latest() {
  const response = await GET(new Request("http://localhost/api/usage/request-logs?format=json"));
  expect(response.status).toBe(200);
  return { response, entries: await response.json() };
}

async function waitForUsage() {
  await vi.waitFor(() => expect(adapter.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(1));
}

describe("Latest Requests data contract", () => {
  it("returns actual request fields instead of text logs, without exposing credentials", async () => {
    await db.saveRequestUsage({
      provider: "codex", model: "gpt-6.1-sol-xhigh",
      tokens: { prompt_tokens: 1234, completion_tokens: 56 },
      timestamp: "2026-10-05T10:00:00.000Z", status: "ok",
      connectionId: "account-private", apiKey: "private-test-credential",
      latency: { ttft: 321, total: 4567 },
    });
    const { response, entries } = await latest();
    expect(entries).toEqual([{
      id: expect.any(Number), timestamp: "2026-10-05T10:00:00.000Z",
      provider: "codex", model: "gpt-6.1-sol-xhigh", status: "ok",
      promptTokens: 1234, completionTokens: 56, ttftMs: 321, durationMs: 4567,
    }]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(entries)).not.toContain("private");
  });

  it("keeps the existing text log contract for the usage log page", async () => {
    await db.saveRequestUsage({ provider: "openai", model: "test-model", tokens: { prompt_tokens: 7, completion_tokens: 2 } });
    const response = await GET(new Request("http://localhost/api/usage/request-logs"));
    const entries = await response.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].split(" | ").slice(1)).toEqual(["test-model", "OPENAI", "-", "7", "2", "ok"]);
  });

  it("returns empty history rather than placeholder requests", async () => {
    const { entries } = await latest();
    expect(entries).toEqual([]);
  });

  it("keeps missing historical timing unknown and preserves error status", async () => {
    await db.saveRequestUsage({ provider: "openai", model: "failed-model", tokens: {}, status: "500" });
    const { entries } = await latest();
    expect(entries[0]).toMatchObject({ model: "failed-model", provider: "openai", promptTokens: 0, completionTokens: 0, status: "500", ttftMs: null, durationMs: null });
  });

  it("uses newest-first order without deduplicating separate identical requests", async () => {
    await db.saveRequestUsage({ provider: "openai", model: "same-model", timestamp: "2026-10-05T10:00:00.000Z", tokens: { input_tokens: 10, output_tokens: 3 } });
    await db.saveRequestUsage({ provider: "openai", model: "same-model", timestamp: "2026-10-05T10:00:01.000Z", tokens: { input_tokens: 10, output_tokens: 3 } });
    const { entries } = await latest();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.timestamp)).toEqual(["2026-10-05T10:00:01.000Z", "2026-10-05T10:00:00.000Z"]);
    expect(entries[0]).toMatchObject({ promptTokens: 10, completionTokens: 3 });
  });

  it("persists timing from the completed stream even with request details disabled", async () => {
    const now = Date.now();
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "codex", model: "stream-model", connectionId: "test-account",
      requestStartTime: now - 1000, body: { messages: [] }, stream: true,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
    });
    onStreamComplete({ content: "OK" }, { prompt_tokens: 20, completion_tokens: 2 }, now - 750);
    await waitForUsage();
    const { entries } = await latest();
    expect(entries[0]).toMatchObject({ provider: "codex", model: "stream-model", promptTokens: 20, completionTokens: 2, ttftMs: 250 });
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(1000);
    expect(adapter.get("SELECT COUNT(*) AS count FROM requestDetails").count).toBe(0);
  });

  it.each([
    [null, false],
    [{ type: "response.created", response: { id: "metadata" } }, false],
    [{ choices: [{ delta: { role: "assistant", content: "" } }] }, false],
    [{ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 2 } }, false],
    [{ type: "content_block_delta", delta: { text: "Hello" } }, true],
    [{ type: "content_block_delta", delta: { partial_json: "{}" } }, true],
    [{ candidates: [{ content: { parts: [{ text: "Hello" }] } }] }, true],
    [{ response: { candidates: [{ content: { parts: [{ functionCall: { name: "read" } }] } }] } }, true],
    [{ message: { content: "Hello" } }, true],
    [{ type: "response.function_call_arguments.delta", delta: "{}" }, true],
    [{ data: { type: "response.reasoning_summary_text.delta", delta: "Thinking" } }, true],
  ])("distinguishes generated output from stream metadata %#", async (chunk, expected) => {
    const { hasTokenContent } = await import("../../open-sse/utils/streamHelpers.js");
    expect(hasTokenContent(chunk)).toBe(expected);
  });

  it("does not replace an absent stream token timestamp with total duration", async () => {
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai", model: "no-token-timestamp", requestStartTime: Date.now() - 1000,
      body: { messages: [] }, stream: true,
    });
    onStreamComplete({ content: "" }, { prompt_tokens: 20, completion_tokens: 1 }, null);
    await waitForUsage();
    const { entries } = await latest();
    expect(entries[0].ttftMs).toBeNull();
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(1000);
  });

  it.each([
    ["passthrough", "openai", { choices: [{ delta: { content: "OK" } }] }],
    ["translate", "openai", { choices: [{ delta: { content: "OK" } }] }],
    ["translate", "openai-responses", { type: "response.output_text.delta", delta: "OK" }],
    ["passthrough", "openai", { choices: [{ delta: { reasoning_content: "Thinking" } }] }],
    ["passthrough", "openai", { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "read", arguments: "{}" } }] } }] }],
  ])("measures first content rather than heartbeat or role metadata (%s/%s)", async (mode, format, content) => {
    const { createSSEStream } = await import("../../open-sse/utils/stream.js");
    let currentTime = 1010;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    try {
      const { onStreamComplete } = buildOnStreamComplete({ provider: "openai", model: "parser-model", body: { messages: [] }, stream: true, requestStartTime: 1000 });
      const transform = createSSEStream({ mode, targetFormat: format, sourceFormat: format, provider: "openai", model: "parser-model", onStreamComplete });
      const consuming = new Response(transform.readable).text();
      const writer = transform.writable.getWriter();
      const encode = (payload) => new TextEncoder().encode(payload);
      await writer.write(encode(": heartbeat\n\n"));
      currentTime = 1050;
      const metadata = format === "openai" ? { choices: [{ delta: { role: "assistant" } }] } : { type: "response.created", response: { id: "resp-test" } };
      await writer.write(encode(`data: ${JSON.stringify(metadata)}\n\n`));
      currentTime = 1200;
      await writer.write(encode(`data: ${JSON.stringify(content)}\n\n`));
      currentTime = 1300;
      const terminal = format === "openai" ? { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 2 } } : { type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 2 } } };
      await writer.write(encode(`data: ${JSON.stringify(terminal)}\n\n`));
      await writer.close();
      await consuming;
      await waitForUsage();
      const { entries } = await latest();
      expect(entries[0]).toMatchObject({ model: "parser-model", ttftMs: 200, durationMs: 300 });
    } finally {
      clock.mockRestore();
    }
  });

  it("records latency through the actual non-streaming response handler", async () => {
    const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
    const result = await handleNonStreamingResponse({
      providerResponse: Response.json({ choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 6 } }),
      provider: "openai", model: "actual-json-model", sourceFormat: "openai", targetFormat: "openai",
      body: { messages: [], stream: false }, stream: false, requestStartTime: Date.now() - 500,
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      trackDone() {}, appendLog() {},
    });
    expect(result.success).toBe(true);
    await waitForUsage();
    const { entries } = await latest();
    expect(entries[0]).toMatchObject({ model: "actual-json-model", promptTokens: 40, completionTokens: 6, ttftMs: null });
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(500);
  });

  it.each(["openai", "openai-responses"])("records latency when %s SSE is converted to JSON", async (format) => {
    const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
    const chunk = format === "openai"
      ? { id: "chat-test", choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 7 } }
      : { type: "response.completed", response: { id: "resp-test", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }], usage: { input_tokens: 50, output_tokens: 7 } } };
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(`${format === "openai-responses" ? "event: response.completed\n" : ""}data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }),
      provider: format === "openai" ? "openai" : "codex", model: `forced-${format}`,
      sourceFormat: "openai", targetFormat: format, body: { messages: [] }, stream: false,
      requestStartTime: Date.now() - 500, trackDone() {}, appendLog() {},
    });
    expect(result.success).toBe(true);
    await waitForUsage();
    const { entries } = await latest();
    expect(entries[0]).toMatchObject({ model: `forced-${format}`, promptTokens: 50, completionTokens: 7, ttftMs: null });
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(500);
  });

  it("persists total latency without inventing a first-token measurement for JSON responses", async () => {
    saveUsageStats({ provider: "openai", model: "json-model", tokens: { prompt_tokens: 30, completion_tokens: 5 }, latency: { total: 800 }, silent: true });
    await waitForUsage();
    const { entries } = await latest();
    expect(entries[0]).toMatchObject({ model: "json-model", promptTokens: 30, completionTokens: 5, ttftMs: null, durationMs: 800 });
  });
});

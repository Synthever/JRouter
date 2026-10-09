/**
 * Muse Spark (Meta Model API) is served by the Responses API. A model that only
 * declares `supportedFormats: ["openai-responses"]` must still be reachable by an
 * OpenAI-format client: the transport must follow the translated body's wire
 * format, otherwise the Responses body (`input`) is POSTed to the default Chat
 * Completions URL and Meta rejects it with `unknown parameter `input``.
 *
 * Second half of the same bug: thinking for the Responses wire must be nested as
 * reasoning.effort, not the Chat-shaped top-level reasoning_effort (Meta rejects
 * `unknown parameter `reasoning_effort``).
 *
 * Repro model: muse/muse-spark-1.3-contributor(xhigh)
 * Ref: https://github.com/decolua/9router/pull/3757
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

const { fetchMock, dataDir, originalDataDir, originalRequestLogs } = await vi.hoisted(async () => {
  const { mkdtempSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const originalDataDir = process.env.DATA_DIR;
  const originalRequestLogs = process.env.ENABLE_REQUEST_LOGS;
  const base = originalDataDir || tmpdir();
  mkdirSync(base, { recursive: true });
  const dataDir = mkdtempSync(join(base, "muse-wire-"));
  process.env.DATA_DIR = dataDir;
  process.env.ENABLE_REQUEST_LOGS = "false";
  return { fetchMock: vi.fn(), dataDir, originalDataDir, originalRequestLogs };
});
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import * as usageDb from "@/lib/usageDb.js";
import * as requestLogger from "../../open-sse/utils/requestLogger.js";
import { getModelTargetFormat, getModelSupportedFormats, getModelUpstreamId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

afterAll(() => {
  globalThis._dbAdapter?.instance?.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [name, value] of Object.entries({ DATA_DIR: originalDataDir, ENABLE_REQUEST_LOGS: originalRequestLogs })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// Mirrors the transport selection in open-sse/handlers/chatCore.js so the
// invariant (body wire === endpoint wire) can be asserted without the full
// handler harness.
function selectTransport(provider, model, sourceFormat) {
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const modelSupportedFormats = getModelSupportedFormats(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const modelTargetTransport = modelTargetFormat ? resolveTransport(provider, modelTargetFormat) : null;
  const useTransport = (!modelSupportedFormats || modelSupportedFormats.includes(sourceFormat))
    ? runtimeTransport
    : modelTargetTransport;
  const targetFormat = useTransport?.format || modelTargetFormat || null;
  return { targetFormat, useTransport };
}

describe("Muse Responses wire routing", () => {
  it("routes an OpenAI client to the Responses transport, matching the translated body", () => {
    const { targetFormat, useTransport } = selectTransport("muse", "muse-spark-1.3-contributor(xhigh)", FORMATS.OPENAI);
    expect(targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.format).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.baseUrl).toBe("https://api.meta.ai/v1/responses");
  });

  it("keeps the upstream id after stripping only the thinking suffix", () => {
    expect(getModelTargetFormat("muse", "muse-spark-1.3-contributor(xhigh)")).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelSupportedFormats("muse", "muse-spark-1.3-contributor(xhigh)")).toEqual([FORMATS.OPENAI_RESPONSES]);
    expect(getModelUpstreamId("muse", "muse-spark-1.3-contributor(xhigh)")).toBe("muse-spark-1.3-contributor(xhigh)");
  });

  it("lets a native Responses client stay on the Responses transport", () => {
    const { targetFormat, useTransport } = selectTransport("muse", "muse-spark-1.3-contributor(xhigh)", FORMATS.OPENAI_RESPONSES);
    expect(targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.baseUrl).toBe("https://api.meta.ai/v1/responses");
  });
});

const MUSE_MODEL = "muse-spark-1.3-contributor(xhigh)";
const MUSE_USAGE = { input_tokens: 12, output_tokens: 7, total_tokens: 19 };
const MUSE_TEXT = {
  type: "message", role: "assistant",
  content: [{ type: "output_text", text: "Hello from Muse", annotations: [] }],
};
const MUSE_TOOL = {
  type: "function_call", id: "fc_muse", call_id: "call_muse", name: "lookup",
  arguments: '{"city":"Jakarta","limit":2}',
};

function museResponse(output) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return new Response([
    event("response.created", { response: { id: "resp_muse", created_at: 1700000000 } }),
    ...output.map((item, output_index) => event("response.output_item.done", { item, output_index })),
    event("response.completed", { response: { status: "completed", usage: MUSE_USAGE } }),
  ].join(""), { headers: { "Content-Type": "text/event-stream" } });
}

async function runMuse(output, sourceFormat = FORMATS.CLAUDE) {
  fetchMock.mockResolvedValueOnce(museResponse(output));
  const onRequestSuccess = vi.fn();
  const request = sourceFormat === FORMATS.OPENAI_RESPONSES
    ? { input: [{ role: "user", content: "Say hello" }] }
    : sourceFormat === FORMATS.CLAUDE
      ? {
        max_tokens: 64,
        messages: [{ role: "user", content: [{ type: "text", text: "Say hello" }] }],
        tools: [{ name: "lookup", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      }
      : { messages: [{ role: "user", content: "Say hello" }] };
  const result = await handleChatCore({
    body: { model: `muse/${MUSE_MODEL}`, stream: false, ...request },
    modelInfo: { provider: "muse", model: MUSE_MODEL },
    credentials: { apiKey: "offline-fixture", providerSpecificData: {} },
    sourceFormatOverride: sourceFormat,
    healthProbe: true,
    onRequestSuccess,
  });
  expect(result.success).toBe(true);
  expect(result.httpStatus).toBe(200);
  expect(result.response.headers.get("Content-Type")).toBe("application/json");
  expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(onRequestSuccess).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.meta.ai/v1/responses");
  const wire = JSON.parse(options.body);
  expect(wire.input).toBeInstanceOf(Array);
  expect(wire.messages).toBeUndefined();
  expect(wire.stream).toBe(sourceFormat !== FORMATS.OPENAI_RESPONSES);
  expect(wire.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
  expect(wire.reasoning_effort).toBeUndefined();
  return result.response.json();
}

// Real core, executor, SSE parser and translator; only outbound HTTP is mocked.
describe("Muse Responses SSE-to-JSON pipeline", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
  });

  it.each([
    { label: "text", output: [MUSE_TEXT], content: [{ type: "text", text: "Hello from Muse" }], stop_reason: "end_turn" },
    { label: "tool use", output: [MUSE_TOOL], content: [{ type: "tool_use", id: "call_muse", name: "lookup", input: { city: "Jakarta", limit: 2 } }], stop_reason: "tool_use" },
    { label: "text plus tool use", output: [MUSE_TEXT, MUSE_TOOL], content: [{ type: "text", text: "Hello from Muse" }, { type: "tool_use", id: "call_muse", name: "lookup", input: { city: "Jakarta", limit: 2 } }], stop_reason: "tool_use" },
    { label: "invalid tool arguments", output: [{ ...MUSE_TOOL, arguments: "{" }], content: [{ type: "tool_use", id: "call_muse", name: "lookup", input: {} }], stop_reason: "tool_use" },
    { label: "empty output", output: [], content: [{ type: "text", text: "" }], stop_reason: "end_turn" },
  ])("returns Claude message JSON for $label", async ({ output, content, stop_reason }) => {
    const json = await runMuse(output);
    expect(json).toEqual({
      id: "resp_muse", type: "message", role: "assistant", model: MUSE_MODEL,
      content, stop_reason, stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    expect(json.choices).toBeUndefined();
    expect(json.object).toBeUndefined();
  });

  it("keeps OpenAI chat completion schema and token usage", async () => {
    const json = await runMuse([MUSE_TEXT, MUSE_TOOL], FORMATS.OPENAI);
    expect(json).toMatchObject({
      object: "chat.completion",
      choices: [{ message: { content: "Hello from Muse", tool_calls: [{ id: "call_muse", function: { name: "lookup", arguments: MUSE_TOOL.arguments } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    });
    expect(json.type).toBeUndefined();
  });

  it("keeps native Responses output and token usage", async () => {
    const json = await runMuse([MUSE_TEXT, MUSE_TOOL], FORMATS.OPENAI_RESPONSES);
    expect(json).toEqual({
      id: "resp_muse", object: "response", created_at: 1700000000, status: "completed",
      output: [MUSE_TEXT, MUSE_TOOL], usage: MUSE_USAGE,
    });
  });

  it("keeps health probes free of usage persistence and request body logging", async () => {
    const spies = [
      vi.spyOn(usageDb, "trackPendingRequest"),
      vi.spyOn(usageDb, "appendRequestLog"),
      vi.spyOn(usageDb, "saveRequestUsage"),
      vi.spyOn(usageDb, "saveRequestDetail"),
      vi.spyOn(requestLogger, "createRequestLogger"),
    ];
    await runMuse([MUSE_TEXT]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  const handlerContext = (sourceFormat, output = [MUSE_TEXT]) => ({
    providerResponse: museResponse(output), sourceFormat, targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "muse", model: MUSE_MODEL, body: { messages: [], stream: false }, stream: false,
    requestStartTime: Date.now(), connectionId: "muse-wire-test", healthProbe: true,
    trackDone: vi.fn(), appendLog: vi.fn(), onRequestSuccess: vi.fn(),
  });

  // Gemini clients always request streaming in core; exercise their JSON handler branch directly.
  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY])("keeps %s response envelope and usage", async (sourceFormat) => {
    const result = await handleForcedSSEToJson(handlerContext(sourceFormat));
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({
      response: {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello from Muse" }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
        modelVersion: MUSE_MODEL, responseId: "resp_muse",
      },
    });
  });

  it("restores caller tool names after Claude conversion", async () => {
    const ctx = handlerContext(FORMATS.CLAUDE, [MUSE_TOOL]);
    ctx.toolNameMap = new Map([["lookup", "Lookup"]]);
    const result = await handleForcedSSEToJson(ctx);
    expect((await result.response.json()).content).toEqual([
      { type: "tool_use", id: "call_muse", name: "Lookup", input: { city: "Jakarta", limit: 2 } },
    ]);
  });

  it("preserves normal usage writes and completion logging", async () => {
    const usage = vi.spyOn(usageDb, "saveRequestUsage");
    const detail = vi.spyOn(usageDb, "saveRequestDetail");
    const ctx = { ...handlerContext(FORMATS.CLAUDE), healthProbe: false, log: { line: vi.fn() }, reqTag: "muse-test" };
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    expect(ctx.trackDone).toHaveBeenCalledOnce();
    expect(ctx.onRequestSuccess).toHaveBeenCalledOnce();
    expect(ctx.appendLog).toHaveBeenCalledWith({ tokens: MUSE_USAGE, status: "200 OK" });
    expect(ctx.log.line).toHaveBeenCalledWith("muse-test", "📊", expect.stringContaining("IN 12 · OUT 7"));
    expect(usage).toHaveBeenCalledOnce();
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "muse", model: MUSE_MODEL,
      tokens: expect.objectContaining({ prompt_tokens: 12, completion_tokens: 7 }),
    }));
    expect(detail).toHaveBeenCalledOnce();
    expect(detail).toHaveBeenCalledWith(expect.objectContaining({
      tokens: { prompt_tokens: 12, completion_tokens: 7 },
      response: { content: "Hello from Muse", thinking: null, finish_reason: "completed" },
      status: "success",
    }));
    await Promise.all([usage.mock.results[0].value, detail.mock.results[0].value]);
    expect(await usageDb.getUsageHistory({ provider: "muse" })).toEqual([
      expect.objectContaining({
        model: MUSE_MODEL, connectionId: "muse-wire-test",
        tokens: expect.objectContaining({ prompt_tokens: 12, completion_tokens: 7 }),
      }),
    ]);
  });
});

describe("Muse Responses thinking wire shape", () => {
  it("writes reasoning.effort (not top-level reasoning_effort) for the Responses wire", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    applyThinking(FORMATS.OPENAI_RESPONSES, "muse-spark-1.3-contributor(xhigh)", body, "muse", { mode: "level", level: "xhigh" });
    expect(body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("clamps max to xhigh for the Responses wire", () => {
    const body = { input: [] };
    applyThinking(FORMATS.OPENAI_RESPONSES, "muse-spark-1.3", body, "muse", { mode: "level", level: "max" });
    expect(body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("keeps Chat Completions clients on the Chat wire (top-level reasoning_effort)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "muse", { mode: "level", level: "high" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });
});

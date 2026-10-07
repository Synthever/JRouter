import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), detail: vi.fn(async () => {}), usage: vi.fn(async () => {}), append: vi.fn(async () => {}), pending: vi.fn(), logger: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestDetail: mocks.detail, saveRequestUsage: mocks.usage, appendRequestLog: mocks.append, trackPendingRequest: mocks.pending }));
vi.mock("open-sse/utils/requestLogger.js", () => ({ createRequestLogger: mocks.logger }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false, execute: mocks.execute, refreshCredentials: mocks.refresh }) }));
import "open-sse/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(async () => ({ response: Response.json({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }] }), url: "https://fixture", headers: { Authorization: "Bearer private-fixture" }, transformedBody: { messages: [] } }));
});
describe("shared pipeline probe isolation", () => {
  const args = () => ({ modelInfo: { provider: "openai", model: "gpt-4o-mini" }, credentials: { apiKey: "private-fixture" }, body: { messages: [{ role: "user", content: "ping" }], max_tokens: 16, stream: false }, healthProbe: true, sourceFormatOverride: "openai", signal: new AbortController().signal });
  it("passes cancellation and probe policy through the actual pipeline without body logs", async () => {
    const result = await handleChatCore(args());
    expect(result.success).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ healthProbe: true, signal: expect.any(AbortSignal) }));
    expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.logger).not.toHaveBeenCalled();
  });
  it("does not refresh and retry a failed authentication probe", async () => {
    mocks.execute.mockResolvedValue({ response: new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 }), url: "https://fixture", headers: {}, transformedBody: {} });
    const result = await handleChatCore(args());
    expect(result.success).toBe(false); expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("converts forced SSE to a checkable response without persisting body logs", async () => {
    mocks.execute.mockResolvedValue({ response: new Response('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }), url: "https://fixture", headers: {}, transformedBody: {} });
    const result = await handleChatCore(args());
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("pong");
    expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.logger).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ core: vi.fn(), credentials: vi.fn(), refresh: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.core }));
vi.mock("@/sse/services/auth.js", () => ({ getProviderCredentials: mocks.credentials }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: mocks.refresh, updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/db/index.js", () => ({ getSettings: async () => ({}) }));
import { probeModel } from "@/lib/health/probe.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue({ connectionId: "credential-reference", apiKey: "secret" });
  mocks.refresh.mockImplementation(async (_provider, creds) => creds);
  mocks.core.mockResolvedValue({ success: true, httpStatus: 200, response: Response.json({ choices: [{ message: { content: "pong" } }] }) });
});
describe("health inference probe", () => {
  const model = { id: "oa/gpt", providerId: "openai", modelId: "gpt" };
  it("uses the shared pipeline with a bounded real inference and returns metadata only", async () => {
    const result = await probeModel(model, { timeoutSeconds: 15 });
    expect(result).toMatchObject({ executed: true, success: true, apiKeyId: "credential-reference", httpStatus: 200 });
    expect(mocks.credentials).toHaveBeenCalledWith("openai", null, "gpt", { requestedModel: "gpt", healthProbe: true });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/secret|pong/);
    expect(mocks.core).toHaveBeenCalledWith(expect.objectContaining({ healthProbe: true, signal: expect.any(AbortSignal), body: expect.objectContaining({ messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 16 }) }));
  });
  it("rejects reachable endpoints that return no usable inference", async () => {
    mocks.core.mockResolvedValue({ success: true, httpStatus: 200, response: Response.json({ object: "chat.completion" }) });
    expect(await probeModel(model, { timeoutSeconds: 15 })).toMatchObject({ success: false, errorType: "INVALID_RESPONSE" });
  });
  it("does not count checks that cannot execute", async () => {
    mocks.credentials.mockResolvedValue(null);
    expect(await probeModel(model, { timeoutSeconds: 15 })).toMatchObject({ executed: false });
    expect(mocks.core).not.toHaveBeenCalled();
  });
  it("sanitizes upstream failures", async () => {
    mocks.core.mockResolvedValue({ success: false, status: 429, error: "insufficient_quota sk-sensitive Bearer abc" });
    const result = await probeModel(model, { timeoutSeconds: 15 });
    expect(result.errorType).toBe("QUOTA_EXCEEDED");
    expect(result.errorMessage).not.toMatch(/sk-sensitive|abc/);
  });
});

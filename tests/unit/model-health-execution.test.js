import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
import { BaseExecutor } from "open-sse/executors/base.js";
import { CommandCodeExecutor } from "open-sse/executors/commandcode.js";
beforeEach(() => vi.clearAllMocks());
describe("health probe execution policy", () => {
  it("does not retry CommandCode errors wrapped in a successful NDJSON response", async () => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ type: "error", error: { message: "temporarily unavailable", statusCode: 503 } }) + "\n"));
    const result = await new CommandCodeExecutor().execute({ model: "model", body: {}, credentials: {}, healthProbe: true });
    expect(result.response.status).toBe(503);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("never retries inference or falls back to another URL on HTTP errors", async () => {
    const executor = new BaseExecutor("fixture", { baseUrls: ["https://one", "https://two"], retry: { 503: { attempts: 2, delayMs: 0 } } });
    mocks.fetch.mockImplementation(async () => new Response("provider error", { status: 503 }));
    const result = await executor.execute({ model: "model", body: {}, credentials: {}, healthProbe: true });
    expect(result.response.status).toBe(503);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry network errors for probes", async () => {
    const executor = new BaseExecutor("fixture", { baseUrls: ["https://one", "https://two"], retry: { 502: { attempts: 2, delayMs: 0 } } });
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(executor.execute({ model: "model", body: {}, credentials: {}, healthProbe: true })).rejects.toThrow("fetch failed");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

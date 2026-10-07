import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{ provider: "openai-compatible-fixture", isActive: true, apiKey: "fixture", providerSpecificData: { baseUrl: "https://fixture/v1", prefix: "fixture" } }]),
  getCombos: vi.fn(async () => []), getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
import { buildModelsList } from "@/app/api/v1/models/route.js";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("health catalog discovery deadline", () => {
  it("bounds metadata body reading as well as the response headers", async () => {
    vi.useFakeTimers();
    let signal;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) };
    }));
    const pending = buildModelsList(["llm"], { skipLiveResolvers: true });
    await vi.advanceTimersByTimeAsync(5001);
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toEqual([]);
  });
});

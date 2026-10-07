import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ allowed: vi.fn(), models: vi.fn(), check: vi.fn(), config: vi.fn(), history: vi.fn(), lease: vi.fn(), batch: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/apiKeyPolicy/dashboardAuth.js", () => ({ canManageApiKeys: mocks.allowed }));
vi.mock("@/lib/health/catalog.js", () => ({ getConfiguredHealthModels: mocks.models }));
vi.mock("@/lib/health/service.js", () => ({
  HealthError: class HealthError extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
  getModelsHealth: mocks.models, getHealthSummary: async () => ({ healthy: 2 }),
  getHealthHistory: mocks.history, checkModel: mocks.check, updateHealthConfig: mocks.config, requireModel: vi.fn(), checkAllModels: mocks.batch,
}));
vi.mock("@/lib/db/repos/modelHealthRepo.js", () => ({ claimLease: mocks.lease, renewLease: vi.fn(), releaseLease: mocks.release, getHealthConfig: vi.fn() }));
import { GET as modelsGet } from "@/app/api/model-health/models/route.js";
import { POST as checkPost } from "@/app/api/model-health/check/route.js";
import { PUT as configPut } from "@/app/api/model-health/config/route.js";
import { POST as batchPost } from "@/app/api/model-health/check-all/route.js";

beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed.mockResolvedValue(true); mocks.models.mockResolvedValue([]); mocks.lease.mockResolvedValue({ id: "batch", owner: "a" });
  mocks.batch.mockImplementation(async ({ onResult }) => { await onResult({ completed: 1, total: 1, modelId: "oa/gpt" }); return { completed: 1, total: 1 }; });
});
const request = (path, method = "GET", body, headers = {}) => new Request(`http://localhost/api/model-health/${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers });
describe("protected health API", () => {
  it("requires dashboard auth on reads, probes, config and batches", async () => {
    mocks.allowed.mockResolvedValue(false);
    for (const [handler, req] of [[modelsGet, request("models")], [checkPost, request("check", "POST", { modelId: "oa/gpt" })], [configPut, request("config?modelId=oa/gpt", "PUT", {})], [batchPost, request("check-all", "POST")]]) {
      expect((await handler(req)).status).toBe(401);
    }
    expect(mocks.models).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations", async () => {
    expect((await checkPost(request("check", "POST", { modelId: "oa/gpt" }, { origin: "https://attacker.example" }))).status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("accepts the browser host when Next.js normalizes the internal request URL", async () => {
    mocks.check.mockResolvedValue({ skipped: true });
    const req = request("check", "POST", { modelId: "oa/gpt" }, { origin: "http://127.0.0.1:20130", host: "127.0.0.1:20130" });
    expect((await checkPost(req)).status).toBe(409);
    expect(mocks.check).toHaveBeenCalled();
  });
  it("returns honest empty state and no-store headers", async () => {
    const response = await modelsGet(request("models"));
    expect(await response.json()).toEqual({ models: [] }); expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not echo internal exceptions or credentials", async () => {
    mocks.check.mockRejectedValue(new Error("Bearer very-sensitive-private-value"));
    const response = await checkPost(request("check", "POST", { modelId: "oa/gpt" }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("very-sensitive");
  });
  it("rejects invalid JSON and reports duplicate checks", async () => {
    expect((await checkPost(new Request("http://localhost/api/model-health/check", { method: "POST", body: "{" }))).status).toBe(400);
    mocks.check.mockResolvedValue({ skipped: true });
    expect((await checkPost(request("check", "POST", { modelId: "oa/gpt" }))).status).toBe(409);
  });
  it("streams progress and releases the batch lease on completion", async () => {
    mocks.models.mockResolvedValue([{ id: "oa/gpt" }]);
    const response = await batchPost(request("check-all", "POST"));
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    expect(events.map((event) => event.type)).toEqual(["start", "result", "done"]);
    expect(mocks.release).toHaveBeenCalledWith({ id: "batch", owner: "a" });
    mocks.lease.mockResolvedValue(null);
    expect((await batchPost(request("check-all", "POST"))).status).toBe(409);
  });
});

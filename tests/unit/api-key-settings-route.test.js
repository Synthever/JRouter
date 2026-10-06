import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authorized: true, key: { id: "id", key: "TOP-SECRET", machineId: "private", name: "production", isActive: true, createdAt: "2026-01-01" } }));
vi.mock("@/lib/apiKeyPolicy/dashboardAuth.js", () => ({ canManageApiKeys: async () => state.authorized }));
vi.mock("@/lib/localDb", () => ({ getApiKeyById: async (id) => id === "id" ? state.key : null, updateApiKey: async (_id, data) => { state.key = { ...state.key, ...data }; return state.key; }, deleteApiKey: async () => true }));
import { GET, PATCH, PUT, DELETE } from "@/app/api/keys/[id]/route.js";
const params = { params: Promise.resolve({ id: "id" }) };
function req(data, method = "PATCH") { return new Request("http://localhost/api/keys/id", { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) }); }
beforeEach(() => { state.authorized = true; });
describe("API-key settings routes", () => {
  it("does not expose raw key or machine ID on GET", async () => {
    const response = await GET(req(undefined, "GET"), params);
    const body = await response.json(); expect(body.key.name).toBe("production"); expect(body.key.key).toBeUndefined(); expect(body.key.machineId).toBeUndefined(); expect(JSON.stringify(body)).not.toContain("TOP-SECRET");
  });
  it("persists validated settings and sanitizes PATCH", async () => {
    const response = await PATCH(req({ maxTokensQuota: 100, name: "renamed" }), params);
    const body = await response.json(); expect(response.status).toBe(200); expect(body.key.maxTokensQuota).toBe(100); expect(body.key.key).toBeUndefined();
  });
  it("rejects secret updates and invalid limits", async () => {
    expect((await PATCH(req({ key: "replacement" }), params)).status).toBe(400);
    expect((await PUT(req({ rateLimitRpm: 0 }, "PUT"), params)).status).toBe(400);
  });
  it.each([GET, PATCH, PUT, DELETE])("rejects unauthorized access before loading or modifying any key", async (handler) => {
    state.authorized = false;
    const response = await handler(req({ name: "hacked" }), params); expect(response.status).toBe(401);
  });
  it("returns 404 for missing key IDs", async () => expect((await GET(req(undefined, "GET"), { params: Promise.resolve({ id: "other" }) })).status).toBe(404));
});

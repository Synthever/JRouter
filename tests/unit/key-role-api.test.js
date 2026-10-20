// Key role input: `role` is a create-time choice, validated with every other
// key setting. It must not enter DEFAULT_KEY_POLICY, which is spread into the
// policy JSON of keys that never chose a role.
import { describe, it, expect, vi, beforeEach } from "vitest";

const created = vi.hoisted(() => ({ args: null }));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: async () => [],
  createApiKey: async (name, machineId, role) => {
    created.args = { name, machineId, role };
    return { id: "k-new", name, key: "sk-abc", machineId, role };
  },
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: async () => "machine-1",
}));
vi.mock("@/lib/apiKeyPolicy/dashboardAuth.js", () => ({
  canManageApiKeys: async () => true,
}));

const { validateKeySettings } = await import("@/lib/apiKeyPolicy/settings.js");
const { DEFAULT_KEY_POLICY } = await import("@/shared/constants/apiKeyPolicy.js");
const { POST } = await import("../../src/app/api/keys/route.js");

const request = (body) =>
  new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  created.args = null;
});

describe("api key role input", () => {
  it("accepts owner and user", () => {
    expect(validateKeySettings({ role: "owner" })).toEqual({ role: "owner" });
    expect(validateKeySettings({ role: "user" })).toEqual({ role: "user" });
  });

  it("rejects any other role", () => {
    expect(() => validateKeySettings({ role: "admin" })).toThrow(/role/i);
  });

  it("keeps role out of DEFAULT_KEY_POLICY", () => {
    expect(Object.keys(DEFAULT_KEY_POLICY)).not.toContain("role");
  });

  it("defaults a creation without role to owner", async () => {
    const res = await POST(request({ name: "friend" }));
    expect(res.status).toBe(201);
    expect(created.args).toEqual({ name: "friend", machineId: "machine-1", role: "owner" });
  });

  it("creates a user key when asked explicitly", async () => {
    const res = await POST(request({ name: "friend", role: "user" }));
    expect(res.status).toBe(201);
    expect(created.args.role).toBe("user");
  });

  it("returns the role in the create response", async () => {
    const res = await POST(request({ name: "friend", role: "user" }));
    const body = await res.json();
    expect(body.role).toBe("user");
  });

  it("rejects an invalid role before creating anything", async () => {
    const res = await POST(request({ name: "friend", role: "root" }));
    expect(res.status).toBe(400);
    expect(created.args).toBeNull();
  });

  it("still requires a name", async () => {
    const res = await POST(request({ role: "user" }));
    expect(res.status).toBe(400);
    expect(created.args).toBeNull();
  });
});

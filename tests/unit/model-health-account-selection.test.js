import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connections: vi.fn(), settings: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.connections,
  getSettings: mocks.settings,
  updateProviderConnection: mocks.update,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

import { getProviderCredentials } from "@/sse/services/auth.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({});
  mocks.connections.mockResolvedValue([
    { id: "exhausted", priority: 1, testStatus: "unavailable", errorCode: 402 },
    { id: "healthy", priority: 2, testStatus: "active" },
  ]);
});

describe("health probe account selection", () => {
  it("prefers a working Kiro account without changing normal routing priority", async () => {
    expect(await getProviderCredentials("kiro", null, "claude-sonnet-4.5", { healthProbe: true }))
      .toMatchObject({ connectionId: "healthy" });
    expect(await getProviderCredentials("kiro", null, "claude-sonnet-4.5"))
      .toMatchObject({ connectionId: "exhausted" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("still probes an unavailable account when none are known to work", async () => {
    mocks.connections.mockResolvedValue([{ id: "exhausted", testStatus: "unavailable" }]);
    expect(await getProviderCredentials("kiro", null, "glm-5", { healthProbe: true }))
      .toMatchObject({ connectionId: "exhausted" });
  });

  it("keeps model locks and exclusions ahead of health preference", async () => {
    mocks.connections.mockResolvedValue([
      { id: "exhausted", testStatus: "unavailable" },
      { id: "locked", testStatus: "active", "modelLock_glm-5": new Date(Date.now() + 60000).toISOString() },
      { id: "excluded", testStatus: "active" },
    ]);
    expect(await getProviderCredentials("kiro", new Set(["excluded"]), "glm-5", { healthProbe: true }))
      .toMatchObject({ connectionId: "exhausted" });
  });
});

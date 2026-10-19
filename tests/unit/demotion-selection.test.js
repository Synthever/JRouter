import { describe, expect, it, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable, clearAccountError, getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { applyDemotionOverlay } = await import("../../src/sse/services/demotion.js");

const baseConn = (overrides = {}) => ({
  id: "conn-1",
  provider: "beatapi",
  name: "key-1",
  priority: 1,
  testStatus: "active",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getSettings.mockResolvedValue({ providerStrategies: {} });
});

describe("move-on-error demotion", () => {
  it("flags demotedAt when a credential error triggers fallback (401)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([baseConn()]);
    await markAccountUnavailable("conn-1", 401, "invalid api key", "beatapi", "glm-5.3-free");
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ demotedAt: expect.any(String) })
    );
  });

  it("flags demotedAt for server errors (5xx)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([baseConn()]);
    await markAccountUnavailable("conn-1", 503, "upstream unavailable", "beatapi", "glm-5.3-free");
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ demotedAt: expect.any(String) })
    );
  });

  it("does NOT demote for payload-caused 4xx that skip fallback (400)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([baseConn()]);
    // checkFallbackError returns shouldFallback:false for this band →
    // markAccountUnavailable exits before any DB write: the credential is
    // untouched (no cooldown, no demotion).
    await markAccountUnavailable("conn-1", 400, "context length exceeded", "beatapi", "glm-5.3-free");
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("clears demotedAt when the key succeeds again", async () => {
    const conn = baseConn({ demotedAt: new Date().toISOString() });
    await clearAccountError("conn-1", conn, "glm-5.3-free");
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ demotedAt: null })
    );
  });
});

describe("demotion-aware key selection", () => {
  it("fill-first picks the healthy key over an earlier demoted key", async () => {
    const demoted = baseConn({ id: "conn-1", name: "key-1", priority: 1, demotedAt: new Date().toISOString() });
    const healthy = baseConn({ id: "conn-2", name: "key-2", priority: 2 });
    dbMocks.getProviderConnections.mockResolvedValue([demoted, healthy]);
    const creds = await getProviderCredentials("beatapi");
    expect(creds.connectionId).toBe("conn-2");
  });

  it("a demoted key is still used when every key is demoted (no deadlock)", async () => {
    const t = new Date().toISOString();
    const a = baseConn({ id: "conn-1", priority: 1, demotedAt: t });
    const b = baseConn({ id: "conn-2", priority: 2, demotedAt: t });
    dbMocks.getProviderConnections.mockResolvedValue([a, b]);
    const creds = await getProviderCredentials("beatapi");
    expect(creds.connectionId).toBe("conn-1");
  });

  it("toggle off (demoteOnError:false) restores pure priority order", async () => {
    const demoted = baseConn({ id: "conn-1", priority: 1, demotedAt: new Date().toISOString() });
    const healthy = baseConn({ id: "conn-2", priority: 2 });
    dbMocks.getProviderConnections.mockResolvedValue([demoted, healthy]);
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: { beatapi: { demoteOnError: false } } });
    const creds = await getProviderCredentials("beatapi");
    expect(creds.connectionId).toBe("conn-1");
  });

  it("overlay keeps manually curated order consistent with the shared helper", () => {
    const t = new Date().toISOString();
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2, demotedAt: t },
      { id: "c", priority: 3 },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["a", "c", "b"]);
  });
});

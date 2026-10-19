import { describe, expect, it, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
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

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const conn = (id, priority, extra = {}) => ({
  id, provider: "beatapi", name: id, priority, testStatus: "active", ...extra,
});

const fourKeys = () => [
  conn("k1", 1), conn("k2", 2), conn("k3", 3), conn("k4", 4),
];

const requestProvider = async () => {
  const creds = await getProviderCredentials("beatapi");
  return creds.connectionId;
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.updateSettings.mockResolvedValue({});
  // Mirror settingsRepo merge semantics: updateSettings({providerStrategies})
  // merges the incoming map over the stored one (shallow per top-level key).
  // Each test starts with round-robin enabled for beatapi; use _setStrategies
  // (never mockResolvedValue, which would kill the stateful cursor behavior).
  let storedStrategies = { beatapi: { fallbackStrategy: "round-robin" } };
  dbMocks.getSettings.mockImplementation(async () => ({ providerStrategies: { ...storedStrategies } }));
  dbMocks.updateSettings.mockImplementation(async (updates) => {
    storedStrategies = { ...storedStrategies, ...(updates.providerStrategies || {}) };
    return {};
  });
  dbMocks._setStrategies = (perProvider) => {
    storedStrategies = { beatapi: { fallbackStrategy: "round-robin" }, ...perProvider };
  };
});

describe("sequential pool round-robin", () => {
  it("rotates 1→2→3→1 strictly in curated order (pool=3 of 4 keys)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue(fourKeys());
    const picks = [];
    for (let i = 0; i < 6; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k1", "k2", "k3", "k1", "k2", "k3"]);
  });

  it("pool size comes from stickyRoundRobinLimit (2 → only first two keys serve)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue(fourKeys());
    dbMocks._setStrategies({ beatapi: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } });
    const picks = [];
    for (let i = 0; i < 4; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k1", "k2", "k1", "k2"]);
  });

  it("pool larger than key count wraps over all keys", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([conn("k1", 1), conn("k2", 2)]);
    dbMocks._setStrategies({ beatapi: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 9 } });
    const picks = [];
    for (let i = 0; i < 4; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k1", "k2", "k1", "k2"]);
  });

  it("a demoted key sinks: the backup key enters the window", async () => {
    const t = new Date().toISOString();
    // k1 failed and is demoted; effective order = k2,k3,k4,[k1]
    dbMocks.getProviderConnections.mockResolvedValue([
      conn("k1", 1, { demotedAt: t }), conn("k2", 2), conn("k3", 3), conn("k4", 4),
    ]);
    const picks = [];
    for (let i = 0; i < 3; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k2", "k3", "k4"]);
  });

  it("a recovered (healthy again) key re-enters the window at its curated spot", async () => {
    dbMocks.getProviderConnections.mockResolvedValue(fourKeys());
    expect(await requestProvider()).toBe("k1");
    // mid-session: k1 errors → demoted; window becomes [k2,k3] (pool 3 of the
    // remaining effective order k2,k3,k4) — wait: poolSize clamps to 3, so the
    // window is k2,k3,k4 and the cursor must survive membership replacement.
    dbMocks.getProviderConnections.mockResolvedValue([
      conn("k1", 1, { demotedAt: new Date().toISOString() }), conn("k2", 2), conn("k3", 3), conn("k4", 4),
    ]);
    expect(await requestProvider()).toBe("k2");
    // k1 succeeded elsewhere (flag cleared) → back at the head of the window;
    // rotation continues from where it was and reaches k1 on its turn.
    dbMocks.getProviderConnections.mockResolvedValue(fourKeys());
    expect(await requestProvider()).toBe("k3");
    expect(await requestProvider()).toBe("k1");
  });

  it("all keys demoted → rotation continues over the demoted pool (no deadlock)", async () => {
    const t = new Date().toISOString();
    dbMocks.getProviderConnections.mockResolvedValue([
      conn("k1", 1, { demotedAt: t }), conn("k2", 2, { demotedAt: t }), conn("k3", 3, { demotedAt: t }),
    ]);
    const picks = [];
    for (let i = 0; i < 4; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k1", "k2", "k3", "k1"]);
  });

  it("demoteOnError:false (opt-out) rotates pure curated order ignoring demotion flags", async () => {
    const t = new Date().toISOString();
    dbMocks.getProviderConnections.mockResolvedValue([
      conn("k1", 1, { demotedAt: t }), conn("k2", 2), conn("k3", 3),
    ]);
    dbMocks._setStrategies({ beatapi: { fallbackStrategy: "round-robin", demoteOnError: false } });
    const picks = [];
    for (let i = 0; i < 3; i += 1) picks.push(await requestProvider());
    expect(picks).toEqual(["k1", "k2", "k3"]);
  });

  it("cursor resets when the window membership changes (no stale index)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue(fourKeys());
    expect(await requestProvider()).toBe("k1"); // cursor: k1 consumed
    expect(await requestProvider()).toBe("k2"); // cursor on k3
    // k2 vanishes (deactivated) → window [k1,k3,k4]; selection must restart
    // cleanly from the window head instead of skipping k3.
    dbMocks.getProviderConnections.mockResolvedValue([conn("k1", 1), conn("k3", 3), conn("k4", 4)]);
    expect(await requestProvider()).toBe("k1");
  });
});

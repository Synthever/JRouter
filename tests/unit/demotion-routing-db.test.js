import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

const ref = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ref.db }));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: async () => ({}),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { updateSettings } from "@/lib/db/repos/settingsRepo.js";
import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "@/sse/services/auth.js";

const provider = "openrouter";
const model = "fixture-model";
const now = Date.parse("2026-10-21T12:00:00Z");
const shutdownEvents = ["beforeExit", "SIGINT", "SIGTERM"];
let listeners;
let keys;

beforeEach(async () => {
  listeners = new Map(shutdownEvents.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  for (const [name, table] of Object.entries(TABLES)) ref.db.exec(buildCreateTableSql(name, table));
  keys = [];
  for (const [i, name] of ["A", "B", "C"].entries()) {
    keys.push(await createProviderConnection({ provider, authType: "apikey", name, priority: i + 1 }));
  }
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  ref.db.close();
  for (const event of shutdownEvents) {
    for (const listener of process.listeners(event)) {
      if (!listeners.get(event).has(listener)) process.removeListener(event, listener);
    }
  }
});

async function demoteAll() {
  for (const [i, key] of keys.entries()) {
    await updateProviderConnection(key.id, { demotedAt: new Date(now - 3000 + i * 1000).toISOString() });
  }
}
const pick = () => getProviderCredentials(provider, null, model);

describe("persistent demotion-aware routing", () => {
  it("after another failure and cooldown, fill-first tries the oldest demoted key instead of the failed head", async () => {
    await demoteAll();
    await markAccountUnavailable(keys[0].id, 503, "Synthetic unavailable", provider, model);
    vi.setSystemTime(now + 24 * 60 * 60 * 1000);

    const selected = await pick();

    expect(selected.connectionId).toBe(keys[1].id);
    expect((await getProviderConnections({ provider })).map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("Round Robin Pool=1 uses the same oldest-demoted head", async () => {
    await demoteAll();
    await updateProviderConnection(keys[0].id, { demotedAt: new Date(now).toISOString() });
    await updateSettings({ providerStrategies: { [provider]: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 } } });

    const selected = await pick();

    expect(selected.connectionId).toBe(keys[1].id);
  });

  it("an explicit opt-out retains manual priority even when failure timestamps differ", async () => {
    await demoteAll();
    await updateProviderConnection(keys[0].id, { demotedAt: new Date(now).toISOString() });
    await updateSettings({ providerStrategies: { [provider]: { demoteOnError: false } } });

    expect((await pick()).connectionId).toBe(keys[0].id);
  });

  it("clearing a successful key restores its curated position", async () => {
    await demoteAll();
    await updateProviderConnection(keys[0].id, { demotedAt: new Date(now).toISOString() });
    const stored = (await getProviderConnections({ provider })).find((c) => c.id === keys[0].id);

    await clearAccountError(stored.id, stored, model);

    expect((await pick()).connectionId).toBe(keys[0].id);
    expect((await getProviderConnections({ provider })).map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("keeps an active model lock excluded even if it is first in the demoted queue", async () => {
    await demoteAll();
    await updateProviderConnection(keys[0].id, { [`modelLock_${model}`]: new Date(now + 60000).toISOString() });

    expect((await pick()).connectionId).toBe(keys[1].id);
  });

  it("a payload error does not demote a healthy key or rewrite its priority", async () => {
    await markAccountUnavailable(keys[0].id, 400, "Synthetic malformed payload", provider, model);

    const stored = (await getProviderConnections({ provider }))[0];
    expect(stored.demotedAt).toBeUndefined();
    expect(stored.priority).toBe(1);
    expect((await pick()).connectionId).toBe(keys[0].id);
  });
});

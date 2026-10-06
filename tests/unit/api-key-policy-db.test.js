import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import migration from "@/lib/db/migrations/002-api-key-policy.js";
import { reserveKeyUsage, accountKeyUsage, finishKeyUsage } from "@/lib/apiKeyPolicy/accounting.js";

const adapterRef = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => adapterRef.db }));
import { getApiKeyById, updateApiKey, validateApiKey } from "@/lib/db/repos/apiKeysRepo.js";

let db;
const now = Date.parse("2026-10-07T12:00:00Z");
beforeEach(async () => {
  db = await createNodeSqliteAdapter(":memory:");
  adapterRef.db = db;
  for (const [name, table] of Object.entries(TABLES)) db.exec(buildCreateTableSql(name, table));
  db.run("INSERT INTO apiKeys(id,key,name,createdAt) VALUES(?,?,?,?)", ["key1", "secret-one", "legacy", new Date(now).toISOString()]);
});
afterEach(() => db.close());

async function configure(policy) { return updateApiKey("key1", policy); }
function reserve(tokens = 10, cost = 0, at = now) { return reserveKeyUsage(db, "key1", { tokens, cost }, at); }

describe("persistent API-key policy", () => {
  it("migrates old rows without replacing secrets", async () => {
    const old = await createNodeSqliteAdapter(":memory:");
    old.exec("CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL)");
    old.run("INSERT INTO apiKeys(id,key,createdAt) VALUES('old','original-secret','2025-01-01')");
    migration.up(old);
    migration.up(old);
    expect(old.get("SELECT * FROM apiKeys WHERE id='old'")).toMatchObject({ key: "original-secret", isActive: 1, policy: "{}", quotaTokens: 0, quotaCost: 0 });
    old.close();
  });
  it("preserves legacy authentication and unrestricted settings", async () => {
    expect(await validateApiKey("secret-one")).toBe(true);
    expect(await getApiKeyById("key1")).toMatchObject({ tokenMultiplier: 1, maxTokensQuota: null });
    expect(reserve()).toBeTruthy();
  });
  it("persists settings and cannot overwrite secrets", async () => {
    await configure({ name: "production", maxTokensQuota: 100, allowedModels: ["gpt-4"] });
    expect(await getApiKeyById("key1")).toMatchObject({ name: "production", maxTokensQuota: 100, allowedModels: ["gpt-4"], key: "secret-one" });
    await expect(configure({ key: "overwrite" })).rejects.toThrow();
  });
  it("rejects expired and revoked keys", async () => {
    await configure({ expiresAt: "2026-10-07T11:59:59Z" });
    expect(() => reserve()).toThrow(/expired/i);
    await configure({ expiresAt: null, isActive: false });
    expect(() => reserve()).toThrow(/inactive/i);
  });
  it("enforces lifetime quota and applies the multiplier to tokens and cost", async () => {
    await configure({ maxTokensQuota: 100, maxCostUsd: 2, tokenMultiplier: 2 });
    const admission = reserve(20, 0.2);
    accountKeyUsage(db, admission, 25, 0.3, now);
    finishKeyUsage(db, admission);
    expect(db.get("SELECT quotaTokens,quotaCost FROM apiKeys WHERE id='key1'")).toMatchObject({ quotaTokens: 50, quotaCost: 0.6 });
    expect(() => reserve(26)).toThrow(/token quota/i);
    expect(() => reserve(1, 0.8)).toThrow(/cost quota/i);
  });
  it("reserves capacity atomically for concurrent requests", async () => {
    await configure({ maxTokensQuota: 20 });
    const first = reserve(15);
    expect(() => reserve(10)).toThrow(/token quota/i);
    finishKeyUsage(db, first);
    expect(reserve(10)).toBeTruthy();
  });
  it("blocks a zero quota", async () => { await configure({ maxTokensQuota: 0 }); expect(() => reserve(0)).toThrow(/token quota/i); });
  it.each(["daily", "monthly"])("lazily resets %s counters", async (cycle) => {
    await configure({ quotaResetCycle: cycle, maxTokensQuota: 20 });
    const first = reserve(15);
    accountKeyUsage(db, first, 15, 0, now); finishKeyUsage(db, first);
    expect(() => reserve(10)).toThrow();
    const next = cycle === "daily" ? Date.parse("2026-10-08T00:00:00Z") : Date.parse("2026-11-01T00:00:00Z");
    expect(reserve(10, 0, next)).toBeTruthy();
    expect(db.get("SELECT quotaTokens FROM apiKeys WHERE id='key1'").quotaTokens).toBe(0);
  });
  it("does not clear counters on a settings edit", async () => {
    const first = reserve(); accountKeyUsage(db, first, 10, 1, now); finishKeyUsage(db, first);
    await configure({ description: "new description" });
    expect(db.get("SELECT quotaTokens FROM apiKeys WHERE id='key1'").quotaTokens).toBe(10);
  });
  it("keeps pending quota reservations across a reset boundary", async () => {
    await configure({ quotaResetCycle: "daily", maxTokensQuota: 20 });
    const midnight = Date.parse("2026-10-08T00:00:00Z");
    reserve(15, 0, midnight - 5000);
    expect(() => reserve(10, 0, midnight)).toThrow(/token quota/i);
  });
  it("isolates rolling RPM by key ID and sends retry metadata", async () => {
    await configure({ rateLimitRpm: 1 }); reserve();
    try { reserve(); expect.fail("must deny"); } catch (error) { expect(error.code).toBe("rate_limit_exceeded"); expect(error.retryAfter).toBe(60); }
    expect(reserve(10, 0, now + 60001)).toBeTruthy();
    db.run("INSERT INTO apiKeys(id,key,createdAt) VALUES('key2','secret-two','2026-10-07')");
    expect(reserveKeyUsage(db, "key2", { tokens: 10, cost: 0 }, now)).toBeTruthy();
  });
  it("enforces TPM and reconciles estimates with actual tokens", async () => {
    await configure({ rateLimitTpm: 20, tokenMultiplier: 2 });
    const first = reserve(15);
    expect(() => reserve(10)).toThrow(/tokens per minute/i);
    accountKeyUsage(db, first, 5, 0, now); finishKeyUsage(db, first);
    expect(reserve(15)).toBeTruthy();
  });
  it("keeps in-flight TPM reservations after a minute and counts tokens when settled", async () => {
    await configure({ rateLimitTpm: 20 });
    const first = reserve(15);
    expect(() => reserve(10, 0, now + 60001)).toThrow(/tokens per minute/i);
    accountKeyUsage(db, first, 15, 0, now + 60001); finishKeyUsage(db, first);
    expect(() => reserve(10, 0, now + 60002)).toThrow(/tokens per minute/i);
    expect(reserve(10, 0, now + 120002)).toBeTruthy();
  });
});

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";
import { DEFAULT_CONFIG } from "@/lib/health/logic.js";

const state = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => state.db }));
import * as repo from "@/lib/db/repos/modelHealthRepo.js";

beforeEach(async () => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const all = (sql, params = []) => {
    const stmt = raw.prepare(sql);
    try { stmt.bind(params); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  };
  state.db = {
    raw, all, get: (sql, params) => all(sql, params)[0],
    run: (sql, params = []) => { raw.run(sql, params); return { changes: raw.getRowsModified() }; },
    transaction: (fn) => { raw.run("BEGIN"); try { const result = fn(); raw.run("COMMIT"); return result; } catch (err) { raw.run("ROLLBACK"); throw err; } },
  };
  for (const name of ["modelHealthConfigs", "modelHealthChecks", "modelHealthLeases"]) raw.run(buildCreateTableSql(name, TABLES[name]));
});
afterEach(() => state.db.raw.close());

describe("health persistence and leases", () => {
  it("filters due models before applying the scheduler batch limit", async () => {
    for (let index = 0; index < 35; index++) await repo.saveHealthConfig(`removed/${index}`, { ...DEFAULT_CONFIG, enabled: true });
    await repo.saveHealthConfig("oa/eligible", { ...DEFAULT_CONFIG, enabled: true });
    expect(await repo.getDueModels(30, ["oa/eligible"])).toEqual(["oa/eligible"]);
  });
  it("persists configuration, serializes models and limits all requests to three slots", async () => {
    await repo.saveHealthConfig("oa/gpt", { ...DEFAULT_CONFIG, enabled: true });
    expect(await repo.getHealthConfig("oa/gpt")).toMatchObject({ enabled: true, intervalSeconds: 300 });
    const first = await repo.claimCheck("oa/gpt", true);
    expect(first).toBeTruthy();
    expect(await repo.claimCheck("oa/gpt")).toBeNull();
    const second = await repo.claimCheck("oa/b");
    const third = await repo.claimCheck("oa/c");
    expect(await repo.claimCheck("oa/d")).toBeNull();
    await repo.releaseCheck(first);
    expect(await repo.claimCheck("oa/d")).toBeTruthy();
    await repo.releaseCheck(second); await repo.releaseCheck(third);
  });
  it("prevents lease takeover and permits expiry recovery", async () => {
    const lease = await repo.claimLease("batch", 1000, "a", 10);
    expect(await repo.claimLease("batch", 1000, "b", 999)).toBeNull();
    const next = await repo.claimLease("batch", 1000, "b", 1010);
    await repo.releaseLease(lease);
    expect(state.db.get("SELECT owner FROM modelHealthLeases WHERE id='batch'").owner).toBe("b");
    await repo.releaseLease(next);
  });
  it("records active status streaks and excludes passive signals from availability", async () => {
    const base = { modelId: "oa/gpt", providerId: "openai", success: true, latencyMs: 100, httpStatus: 200 };
    await repo.recordCheck(base);
    await repo.recordCheck({ ...base, success: false, source: "passive" });
    expect((await repo.getHealthRows())[0]).toMatchObject({ status: "HEALTHY", checks: 1, availability: 100, avgLatencyMs: 100 });
    for (let i = 0; i < 3; i++) await repo.recordCheck({ ...base, success: false });
    expect(await repo.getHealthConfig(base.modelId)).toMatchObject({ status: "DOWN", failures: 3 });
    await repo.recordCheck(base);
    expect((await repo.getHealthConfig(base.modelId)).status).toBe("DOWN");
    await repo.recordCheck(base);
    expect((await repo.getHealthConfig(base.modelId)).status).toBe("HEALTHY");
    expect((await repo.getRecentChecks(base.modelId, 2, 2)).checks).toHaveLength(2);
  });
  it("aggregates buckets, excludes old latency, computes p95 and prunes history", async () => {
    const now = Date.now();
    const base = { modelId: "oa/gpt", providerId: "openai", success: true, httpStatus: 200 };
    await repo.recordCheck({ ...base, latencyMs: 99999, checkedAt: now - 31 * 86400000 });
    for (let i = 1; i <= 20; i++) await repo.recordCheck({ ...base, latencyMs: i * 10, checkedAt: now - 1000 });
    expect(await repo.getP95Latency(base.modelId, now)).toBe(190);
    const timeline = await repo.aggregateTimeline([base.modelId], now - 259200000, now);
    expect(timeline.buckets).toHaveLength(72);
    expect(timeline.checks).toBe(20);
    expect(timeline.availability).toBe(100);
    expect(timeline.buckets[0].availability).toBeNull();
    await repo.pruneHealthHistory(now);
    expect((await repo.getRecentChecks(base.modelId)).total).toBe(20);
  });
  it("does not count a stale worker after its model lease is replaced", async () => {
    const lease = await repo.claimCheck("oa/gpt");
    state.db.run("UPDATE modelHealthLeases SET owner='new' WHERE id=?", [lease.id]);
    expect(await repo.recordCheck({ modelId: "oa/gpt", providerId: "openai", success: true }, lease)).toBeNull();
    expect((await repo.getRecentChecks("oa/gpt")).total).toBe(0);
  });
});

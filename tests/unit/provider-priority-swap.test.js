import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteAdapter } from "@/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

const ref = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ref.db }));
import * as repository from "@/lib/db/repos/connectionsRepo.js";

const events = ["beforeExit", "SIGINT", "SIGTERM"];
let listeners;
beforeEach(async () => {
  listeners = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  ref.db = await createNodeSqliteAdapter(":memory:");
  ref.db.exec(buildCreateTableSql("providerConnections", TABLES.providerConnections));
});
afterEach(() => {
  ref.db.close();
  for (const event of events) {
    for (const listener of process.listeners(event)) {
      if (!listeners.get(event).has(listener)) process.removeListener(event, listener);
    }
  }
});

async function seed(priorities = [1, 2, 3, 4]) {
  for (const [i, priority] of priorities.entries()) {
    ref.db.run("INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)", [
      String.fromCharCode(65 + i), "fixture", "apikey", `Key ${i}`, priority,
      JSON.stringify({ demotedAt: i === 0 ? "2026-10-21T00:00:00Z" : null, modelLock_fixture: "2099-01-01T00:00:00Z" }),
      "2026-10-21", "2026-10-21",
    ]);
  }
}
const snapshot = () => ref.db.all("SELECT * FROM providerConnections ORDER BY id");
const ids = async () => (await repository.getProviderConnections({ provider: "fixture" })).map((c) => c.id);

describe("atomic manual-priority swap", () => {
  it.each([[1, 2, 3, 4], [10, 20, 30, 40], [1, 1, 1, 1]])("swaps positions once without per-request renormalization (%j)", async (...priorities) => {
    await seed(priorities);
    const metadata = snapshot().map(({ priority: _priority, ...rest }) => rest);

    await repository.swapProviderConnectionPriorities("A", "D");

    expect(await ids()).toEqual(["D", "B", "C", "A"]);
    expect(snapshot().map(({ priority: _priority, ...rest }) => rest)).toEqual(metadata);
    expect((await repository.getProviderConnections({ provider: "fixture" })).map((c) => c.priority)).toEqual([1, 2, 3, 4]);
  });

  it("swaps adjacent manual neighbors even when their displayed positions are separated", async () => {
    await seed();

    await repository.swapProviderConnectionPriorities("A", "B");

    expect(await ids()).toEqual(["B", "A", "C", "D"]);
  });

  it.each([["A", "A", 400], ["A", "missing", 404], ["missing", "B", 404]])("rejects invalid swap %s / %s without writes", async (a, b, status) => {
    await seed();
    const before = snapshot();

    await expect(repository.swapProviderConnectionPriorities(a, b)).rejects.toMatchObject({ status });

    expect(snapshot()).toEqual(before);
  });

  it("rejects swapping keys from different providers without writes", async () => {
    await seed();
    ref.db.run("UPDATE providerConnections SET provider='other' WHERE id='D'");
    const before = snapshot();

    await expect(repository.swapProviderConnectionPriorities("A", "D")).rejects.toMatchObject({ status: 400 });

    expect(snapshot()).toEqual(before);
  });

  it("rolls every priority back when a later update fails", async () => {
    await seed();
    const before = snapshot();
    ref.db.exec("CREATE TRIGGER reject_priority BEFORE UPDATE OF priority ON providerConnections WHEN OLD.id='C' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");

    await expect(repository.swapProviderConnectionPriorities("A", "D")).rejects.toThrow("synthetic write failure");

    expect(snapshot()).toEqual(before);
  });
});

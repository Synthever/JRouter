// Orphaned customModels rows (keyed by a deleted provider node's UUID) must be
// pruned on import and on node deletion; live node rows (id or prefix alias)
// and non-node aliases (provider registry ids like cx/openrouter) stay.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-orphan-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

const DEAD = "openai-compatible-chat-d6df7884-7634-4d6f-b53c-4c97dff5c097";
const row = (alias, id) => JSON.stringify({ providerAlias: alias, id, type: "llm", name: id });

async function seed() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, 'openai-compatible', 'Live', ?, ?, ?)`,
    ["openai-compatible-chat-11111111-1111-4111-8111-111111111111", JSON.stringify({ prefix: "lvx", baseUrl: "http://127.0.0.1:9" }), now, now]);
  const kv = (alias, id) => db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [`${alias}|${id}|llm`, row(alias, id)]);
  kv("openai-compatible-chat-11111111-1111-4111-8111-111111111111", "live-id-model");   // node id, live
  kv("lvx", "live-prefix-model");                                                       // node prefix, live
  kv(DEAD, "ghost-model");                                                              // deleted node uuid (the bug)
  kv("cx", "provider-alias-model");                                                     // registry provider alias, not a node
  return db;
}

const customAliasKeys = (db) => db.all(`SELECT key FROM kv WHERE scope='customModels'`).map((r) => r.key);

describe("orphan customModels pruning", () => {
  it("importDb drops rows keyed by deleted node ids and keeps live and non-node rows", async () => {
    const db = await seed();
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const before = customAliasKeys(db);
    expect(before.some((k) => k.startsWith(`${DEAD}|`))).toBe(true);
    await importDb(await exportDb());
    const after = customAliasKeys(await (await import("@/lib/db/driver.js")).getAdapter());
    expect(after.some((k) => k.startsWith(`${DEAD}|`))).toBe(false);
    expect(after.some((k) => k.includes("|live-id-model|"))).toBe(true);
    expect(after.some((k) => k.includes("|live-prefix-model|"))).toBe(true);
    expect(after.some((k) => k.startsWith("cx|"))).toBe(true);
  });

  it("pruneOrphanCustomModels removes only dead node-uuid rows", async () => {
    const db = await seed();
    const { pruneOrphanCustomModels } = await import("@/lib/db/helpers/customModelsPrune.js");
    const removed = pruneOrphanCustomModels(db);
    expect(removed).toBe(1);
    const keys = customAliasKeys(db);
    expect(keys).toHaveLength(3);
    expect(keys.some((k) => k.startsWith(`${DEAD}|`))).toBe(false);
  });

  it("boot migration prunes pre-existing orphans exactly once", async () => {
    const db = await seed();
    // Model a DB that predates the sweep: orphans exist, no marker stamped yet.
    db.run(`DELETE FROM _meta WHERE key = 'customModelsOrphanPrune'`);
    // Simulate a process restart over the same DATA_DIR: close + fresh adapter.
    try { db?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter();
    const keys = db2.all(`SELECT key FROM kv WHERE scope='customModels'`).map((r) => r.key);
    expect(keys.some((k) => k.startsWith(`${DEAD}|`))).toBe(false);
    expect(keys.some((k) => k.includes("|live-id-model|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("cx|"))).toBe(true);
    expect(db2.get(`SELECT value FROM _meta WHERE key='customModelsOrphanPrune'`).value).toBe("v1");
  });

  it("deleteProviderNode also clears row families keyed by the node prefix", async () => {
    const { deleteProviderNode } = await import("@/lib/db/repos/nodesRepo.js");
    const db = await seed();
    await deleteProviderNode("openai-compatible-chat-11111111-1111-4111-8111-111111111111");
    const keys = customAliasKeys(db);
    expect(keys.some((k) => k.includes("|live-id-model|"))).toBe(false);
    expect(keys.some((k) => k.includes("|live-prefix-model|"))).toBe(false);
    expect(keys.some((k) => k.startsWith(`${DEAD}|`))).toBe(true, "unrelated dead rows are not this function's job");
    expect(keys.some((k) => k.startsWith("cx|"))).toBe(true);
  });
});

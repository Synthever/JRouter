import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeLegacyDb(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '3'), ('backupSchemaVersion', '3')`);
  db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL, policy TEXT NOT NULL DEFAULT '{}', accessRestricted INTEGER DEFAULT 0, accessAllow TEXT)`);
  db.exec(`CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT, models TEXT NOT NULL, promptInjectionEnabled INTEGER NOT NULL DEFAULT 0, promptInjectionMode TEXT NOT NULL DEFAULT 'prepend', systemPrompt TEXT, displayIdentity TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  db.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES (?,?,?,?,?,?,?,?)`)
    .run("k1", "sk-legacy-1", "Default Key", "m", 1, "2026-09-01T00:00:00.000Z", 1, '["Main"]');
  db.prepare(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`)
    .run("c1", "Main", null, '["openai/model-a"]', "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  db.close();
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jr-cmid-migrate-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("custom-model-id migration", () => {
  it("adds role/visibility without changing existing access", async () => {
    writeLegacyDb(tempDir);
    delete global._dbAdapter;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");

    const keys = await db.getApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ id: "k1", role: "owner", access: { restricted: true, allow: ["Main"] } });

    const combos = await db.getCombos();
    expect(combos).toHaveLength(1);
    expect(combos[0]).toMatchObject({ name: "Main", visibility: "private", publicName: null });
    expect(combos[0].models).toEqual(["openai/model-a"]);
  });

  it("looks a combo up by its effective public name", async () => {
    writeLegacyDb(tempDir);
    delete global._dbAdapter;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");
    await db.updateCombo("c1", { visibility: "public", publicName: "gpt-fast" });

    expect((await db.getComboByPublicName("gpt-fast"))?.id).toBe("c1");
    expect(await db.getComboByPublicName("nope")).toBeNull();
  });
});

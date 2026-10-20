// A DB whose stored schemaVersion already equals the highest migration number
// must still be recognised as fully migrated — and a DB one version behind must
// advance. Regression guard for the runner comparing against latestVersion().
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-schemaver-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

function schemaVersion(db) {
  return parseInt(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`)?.value ?? "0", 10);
}

describe("schemaVersion counter", () => {
  it("stamps a fresh DB at the latest applied migration", async () => {
    const db = await boot();
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(schemaVersion(db)).toBe(latestVersion());
  });

  it("keeps a DB at the last migration number instead of regressing", async () => {
    const db = await boot();
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(schemaVersion(db)).toBe(latestVersion());

    // Re-boot: the stored value must not be lowered or reset by a second run.
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();
    const db2 = await boot();
    const { latestVersion: latest2 } = await import("@/lib/db/migrations/index.js");
    expect(schemaVersion(db2)).toBe(latest2());
  });

  it("advanced past a pending migration when the stored version is behind", async () => {
    const db = await boot();
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const latest = latestVersion();

    // Put the DB one migration behind and restart.
    db.run(`UPDATE _meta SET value = ? WHERE key = 'schemaVersion'`, [String(latest - 1)]);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const db2 = await boot();
    expect(schemaVersion(db2)).toBe(latest);
  });

  it("does not re-run migrations when every migration is already applied", async () => {
    const db = await boot();
    // A sentinel proves no migration rewrote data on the next boot.
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ['{"sentinel":"kept"}']);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const db2 = await boot();
    const row = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(row.data)).toEqual({ sentinel: "kept" });
  });
});

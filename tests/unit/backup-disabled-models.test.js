// Enabled/disabled models per provider (kv scope 'disabledModels') must survive
// a full backup → restore round trip: exportDb carries them, and importDb wipes
// + restores them so the database matches the backup exactly instead of falling
// back to defaults or keeping the restoring database's own settings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-disabled-backup-"));
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

const kvScopeRows = (db, scope) =>
  Object.fromEntries(db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]).map((r) => [r.key, JSON.parse(r.value)]));

describe("disabledModels in full backup/restore", () => {
  it("exportDb carries per-provider disabled model lists and importDb restores them exactly", async () => {
    const { disableModels, enableModels } = await import("@/lib/db/repos/disabledModelsRepo.js");
    const { exportDb, importDb } = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    await disableModels("cx", ["gpt-5.6-sol", "gpt-5.6-terra"]);
    await disableModels("oc", ["union-alpha"]);
    const payload = await exportDb();

    expect(payload.disabledModels).toEqual({ cx: expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra"]), oc: ["union-alpha"] });

    // Mutate after the backup was taken: enable everything on cx, disable more on ag.
    await enableModels("cx", ["gpt-5.6-sol", "gpt-5.6-terra"]);
    await disableModels("ag", ["gemini-3.8-flash"]);

    await importDb(await structuredClone(payload));

    const db = await getAdapter();
    const restored = kvScopeRows(db, "disabledModels");
    expect(restored.cx.sort()).toEqual(["gpt-5.6-terra", "gpt-5.6-sol"].sort());
    expect(restored.oc).toEqual(["union-alpha"]);
    expect(restored.ag).toBeUndefined();
    expect(Object.keys(restored).sort()).toEqual(["cx", "oc"]);
  });
});

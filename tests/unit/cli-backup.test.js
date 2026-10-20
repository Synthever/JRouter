// `jrouter` TUI backup/restore — payload validation, section counting and path
// handling. The HTTP leg is exercised separately against a live gateway; these
// cases pin the guards that decide whether a file is safe to send at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

// `backup.js` pulls in the API client, which reads machine-id and writes a CLI
// secret on first use. Point DATA_DIR at a throwaway dir before importing.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jrouter-backup-test-"));
process.env.DATA_DIR = scratch;

const backup = require("../../cli/src/cli/menus/backup.js");
const { validatePayload, countSections, resolveBackupPath, getBackupDir, writeBackupFile } = backup.__test__;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backup payload validation", () => {
  it("accepts a payload carrying a known section", () => {
    const res = validatePayload({ providerConnections: [], apiKeys: [] });
    expect(res.ok).toBe(true);
    expect(res.present).toEqual(["providerConnections", "apiKeys"]);
  });

  it("accepts a payload with only settings", () => {
    expect(validatePayload({ settings: { requireLogin: false } }).ok).toBe(true);
  });

  it("rejects an array — a bare JSON list is not a backup", () => {
    const res = validatePayload([{ providerConnections: [] }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/must be a JSON object/);
  });

  it("rejects null and primitives", () => {
    for (const value of [null, 42, "backup", undefined]) {
      expect(validatePayload(value).ok).toBe(false);
    }
  });

  it("rejects an object with no recognised section", () => {
    const res = validatePayload({ unrelated: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No known sections/);
  });

  it("rejects an empty object", () => {
    expect(validatePayload({}).ok).toBe(false);
  });
});

describe("section counting", () => {
  it("counts array sections by length and object sections by key", () => {
    const counts = countSections({
      settings: { a: 1, b: 2 },
      providerConnections: [{}, {}, {}],
      apiKeys: [{}, {}],
      combos: [],
      pricing: { openai: {} },
    });
    expect(counts.settings).toBe(2);
    expect(counts.providerConnections).toBe(3);
    expect(counts.apiKeys).toBe(2);
    expect(counts.combos).toBe(0);
    expect(counts.pricing).toBe(1);
  });

  it("marks absent sections as null so the preview can render a dash", () => {
    const counts = countSections({ settings: {} });
    expect(counts.combos).toBeNull();
    expect(counts.providerConnections).toBeNull();
  });

  it("treats a wrongly-typed section as absent instead of crashing", () => {
    const counts = countSections({ combos: "not-an-array", pricing: 7 });
    expect(counts.combos).toBeNull();
    expect(counts.pricing).toBeNull();
  });
});

describe("post-restore comparison", () => {
  const { diffCounts } = backup.__test__;

  it("reports no mismatch when every section matches", () => {
    const counts = { settings: 2, combos: 1, apiKeys: 3 };
    expect(diffCounts(counts, { ...counts })).toEqual([]);
  });

  it("treats an omitted section and an emptied section as the same outcome", () => {
    // importDb() clears tables the file does not carry, so absent → 0 is correct.
    const file = countSections({ settings: {}, combos: [{}, {}] });
    const after = countSections({ settings: {}, combos: [{}, {}], apiKeys: [], pricing: {} });
    expect(diffCounts(file, after)).toEqual([]);
  });

  it("reports a genuine count difference with both sides", () => {
    const file = countSections({ combos: [{}] });
    const after = countSections({ combos: [{}, {}, {}] });
    expect(diffCounts(file, after)).toEqual([{ label: "combos", from: 1, to: 3 }]);
  });
});

describe("backup path resolution", () => {
  it("resolves relative paths against cwd", () => {
    expect(resolveBackupPath("backup.json")).toBe(path.resolve("backup.json"));
  });

  it("expands a leading tilde", () => {
    const resolved = resolveBackupPath("~/backups/b.json");
    expect(resolved).toBe(path.join(os.homedir(), "backups", "b.json"));
  });

  it("expands a lone tilde to the home directory", () => {
    expect(resolveBackupPath("~")).toBe(os.homedir());
  });

  it("strips wrapping quotes from a dropped path", () => {
    expect(resolveBackupPath('"/tmp/a b.json"')).toBe(path.resolve("/tmp/a b.json"));
    expect(resolveBackupPath("'/tmp/a b.json'")).toBe(path.resolve("/tmp/a b.json"));
  });

  it("keeps an absolute path untouched", () => {
    expect(resolveBackupPath("/var/backups/x.json")).toBe("/var/backups/x.json");
  });
});

describe("backup file writing", () => {
  it("writes owner-only permissions because the payload holds credentials", () => {
    const file = path.join(scratch, "nested", "backup.json");
    writeBackupFile(file, { settings: { ok: true } });
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ settings: { ok: true } });
  });

  it("defaults the backup directory under DATA_DIR", () => {
    expect(getBackupDir()).toBe(path.join(scratch, "backups"));
  });
});

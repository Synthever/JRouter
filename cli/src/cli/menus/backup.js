const fs = require("fs");
const os = require("os");
const path = require("path");
const api = require("../api/client");
const { prompt, pause } = require("../utils/input");
const { showStatus, showTable } = require("../utils/display");

// Backup payload sections, in the order exportDb() produces them.
// `kind` drives rendering: arrays show a row count, objects show a key count.
const SECTIONS = [
  { key: "settings", label: "settings", kind: "object" },
  { key: "providerConnections", label: "providerConnections", kind: "array" },
  { key: "providerNodes", label: "providerNodes", kind: "array" },
  { key: "proxyPools", label: "proxyPools", kind: "array" },
  { key: "apiKeys", label: "apiKeys", kind: "array" },
  { key: "combos", label: "combos", kind: "array" },
  { key: "modelAliases", label: "modelAliases", kind: "object" },
  { key: "customModels", label: "customModels", kind: "array" },
  { key: "mitmAlias", label: "mitmAlias", kind: "object" },
  { key: "pricing", label: "pricing", kind: "object" },
  { key: "disabledModels", label: "disabledModels", kind: "object" }
];

const KNOWN_KEYS = SECTIONS.map((s) => s.key);

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "jrouter");
  }
  return path.join(os.homedir(), ".jrouter");
}

function getBackupDir() {
  return path.join(getDataDir(), "backups");
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * A backup is only usable if it is a plain object carrying at least one
 * section exportDb() writes. Anything else would wipe the live DB for nothing.
 * @param {*} payload - Parsed JSON
 * @returns {{ok: boolean, error?: string, present: string[]}}
 */
function validatePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Backup must be a JSON object", present: [] };
  }
  const present = KNOWN_KEYS.filter((k) => payload[k] !== undefined);
  if (present.length === 0) {
    return {
      ok: false,
      error: `No known sections found (expected one of: ${KNOWN_KEYS.join(", ")})`,
      present: []
    };
  }
  return { ok: true, present };
}

/**
 * Count what a payload actually carries, per section.
 * @param {Object} payload
 * @returns {Object<string, number|null>} section key → count (null = absent)
 */
function countSections(payload) {
  const counts = {};
  for (const section of SECTIONS) {
    const value = payload?.[section.key];
    if (value === undefined || value === null) {
      counts[section.key] = null;
    } else if (section.kind === "array") {
      counts[section.key] = Array.isArray(value) ? value.length : null;
    } else {
      counts[section.key] = typeof value === "object" ? Object.keys(value).length : null;
    }
  }
  return counts;
}

/**
 * Resolve a user-typed path: strips quotes, expands `~`, resolves relative to cwd.
 * @param {string} input
 * @returns {string} absolute path
 */
function resolveBackupPath(input) {
  let p = String(input || "").trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  if (p === "~" || p.startsWith(`~${path.sep}`) || p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

/**
 * Write a backup JSON payload with owner-only permissions — it contains
 * provider credentials and API keys in clear text.
 * @param {string} filePath
 * @param {Object} payload
 */
function writeBackupFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  // writeFileSync only applies mode when creating; enforce it on overwrite too.
  try { fs.chmodSync(filePath, 0o600); } catch { }
}

function renderCountsTable(fileCounts, liveCounts) {
  const rows = SECTIONS.map((section) => {
    const from = liveCounts ? liveCounts[section.key] : null;
    const to = fileCounts[section.key];
    const fmt = (v) => (v === null ? "—" : String(v));
    return [section.label, fmt(from), fmt(to)];
  });
  showTable(["section", "current", "backup"], rows);
}

/**
 * Compare what a file carries against what the server reports after a restore.
 * A section the file omits is cleared to empty by importDb(), so absent (null)
 * and zero are the same outcome — comparing them raw reports a false mismatch.
 * @param {Object} fileCounts
 * @param {Object} afterCounts
 * @returns {Array<{label: string, from: number, to: number}>}
 */
function diffCounts(fileCounts, afterCounts) {
  const normalise = (v) => (v === null || v === undefined ? 0 : v);
  return SECTIONS
    .filter((s) => normalise(afterCounts[s.key]) !== normalise(fileCounts[s.key]))
    .map((s) => ({ label: s.label, from: normalise(fileCounts[s.key]), to: normalise(afterCounts[s.key]) }));
}

/**
 * Export the live database to ~/.jrouter/backups/ and report the path.
 */
async function exportBackup() {
  showStatus("Exporting database...", "info");
  const result = await api.exportDatabase();

  if (!result.success) {
    showStatus(`Export failed: ${result.error}`, "error");
    await pause();
    return;
  }

  const stamp = timestamp();
  const filePath = path.join(getBackupDir(), `jrouter-backup-${stamp}.json`);
  try {
    writeBackupFile(filePath, result.data);
  } catch (err) {
    showStatus(`Could not write ${filePath}: ${err.message}`, "error");
    await pause();
    return;
  }

  const counts = countSections(result.data);
  showStatus("Database exported", "success");
  renderCountsTable(counts, null);
  console.log(`\n  File: ${filePath}`);
  console.log(`  ${"\x1b[2m"}Contains credentials — keep this file private.\x1b[0m`);
  await pause();
}

/**
 * Restore the live database from a JSON backup. Destructive: the server wipes
 * every owned table and rewrites it from the file.
 */
async function restoreBackup() {
  const answer = await prompt("\nBackup file path: ");
  if (!answer) {
    showStatus("Cancelled", "info");
    return;
  }

  const filePath = resolveBackupPath(answer);
  if (!fs.existsSync(filePath)) {
    showStatus(`File not found: ${filePath}`, "error");
    await pause();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    showStatus(`Not a valid JSON file: ${err.message}`, "error");
    await pause();
    return;
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    showStatus(`Invalid backup: ${validation.error}`, "error");
    await pause();
    return;
  }

  const fileCounts = countSections(payload);

  // Live counts are best-effort: the preview still renders if the read fails.
  let liveCounts = null;
  const live = await api.exportDatabase();
  if (live.success) liveCounts = countSections(live.data);
  else showStatus(`Could not read current database: ${live.error}`, "warning");

  console.log(`\nRestoring from: ${filePath}`);
  console.log("\x1b[33mThis replaces the current configuration — it does not merge.\x1b[0m\n");
  renderCountsTable(fileCounts, liveCounts);

  console.log("\nA safety copy of the current database is written before the restore.\n");

  const typed = await prompt('Type RESTORE to continue (anything else cancels): ');
  if (typed !== "RESTORE") {
    showStatus("Cancelled — nothing was changed", "info");
    await pause();
    return;
  }

  // Safety copy first: if the restore is wrong, this is the way back.
  let safetyPath = null;
  if (live.success) {
    const stamp = timestamp();
    const sameDir = path.join(path.dirname(filePath), `pre-restore-${stamp}.json`);
    try {
      writeBackupFile(sameDir, live.data);
      safetyPath = sameDir;
    } catch {
      try {
        const fallback = path.join(getBackupDir(), `pre-restore-${stamp}.json`);
        writeBackupFile(fallback, live.data);
        safetyPath = fallback;
      } catch (err) {
        showStatus(`Could not write safety copy: ${err.message}`, "error");
        showStatus("Restore aborted — no rollback artifact available", "error");
        await pause();
        return;
      }
    }
    console.log(`\n  Safety copy: ${safetyPath}`);
  } else {
    showStatus("Proceeding without a safety copy (current database unreadable)", "warning");
  }

  showStatus("Restoring...", "info");
  const result = await api.importDatabase(payload);

  if (!result.success) {
    showStatus(`Restore failed: ${result.error}`, "error");
    if (safetyPath) console.log(`\n  Recover with: ${safetyPath}`);
    await pause();
    return;
  }

  // Verify by reading the server back rather than trusting the 200 alone.
  const after = await api.exportDatabase();
  if (!after.success) {
    showStatus("Restore reported success but the database could not be re-read", "warning");
    if (safetyPath) console.log(`  Safety copy: ${safetyPath}`);
    await pause();
    return;
  }

  const afterCounts = countSections(after.data);
  const mismatches = diffCounts(fileCounts, afterCounts);

  if (mismatches.length === 0) {
    showStatus("Database restored and verified", "success");
  } else {
    showStatus("Restored, but counts differ from the file:", "warning");
    for (const m of mismatches) {
      console.log(`  ${m.label}: file ${m.from} → server ${m.to}`);
    }
  }
  if (safetyPath) console.log(`\n  Rollback copy: ${safetyPath}`);
  await pause();
}

/**
 * Show the Backup & Restore menu
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showBackupMenu(breadcrumb = []) {
  const { showMenuWithBack } = require("../utils/menuHelper");
  await showMenuWithBack({
    title: "💾  Backup & Restore",
    breadcrumb,
    headerContent: () => `  Backup dir: ${getBackupDir()}`,
    items: [
      {
        label: "Export database to JSON",
        action: async () => { await exportBackup(); return true; }
      },
      {
        label: "Restore database from JSON",
        action: async () => { await restoreBackup(); return true; }
      }
    ]
  });
}

module.exports = {
  showBackupMenu,
  __test__: {
    validatePayload,
    countSections,
    diffCounts,
    resolveBackupPath,
    getBackupDir,
    writeBackupFile,
    SECTIONS,
    KNOWN_KEYS
  }
};

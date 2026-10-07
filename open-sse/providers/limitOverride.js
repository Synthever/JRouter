// Manual context/output limits pinned from the dashboard.
//
// The automatic resolution (heuristic tables refined by the synced catalog) is
// sometimes wrong for models upstream does not publish, and a context_length
// that comes out too low makes the client compact long before the model would
// actually truncate. The admin can therefore pin the two numbers per provider +
// model; a pinned value wins over every table and over the catalog, and an
// unpinned one keeps resolving automatically.
//
// Same read/write plumbing as the catalog reader: the file is the source of
// truth, the parsed copy is dropped when the mtime changes, and writes go
// through a temp file + rename so a crash cannot leave half-written JSON.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { resolveProviderAlias } from "../services/model.js";

export const LIMITS_OVERRIDE_FILE = path.join(DATA_DIR, "model-limits-overrides.json");

// Nothing above 10M tokens exists. A larger number is a typo, and accepting it
// would make every downstream clamp meaningless.
export const MAX_OVERRIDE_TOKENS = 10_000_000;

const EMPTY = { overrides: {} };
let cache = EMPTY;
let cachedMtime = -1;

function load() {
  let mtime;
  try {
    mtime = fs.statSync(LIMITS_OVERRIDE_FILE).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime) return cache;

  cachedMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(LIMITS_OVERRIDE_FILE, "utf8"));
    cache = { overrides: parsed?.overrides || {} };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

// A blank, non-numeric or out-of-range value means "auto", never a limit.
function normalizeTokens(value) {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0 || tokens > MAX_OVERRIDE_TOKENS) return null;
  return Math.round(tokens);
}

function normalizeKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key && key.length <= 200 ? key : null;
}

// The pin lives in the provider id space ("codex"), while some callers pass the
// display alias the seats use ("cx"); both have to hit the same entry.
function normalizeProvider(value) {
  const key = normalizeKey(value);
  return key ? resolveProviderAlias(key) : null;
}

// Keyed by provider + model, exactly like the catalog limits, so one pin covers
// the combo list, /api/models, /v1/models and the runtime clamps.
export function getLimitOverride(provider, model) {
  const providerId = normalizeProvider(provider);
  const modelId = normalizeKey(model);
  if (!providerId || !modelId) return null;

  const entry = load().overrides[providerId]?.[modelId];
  if (!entry) return null;

  const contextWindow = normalizeTokens(entry.contextWindow);
  const maxOutput = normalizeTokens(entry.maxOutput);
  if (!contextWindow && !maxOutput) return null;
  return { contextWindow, maxOutput };
}

export function listLimitOverrides() {
  return load().overrides;
}

// Each field: a number pins it, null (or anything invalid) clears it back to
// auto, and a missing field stays as stored. An entry left with no field is
// dropped so the file only ever lists real pins.
export function setLimitOverride(provider, model, patch = {}) {
  const providerId = normalizeProvider(provider);
  const modelId = normalizeKey(model);
  if (!providerId || !modelId) throw new Error("provider and model are required");

  const overrides = JSON.parse(JSON.stringify(load().overrides));
  const entry = { ...(overrides[providerId]?.[modelId] || {}) };
  if ("contextWindow" in patch) entry.contextWindow = normalizeTokens(patch.contextWindow);
  if ("maxOutput" in patch) entry.maxOutput = normalizeTokens(patch.maxOutput);
  if (!entry.contextWindow) delete entry.contextWindow;
  if (!entry.maxOutput) delete entry.maxOutput;

  if (entry.contextWindow || entry.maxOutput) {
    (overrides[providerId] || (overrides[providerId] = {}))[modelId] = entry;
  } else if (overrides[providerId]) {
    delete overrides[providerId][modelId];
    if (!Object.keys(overrides[providerId]).length) delete overrides[providerId];
  }

  write(overrides);
  return getLimitOverride(providerId, modelId);
}

function write(overrides) {
  fs.mkdirSync(path.dirname(LIMITS_OVERRIDE_FILE), { recursive: true });
  const tmp = `${LIMITS_OVERRIDE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, overrides }, null, 2));
  fs.renameSync(tmp, LIMITS_OVERRIDE_FILE);
  // Serve the new content from this process even if the mtime has not moved yet.
  cache = { overrides };
  cachedMtime = -1;
}

// Hand the reader to capabilities.js. That module is bundled into the browser
// too, so it cannot import this file directly — the server pushes it in.
export async function installLimitOverrideSource() {
  const { setLimitOverrideSource } = await import("./capabilities.js");
  setLimitOverrideSource({ getLimits: getLimitOverride });
}

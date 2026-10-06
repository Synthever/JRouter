import { DEFAULT_KEY_POLICY, API_KEY_ENDPOINTS, QUOTA_CYCLES } from "@/shared/constants/apiKeyPolicy.js";

function validExpiration(value) {
  if (typeof value !== "string") return false;
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const calendarDate = new Date(`${parts[1]}T00:00:00Z`);
  return calendarDate.toISOString().slice(0, 10) === parts[1] && Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60 && Number(parts[5] || 0) < 24 && Number(parts[6] || 0) < 60;
}

export function policyDefaults(policy = {}) {
  return { ...DEFAULT_KEY_POLICY, ...policy };
}

export function validateKeySettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings must be an object.");
  const allowedFields = new Set([...Object.keys(DEFAULT_KEY_POLICY), "name", "isActive"]);
  const result = {};
  for (const [field, value] of Object.entries(input)) {
    if (!allowedFields.has(field)) throw new Error(`Unknown setting: ${field}`);
    if (["name", "description"].includes(field)) {
      if (typeof value !== "string" || value.length > (field === "name" ? 120 : 500) || (field === "name" && !value.trim())) throw new Error(`Invalid ${field}.`);
      result[field] = value.trim();
    } else if (field === "isActive") {
      if (typeof value !== "boolean") throw new Error("isActive must be a boolean.");
      result[field] = value;
    } else if (field === "quotaResetCycle") {
      if (!QUOTA_CYCLES.includes(value)) throw new Error("Invalid quota reset cycle.");
      result[field] = value;
    } else if (field === "expiresAt") {
      if (value !== null && !validExpiration(value)) throw new Error("Invalid expiration date. Use an ISO datetime with a timezone.");
      result[field] = value === null ? null : new Date(value).toISOString();
    } else if (["allowedModels", "blockedModels", "allowedEndpoints"].includes(field)) {
      if (value === null && field === "allowedEndpoints") { result[field] = null; continue; }
      if (!Array.isArray(value) || value.length > 200 || value.some((v) => typeof v !== "string" || !v.trim() || v.length > 256 || /[\s\x00-\x1f]|:\/\//.test(v))) throw new Error(`Invalid ${field}.`);
      if (field === "allowedEndpoints" && value.some((v) => !API_KEY_ENDPOINTS.some((e) => e.value === v))) throw new Error("Invalid endpoint permission.");
      result[field] = [...new Set(value)];
    } else {
      if (value === null && field !== "tokenMultiplier") { result[field] = null; continue; }
      const isInteger = !["maxCostUsd", "tokenMultiplier"].includes(field);
      const minimum = ["maxTokensQuota", "maxCostUsd"].includes(field) ? 0 : Number.MIN_VALUE;
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER || (isInteger && !Number.isSafeInteger(value))) throw new Error(`Invalid ${field}. Enter ${isInteger ? "an integer" : "a number"} ${minimum === 0 ? "at least zero" : "greater than zero"}, or leave empty for unlimited.`);
      result[field] = value;
    }
  }
  return result;
}

export function sanitizeApiKey(key) {
  if (!key) return null;
  const { key: secret, machineId: _machineId, ...safe } = key;
  const keyPrefix = !secret ? "" : secret.length <= 12 ? "••••••" : `${secret.slice(0, 6)}••••••${secret.slice(-4)}`;
  return { ...safe, isExpired: Boolean(key.expiresAt && Date.parse(key.expiresAt) <= Date.now()), keyPrefix };
}

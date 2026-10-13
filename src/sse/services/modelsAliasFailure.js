import { checkFallbackError, getQuotaCooldown } from "open-sse/services/accountFallback.js";
import { BACKOFF_CONFIG, COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId } from "@/shared/constants/providers.js";

const TRANSIENT_MS = [30000, 60000, 120000, 300000];
const NO_PENALTY = new Set(["client", "policy", "quota", "cancelled", "configuration", "collection"]);
const CANCEL_CATEGORIES = new Map([
  ["client", "cancelled"], ["configuration", "configuration"],
  ["collection-grace", "collection"], ["collection-timeout", "collection"],
]);
const MALFORMED_INPUT = /improperly formed request|malformed request|invalid request|maximum context length|context (?:length|window).*exceed|unsupported parameter|request not allowed|invalid json/i;

function errorText(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error == null) return "";
  try { return JSON.stringify(error); } catch { return ""; }
}

function reportedRetryAt(input, now) {
  if (typeof input.resetsAtMs === "number" && Number.isFinite(input.resetsAtMs) && input.resetsAtMs >= 0) return Math.max(now, input.resetsAtMs);
  const value = input.retryAfter;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds * 1000) ? now + seconds * 1000 : null;
  }
  // Negative numeric strings must not be interpreted as calendar dates.
  if (/^[+-]?[\d.]+$/.test(text)) return null;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

/**
 * Input category is server-owned provenance, not a public error envelope.
 * Counters belong to the alias member; retryAt is epoch milliseconds.
 */
export function classifyAliasMemberFailure(input = {}, { now = Date.now(), provider = null, transientFailures = 0, rateLimitLevel = 0 } = {}) {
  transientFailures = Math.min(4, Math.max(0, Math.trunc(transientFailures) || 0));
  rateLimitLevel = Math.min(BACKOFF_CONFIG.maxLevel, Math.max(0, Math.trunc(rateLimitLevel) || 0));
  provider = resolveProviderId(provider);
  let category = input.category;
  let cooldownMs = 0;
  const result = (penalize = false) => ({
    category, penalize,
    shouldFallback: penalize && !input.outputStarted,
    terminal: category !== "success" && (!penalize || !!input.outputStarted),
    cooldownMs, retryAt: penalize ? now + cooldownMs : null,
    transientFailures, rateLimitLevel,
  });

  if (category === "success") {
    transientFailures = 0;
    rateLimitLevel = 0;
    return result();
  }
  if (NO_PENALTY.has(category) && category !== "cancelled") return result();
  if (CANCEL_CATEGORIES.has(input.cancelReason)) {
    category = CANCEL_CATEGORIES.get(input.cancelReason);
    return result();
  }
  if (input.cancelReason === "initial-output-deadline") category = "transient";
  else if (NO_PENALTY.has(category)) return result();

  const status = Number(input.status);
  const text = errorText(input.error);
  let legacy = null;
  if (category === "provider") {
    if (/no credentials/i.test(text)) {
      category = "configuration";
      return result();
    }
    if (MALFORMED_INPUT.test(text)) {
      category = "client";
      return result();
    }
    if (reportedRetryAt(input, now) !== null) category = "rate-limit";
    else {
      legacy = checkFallbackError(status, text, rateLimitLevel, provider);
      if (!legacy.shouldFallback) {
        category = "client";
        return result();
      }
      if (legacy.newBackoffLevel !== undefined) category = "rate-limit";
      else if (status === 401 || status === 403) category = "auth";
      else if (status === 402) category = "payment";
      else if (status === 404 || legacy.cooldownMs !== COOLDOWN_MS.transient) category = "provider";
      else category = "transient";
    }
  }

  if (category === "rate-limit") {
    const reported = reportedRetryAt(input, now);
    if (reported !== null) {
      cooldownMs = provider === "antigravity" && typeof input.resetsAtMs === "number"
        ? reported - now : Math.min(reported - now, MAX_RATE_LIMIT_COOLDOWN_MS);
      rateLimitLevel = 0;
    } else {
      rateLimitLevel = Math.min(rateLimitLevel + 1, BACKOFF_CONFIG.maxLevel);
      cooldownMs = getQuotaCooldown(rateLimitLevel);
    }
  } else if (category === "transient") {
    cooldownMs = TRANSIENT_MS[Math.min(transientFailures, TRANSIENT_MS.length - 1)];
    transientFailures = Math.min(transientFailures + 1, TRANSIENT_MS.length);
  } else if (category === "auth" || category === "payment") {
    cooldownMs = legacy?.cooldownMs ?? (category === "auth" ? COOLDOWN_MS.unauthorized : COOLDOWN_MS.paymentRequired);
  } else if (category === "provider" && legacy) {
    cooldownMs = legacy.cooldownMs;
  } else {
    category = "unknown";
    return result();
  }
  return result(true);
}

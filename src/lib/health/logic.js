export const DEFAULT_CONFIG = Object.freeze({
  enabled: false, intervalSeconds: 300, timeoutSeconds: 15,
  failureThreshold: 3, recoveryThreshold: 2, includeInRouting: true,
});
export const INTERVALS = [60, 300, 600, 900, 1800, 3600];
export const RANGES = { "24h": 86400000, "3d": 259200000, "7d": 604800000 };

export function availability(successes, total) {
  return total > 0 ? Math.round(successes / total * 10000) / 100 : null;
}

export function advanceStatus(previous, success, config) {
  const failures = success ? 0 : (previous.failures || 0) + 1;
  const successes = success ? (previous.successes || 0) + 1 : 0;
  let status = previous.status || "UNKNOWN";
  if (success) {
    if (status === "UNKNOWN" || successes >= config.recoveryThreshold) status = "HEALTHY";
  } else if (failures >= config.failureThreshold) status = "DOWN";
  else if (status !== "DOWN" && failures >= Math.min(2, config.failureThreshold)) status = "DEGRADED";
  return { status, failures, successes };
}

const ERROR_MESSAGES = {
  TIMEOUT: "Health check timed out", RATE_LIMITED: "Provider rate limited the request",
  AUTH_ERROR: "Provider authentication failed", MODEL_NOT_FOUND: "Model is unavailable at the provider",
  PROVIDER_ERROR: "Provider returned a server error", NETWORK_ERROR: "Could not reach the provider",
  INVALID_RESPONSE: "Provider did not return a valid model completion",
  QUOTA_EXCEEDED: "Provider quota or credit balance exhausted", UNKNOWN: "Health check failed",
};

// Persist an allowlisted explanation, never fragments of a provider response.
export function classifyFailure({ httpStatus, message = "", name = "", errorType } = {}) {
  let type = errorType && ERROR_MESSAGES[errorType] ? errorType : "UNKNOWN";
  const text = String(message).toLowerCase();
  if (/timeout|abort/i.test(name) || /timed out/.test(text)) type = "TIMEOUT";
  else if (httpStatus === 402 || /insufficient.quota|quota.exceeded|credit|billing|usage.limit|balance/.test(text)) type = "QUOTA_EXCEEDED";
  else if (httpStatus === 429) type = "RATE_LIMITED";
  else if (httpStatus === 401 || httpStatus === 403) type = "AUTH_ERROR";
  else if (httpStatus === 404) type = "MODEL_NOT_FOUND";
  else if (httpStatus >= 500) type = "PROVIDER_ERROR";
  else if (/invalid.response|no.*completion|empty.response/.test(text) || (httpStatus >= 200 && httpStatus < 300)) type = "INVALID_RESPONSE";
  else if (!httpStatus && /fetch|network|socket|connect|dns|econn|enotfound/.test(text)) type = "NETWORK_ERROR";
  return { errorType: type, errorMessage: ERROR_MESSAGES[type] };
}

export function validateConfig(input, previous = DEFAULT_CONFIG) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid health configuration");
  const config = { ...DEFAULT_CONFIG, ...previous };
  for (const key of Object.keys(DEFAULT_CONFIG)) if (Object.hasOwn(input, key)) config[key] = input[key];
  for (const key of ["enabled", "includeInRouting"]) if (typeof config[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  if (!INTERVALS.includes(config.intervalSeconds)) throw new Error("Choose a supported check interval");
  for (const [key, max] of [["timeoutSeconds", 60], ["failureThreshold", 20], ["recoveryThreshold", 20]]) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > max) throw new Error(`${key} must be an integer between 1 and ${max}`);
  }
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, config[key]]));
}

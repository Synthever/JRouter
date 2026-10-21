// Move-on-error demotion: an errored key is flagged (demotedAt) and sorts after
// every healthy key for this provider until its next success clears the flag.
// The operator's manual priority order is never rewritten — this is a runtime
// overlay, so a recovered key returns to its curated position automatically.
// Payload-caused request errors (no-fallback band below) do NOT demote: the
// credential is not the problem and no inter-key retry happens for them.

// HTTP statuses that say something about the request payload rather than the
// credential/server. Mirrors the no-fallback band in accountFallback.js
// checkFallbackError (4xx except 401/402/403/429) so demotion and inter-key
// retry always agree: demote exactly when the loop falls back.
const NO_DEMOTE_STATUSES = new Set([400, 404, 405, 409, 410, 413, 422]);

/**
 * Whether an upstream failure with this status should demote the key.
 * Null/undefined/0 status = connection-level failure (fetch threw) → demote.
 * @param {number|null} status
 * @returns {boolean}
 */
export function shouldDemoteStatus(status) {
  if (!status) return true; // connection error / abort before response
  return !NO_DEMOTE_STATUSES.has(status);
}

/**
 * Effective connection order: healthy keys first (curated priority order),
 * then demoted keys oldest failure first (new failures move to the tail).
 * Timestamp ties fall back to curated priority. Non-mutating.
 * @param {Array<object>} connections - priority-sorted connections of one provider
 * @returns {Array<object>} new sorted array
 */
export function applyDemotionOverlay(connections) {
  const healthy = [];
  const demoted = [];
  for (const c of connections) {
    (c.demotedAt ? demoted : healthy).push(c);
  }
  const byPriority = (a, b) => (a.priority || 999) - (b.priority || 999);
  const byFailureTime = (a, b) =>
    ((Date.parse(a.demotedAt) || 0) - (Date.parse(b.demotedAt) || 0)) || byPriority(a, b);
  return [...healthy.sort(byPriority), ...demoted.sort(byFailureTime)];
}

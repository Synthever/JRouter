import { joinSharedOperation } from "../../utils/sharedOperation.js";

const REFRESH_RESULT_TTL_MS = 10_000;
const refreshDedupCache = new Map();
const refreshOperations = new Map();

/**
 * dedupRefresh(provider, oldToken, start, log, {signal,recoveryBudget})
 * The remote-acquisition boundary: each uncached owner claims before joining.
 * Outer credential/persistence layers must pass the budget, not claim it too.
 */
export async function dedupRefresh(provider, oldToken, fn, log, { signal, recoveryBudget } = {}) {
  signal?.throwIfAborted();
  const key = oldToken ? `${provider}:${oldToken}` : Symbol(provider);
  const hit = refreshDedupCache.get(key);
  if (hit?.expiresAt > Date.now()) {
    log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
    return hit.result;
  }
  if (hit) refreshDedupCache.delete(key);
  if (recoveryBudget && !recoveryBudget.claimRefresh()) return null;
  return joinSharedOperation(refreshOperations, key, async sharedSignal => {
    sharedSignal.throwIfAborted();
    const result = await fn(sharedSignal);
    sharedSignal.throwIfAborted();
    if (oldToken && result && !result.error && (result.accessToken || result.token || result.apiKey)) {
      refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
    }
    return result;
  }, { signal });
}

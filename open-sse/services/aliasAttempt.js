import { isQualifyingModelOutput, readAliasProtocolError } from "../utils/aliasOutput.js";

const MAX_TIMER_MS = 2_147_483_647;

function makeAbortError(reason, cause) {
  const error = new Error(`Alias attempt aborted: ${reason}`);
  error.name = "AbortError";
  error.code = "ALIAS_ATTEMPT_ABORTED";
  error.reason = reason;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function normalizeAbortReason(reason, cause) {
  if (reason && typeof reason === "object" && typeof reason.reason === "string") {
    return makeAbortError(reason.reason, reason.cause ?? cause);
  }
  const normalized = typeof reason === "string" ? reason : "cancelled";
  const taxonomy = new Set(["client", "configuration", "collection", "initial-output-deadline"]);
  return makeAbortError(taxonomy.has(normalized) ? normalized : "cancelled", cause ?? reason);
}

function validateTimeout(timeoutMs) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    throw new TypeError("Initial response timeout must be a finite timer value");
  }
  const timerDelay = Math.ceil(timeoutMs);
  if (timerDelay < 1 || timerDelay > MAX_TIMER_MS) {
    throw new RangeError("Initial response timeout must be representable by a JS timer");
  }
  return timerDelay;
}

/**
 * Create per-member-attempt cancellation, readiness and per-account recovery state.
 * @param {{initialResponseTimeoutMs:number,clientSignal?:AbortSignal,collectionSignal?:AbortSignal,configSignal?:AbortSignal}} options
 */
export function createAliasAttempt({ initialResponseTimeoutMs, clientSignal, collectionSignal, configSignal } = {}) {
  const timerDelay = validateTimeout(initialResponseTimeoutMs);
  const controller = new AbortController();
  const sourceListeners = [];
  const accountBudgets = new Map();
  let outputStarted = false;
  let disposed = false;
  let timer = null;
  const deadlineAt = Date.now() + timerDelay;

  const clearInitialTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clearSourceListeners = () => {
    for (const [signal, listener] of sourceListeners) signal.removeEventListener("abort", listener);
    sourceListeners.length = 0;
  };

  const abort = (reason = "cancelled", cause) => {
    if (controller.signal.aborted) return false;
    clearInitialTimer();
    clearSourceListeners();
    controller.abort(normalizeAbortReason(reason, cause));
    return true;
  };

  const sources = [[clientSignal, "client"], [configSignal, "configuration"], [collectionSignal, "collection"]];
  for (const [signal] of sources) {
    if (signal && typeof signal.addEventListener !== "function") throw new TypeError("Alias attempt source signals must be AbortSignal instances");
  }
  const attachSignal = (signal, reason) => {
    if (!signal || controller.signal.aborted) return;
    const onAbort = () => abort(reason, signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    sourceListeners.push([signal, onAbort]);
  };

  for (const [signal, reason] of sources) attachSignal(signal, reason);


  if (!controller.signal.aborted) {
    timer = setTimeout(() => abort("initial-output-deadline"), timerDelay);
  }

  const markOutput = (event, format) => {
    if (!outputStarted && Date.now() >= deadlineAt) abort("initial-output-deadline");
    if (outputStarted || controller.signal.aborted) return false;
    if (readAliasProtocolError(event, format) || !isQualifyingModelOutput(event, format)) return false;
    if (Date.now() >= deadlineAt) {
      abort("initial-output-deadline");
      return false;
    }
    outputStarted = true;
    clearInitialTimer();
    return true;
  };

  const getAccountRecoveryBudget = (accountKey) => {
    if ((typeof accountKey !== "string" && typeof accountKey !== "number" && typeof accountKey !== "symbol" && typeof accountKey !== "bigint") || (typeof accountKey === "string" && accountKey.length === 0)) {
      throw new TypeError("Account recovery budget requires a stable non-empty account key");
    }
    if (accountBudgets.has(accountKey)) return accountBudgets.get(accountKey);

    let refreshClaimed = false;
    let redispatchClaimed = false;
    const budget = Object.freeze({
      claimRefresh() {
        if (refreshClaimed || controller.signal.aborted || disposed) return false;
        refreshClaimed = true;
        return true;
      },
      claimRedispatch() {
        if (redispatchClaimed || controller.signal.aborted || disposed) return false;
        redispatchClaimed = true;
        return true;
      },
    });
    accountBudgets.set(accountKey, budget);
    return budget;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInitialTimer();
    for (const [signal, listener] of sourceListeners) signal.removeEventListener("abort", listener);
    sourceListeners.length = 0;
  };

  return Object.freeze({
    signal: controller.signal,
    deadlineAt,
    get outputStarted() { return outputStarted; },
    markOutput,
    getAccountRecoveryBudget,
    abort,
    dispose,
  });
}

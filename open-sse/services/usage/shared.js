/**
 * Shared usage helpers (cross-provider)
 */

import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

// usage endpoints: single source from registry transport.usage
export const U = (id) => PROVIDERS[id]?.usage || {};

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
export function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

export function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (project && typeof project === "object" && typeof project.id === "string") {
    return project.id.trim() || null;
  }
  return null;
}

export async function fetchWithTimeout(url, opts, ms = 10000, proxyOptions = null) {
  const callerSignal = opts?.signal;
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  // Native composition stays connected to the caller after the header timer ends.
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const response = await proxyAwareFetch(url, { ...opts, signal }, proxyOptions);
    if (callerSignal?.aborted) {
      discardUsageBody(response, callerSignal.reason);
      callerSignal.throwIfAborted();
    }
    return response;
  } catch (error) {
    callerSignal?.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function discardUsageBody(response, reason) {
  try { Promise.resolve(response?.body?.cancel(reason)).catch(() => {}); } catch { /* Already locked or closed. */ }
}

// Only the Google usage consumers need local detachment for noncooperative bodies.
export async function readUsageJson(response, signal) {
  let reader;
  const cancel = reason => {
    if (!reader) { discardUsageBody(response, reason); return; }
    try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* Best-effort release. */ }
  };
  const wait = work => new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      cancel(signal.reason);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
  try {
    signal?.throwIfAborted();
    // Keep signal-less callers and old mock-only .json() responses compatible.
    if (!signal || !response.body?.getReader) {
      const data = await (signal ? wait(response.json()) : response.json());
      signal?.throwIfAborted();
      return data;
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await wait(reader.read());
      signal.throwIfAborted();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    cancel(signal?.aborted ? signal.reason : error);
    signal?.throwIfAborted();
    throw error;
  } finally {
    try { reader?.releaseLock(); } catch { /* Pending noncooperative read. */ }
  }
}

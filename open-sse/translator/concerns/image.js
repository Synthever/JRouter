// Build a base64 data URI from mime + base64 payload
export function encodeDataUri(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

// Parse a base64 data URI → { mimeType, base64 }, or null if not a data URI.
// [\s\S] tolerates newlines inside the base64 payload.
const DATA_URI_RE = /^data:([^;]+);base64,([\s\S]+)$/;
export function parseDataUri(url) {
  if (typeof url !== "string") return null;
  const m = url.match(DATA_URI_RE);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS, IMAGE_SIGNATURES, BLOCKED_HOSTS } from "../../config/mediaConfig.js";

// True if an IPv4/IPv6 address is private/reserved (SSRF target).
function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv6 loopback / unique-local / link-local
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> extract tail
  const v4 = ip.includes(".") ? ip.split(":").pop() : ip;
  const parts = v4.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return ip.includes(":") ? false : true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason;
}

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

// Resolve host once and return only public IPs (SSRF guard).
// Rejects if any resolved record is private/reserved (defeats multi-A tricks).
// The abortable waiter detaches promptly; Node's underlying lookup may finish later.
async function resolvePinnedIps(hostname, signal) {
  throwIfAborted(signal);
  if (!hostname || BLOCKED_HOSTS.has(hostname.toLowerCase())) return null;
  try {
    const records = await awaitWithSignal(lookup(hostname, { all: true }), signal);
    throwIfAborted(signal);
    if (!records.length || records.some((r) => isPrivateIp(r.address))) return null;
    return records;
  } catch (error) {
    throwIfAborted(signal);
    return null;
  }
}

function createFetchAbort(signal, timeoutMs) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function cancelReader(reader) {
  let cancellation;
  try { cancellation = Promise.resolve(reader?.cancel()); } catch { cancellation = Promise.resolve(); }
  try { reader?.releaseLock(); } catch { /* pending native reads may defer lock release */ }
  cancellation.then(() => {
    try { reader?.releaseLock(); } catch { /* ignore an already released or errored reader */ }
  }, () => {});
}

function closeAgent(dispatcher) {
  try { Promise.resolve(dispatcher?.close()).catch(() => {}); } catch { /* best effort */ }
}

function cancelResponse(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* best effort */ }
}

// Verify buffer magic bytes match a known image signature; return its mime or null.
function detectImageMime(buf) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (buf.length < offset + sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[offset + i] !== sig[i]) { match = false; break; }
    }
    if (!match) continue;
    // WEBP: RIFF....WEBP — bytes 8..11 must be "WEBP".
    if (verifyWebp && !(buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)) continue;
    return mime;
  }
  return null;
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Hardened against SSRF (private/metadata IPs), memory DoS (size cap),
 * and disguised non-image payloads (magic-byte verification).
 * Returns null on ordinary failures; caller cancellation rejects with its original reason.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs, maxBytes }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES } = options;
  try { throwIfAborted(signal); } catch (reason) { throw reason; }
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  let url;
  try { url = new URL(imageUrl); } catch { return null; }
  let pinnedIps;
  try {
    pinnedIps = await resolvePinnedIps(url.hostname, signal);
  } catch (reason) {
    if (signal?.aborted) throw reason;
    return null;
  }
  throwIfAborted(signal);
  if (!pinnedIps) return null;

  const timeout = createFetchAbort(signal, timeoutMs);
  let dispatcher;
  let response;
  let reader;
  let readerDone = false;
  let completed = false;
  try {
    throwIfAborted(signal);
    // Pin connect to the validated IP so no second DNS resolution can rebind (TOCTOU fix).
    dispatcher = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, [{ address: pinnedIps[0].address, family: pinnedIps[0].family }]) },
    });
    throwIfAborted(signal);
    // redirect:"manual" prevents a public URL redirecting to a private one (SSRF bypass).
    const pendingResponse = fetch(imageUrl, { signal: timeout.signal, redirect: "manual", dispatcher });
    Promise.resolve(pendingResponse).then((lateResponse) => {
      if (timeout.signal.aborted) cancelResponse(lateResponse);
    }, () => {});
    response = await awaitWithSignal(pendingResponse, timeout.signal);
    throwIfAborted(signal);
    if (!response.ok || !response.body) {
      cancelResponse(response);
      return null;
    }

    // Stream-read with a hard byte cap to avoid loading huge payloads into memory.
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await awaitWithSignal(reader.read(), timeout.signal);
      throwIfAborted(signal);
      if (done) { readerDone = true; break; }
      total += value.length;
      if (total > maxBytes) return null;
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mimeType = detectImageMime(buf);
    if (!mimeType) return null; // not a recognized image — reject disguised payloads

    completed = true;
    return { url: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return null;
  } finally {
    timeout.dispose();
    if (reader && readerDone) {
      try { reader.releaseLock(); } catch { /* ignore */ }
    } else if (!completed && reader) cancelReader(reader);
    else if (!reader && response?.body) cancelResponse(response);
    closeAgent(dispatcher);
  }
}

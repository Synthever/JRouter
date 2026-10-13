import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { joinSharedOperation } from "../utils/sharedOperation.js";
import { createHash } from "crypto";
import os from "os";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = PROVIDERS["mimo-free"].baseUrl;
const SESSION_AFFINITY_PREFIX = "ses_";
const SESSION_ID_LENGTH = 24;
const JWT_FALLBACK_TTL_SEC = 3000;
const JWT_EXPIRY_BUFFER_MS = 300000;
const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Anti-abuse gate: upstream rejects requests without a Chrome-like User-Agent with 403 "Illegal access"
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// Anti-abuse gate marker: the free chat endpoint returns 403 "Illegal access"
// unless a system message contains this exact MiMoCode signature substring.
export const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

// In-memory JWT cache (per-process, survives across requests but not restarts)
let cachedJwt = null;
let jwtExpiresAt = 0;

// Device fingerprint reused as the bootstrap "client" — stable per machine
function generateFingerprint() {
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {
    // ignore
  }
  const cpu = (os.cpus()[0]?.model || "unknown-cpu").trim();
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}|${username}`;
  return createHash("sha256").update(seed).digest("hex");
}

function generateSessionId() {
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return id;
}

// Derive expiry from the JWT exp claim; fall back to a fixed TTL when unparseable
function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // ignore
  }
  return Date.now() + JWT_FALLBACK_TTL_SEC * 1000;
}

// Ensure the body carries the anti-abuse marker in a system message (idempotent)
function injectSystemMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (m) => m?.role === "system" && typeof m.content === "string" && m.content.includes(MIMO_SYSTEM_MARKER)
  );
  if (hasMarker) return body;
  return { ...body, messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages] };
}

function resetJwtCache() {
  cachedJwt = null;
  jwtExpiresAt = 0;
}

const jwtOperations = new Map();
const JWT_OPERATION_KEY = "jwt";
const NO_BOOTSTRAP_RESULT = Symbol("MiMo renewal denied");

function cancelBody(body, reason) {
  try { Promise.resolve(body?.cancel(reason)).catch(() => {}); } catch { /* Keep the original outcome. */ }
}

function guardResponse(response, signal) {
  if (signal?.aborted) cancelBody(response?.body, signal.reason);
  signal?.throwIfAborted();
}

async function readBootstrapJson(response, signal) {
  let reader;
  let onAbort;
  let canceled = false;
  const cancel = reason => {
    if (canceled) return;
    canceled = true;
    cancelBody(reader || response.body, reason);
  };
  try {
    guardResponse(response, signal);
    reader = response.body?.getReader?.();
    const aborted = new Promise((resolve, reject) => {
      onAbort = () => { cancel(signal.reason); reject(signal.reason); };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    aborted.catch(() => {});
    if (signal.aborted) onAbort();
    signal.throwIfAborted();
    if (!reader) {
      const data = await Promise.race([response.json(), aborted]);
      signal.throwIfAborted();
      return data;
    }
    const decoder = new TextDecoder();
    let text = "";
    let reads = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (++reads % 16 === 0) {
        let timer;
        try {
          await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, 0); }), aborted]);
        } finally { clearTimeout(timer); }
        signal.throwIfAborted();
      }
    }
    signal.throwIfAborted();
    return JSON.parse((text + decoder.decode()).replace(/^\uFEFF/, ""));
  } catch (error) {
    cancel(signal.aborted ? signal.reason : error);
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { reader?.releaseLock(); } catch { /* A canceled reader may already be released. */ }
  }
}

async function bootstrapJwt(proxyOptions = null, { signal, recoveryBudget, forceRefresh = false } = {}) {
  signal?.throwIfAborted();
  if (!forceRefresh && cachedJwt && Date.now() < jwtExpiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cachedJwt;
  }
  const entry = jwtOperations.get(JWT_OPERATION_KEY);
  const recovery = forceRefresh || !!cachedJwt || !!entry?.recovery;
  // An uncached renewal owner pays before joining someone else's acquisition.
  if (recovery && recoveryBudget && !recoveryBudget.claimRefresh()) {
    signal?.throwIfAborted();
    return NO_BOOTSTRAP_RESULT;
  }
  signal?.throwIfAborted();
  if (forceRefresh && cachedJwt) jwtExpiresAt = 0;
  if (recovery && entry) entry.recovery = true;

  const jwt = await joinSharedOperation(jwtOperations, JWT_OPERATION_KEY, async sharedSignal => {
    const owned = jwtOperations.get(JWT_OPERATION_KEY);
    owned.recovery = recovery;
    sharedSignal.throwIfAborted();
    const response = await proxyAwareFetch(BOOTSTRAP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      },
      body: JSON.stringify({ client: generateFingerprint() }),
      signal: sharedSignal,
    }, proxyOptions);
    guardResponse(response, sharedSignal);
    if (!response.ok) {
      cancelBody(response.body);
      throw new Error(`MiMo bootstrap failed: ${response.status}`);
    }
    const data = await readBootstrapJson(response, sharedSignal);
    sharedSignal.throwIfAborted();
    if (!data.jwt) throw new Error("MiMo bootstrap returned no JWT");
    const expiresAt = parseJwtExp(data.jwt);
    sharedSignal.throwIfAborted();
    if (jwtOperations.get(JWT_OPERATION_KEY) === owned) {
      cachedJwt = data.jwt;
      jwtExpiresAt = expiresAt;
    }
    sharedSignal.throwIfAborted();
    return data.jwt;
  }, { signal });
  signal?.throwIfAborted();
  return jwt;
}

function guardExecution(signal, executionOptions) {
  const attempt = executionOptions?.attempt;
  if (!attempt?.outputStarted && Number.isFinite(attempt?.deadlineAt) && Date.now() >= attempt.deadlineAt) {
    attempt.abort?.("initial-output-deadline");
  }
  signal?.throwIfAborted();
}

export class MimoFreeExecutor extends BaseExecutor {
  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl() {
    return CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      "x-session-affinity": this.sessionId,
      "Accept": stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model, body) {
    return injectSystemMarker(body);
  }

  async execute({ model, body, stream, credentials, signal: callerSignal, log, proxyOptions = null, healthProbe = false, executionOptions = null }) {
    const attemptSignal = executionOptions?.attempt?.signal;
    const signal = callerSignal && attemptSignal && callerSignal !== attemptSignal
      ? AbortSignal.any([callerSignal, attemptSignal]) : callerSignal || attemptSignal;
    const guard = () => guardExecution(signal, executionOptions);
    guard();
    const singleAttempt = executionOptions?.alias === true || executionOptions?.retryPolicy === "single-attempt";
    const noNetworkReplay = singleAttempt || executionOptions?.allowNetworkReplay === false;
    const recoveryBudget = executionOptions?.recoveryBudget;
    let heldResponse;
    try {
      let jwt;
      try {
        jwt = await bootstrapJwt(proxyOptions, { signal, recoveryBudget });
      } catch (error) {
        guard();
        log?.error?.("AUTH", `MiMo bootstrap failed: ${error.message}`);
        throw error;
      }
      guard();
      if (jwt === NO_BOOTSTRAP_RESULT) throw new Error("MiMo recovery budget exhausted before generation");

      const forceStream = executionOptions?.forceUpstreamStreaming === true && this.supportsUpstreamStreaming(credentials);
      const upstreamStream = forceStream ? true : stream;
      const attemptBody = executionOptions?.alias === true || forceStream ? structuredClone(body) : body;
      if (forceStream) attemptBody.stream = true;
      guard();
      const url = this.buildUrl();
      const transformedBody = this.transformRequest(model, attemptBody, upstreamStream, credentials, executionOptions);
      guard();
      const headers = { ...this.buildHeaders(credentials, upstreamStream), "Authorization": `Bearer ${jwt}` };
      const bodyStr = JSON.stringify(transformedBody);
      guard();
      log?.debug?.("FETCH", `MIMO-FREE → ${url} | body=${bodyStr.length}B`);
      const dispatch = () => {
        guard();
        const fetchOptions = { method: "POST", headers, body: bodyStr, signal };
        return noNetworkReplay
          ? proxyAwareFetch(url, fetchOptions, proxyOptions, { allowNetworkReplay: false })
          : proxyAwareFetch(url, fetchOptions, proxyOptions);
      };
      heldResponse = await dispatch();
      guard();
      const result = { response: heldResponse, url, headers, transformedBody };

      if (!healthProbe && (heldResponse.status === 401 || heldResponse.status === 403)
          && (!singleAttempt || !executionOptions?.attempt?.outputStarted)) {
        if (!singleAttempt) {
          log?.debug?.("AUTH", `MiMo auth failed (${heldResponse.status}), re-bootstrapping...`);
          resetJwtCache();
        }
        guard();
        try {
          jwt = await bootstrapJwt(proxyOptions, { signal, recoveryBudget, forceRefresh: true });
        } catch (error) {
          guard();
          if (!singleAttempt) throw error;
          return result;
        }
        guard();
        if (jwt === NO_BOOTSTRAP_RESULT || (singleAttempt && executionOptions?.attempt?.outputStarted)) return result;
        if (singleAttempt && recoveryBudget && !recoveryBudget.claimRedispatch()) {
          guard();
          return result;
        }
        guard();
        headers["Authorization"] = `Bearer ${jwt}`;
        guard();
        if (singleAttempt) cancelBody(heldResponse.body);
        heldResponse = undefined;
        heldResponse = await dispatch();
        guard();
        return { response: heldResponse, url, headers, transformedBody };
      }
      guard();
      return result;
    } catch (error) {
      if (signal?.aborted) cancelBody(heldResponse?.body, signal.reason);
      guard();
      throw error;
    }
  }
}

export const __test__ = {
  generateFingerprint, generateSessionId, bootstrapJwt, resetJwtCache, parseJwtExp,
  injectSystemMarker, MIMO_SYSTEM_MARKER, BOOTSTRAP_URL, CHAT_URL, SESSION_AFFINITY_PREFIX,
};

export default MimoFreeExecutor;

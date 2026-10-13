import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { parseVertexSaJson, refreshVertexToken, refreshGoogleToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Cache project IDs resolved from raw API keys { apiKey → projectId }
const projectIdCache = new Map();

function cancelBody(response, reason) {
  try { Promise.resolve(response?.body?.cancel(reason)).catch(() => {}); } catch { /* Keep the abort reason. */ }
}

/**
 * Parse Google ADC user credential JSON from apiKey string.
 * This is the format produced by `gcloud auth application-default login`.
 */
function parseVertexAdcJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (
      parsed.type === "authorized_user" &&
      parsed.client_id &&
      parsed.client_secret &&
      parsed.refresh_token
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve GCP project ID from a raw Vertex API key.
 * Sends a dummy 404 request and parses "projects/{id}" from the error message.
 */
async function resolveProjectId(apiKey, signal) {
  signal?.throwIfAborted();
  if (projectIdCache.has(apiKey)) return projectIdCache.get(apiKey);

  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
  let res, json;
  try {
    res = await fetch(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
      signal ? { ...init, signal } : init
    );
    if (signal?.aborted) cancelBody(res, signal.reason);
    signal?.throwIfAborted();
    json = await res.json().catch(() => { signal?.throwIfAborted(); return null; });
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  const msg = json?.[0]?.error?.message || json?.error?.message || "";
  const match = msg.match(/projects\/([^/]+)\//);
  const projectId = match?.[1] || null;

  signal?.throwIfAborted();
  if (projectId) projectIdCache.set(apiKey, projectId);
  return projectId;
}

/**
 * VertexExecutor - Google Cloud Vertex AI
 *
 * "vertex"         → Gemini models via regional/global Vertex endpoint
 * "vertex-partner" → Partner models (Llama, Mistral, GLM, DeepSeek, Qwen)
 *                    via global OpenAI-compatible endpoint
 *
 * Auth: SA JSON (stored as apiKey) → JWT assertion → Bearer token (via jose)
 * Token is minted/cached in tokenRefresh.js, not here.
 */
export class VertexExecutor extends BaseExecutor {
  constructor(providerId = "vertex") {
    super(providerId, PROVIDERS[providerId] || {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);
    const usesOAuth = !!saJson || !!adcJson || !!credentials?.accessToken;
    const rawKey = !usesOAuth ? credentials?.apiKey : null;
    const projectId =
      saJson?.project_id ||
      adcJson?.quota_project_id ||
      credentials?.providerSpecificData?.projectId;

    if (this.provider === "vertex-partner") {
      // Partner models require project_id in path regardless of auth method
      if (!projectId) throw new Error("Vertex partner models require a project_id. Add it in providerSpecificData or use Service Account JSON.");
      const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
      return rawKey ? `${url}?key=${rawKey}` : url;
    }

    // Gemini on Vertex
    const action = stream ? "streamGenerateContent" : "generateContent";

    if (usesOAuth) {
      // SA JSON / ADC / pre-set accessToken: must use project-scoped path to avoid RESOURCE_PROJECT_INVALID
      if (!projectId) {
        throw new Error(
          "Vertex OAuth/ADC requires a project_id. " +
          "Add quota_project_id to your ADC JSON or set providerSpecificData.projectId."
        );
      }
      const location = credentials?.providerSpecificData?.location || "us-central1";
      let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`;
      if (stream) url += "?alt=sse";
      return url;
    }

    // Raw API key: use global publishers endpoint with ?key= param
    // ?alt=sse is required for proper SSE streaming (matches every other Gemini executor)
    let url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${action}`;
    if (stream) url += "?alt=sse";
    if (rawKey) url += stream ? `&key=${rawKey}` : `?key=${rawKey}`;
    return url;
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json" };

    // Only set Bearer token if using SA JSON flow (raw key goes in URL ?key=)
    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null, { signal, recoveryBudget } = {}) {
    signal?.throwIfAborted();
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = signal || recoveryBudget ? parseVertexAdcJson(credentials?.apiKey) : null;
    if (!saJson && !adcJson) return null;
    const options = { signal, recoveryBudget };
    let result;
    try {
      if (saJson) {
        result = signal || recoveryBudget
          ? await refreshVertexToken(saJson, log, options)
          : await refreshVertexToken(saJson, log);
      } else result = await refreshGoogleToken(adcJson.refresh_token, adcJson.client_id, adcJson.client_secret, log, options);
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
    if (!result) return null;
    return saJson ? { accessToken: result.accessToken, expiresAt: result.expiresAt } : result;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, executionOptions = null }) {
    const attemptSignal = executionOptions?.attempt?.signal;
    const requestSignal = signal && attemptSignal ? AbortSignal.any([signal, attemptSignal]) : signal || attemptSignal;
    requestSignal?.throwIfAborted();
    const forceStream = executionOptions?.forceUpstreamStreaming === true;
    const upstreamStream = forceStream ? true : stream;
    if (executionOptions?.alias === true || forceStream) {
      body = structuredClone(body);
      credentials = structuredClone(credentials);
    }
    if (forceStream && this.provider === "vertex-partner") body.stream = true;
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);

    const refreshOptions = { signal: requestSignal, recoveryBudget: executionOptions?.recoveryBudget };
    const hasRefreshPolicy = !!requestSignal || !!refreshOptions.recoveryBudget;
    const guardError = error => { requestSignal?.throwIfAborted(); throw error; };

    // SA JSON flow: mint Bearer token via JWT assertion (cached)
    if (saJson) {
      requestSignal?.throwIfAborted();
      const result = await (hasRefreshPolicy
        ? refreshVertexToken(saJson, log, refreshOptions)
        : refreshVertexToken(saJson, log)).catch(guardError);
      requestSignal?.throwIfAborted();
      if (!result?.accessToken) throw new Error("Vertex: failed to mint access token from Service Account JSON");
      credentials.accessToken = result.accessToken;
    }

    // ADC user credential flow: refresh Bearer token via Google OAuth2 token endpoint
    if (adcJson) {
      requestSignal?.throwIfAborted();
      const result = await (hasRefreshPolicy
        ? refreshGoogleToken(adcJson.refresh_token, adcJson.client_id, adcJson.client_secret, log, refreshOptions)
        : refreshGoogleToken(adcJson.refresh_token, adcJson.client_id, adcJson.client_secret, log)).catch(guardError);
      requestSignal?.throwIfAborted();
      if (!result?.accessToken) throw new Error("Vertex: failed to refresh access token from ADC JSON (authorized_user)");
      credentials.accessToken = result.accessToken;
    }

    // vertex-partner with raw key: auto-resolve project_id if not provided
    if (this.provider === "vertex-partner" && !saJson && !adcJson && !credentials?.providerSpecificData?.projectId) {
      requestSignal?.throwIfAborted();
      const projectId = await (requestSignal
        ? resolveProjectId(credentials.apiKey, requestSignal)
        : resolveProjectId(credentials.apiKey)).catch(guardError);
      requestSignal?.throwIfAborted();
      if (!projectId) throw new Error("Vertex: could not resolve project_id from API key. Please add it manually in provider settings.");
      log?.debug?.("VERTEX", `Resolved project_id: ${projectId}`);
      credentials.providerSpecificData = { ...credentials.providerSpecificData, projectId };
    }

    requestSignal?.throwIfAborted();
    const url = this.buildUrl(model, upstreamStream, 0, credentials);
    const headers = this.buildHeaders(credentials, upstreamStream);
    const transformedBody = this.transformRequest(model, body, upstreamStream, credentials, executionOptions);
    requestSignal?.throwIfAborted();
    const init = { method: "POST", headers, body: JSON.stringify(transformedBody), signal: requestSignal };
    const response = await (executionOptions?.alias === true || executionOptions?.allowNetworkReplay === false
      ? proxyAwareFetch(url, init, proxyOptions, { allowNetworkReplay: false })
      : proxyAwareFetch(url, init, proxyOptions)).catch(guardError);
    if (requestSignal?.aborted) cancelBody(response, requestSignal.reason);
    requestSignal?.throwIfAborted();
    return { response, url, headers, transformedBody };
  }
}

export default VertexExecutor;

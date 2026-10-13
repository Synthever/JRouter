import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants.js";

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  usesStreamBody() {
    return false;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model, body, stream, credentials) {
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    // Cloud Code Assist wraps the Gemini payload: { project, model, request: <body> }
    if (body && body.request && body.model) return body;
    return {
      project: credentials?.projectId || body?.project,
      model,
      request: body
    };
  }

  // Parse RetryInfo.retryDelay from Google API 429 body to surface upstream retry hint
  parseError(response, bodyText) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    try {
      const parsed = JSON.parse(bodyText);
      const details = parsed?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && d?.retryDelay) {
            base.retryAfter = d.retryDelay;
            break;
          }
        }
      }
    } catch {}
    return base;
  }

  // proxyOptions is an optional positional placeholder; this refresh uses global fetch.
  async refreshCredentials(credentials, log, proxyOptions = null, { signal, recoveryBudget } = {}) {
    signal?.throwIfAborted();
    if (!credentials.refreshToken) return null;

    try {
      signal?.throwIfAborted();
      if (recoveryBudget && !recoveryBudget.claimRefresh()) return null;
      signal?.throwIfAborted();
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });
      signal?.throwIfAborted();

      if (!response.ok) return null;

      const tokens = await response.json();
      signal?.throwIfAborted();
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      signal?.throwIfAborted();
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;

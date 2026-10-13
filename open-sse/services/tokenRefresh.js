import { PROVIDERS } from "../config/providers.js";
import { dedupRefresh } from "./tokenRefresh/dedup.js";
import { waitForOperation } from "../utils/sharedOperation.js";
import { OAUTH_ENDPOINTS, REFRESH_LEAD_MS } from "../config/appConstants.js";
import {
  refreshXaiToken,
  refreshAccessToken,
  refreshKimiToken,
  refreshClineToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  refreshMiniMaxCodeToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers.js";

// Re-export all provider refresh functions (preserves public API for all consumers)
export {
  refreshAccessToken,
  refreshKimiToken,
  refreshClineToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  refreshMiniMaxCodeToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider) {
  if (REFRESH_LEAD_MS[provider]) return REFRESH_LEAD_MS[provider];
  // Legacy id after kimi-coding → kimi merge
  if (provider === "kimi-coding" && REFRESH_LEAD_MS.kimi) return REFRESH_LEAD_MS.kimi;
  return TOKEN_EXPIRY_BUFFER_MS;
}

export function parseVertexSaJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Cache Vertex tokens keyed by service account email { token, expiresAt }
const vertexTokenCache = new Map();

export async function refreshVertexToken(saJson, log, options = {}) {
  options.signal?.throwIfAborted();
  const cacheKey = saJson.client_email;
  const cached = vertexTokenCache.get(cacheKey);

  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }

  // No established minted session is bootstrap preparation. Once one exists,
  // all replacement owners use the ordinary concrete acquisition allowance.
  const acquisitionOptions = cached ? options : { signal: options.signal };
  return dedupRefresh("vertex", cacheKey, async sharedSignal => {
  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    sharedSignal.throwIfAborted();
    log?.debug?.("TOKEN_REFRESH", `Vertex minting token for ${saJson.client_email}`);
    const privateKey = await importPKCS8(saJson.private_key.replace(/\\n/g, "\n"), "RS256");
    sharedSignal.throwIfAborted();
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(saJson.client_email)
      .setAudience(OAUTH_ENDPOINTS.google.token)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    sharedSignal.throwIfAborted();

    const res = await fetch(OAUTH_ENDPOINTS.google.token, {
      signal: sharedSignal,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    sharedSignal.throwIfAborted();

    if (!res.ok) {
      const err = await res.text();
      sharedSignal.throwIfAborted();
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed: ${err}`);
      return null;
    }

    const { access_token, expires_in } = await res.json();
    sharedSignal.throwIfAborted();
    const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;

    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.("TOKEN_REFRESH", `Vertex token minted for ${saJson.client_email}`);

    return { accessToken: access_token, expiresAt };
  } catch (error) {
    sharedSignal.throwIfAborted();
    log?.error?.("TOKEN_REFRESH", `Vertex token error: ${error.message}`);
    return null;
  }
  }, log, acquisitionOptions);
}

function vertexRefreshHandler(c, log, options) {
  const saJson = parseVertexSaJson(c.apiKey);
  if (!saJson) return null;
  return refreshVertexToken(saJson, log, options);
}

const REFRESH_HANDLERS = {
  "gemini-cli": (c, log, options) => refreshGoogleToken(c.refreshToken, PROVIDERS["gemini-cli"].clientId, PROVIDERS["gemini-cli"].clientSecret, log, options),
  antigravity: (c, log, options) => refreshGoogleToken(c.refreshToken, PROVIDERS.antigravity.clientId, PROVIDERS.antigravity.clientSecret, log, options),
  claude: (c, log, options) => refreshClaudeOAuthToken(c.refreshToken, log, options),
  codex: (c, log, options) => refreshCodexToken(c.refreshToken, log, options),
  iflow: (c, log, options) => refreshIflowToken(c.refreshToken, log, options),
  github: (c, log, options) => refreshGitHubToken(c.refreshToken, log, options),
  kiro: (c, log, options) => refreshKiroToken(c.refreshToken, c.providerSpecificData, log, null, options),
  xai: (c, log, options) => refreshXaiToken(c.refreshToken, log, options),
  // Grok CLI shares xAI OAuth client + token endpoint (device-code tokens refresh the same way)
  "grok-cli": (c, log, options) => refreshXaiToken(c.refreshToken, log, options),
  gcli: (c, log, options) => refreshXaiToken(c.refreshToken, log, options),
  "codebuddy-cn": (c, log, options) => refreshCodebuddyToken(c.refreshToken, log, options),
  "codebuddy-intl": (c, log, options) => refreshCodebuddyIntlToken(c.refreshToken, log, options),
  trae: (c, log, options) => refreshTraeToken(c.refreshToken, c, log, options),
  cline: (c, log, options) => refreshClineToken(c.refreshToken, log, options),
  // ClinePass shares Cline's WorkOS auth endpoints, so the same refresh works.
  clinepass: (c, log, options) => refreshClineToken(c.refreshToken, log, options),
  zed: () => refreshZedToken(),
  windsurf: (c, log, options) => refreshWindsurfToken(c, log, options),
  // Kimi Code OAuth (merged into id `kimi`); legacy id still routes here
  kimi: (c, log, options) => refreshKimiToken(c.refreshToken, c, log, options),
  "kimi-coding": (c, log, options) => refreshKimiToken(c.refreshToken, c, log, options),
  // MiniMax Code — single-use refresh tokens; the handler dedupes by token
  // value and classifies invalid_grant (docs/minimax-code-proxy-plan.md §2.3)
  "minimax-code": (c, log, options) => refreshMiniMaxCodeToken("minimax-code", c.refreshToken, log, options),
  "minimax-code-global": (c, log, options) => refreshMiniMaxCodeToken("minimax-code-global", c.refreshToken, log, options),
  vertex: vertexRefreshHandler,
  "vertex-partner": vertexRefreshHandler
};

export async function getAccessToken(provider, credentials, log, options = {}) {
  options.signal?.throwIfAborted();
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log, options);
}

async function _getAccessTokenInternal(provider, credentials, log, options) {
  if (provider === "gemini") {
    return refreshGoogleToken(credentials.refreshToken, PROVIDERS.gemini.clientId, PROVIDERS.gemini.clientSecret, log, options);
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log, options);
}

export async function refreshTokenByProvider(provider, credentials, log, options = {}) {
  options.signal?.throwIfAborted();
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler ? handler(credentials, log, options) : refreshAccessToken(provider, credentials.refreshToken, credentials, log, options);
}

export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
    case "grok-cli":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo, log, options = {}) {
  options.signal?.throwIfAborted();
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log, options);
        options.signal?.throwIfAborted();

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null, options = {}) {
  options.signal?.throwIfAborted();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await waitForOperation(delay, options.signal);
    }

    try {
      options.signal?.throwIfAborted();
      const result = await refreshFn(options);
      options.signal?.throwIfAborted();
      if (result) return result;
    } catch (error) {
      options.signal?.throwIfAborted();
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}

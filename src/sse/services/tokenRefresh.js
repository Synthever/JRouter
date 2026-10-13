// Re-export from open-sse with local logger
import * as log from "../utils/logger.js";
import { joinSharedOperation } from "open-sse/utils/sharedOperation.js";
import { getProviderConnectionById, updateProviderConnection } from "../../lib/localDb.js";
import {
  getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
} from "open-sse/services/projectId.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshCodexToken as _refreshCodexToken,
  refreshIflowToken as _refreshIflowToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshCopilotToken as _refreshCopilotToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  formatProviderCredentials as _formatProviderCredentials,
  getAllAccessTokens as _getAllAccessTokens,
  refreshKiroToken as _refreshKiroToken,
  getRefreshLeadMs as _getRefreshLeadMs
} from "open-sse/services/tokenRefresh.js";
import {
  refreshProviderCredentials as _refreshProviderCredentials,
  shouldRefreshCredentials as _shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;
const persistenceOperations = new Map();
const persistedResults = new Map();

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshAccessToken = (provider, refreshToken, credentials, options) =>
  _refreshAccessToken(provider, refreshToken, credentials, log, options);

export const refreshClaudeOAuthToken = (refreshToken, options) =>
  _refreshClaudeOAuthToken(refreshToken, log, options);

export const refreshGoogleToken = (refreshToken, clientId, clientSecret, options) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log, options);

export const refreshCodexToken = (refreshToken, options) =>
  _refreshCodexToken(refreshToken, log, options);

export const refreshIflowToken = (refreshToken, options) =>
  _refreshIflowToken(refreshToken, log, options);

export const refreshGitHubToken = (refreshToken, options) =>
  _refreshGitHubToken(refreshToken, log, options);

export const refreshCopilotToken = (githubAccessToken, options) =>
  _refreshCopilotToken(githubAccessToken, log, options);

export const refreshKiroToken = (refreshToken, providerSpecificData, proxyOptions = null, options) =>
  _refreshKiroToken(refreshToken, providerSpecificData, log, proxyOptions, options);

export const getAccessToken = (provider, credentials, options) =>
  _getAccessToken(provider, credentials, log, options);

export const refreshTokenByProvider = (provider, credentials, options) =>
  _refreshTokenByProvider(provider, credentials, log, options);

export const formatProviderCredentials = (provider, credentials) =>
  _formatProviderCredentials(provider, credentials, log);

export const getAllAccessTokens = (userInfo, options) =>
  _getAllAccessTokens(userInfo, log, options);

export const shouldRefreshCredentials = (provider, credentials) =>
  _shouldRefreshCredentials(provider, credentials);

// ─── Lifecycle hook ───────────────────────────────────────────────────────────

/**
 * Call this when a connection is fully closed / removed.
 * Aborts any in-flight projectId fetch and evicts its cache entry,
 * preventing the module-level Maps from accumulating stale entries.
 *
 * @param {string} connectionId
 */
export function releaseConnection(connectionId) {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute an ISO expiry timestamp from a relative expiresIn (seconds).
 * @param {number} expiresIn
 * @returns {string}
 */
function toExpiresAt(expiresIn) {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function normalizeExpiresAt(expiresAt) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Providers that carry a real Google project ID.
 * @param {string} provider
 * @returns {boolean}
 */
function needsProjectId(provider) {
  return provider === "antigravity" || provider === "gemini-cli";
}

/**
 * Non-blocking: fetch the project ID for a connection after a token refresh and
 * persist it to localDb.  Invalidates the stale cached value first so the fetch
 * always retrieves a fresh one.
 *
 * @param {string} provider
 * @param {string} connectionId
 * @param {string} accessToken
 */
async function _refreshProjectId(provider, connectionId, accessToken, options = {}) {
  options.signal?.throwIfAborted();
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;

  // Invalidate the stale cached entry so getProjectIdForConnection does a real fetch
  invalidateProjectId(connectionId);

  // Lazy resolution: Do not eagerly trigger onboardUser during background token refresh.
  // Eagerly fetching projectId across multiple accounts simultaneously triggers Google Cloud anti-abuse / rate limits.
  // Runtime handlers (e.g. chat handler) will lazily call getProjectIdForConnection() on demand.
  if (process.env.EAGER_PROJECT_ID_REFRESH === "true") {
    try {
      const projectId = await getProjectIdForConnection(connectionId, accessToken, provider, options);
      options.signal?.throwIfAborted();
      if (projectId) await updateProviderCredentials(connectionId, { projectId }, options);
    } catch (err) {
      options.signal?.throwIfAborted();
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", { connectionId, error: err?.message ?? err });
    }
  }
}

// ─── Local-specific: persist credentials to localDb ──────────────────────────

/**
 * Persist updated credentials for a connection to localDb.
 * Only fields that are present in `newCredentials` are written.
 *
 * @param {string} connectionId
 * @param {object} newCredentials
 * @returns {Promise<boolean>}
 */
export async function updateProviderCredentials(connectionId, newCredentials, { signal } = {}) {
  signal?.throwIfAborted();
  try {
    const updates = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.idToken)             updates.idToken = newCredentials.idToken;
    if (newCredentials.lastRefreshAt)       updates.lastRefreshAt = newCredentials.lastRefreshAt;
    if (newCredentials.expiresAt)           updates.expiresAt = newCredentials.expiresAt;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    } else if (newCredentials.expiresAt) {
      const expiresAt = normalizeExpiresAt(newCredentials.expiresAt);
      if (expiresAt) {
        updates.expiresAt = expiresAt;
        updates.expiresIn = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      }
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.copilotToken || newCredentials.copilotTokenExpiresAt) {
      updates.providerSpecificData = {
        ...(updates.providerSpecificData || newCredentials.existingProviderSpecificData || {}),
        ...(newCredentials.copilotToken ? { copilotToken: newCredentials.copilotToken } : {}),
        ...(newCredentials.copilotTokenExpiresAt ? { copilotTokenExpiresAt: newCredentials.copilotTokenExpiresAt } : {}),
      };
    }
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    signal?.throwIfAborted();
    const result = await updateProviderConnection(connectionId, updates, { signal });
    signal?.throwIfAborted();
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error) {
    signal?.throwIfAborted();
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: error.message,
    });
    return false;
  }
}

/** Persist one acquired result per connection, owned by all live result adopters. */
async function persistSharedCredentials(provider, connectionId, credentials, { signal } = {}) {
  signal?.throwIfAborted();
  const key = JSON.stringify([
    provider,
    connectionId,
    credentials.accessToken || credentials.token || credentials.copilotToken || credentials.apiKey,
    credentials.refreshToken ?? null,
  ]);
  const now = Date.now();
  for (const [id, expiresAt] of persistedResults) {
    if (expiresAt <= now) persistedResults.delete(id);
  }
  if (persistedResults.has(key)) return;
  return joinSharedOperation(persistenceOperations, key, async sharedSignal => {
    sharedSignal.throwIfAborted();
    const persisted = await updateProviderCredentials(connectionId, credentials, { signal: sharedSignal });
    sharedSignal.throwIfAborted();
    if (persisted) persistedResults.set(key, Date.now() + 10_000);
  }, { signal });
}

// ─── Local-specific: proactive token refresh ─────────────────────────────────

/**
 * Check whether the provider token (and, for GitHub, the Copilot token) is
 * about to expire and refresh it proactively.
 *
 * @param {string} provider
 * @param {object} credentials
 * @param {{ force?: boolean }} [options]  force=true skips the on-request lead check
 *   (used by background scheduler which applies a larger lead). Request path omits this.
 * @returns {Promise<object>} updated credentials object
 */
export async function checkAndRefreshToken(provider, credentials, options = {}) {
  options.signal?.throwIfAborted();
  let creds = { ...credentials };
  if (!creds.connectionId && creds.id) {
    creds.connectionId = creds.id;
  }

  // Adopt latest DB tokens: OpenAI rotates the refresh token on every refresh, and
  // refreshing with a stale snapshot (reuse) revokes the whole session → account logout.
  if (creds.connectionId) {
    const latest = await getProviderConnectionById(creds.connectionId).catch(() => null);
    options.signal?.throwIfAborted();
    const latestRefreshMs = Date.parse(latest?.lastRefreshAt || "");
    const credsRefreshMs = Date.parse(creds.lastRefreshAt || "");
    const dbIsNewer = Number.isFinite(latestRefreshMs)
      && (!Number.isFinite(credsRefreshMs) || latestRefreshMs > credsRefreshMs);
    if (dbIsNewer && latest.refreshToken && latest.refreshToken !== creds.refreshToken) {
      creds = {
        ...creds,
        refreshToken: latest.refreshToken,
        accessToken: latest.accessToken || creds.accessToken,
        expiresAt: latest.expiresAt || latest.tokenExpiresAt || creds.expiresAt,
        lastRefreshAt: latest.lastRefreshAt || creds.lastRefreshAt,
      };
    }
  }

  const force = options?.force === true;

  // ── 1. Regular access-token expiry ────────────────────────────────────────
  if (force || _shouldRefreshCredentials(provider, creds)) {
    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
    const remaining = expiresAt ? expiresAt - Date.now() : null;
    const refreshLead = _getRefreshLeadMs(provider);

    log.info("TOKEN_REFRESH", "Refreshing provider credentials proactively", {
      provider,
      expiresIn: remaining === null ? null : Math.round(remaining / 1000),
      refreshLeadMs: refreshLead,
      lastRefreshAt: creds.lastRefreshAt || null,
    });

    const newCreds = await _refreshProviderCredentials(provider, creds, log, options);
    options.signal?.throwIfAborted();
    if (newCreds?.accessToken || newCreds?.apiKey || newCreds?.copilotToken) {
      const mergedCreds = {
        ...newCreds,
        existingProviderSpecificData: creds.providerSpecificData,
      };

      // Persist to DB (non-blocking path continues below)
      await persistSharedCredentials(provider, creds.connectionId, mergedCreds, options);
      options.signal?.throwIfAborted();

      creds = {
        ...creds,
        ...newCreds,
        expiresAt: newCreds.expiresIn
          ? toExpiresAt(newCreds.expiresIn)
          : normalizeExpiresAt(newCreds.expiresAt) || newCreds.expiresAt || creds.expiresAt,
        providerSpecificData: newCreds.providerSpecificData
          ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
          : creds.providerSpecificData,
      };

      // Non-blocking: refresh projectId with the new access token
      if (options.signal) {
        await _refreshProjectId(provider, creds.connectionId, creds.accessToken, options);
      } else {
        // Ordinary/background refresh keeps the existing non-blocking timing.
        _refreshProjectId(provider, creds.connectionId, creds.accessToken).catch(err => {
          log.debug("TOKEN_REFRESH", "Failed to refresh projectId", { connectionId: creds.connectionId, error: err?.message ?? err });
        });
      }
    }
  }

  // ── 2. GitHub Copilot token expiry ────────────────────────────────────────
  if (provider === "github") {
    const copilotToken = creds.providerSpecificData?.copilotToken;
    const copilotExpiresAt = creds.providerSpecificData?.copilotTokenExpiresAt
      ? creds.providerSpecificData.copilotTokenExpiresAt * 1000
      : 0;
    const now              = Date.now();
    const remaining        = copilotExpiresAt - now;

    if (!copilotToken || remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon or missing, refreshing proactively", {
        provider,
        expiresIn: copilotToken ? Math.round(remaining / 1000) : "missing",
      });

      // No Copilot session yet is preparation; replacing an established one
      // uses the same account allowance as proactive/reactive OAuth refresh.
      const copilotTokenResult = await refreshCopilotToken(creds.accessToken,
        copilotToken ? options : { signal: options.signal });
      options.signal?.throwIfAborted();
      if (copilotTokenResult) {
        const updatedSpecific = {
          ...creds.providerSpecificData,
          copilotToken:          copilotTokenResult.token,
          copilotTokenExpiresAt: copilotTokenResult.expiresAt,
        };

        await persistSharedCredentials(provider, creds.connectionId, {
          token: copilotTokenResult.token,
          providerSpecificData: updatedSpecific,
        }, options);
        options.signal?.throwIfAborted();

        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotTokenResult.token;
      }
    }
  }

  return creds;
}

// ─── Local-specific: combined GitHub + Copilot refresh ───────────────────────

/**
 * Refresh the GitHub OAuth token and immediately exchange it for a fresh
 * Copilot token.
 *
 * @param {object} credentials  – must contain `refreshToken`
 * @returns {Promise<object|null>} merged credentials or the raw GitHub credentials on Copilot failure
 */
export async function refreshGitHubAndCopilotTokens(credentials, options = {}) {
  options.signal?.throwIfAborted();
  const newGitHubCreds = await refreshGitHubToken(credentials.refreshToken, options);
  options.signal?.throwIfAborted();
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;

  const copilotToken = await refreshCopilotToken(newGitHubCreds.accessToken,
    credentials.providerSpecificData?.copilotToken ? options : { signal: options.signal });
  options.signal?.throwIfAborted();
  if (!copilotToken) return newGitHubCreds;

  return {
    ...newGitHubCreds,
    providerSpecificData: {
      copilotToken:          copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}

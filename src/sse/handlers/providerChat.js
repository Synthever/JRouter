import "open-sse/index.js";
import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { waitWithSignal } from "open-sse/utils/streamHandler.js";
import * as defaultLog from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";

export async function executeProviderChat(options) {
  const attempt = options.executionOptions?.alias === true ? options.executionOptions.attempt : null;
  try {
    return await runProviderChat(options);
  } catch (error) {
    if (!attempt) throw error;
    const cancelled = attempt.signal.aborted;
    const cancelReason = cancelled ? attempt.signal.reason?.reason : undefined;
    const status = cancelled ? (cancelReason === "initial-output-deadline" ? 504 : 499) : 502;
    return { response: errorResponse(status, cancelled ? "Alias attempt cancelled" : "Provider preparation failed"), success: false,
      outputStarted: attempt.outputStarted, failure: { category: cancelled ? "cancelled" : "provider", status,
        cancelReason, error: cancelled ? attempt.signal.reason : error, outputStarted: attempt.outputStarted } };
  }
}

async function runProviderChat({ body, member: modelInfo, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, log = defaultLog, executionOptions = null, signal: callerSignal = null }) {
  const attempt = executionOptions?.alias === true ? executionOptions.attempt : null;
  const signal = attempt?.signal || callerSignal;
  const wait = operation => signal ? waitWithSignal(operation, signal) : operation;
  const failed = (response, failure = null) => ({ response, success: false, outputStarted: attempt?.outputStarted || false,
    failure: failure || { category: "provider", status: response.status, error: "All accounts unavailable", outputStarted: false } });
  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;
  let lastResult = null;

  while (true) {
    signal?.throwIfAborted();
    const credentials = await wait(getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model, ...(signal ? { signal } : {}) }));
    signal?.throwIfAborted();

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (attempt && lastResult) return lastResult;
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return failed(unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders), { category: "provider", status, error: errorMsg, retryAfter: credentials.retryAfter });
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return failed(errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`), { category: "configuration", status: 404, error: "No active credentials", ...(attempt ? { credentialsUnavailable: true } : {}) });
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return failed(errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders));
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const recoveryBudget = attempt?.getAccountRecoveryBudget(`${provider}:${credentials.connectionId || credentials.id || "session"}`);
    const preparationOptions = signal ? { signal, recoveryBudget } : undefined;
    const refreshedCredentials = await wait(checkAndRefreshToken(provider, credentials, ...(preparationOptions ? [preparationOptions] : [])));
    signal?.throwIfAborted();

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await wait(getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider, ...(preparationOptions ? [preparationOptions] : [])));
      signal?.throwIfAborted();
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        if (signal) await wait(updateProviderCredentials(credentials.connectionId, { projectId: pid }, { signal }));
        else updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await wait(getSettings());
    signal?.throwIfAborted();
    if (attempt && chatSettings.pxpipeEnabled) log.debug("PXPIPE", "Skipped for Models Alias: transform is not cancellable");
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await wait(handleChatCore({
      body: { ...(attempt ? structuredClone(body) : body), model: `${provider}/${model}` },
      ...(signal ? { signal } : {}),
      ...(attempt ? { executionOptions: { ...executionOptions, recoveryBudget } } : {}),
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest: attempt && clientRawRequest ? structuredClone(clientRawRequest) : clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !attempt && !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: !attempt && chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds, persistenceOptions) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        }, ...(persistenceOptions ? [persistenceOptions] : []));
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model, ...(signal ? [{ signal }] : []));
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    }));

    if (result.success || signal?.aborted) return result;

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData, ...(signal ? [{ signal }] : [])
      );
      signal?.throwIfAborted();
      if (quotaResetMs) {
        resetsAtMs = quotaResetMs;
        if (attempt && result.failure) {
          const failure = { ...result.failure, resetsAtMs: quotaResetMs };
          Object.defineProperty(result, "failure", { enumerable: true, configurable: true, value: failure });
        }
      }
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await wait(markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs, ...(signal ? [{ signal }] : [])))).shouldFallback;

    if (attempt?.outputStarted) return result;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastResult = result;
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result;
  }
}

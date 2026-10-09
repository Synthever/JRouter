import "open-sse/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken, updateProviderCredentials } from "@/sse/services/tokenRefresh.js";
import { getSettings } from "@/lib/db/index.js";
import { classifyFailure } from "./logic.js";

const quietLog = new Proxy({}, { get: () => () => {} });

export async function probeModel(model, config) {
  const startedAt = performance.now();
  const controller = new AbortController();
  let executed = false;
  let apiKeyId = null;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new DOMException("Health check timed out", "TimeoutError")); }, config.timeoutSeconds * 1000);
  });
  const operation = async () => {
    const credentials = await getProviderCredentials(model.providerId, null, model.modelId, { requestedModel: model.modelId, healthProbe: true });
    controller.signal.throwIfAborted();
    if (!credentials || credentials.allRateLimited) return { executed: false, success: false, errorType: "AUTH_ERROR", errorMessage: "No available provider connection; check skipped" };
    apiKeyId = credentials.connectionId || null;
    const refreshed = await checkAndRefreshToken(model.providerId, credentials);
    const settings = await getSettings();
    controller.signal.throwIfAborted();
    // A small reasoning budget still proves inference when only reasoning is returned.
    const body = { model: model.id, messages: [{ role: "user", content: "ping" }], max_tokens: model.capabilities?.reasoning ? 256 : 16, stream: false };
    executed = true;
    const result = await handleChatCore({
      body, modelInfo: { provider: model.providerId, model: model.modelId }, credentials: refreshed,
      connectionId: apiKeyId, log: quietLog, sourceFormatOverride: "openai", healthProbe: true,
      signal: controller.signal, providerOverrides: settings.providerOverrides?.[model.providerId] || null,
      onCredentialsRefreshed: (updates) => updateProviderCredentials(apiKeyId, { ...updates, existingProviderSpecificData: credentials.providerSpecificData }),
    });
    controller.signal.throwIfAborted();
    const httpStatus = result.httpStatus || result.status || result.response?.status || null;
    if (!result.success) return { executed, success: false, httpStatus, ...classifyFailure({ httpStatus, message: result.error }) };
    let parsed;
    try { parsed = await result.response.json(); } catch { parsed = null; }
    const message = parsed?.choices?.[0]?.message;
    const content = message?.content || message?.reasoning_content || message?.reasoning || message?.thinking || message?.thinking_content;
    const valid = !parsed?.error && typeof content === "string" && content.trim().length > 0;
    return { executed, success: valid, httpStatus, ...(valid ? {} : classifyFailure({ httpStatus, errorType: "INVALID_RESPONSE" })) };
  };
  try {
    const result = await Promise.race([operation(), deadline]);
    return { ...result, apiKeyId, latencyMs: executed ? Math.round(performance.now() - startedAt) : null };
  } catch (error) {
    return { executed, success: false, apiKeyId, latencyMs: executed ? Math.round(performance.now() - startedAt) : null, httpStatus: null,
      ...classifyFailure({ name: error.name, message: error.message }) };
  } finally { clearTimeout(timeout); }
}

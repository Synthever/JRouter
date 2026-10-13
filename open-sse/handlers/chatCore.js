import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { applyThinking, extractThinking, stripThinkingSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough, anchorClaudeCache } from "../translator/formats/claude.js";
import { createStreamController, waitWithSignal, cancelBody, readResponseText } from "../utils/streamHandler.js";
import { gateAliasResponse } from "../utils/aliasOutput.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelSupportedFormats, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { upstreamResponseHeaders } from "../utils/upstreamHeaders.js";
import { HTTP_STATUS, TOKEN_SAVER_HEADER } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest as trackUsageRequest, appendRequestLog as appendUsageLog, saveRequestDetail as saveUsageDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { supportsGrokCliReasoningEffort } from "../config/grokCli.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { takeRenamedToolNames } from "../utils/opencodeFingerprint.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { compressWithPxpipe } from "../rtk/pxpipe.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { defaultClaudeToolType, shouldDefaultClaudeToolType } from "../translator/concerns/toolCall.js";
import { resolveSessionId } from "../utils/sessionManager.js";

const SAFE_PROVIDER_ERROR_TOKEN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const PROVIDER_SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/i,
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/i,
  /\bbearer\s+[A-Za-z0-9._~+/-]{12,}=?/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}/i,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|credential)(?:=|:)[A-Za-z0-9._~-]{8,}/i,
  /(?:xox[baprs]-|AKIA)[A-Za-z0-9_-]{16,}/i,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?:$|[^A-Za-z0-9_-])/,
];
const SENSITIVE_PROVIDER_ERROR_TOKEN = /^(?:bearer|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|credential)(?:$|[:=])/i;
function containsProviderSecret(value) {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  const labels = ["api_key", "api-key", "api key", "access_token", "access-token", "access token", "refresh_token", "refresh-token", "refresh token", "authorization", "secret", "credential"];
  if (labels.some(label => {
    let index = lower.indexOf(label);
    while (index >= 0) {
      let cursor = index + label.length;
      while (lower[cursor] === " " || lower[cursor] === "\t") cursor++;
      if (lower[cursor] === "=" || lower[cursor] === ":") {
        cursor++;
        while (lower[cursor] === " " || lower[cursor] === "\t") cursor++;
        if (cursor < lower.length) return true;
      }
      index = lower.indexOf(label, index + 1);
    }
    return false;
  })) return true;
  const bearer = lower.indexOf("bearer ");
  if (bearer >= 0 && lower.slice(bearer + 7).trimStart().split(/[\s,;]+/)[0].length >= 12) return true;
  return PROVIDER_SECRET_PATTERNS.some(pattern => pattern.test(value));
}
function safeProviderErrorToken(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000_000 ? value : null;
  if (typeof value !== "string" || !SAFE_PROVIDER_ERROR_TOKEN.test(value) || SENSITIVE_PROVIDER_ERROR_TOKEN.test(value) || containsProviderSecret(value)) return null;
  return value;
}
function safeProviderErrorMessage(bodyText, status) {
  let message = null;
  try {
    const payload = JSON.parse(bodyText);
    const error = payload?.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error : payload;
    if (typeof error?.message === "string") message = error.message;
    else if (typeof payload?.message === "string") message = payload.message;
  } catch { /* Keep the parsed executor message only when it is not raw JSON. */ }
  if (typeof message === "string" && message.trim() && !containsProviderSecret(message)) return message;
  return `Upstream error: ${status}`;
}

function extractProviderErrorMetadata(bodyText, fallbackText = null) {
  try {
    const payload = JSON.parse(bodyText);
    const error = payload?.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error : payload;
    const metadata = {};
    for (const key of ["code", "type"]) {
      const value = safeProviderErrorToken(error?.[key]);
      if (value !== null) metadata[key] = value;
    }
    const sourceDetail = error?.detail;
    const detail = safeProviderErrorToken(sourceDetail);
    if (detail !== null) metadata.detail = detail;
    else if (sourceDetail && typeof sourceDetail === "object" && !Array.isArray(sourceDetail)) {
      const fields = {};
      for (const key of ["code", "type", "reason", "param"]) {
        const value = safeProviderErrorToken(sourceDetail[key]);
        if (value !== null) fields[key] = value;
      }
      if (Object.keys(fields).length) metadata.detail = fields;
    }
    if (Object.keys(metadata).length) return metadata;
  } catch { /* executor parsers may stringify structured errors */ }
  if (fallbackText) return extractProviderErrorMetadata(fallbackText);
  return null;
}

function attachProviderErrorMetadata(result, metadata) {
  if (metadata) Object.defineProperty(result, "providerError", { value: metadata, enumerable: true });
  return result;
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
/**
 * Remove translator-internal continuity fields from the outbound upstream
 * body. The Responses→Chat request translator stashes reasoning
 * `encrypted_content` on assistant messages so a later openai→responses
 * round-trip can restore the store=false continuity blob; that stash must
 * never reach an upstream provider. Chat-native proxies reject the unknown
 * assistant-message field and answer every turn with a literal "400" body
 * (observed with multi-turn Codex sessions via OpenAI-compatible nodes).
 */
export function stripContinuityFields(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  for (const msg of body.messages) {
    if (msg && typeof msg === "object") {
      delete msg.encrypted_content;
      delete msg.reasoning_encrypted_content;
    }
  }
  return body;
}

export async function handleChatCore(options) {
  const executionOptions = options.executionOptions;
  if (executionOptions?.alias !== true) return runChatCore(options);
  const attempt = executionOptions.attempt;
  const signal = AbortSignal.any([options.signal, attempt?.signal].filter(Boolean));
  try {
    signal.throwIfAborted();
    const result = await runChatCore({ ...options, signal, body: structuredClone(options.body), credentials: structuredClone(options.credentials) });
    signal.throwIfAborted();
    return { ...result, outputStarted: attempt.outputStarted, get failure() { return result.success ? result.failure || null : {
      category: "provider", status: result.status, error: result.error, resetsAtMs: result.resetsAtMs,
      code: result.providerError?.code || result._aliasAuthFailure?.code,
      detail: result.providerError || result._aliasAuthFailure || undefined,
      retryAfter: result.response?.headers.get("retry-after"),
      outputStarted: attempt.outputStarted,
    }; } };
  } catch (caught) {
    const error = signal.aborted ? signal.reason : caught;
    const reportedStatus = error?.detail?.status ?? error?.status;
    const status = signal.aborted ? (signal.reason?.reason === "initial-output-deadline" ? HTTP_STATUS.GATEWAY_TIMEOUT : 499)
      : (reportedStatus >= 400 && reportedStatus <= 599 ? reportedStatus : HTTP_STATUS.BAD_GATEWAY);
    trackUsageRequest(options.modelInfo.model, options.modelInfo.provider, options.connectionId, false, true);
    const message = error?.message || "Alias request aborted or failed";
    return { ...createErrorResult(status, message), outputStarted: !!attempt?.outputStarted, failure: {
      category: signal.aborted ? "cancelled" : "provider", status, error, code: error?.code,
      detail: error?.detail, cancelReason: signal.aborted ? (signal.reason?.reason || "client") : undefined,
      outputStarted: !!attempt?.outputStarted,
    } };
  }
}

async function runChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, headroomTimeoutMs, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled, pxpipeMinChars, pxpipeTimeoutMs, pxpipeTransform, onPxpipeEvent, sourceFormatOverride, providerThinking, providerOverrides, signal, healthProbe = false, executionOptions = null }) {
  const isAlias = executionOptions?.alias === true;
  const cancellable = isAlias || !!signal;
  if (cancellable) signal?.throwIfAborted();
  const attempt = isAlias ? executionOptions.attempt : null;
  const guard = () => { if (cancellable) signal?.throwIfAborted(); };
  const wait = operation => cancellable ? waitWithSignal(operation, signal) : operation;
  const ownResponse = response => !isAlias && cancellable && response.body
    ? new Response(response.body.pipeThrough(new TransformStream(), { signal }), {
      status: response.status, statusText: response.statusText, headers: response.headers,
    }) : response;
  const trackPendingRequest = healthProbe ? () => {} : trackUsageRequest;
  const appendRequestLog = healthProbe ? async () => {} : appendUsageLog;
  const saveRequestDetail = healthProbe ? async () => {} : saveUsageDetail;
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();
  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: clientRawRequest?.headers, body, connectionId, scope: provider });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession ? log.tagForSession(sessionSeed) : (log?.nextTag ? log.nextTag() : "");

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = isAlias ? null : handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation.
  // Per-model guard: only use the transport when the model declares support for that
  // sourceFormat — opencode-go models differ in endpoint support (kimi/glm only do
  // /chat/completions), so without this guard a claude-format request would wrongly
  // route kimi to /messages.
  const modelSupportedFormats = getModelSupportedFormats(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  // Per-model guard: when a model declares supportedFormats, only use the
  // sourceFormat-matched transport if that format is declared (opencode-go models
  // differ — kimi/glm only do /chat/completions). Undeclared models keep the
  // upstream default (use the transport), preserving behavior for glm/deepseek/...
  // When the client's wire format is NOT among the model's supportedFormats, fall
  // back to the transport for the model's declared targetFormat so the URL always
  // matches the translated body. Without this, a Responses-only model (e.g. Muse
  // Spark: supportedFormats ["openai-responses"]) requested by an OpenAI client is
  // translated to the Responses body (`input`) yet POSTed to the default Chat
  // Completions URL, and upstream rejects it: "unknown parameter `input`".
  const modelTargetTransport = modelTargetFormat ? resolveTransport(provider, modelTargetFormat) : null;
  const useTransport = (!modelSupportedFormats || modelSupportedFormats.includes(sourceFormat))
    ? runtimeTransport
    : modelTargetTransport;
  // A source-format-matched endpoint keeps the request lossless. Prefer it
  // over a model-level targetFormat, which is only the fallback for clients
  // whose wire format has no supported transport (for example MiniMax-M3:
  // OpenAI clients should stay on /chat/completions; other clients can fall
  // back to its declared Claude target).
  const targetFormat = useTransport?.format || modelTargetFormat || getTargetFormat(provider, credentials);
  if (useTransport && credentials) credentials.runtimeTransport = useTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  // Per-request opt-out: client can bypass all token savers via header
  const tokenSaverEnabled = clientRawRequest?.headers?.[TOKEN_SAVER_HEADER]?.toLowerCase() !== "off";

  // Cursor's translator rewrites tool_result into user text, so RTK must run on
  // the source body before translation. Every other pair translates the tool
  // shapes 1:1 — keep the post-translate pass there so those providers are
  // untouched (and a retry never re-compresses an already-compressed body).
  const preTranslateRtk = provider === "cursor"
    ? compressMessages(body, tokenSaverEnabled && rtkEnabled)
    : null;
  const preTranslateRtkLine = formatRtkLog(preTranslateRtk);
  if (preTranslateRtkLine) console.log(preTranslateRtkLine);

  const clientRequestedStreaming = isAlias && body.stream === false ? false : (body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI);
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  guard();
  const reqLogger = healthProbe || isAlias
    ? new Proxy({}, { get: () => () => {} })
    : await createRequestLogger(sourceFormat, targetFormat, model);
  guard();
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      guard();
      const n = await wait(prefetchRemoteImages(body, sourceFormat, targetFormat, { signal }));
      guard();
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { guard(); log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  let customToolNames;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    if (provider === "codex") {
      const suffixThinking = {};
      applyThinking(sourceFormat, upstreamModel, suffixThinking, provider);
      if (suffixThinking.reasoning_effort) {
        const reasoning = translatedBody.reasoning;
        translatedBody.reasoning = {
          ...(reasoning && typeof reasoning === "object" && !Array.isArray(reasoning) ? reasoning : {}),
          effort: suffixThinking.reasoning_effort,
        };
        delete translatedBody.reasoning_effort;
      }
    }
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model);
  } else {
    guard();
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    customToolNames = translatedBody._customToolNames;
    delete translatedBody._customToolNames;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
    stripContinuityFields(translatedBody);
  }

  // Tool normalization: MCP-equivalent built-in dedup (Claude clients) + same-name
  // dedup for DeepSeek models (upstream rejects duplicate tool names on all endpoints).
  if (Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools, { clientTool, model });
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || body.messages?.length || body.input?.length || 0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking = provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking ? log.fmtThink?.(extractThinking(translatedBody)) : null;
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // Claude tool schema requires `type` to be explicitly set; strict gateways (e.g., MiniMax)
  // reject legacy payloads that omit it with HTTP 400. Default to "custom" when missing.
  // Provider-scoped via quirks (shouldDefaultClaudeToolType): only gateways that declare
  // requireClaudeToolType get the explicit type. Applying it unconditionally breaks
  // Claude-format endpoints that only accept the legacy typeless tool shape — DeepSeek's
  // Anthropic-compatible endpoint 400s with "unknown variant `custom`" (#3905).
  if (shouldDefaultClaudeToolType(provider, finalFormat, translatedBody.tools, PROVIDERS)) {
    translatedBody.tools = defaultClaudeToolType(translatedBody.tools);
  }

  // RTK: compress tool_result content. Skipped when already done pre-translate.
  const rtkStats = preTranslateRtk || compressMessages(translatedBody, tokenSaverEnabled && rtkEnabled);

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  guard();
  const headroomStats = await wait(compressWithHeadroom(translatedBody, { enabled: tokenSaverEnabled && headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, timeoutMs: headroomTimeoutMs, diagnostics: headroomDiagnostics, signal }));
  guard();
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${formatHeadroomSizeLog(headroomDiagnostics)}`);
    }
  } else if (tokenSaverEnabled && headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  // Token-saver flags accumulator for the single "⚙" log line below.
  const xf = [];

  if (rtkStats?.hits?.length) xf.push(`RTK:${rtkStats.hits.length}`);
  if (isAlias && pxpipeEnabled) {
    xf.push("PXPIPE:skipped (alias cancellation)");
    try { onPxpipeEvent?.({ provider, model, applied: false, reason: "alias-cancellation-unsupported" }); } catch { /* stats must not break requests */ }
  }

  // Caveman: inject terse-style system prompt
  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = isAlias && pxpipeEnabled ? { applied: false, reason: "alias-cancellation-unsupported" } : null;
  if (pxpipeEnabled && !isAlias) {
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: true, format: finalFormat, model: upstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    if (pxpipeSummary?.applied) xf.push(`PXPIPE:${pxpipeSummary.imageCount}img`);
    try { onPxpipeEvent?.({ provider, model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
  }

  if (xf.length && log?.line) log.line(reqTag, "⚙", xf.join(" · "));

  // Pin cache breakpoints to the final body — every saver above can reshape
  // system/tools/messages, and a stale anchor costs a full prefix rewrite.
  if (passthrough && clientTool === "claude") anchorClaudeCache(translatedBody);

  guard();
  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model, reqTag
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  signal = AbortSignal.any([signal, streamController.signal].filter(Boolean));
  const dispatchBody = isAlias ? structuredClone(translatedBody) : translatedBody;
  guard();

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  // Most executors return their registry format. Cursor AgentService is an
  // exception: it is decoded by the executor into OpenAI-compatible output.
  let providerResponseFormat = targetFormat;
  try {
    const executeBody = isAlias ? structuredClone(dispatchBody) : translatedBody;
    const result = await executor.execute({
      model,
      body: executeBody,
      stream,
      credentials,
      providerSessionId: sessionSeed,
      clientTool,
      signal,
      log,
      proxyOptions,
      providerOverrides,
      healthProbe,
      executionOptions,
    });
    if (signal.aborted) cancelBody(result.response?.body, signal.reason);
    guard();
    providerResponse = ownResponse(result.response);
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || (isAlias && ["kiro", "commandcode"].includes(provider) ? FORMATS.OPENAI : targetFormat);
    const renamedToolNames = takeRenamedToolNames(executeBody);
    if (renamedToolNames?.size) {
      toolNameMap = new Map([...(toolNameMap || []), ...renamedToolNames]);
    }
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    if (isAlias) { cancelBody(providerResponse?.body, error); guard(); throw error; }
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error.stack ? `\n    ${error.stack}` : ""}`);
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  let authFailure;
  if (!healthProbe && !executor.noAuth && !attempt?.outputStarted && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    if (isAlias) {
      guard();
      const authText = await readResponseText(providerResponse, signal);
      providerResponse = new Response(authText, { status: providerResponse.status, statusText: providerResponse.statusText, headers: providerResponse.headers });
      authFailure = await parseUpstreamError(new Response(authText, { status: providerResponse.status, statusText: providerResponse.statusText, headers: providerResponse.headers }), executor);
      authFailure.message = safeProviderErrorMessage(authText, providerResponse.status);
      authFailure.providerError = extractProviderErrorMetadata(authText) || extractProviderErrorMetadata(authFailure.message);
      guard();
    }
    try {
      // Mutate credentials after each successful refresh: rotating refresh_token
      // providers (xAI/grok-cli) issue a new RT on every refresh; without this,
      // refreshWithRetry's 2nd/3rd attempt reuses the already-consumed RT →
      // invalid_grant → auth_failed retryable=false.
      guard();
      const newCredentials = isAlias
        ? await wait(executor.refreshCredentials(credentials, log, proxyOptions, { signal, recoveryBudget: executionOptions.recoveryBudget }))
        : await wait(refreshWithRetry(async () => {
        const result = cancellable
          ? await executor.refreshCredentials(credentials, log, proxyOptions, { signal })
          : await executor.refreshCredentials(credentials, log);
        guard();
        if (result?.refreshToken && result.refreshToken !== credentials.refreshToken) {
          if (result.accessToken) credentials.accessToken = result.accessToken;
          credentials.refreshToken = result.refreshToken;
        }
        return result;
      }, 3, log, ...(cancellable ? [{ signal }] : [])));
      guard();
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        if (log?.line) log.line(reqTag, "🔑", `TOKEN REFRESHED · ${provider}/${model}`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { guard(); await wait(onCredentialsRefreshed(newCredentials, cancellable ? { signal } : undefined)); guard(); } catch (e) { guard(); log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          guard();
          if (isAlias && !executionOptions.recoveryBudget?.claimRedispatch()) throw new Error("Alias redispatch budget denied");
          if (isAlias) cancelBody(providerResponse.body, "auth-redispatch");
          const retryResult = await executor.execute({
            model,
            body: isAlias ? structuredClone(dispatchBody) : translatedBody,
            stream,
            credentials,
            providerSessionId: sessionSeed,
            clientTool,
            signal,
            log,
            proxyOptions,
            providerOverrides,
            executionOptions,
          });
          if (signal.aborted) cancelBody(retryResult.response?.body, signal.reason);
          guard();
          if (retryResult.response.ok || isAlias) {
            providerResponse = ownResponse(retryResult.response);
            providerUrl = retryResult.url;
            if (isAlias) { providerHeaders = retryResult.headers; finalBody = retryResult.transformedBody; reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody); }
            providerResponseFormat = retryResult.responseFormat || (isAlias && ["kiro", "commandcode"].includes(provider) ? FORMATS.OPENAI : targetFormat);
          }
        } catch (error) {
          guard();
          if (isAlias) {
            if (attempt.outputStarted) throw error;
            return attachProviderErrorMetadata(createErrorResult(authFailure.statusCode, authFailure.message, authFailure.resetsAtMs, upstreamResponseHeaders(providerResponse.headers)), authFailure.providerError);
          }
          log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
        }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      guard();
      if (isAlias && attempt.outputStarted) throw e;
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    guard();
    const upstreamErrorText = isAlias ? await readResponseText(providerResponse, signal) : null;
    const errorResponse = isAlias ? new Response(upstreamErrorText, {
      status: providerResponse.status, statusText: providerResponse.statusText, headers: providerResponse.headers,
    }) : providerResponse;
    const { statusCode, message: parsedMessage, resetsAtMs } = await parseUpstreamError(errorResponse, executor);
    const message = isAlias ? safeProviderErrorMessage(upstreamErrorText, statusCode) : parsedMessage;
    const providerError = isAlias ? extractProviderErrorMetadata(upstreamErrorText) : null;
    guard();
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    if (log?.errorLine) {
      const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
      log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
    }
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return attachProviderErrorMetadata(createErrorResult(statusCode, errMsg, resetsAtMs, upstreamResponseHeaders(providerResponse.headers)), providerError || (isAlias ? credentials?._aliasAuthFailure : null));
  }

  guard();
  if (isAlias) {
    if (!providerResponse.headers.get("content-type") && (stream || executionOptions.forceUpstreamStreaming === true) && providerResponseFormat === FORMATS.OPENAI_RESPONSES) {
      const headers = new Headers(providerResponse.headers);
      headers.set("content-type", "text/event-stream");
      providerResponse = new Response(providerResponse.body, { status: providerResponse.status, statusText: providerResponse.statusText, headers });
    }
    providerResponse = await gateAliasResponse(providerResponse, { attempt: {
      signal, deadlineAt: attempt.deadlineAt, markOutput: attempt.markOutput, abort: attempt.abort,
      get outputStarted() { return attempt.outputStarted; },
    }, format: providerResponseFormat });
    guard();
  }

  const sharedCtx = { executionOptions, signal, streamController, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log, healthProbe };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON. The Responses wire always
  // streams upstream (openaiToOpenAIResponsesRequest pins stream:true), so a
  // non-stream OpenAI/native client behind a Responses upstream must also take
  // this path — handleForcedSSEToJson returns null when the body is not SSE.
  if (!clientRequestedStreaming && (providerRequiresStreaming || providerResponseFormat === FORMATS.OPENAI_RESPONSES || (isAlias && executionOptions.forceUpstreamStreaming === true))) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, customToolNames, toolNameMap, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return { ...result, httpStatus: providerResponse.status }; }
  }

  // True non-streaming response
  if (!stream || (isAlias && !providerResponse.headers.get("content-type")?.includes("text/event-stream")) || (healthProbe && !clientRequestedStreaming)) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, reqLogger, toolNameMap, customToolNames, trackDone, appendLog });
    streamController.handleComplete();
    return { ...result, httpStatus: providerResponse.status };
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat, userAgent, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, credentials });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}

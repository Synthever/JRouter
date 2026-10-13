import { BaseExecutor } from "./base.js";
import { randomUUID } from "node:crypto";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE, selectAnthropicBeta, mergeAnthropicBeta } from "../providers/shared.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { extractClaudeSessionIdFromUserId } from "../utils/claudeCloaking.js";
import { FORMATS } from "../translator/formats.js";

const NO_REFRESH_RESULT = Symbol("no refresh result");

function cancelRefreshBody(response, reason) {
  try { Promise.resolve(response?.body?.cancel(reason)).catch(() => {}); } catch { /* Preserve cancellation even if cleanup fails. */ }
}

// A signal-aware read owns the reader so abort can stop a pending body, not just detach its waiter.
async function readRefreshJSON(response, signal) {
  if (signal?.aborted) cancelRefreshBody(response, signal.reason);
  signal?.throwIfAborted();
  if (!response.ok) return NO_REFRESH_RESULT;
  if (!signal) return response.json();
  const reader = response.body?.getReader?.();
  const onAbort = () => {
    if (reader) {
      try { Promise.resolve(reader.cancel(signal.reason)).catch(() => {}); } catch { /* Preserve the abort reason. */ }
    } else cancelRefreshBody(response, signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    let result;
    if (reader) {
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      result = JSON.parse(text + decoder.decode());
    } else result = await response.json();
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { reader?.releaseLock(); } catch { /* A canceled transport may already have released it. */ }
  }
}

async function fetchRefreshJSON(url, init, proxyOptions, { signal, recoveryBudget } = {}) {
  signal?.throwIfAborted();
  if (recoveryBudget && !recoveryBudget.claimRefresh()) return NO_REFRESH_RESULT;
  signal?.throwIfAborted();
  try {
    const response = await proxyAwareFetch(url, signal ? { ...init, signal } : init, proxyOptions);
    return await readRefreshJSON(response, signal);
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

// Auth header descriptors — derived from registry transport.auth, fallback to hardcoded defaults.
const BEARER = { combined: true, header: "Authorization", scheme: "bearer" };
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" };
const AUTH_DESCRIPTORS = Object.fromEntries(
  Object.entries(PROVIDERS)
    .filter(([, t]) => t.auth)
    .map(([id, t]) => [id, t.auth])
);

// Apply a token to a header per scheme (matches legacy: combined always sets, even when undefined).
function setAuth(headers, spec, token) {
  headers[spec.header] = spec.scheme === "bearer" ? `Bearer ${token}` : token;
}

// Resolve auth onto headers from a descriptor.
function applyAuth(headers, desc, credentials) {
  if (desc.combined) {
    // combined providers always set the header (legacy behavior, incl. noAuth → "Bearer undefined")
    setAuth(headers, desc, credentials.apiKey || credentials.accessToken);
    if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return;
  }
  // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);
  else if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
}

// Provider-specific header quirks kept as small hooks (not pure auth).
const HEADER_HOOKS = {
  // Stable device_id from OAuth connection (CLIProxyAPI KimiTokenStorage.DeviceID)
  kimiHeaders: (h, c) => Object.assign(h, buildKimiHeaders(c?.providerSpecificData?.deviceId)),
  // MiniMax Code (mcode): the placeholder x-api-key rides every request next
  // to the Bearer token, plus per-request session/timezone headers. Static
  // teammates (User-Agent, X-Mavis-Agent-Id) live in the registry transport.
  minimaxHeaders: (h) => {
    h["x-api-key"] = "sk-xxx";
    h["X-Mavis-Timezone-Offset"] = String(new Date().getTimezoneOffset() * -60);
    if (!h["X-Mavis-Session-Id"]) h["X-Mavis-Session-Id"] = randomUUID();
  },
  // Muse: x-api-version only on subscription (minted key) requests — plain
  // Model API keys already work without it
  museHeaders: (h, c) => { if (c?.accessToken && !c?.apiKey) h["x-api-version"] = "1.0.0"; },
  clineHeaders: (h, c) => Object.assign(h, buildClineHeaders(c.apiKey || c.accessToken)),
  kilocodeOrg: (h, c) => { if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId; },
};

// Config-driven OAuth refresh grants — derived from registry oauth.refresh.
const REFRESH_GRANTS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH)
    .filter(([, o]) => o.refresh)
    .map(([id, o]) => {
      const tokenUrl = o.tokenUrl;
      const encoding = o.refresh.encoding;
      const extraParams = o.refresh.scope ? { scope: o.refresh.scope } : {};
      return [id, {
        encoding,
        url: () => tokenUrl,
        params: (ex) => id === "gemini"
          ? { client_id: ex.config.clientId, client_secret: ex.config.clientSecret, ...extraParams }
          : { client_id: o.clientId, ...extraParams },
      }];
    })
);

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  supportsUpstreamStreaming(credentials) {
    const transport = credentials?.runtimeTransport || this.config;
    return transport.forceStream === true || [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE, FORMATS.CLAUDE, FORMATS.GEMINI, FORMATS.OLLAMA].includes(transport.format);
  }

  usesStreamBody(credentials) {
    return (credentials?.runtimeTransport?.format || this.config.format) !== FORMATS.GEMINI;
  }

  transformRequest(model, body, stream, credentials, executionOptions = null) {
    const transformed = this.applyJsonSchemaFallback(body);

    if (transformed && typeof transformed === "object") {
      // quirk: some openai-compatible providers reject Anthropic's client_metadata field
      if (this.config.quirks?.dropClientMetadata) {
        delete transformed.client_metadata;
      }
      stripUnsupportedParams(this.provider, model, transformed);
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map(m => ({ ...m })) : [];
    const sys = messages.find(m => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Runtime transport (multi-endpoint providers): use the sourceFormat-matched endpoint
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    }
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = resolveOpenAICompatibleApiType(this.provider, credentials) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    // gemini-format: build :streamGenerateContent / :generateContent path
    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    // urlSuffix (e.g. ?beta=true) declared per-provider in registry
    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl;
    if (url?.includes("{accountId}")) {
      const accountId = credentials?.providerSpecificData?.accountId;
      if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
      return url.replace("{accountId}", accountId);
    }
    return url;
  }

  // Fallback descriptor for providers without an explicit entry in AUTH_DESCRIPTORS.
  resolveAuthDescriptor() {
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return BEARER;
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const rt = credentials?.runtimeTransport;
    const headers = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
    const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
    // Hooks run BEFORE auth so dynamic overlays can't clobber the token.
    for (const hook of desc.hooks || []) HEADER_HOOKS[hook]?.(headers, credentials);
    applyAuth(headers, desc, credentials);

    // anthropic-compatible-* nodes serving a real Claude model sit in front of
    // Anthropic itself (a rotating multi-account proxy, a corporate gateway),
    // so the request needs the same beta flags the `claude` provider sends:
    // without `context-management-2025-06-27` upstream rejects the
    // `context_management` block Claude Code puts in every request with
    // "context_management: Extra inputs are not permitted" (HTTP 400), and the
    // combo silently falls through to the next model. The model id gates this:
    // a node fronting Kimi or GLM answers on its own ids and never matches, so
    // gateways that would choke on unknown beta flags are left untouched.
    const isClaudeModel = typeof model === "string" && /^claude-/.test(model);
    const clientBeta = credentials?.rawHeaders?.["anthropic-beta"];
    if (model && (this.provider === "claude"
      || (this.provider?.startsWith?.("anthropic-compatible-") && isClaudeModel))) {
      headers["Anthropic-Beta"] = mergeAnthropicBeta(selectAnthropicBeta(model, body), clientBeta);
    } else if (this.provider === "anthropic" && clientBeta) {
      headers["Anthropic-Beta"] = mergeAnthropicBeta(headers["Anthropic-Beta"], clientBeta);
    }

    // Claude OAuth: align x-claude-code-session-id with metadata.user_id.session_id if missing
    if (this.provider === "claude" && !headers["x-claude-code-session-id"]) {
      const token = credentials?.accessToken || credentials?.apiKey || "";
      if (token.includes("sk-ant-oat")) {
        const sid = extractClaudeSessionIdFromUserId(body?.metadata?.user_id);
        if (sid) headers["x-claude-code-session-id"] = sid;
      }
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials, proxyOptions, options = {}) {
    const grant = REFRESH_GRANTS[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json"
      ? this.refreshWithJSON(grant.url(), params, proxyOptions, options)
      : this.refreshWithForm(grant.url(), params, proxyOptions, options);
  }

  async refreshCredentials(credentials, log, proxyOptions = null, { signal, recoveryBudget } = {}) {
    signal?.throwIfAborted();
    if (!credentials.refreshToken) return null;
    // This entry point owns the claim; direct helper calls claim at their fetch boundary instead.
    const options = { signal };

    const refreshers = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions, options),
      codex: () => this.refreshFromGrant(credentials, proxyOptions, options),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions, options),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions, options),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions, options),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions, options),
      clinepass: () => this.refreshCline(credentials.refreshToken, proxyOptions, options),
      kimi: () => this.refreshKimi(credentials, proxyOptions, options),
      "kimi-coding": () => this.refreshKimi(credentials, proxyOptions, options)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;
    if (this.provider === "kimi" || this.provider === "kimi-coding") {
      const cfg = PROVIDERS.kimi || PROVIDERS["kimi-coding"];
      if (!cfg?.refreshUrl || !cfg?.clientId) return null;
    }

    try {
      signal?.throwIfAborted();
      if (recoveryBudget && !recoveryBudget.claimRefresh()) return null;
      signal?.throwIfAborted();
      const result = await refresher();
      signal?.throwIfAborted();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null, options = {}) {
    const tokens = await fetchRefreshJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (tokens === NO_REFRESH_RESULT) return null;
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null, options = {}) {
    const tokens = await fetchRefreshJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (tokens === NO_REFRESH_RESULT) return null;
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken, proxyOptions = null, options = {}) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const tokens = await fetchRefreshJSON(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId, client_secret: PROVIDERS.iflow.clientSecret })
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (tokens === NO_REFRESH_RESULT) return null;
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null, options = {}) {
    const tokens = await fetchRefreshJSON(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (tokens === NO_REFRESH_RESULT) return null;
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCline(refreshToken, proxyOptions = null, options = {}) {
    const payload = await fetchRefreshJSON(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (payload === NO_REFRESH_RESULT) return null;
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    let accessToken = data?.accessToken;
    if (accessToken && !accessToken.startsWith("workos:")) {
      accessToken = `workos:${accessToken}`;
    }
    return { accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  // CLIProxyAPI DeviceFlowClient.RefreshToken — form body + X-Msh-* headers + stable device_id
  async refreshKimi(credentials, proxyOptions = null, options = {}) {
    const refreshToken = credentials.refreshToken;
    const cfg = PROVIDERS.kimi || PROVIDERS["kimi-coding"];
    if (!cfg?.refreshUrl || !cfg?.clientId) return null;
    const kimiHeaders = buildKimiHeaders(credentials?.providerSpecificData?.deviceId);
    const tokens = await fetchRefreshJSON(cfg.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId })
    }, proxyOptions, options);
    options.signal?.throwIfAborted();
    if (tokens === NO_REFRESH_RESULT) return null;
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;

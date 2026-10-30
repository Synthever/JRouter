export const SESSIONS_KEY = "jrouter.playground.sessions.v1";
export const SETTINGS_KEY = "jrouter.playground.settings.v1";
export const FAVORITES_KEY = "jrouter.playground.favorites.v1";
export const MAX_CONVERSATIONS = 50;
export const MAX_MESSAGES = 200;
export const MAX_REASONING_CHARS = 4000;
export const MAX_TITLE_CHARS = 60;

export const DEFAULT_SETTINGS = Object.freeze({
  system: "",
  temperature: 0.7,
  maxTokens: 2048,
  topP: "",
  helper: true,
  think: false,
});

const MESSAGE_ROLES = new Set(["user", "assistant", "divider"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const temperature = Number.parseFloat(input.temperature);
  const maxTokens = Number.parseInt(input.maxTokens, 10);
  const topP = Number.parseFloat(input.topP);
  return {
    system: safeString(input.system),
    temperature: Number.isFinite(temperature) ? clamp(temperature, 0, 2) : DEFAULT_SETTINGS.temperature,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_SETTINGS.maxTokens,
    topP: Number.isFinite(topP) ? String(clamp(topP, 0, 1)) : "",
    helper: typeof input.helper === "boolean" ? input.helper : DEFAULT_SETTINGS.helper,
    think: typeof input.think === "boolean" ? input.think : DEFAULT_SETTINGS.think,
  };
}

export function settingsToSliderValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 2) : DEFAULT_SETTINGS.temperature;
}

export function normalizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = MESSAGE_ROLES.has(raw.role) ? raw.role : null;
  if (!role) return null;
  const content = safeString(raw.content);
  const reasoning = safeString(raw.reasoning).slice(0, MAX_REASONING_CHARS);
  let status = raw.status;
  if (role === "assistant") {
    if (status === "streaming") status = content || reasoning ? "done" : "empty";
    if (!["streaming", "done", "empty", "error"].includes(status)) status = content ? "done" : "empty";
  }
  return {
    id: safeString(raw.id) || `restored_${Math.random().toString(36).slice(2)}`,
    role,
    content,
    reasoning,
    status: role === "assistant" ? status : undefined,
    modelName: safeString(raw.modelName),
    providerId: safeString(raw.providerId),
    providerName: safeString(raw.providerName),
    isCombo: raw.isCombo === true,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
    elapsedMs: Number.isFinite(raw.elapsedMs) ? raw.elapsedMs : null,
    thinkingMs: Number.isFinite(raw.thinkingMs) ? raw.thinkingMs : null,
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : null,
    error: safeString(raw.error),
    followUps: Array.isArray(raw.followUps) ? raw.followUps.filter((item) => typeof item === "string").slice(0, 3) : [],
    from: safeString(raw.from),
    to: safeString(raw.to),
  };
}

export function normalizeSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES)
    : [];
  const model = raw.model && typeof raw.model === "object" && typeof raw.model.value === "string"
    ? {
      value: raw.model.value,
      name: safeString(raw.model.name) || raw.model.value,
      providerId: safeString(raw.model.providerId),
      providerName: safeString(raw.model.providerName),
      providerColor: safeString(raw.model.providerColor),
      isCombo: raw.model.isCombo === true,
    }
    : null;
  return {
    id: safeString(raw.id) || `session_${Math.random().toString(36).slice(2)}`,
    title: safeString(raw.title).slice(0, MAX_TITLE_CHARS) || "New chat",
    model,
    messages,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

export function restoreSessions(raw) {
  const input = Array.isArray(raw) ? { conversations: raw } : raw;
  if (!input || typeof input !== "object" || !Array.isArray(input.conversations)) return null;
  const conversations = input.conversations
    .map(normalizeSession)
    .filter(Boolean)
    .slice(0, MAX_CONVERSATIONS);
  if (conversations.length === 0) return null;
  const activeId = safeString(input.activeId);
  const activeExists = conversations.some((conversation) => conversation.id === activeId);
  return { activeId: activeExists ? activeId : conversations[0].id, conversations };
}

export function stripReasoning(sessions) {
  return {
    ...sessions,
    conversations: sessions.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message, reasoning: "" })),
    })),
  };
}

const NO_STORAGE = Symbol("playground.noStorage");

// Resolve the default storage inside the guarded body: reading
// `globalThis.localStorage` throws in hosts where site data is blocked, and a
// default parameter would surface that error before any `try` runs.
function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? NO_STORAGE;
  } catch {
    return NO_STORAGE;
  }
}

// A target is only usable when it exists and can actually accept a write: a
// `null`/`{}` storage used to short-circuit the optional call and report success
// while persisting nothing.
function isWritableStorage(target) {
  return target !== NO_STORAGE && Boolean(target) && typeof target.setItem === "function";
}

export function readStorage(key, validate, storage) {
  try {
    const target = resolveStorage(storage);
    if (target === NO_STORAGE) return null;
    const raw = target?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStorage(key, value, storage) {
  try {
    const target = resolveStorage(storage);
    if (!isWritableStorage(target)) return false;
    target.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function trimReasoning(sessions) {
  return {
    ...sessions,
    conversations: sessions.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => (
        typeof message.reasoning === "string" && message.reasoning.length > MAX_REASONING_CHARS
          ? { ...message, reasoning: message.reasoning.slice(0, MAX_REASONING_CHARS) }
          : message
      )),
    })),
  };
}

export function persistSessions(sessions, storage) {
  const target = resolveStorage(storage);
  if (!isWritableStorage(target)) return false;
  if (writeStorage(SESSIONS_KEY, trimReasoning(sessions), target)) return true;
  // Quota: retry without the heavy reasoning bodies before giving up.
  return writeStorage(SESSIONS_KEY, stripReasoning(sessions), target);
}

export function sanitizeTitle(raw) {
  const line = safeString(raw)
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s"'`*#]+/, "")
    .replace(/[\s"'`*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.slice(0, MAX_TITLE_CHARS);
}

export function localTitle(question) {
  const words = safeString(question).replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").split(" ").filter(Boolean);
  const title = words.slice(0, 6).join(" ").slice(0, MAX_TITLE_CHARS);
  if (!title) return "New chat";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function parseFollowUps(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const text = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function toRequestMessages(messages, system) {
  const result = [];
  if (system && system.trim()) result.push({ role: "system", content: system.trim() });
  for (const message of messages || []) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (typeof message.content !== "string" || !message.content.trim()) continue;
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

export function buildTurnBody(session, settings) {
  const normalized = normalizeSettings(settings);
  const body = {
    model: session?.model?.value || "",
    messages: toRequestMessages(session?.messages, normalized.system),
    stream: true,
    temperature: normalized.temperature,
    max_tokens: normalized.maxTokens,
  };
  const topP = Number.parseFloat(normalized.topP);
  if (Number.isFinite(topP)) body.top_p = clamp(topP, 0, 1);
  if (normalized.think) body.reasoning_effort = "high";
  return body;
}

export function buildExportBody(session, settings) {
  const body = buildTurnBody(session, settings);
  if (!body.messages.some((message) => message.role === "user")) {
    body.messages = [...body.messages, { role: "user", content: "Hello" }];
  }
  if (!body.model) body.model = "YOUR_MODEL";
  return body;
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

export function renderCurl(body, origin) {
  const payload = stringify(body).replace(/'/g, "'\\''");
  return `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer $JROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${payload}'`;
}

export function renderJavaScript(body, origin) {
  return `const res = await fetch("${origin}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.JROUTER_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${stringify(body).replace(/\n/g, "\n  ")}),
});
console.log(await res.json());`;
}

export function renderPython(body, origin) {
  // Single JSON-encoded string literal: a raw triple-quoted body breaks the
  // snippet as soon as a message contains `"""`.
  return `import json, os, requests

payload = json.loads(${JSON.stringify(stringify(body))})

res = requests.post(
    "${origin}/v1/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['JROUTER_API_KEY']}"},
    json=payload,
)
print(res.json())`;
}

export function relativeTime(timestamp, now = Date.now()) {
  const delta = now - Number(timestamp || 0);
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildMetaParts(meta) {
  if (!meta) return [];
  const parts = [];
  const latency = formatLatency(meta.latencyMs);
  if (latency) parts.push(latency);
  const prompt = Number.isFinite(meta.usage?.prompt_tokens) ? meta.usage.prompt_tokens.toLocaleString("en-US") : "";
  if (prompt) parts.push(`${prompt} in`);
  const completion = Number.isFinite(meta.usage?.completion_tokens) ? meta.usage.completion_tokens.toLocaleString("en-US") : "";
  if (completion) {
    parts.push(`${completion} out`);
  } else if (Number.isFinite(meta.usage?.total_tokens)) {
    parts.push(`${meta.usage.total_tokens.toLocaleString("en-US")} tokens`);
  }
  if (meta.finishReason) parts.push(meta.finishReason);
  if (meta.responseModel && meta.responseModel !== meta.requestedModel) parts.push(meta.responseModel);
  if (meta.stopped) parts.push("stopped");
  return parts;
}

export function nextActiveId(conversations, removedId) {
  const remaining = conversations.filter((conversation) => conversation.id !== removedId);
  return remaining[0]?.id || "";
}

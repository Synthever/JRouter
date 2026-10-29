// Pure helpers for the Playground. No React, no DOM: this module is imported by
// client components and by tests/unit/playground-utils.test.js under Node.

const SPEED_WINDOW_GUARD_MS = 0;

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function errorMessageFrom(payload) {
  const raw = payload?.error?.message ?? payload?.error ?? payload?.message ?? payload?.msg;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return "";
}

export function reasoningDeltaFrom(delta) {
  const raw = delta?.reasoning_content ?? delta?.reasoning;
  return typeof raw === "string" ? raw : "";
}

export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "";
}

export function formatSpeed(usage, firstTokenMs, totalMs) {
  const completion = usage?.completion_tokens;
  if (!Number.isFinite(completion) || completion <= 0) return "";
  if (!Number.isFinite(firstTokenMs) || !Number.isFinite(totalMs)) return "";
  const windowMs = totalMs - firstTokenMs;
  if (windowMs <= SPEED_WINDOW_GUARD_MS) return "";
  return `${Math.round(completion / (windowMs / 1000))} tok/s`;
}

export function shortModelName(name, max = 28) {
  const text = String(name || "").trim();
  if (!text) return "";
  const tail = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
  return tail.length > max ? `${tail.slice(0, max - 1)}…` : tail;
}

export function estimateTokens(text) {
  const value = String(text || "").trim();
  return value ? Math.ceil(value.length / 4) : 0;
}

export function cacheShare(stats) {
  const cached = Number(stats?.totalCachedTokens) || 0;
  const prompt = Number(stats?.totalPromptTokens) || 0;
  if (prompt <= 0) return { percent: 0, cached, prompt, hasData: false };
  const percent = Math.min(100, Math.round((cached / prompt) * 1000) / 10);
  return { percent, cached, prompt, hasData: true };
}

export function buildMetricParts(turn) {
  const parts = [];
  if (!turn) return parts;
  const ttft = formatLatency(turn.firstTokenMs);
  if (ttft) parts.push(`TTFT ${ttft}`);
  const total = formatLatency(turn.totalMs);
  if (total) parts.push(`total ${total}`);
  const speed = formatSpeed(turn.usage, turn.firstTokenMs, turn.totalMs);
  if (speed) parts.push(speed);
  const prompt = formatCount(turn.usage?.prompt_tokens ?? turn.usage?.input_tokens);
  const completion = formatCount(turn.usage?.completion_tokens ?? turn.usage?.output_tokens);
  if (prompt || completion) parts.push(`${prompt || "0"} in / ${completion || "0"} out`);
  if (turn.finishReason) parts.push(turn.finishReason);
  if (turn.reportedModel && turn.reportedModel !== turn.requestedModel) parts.push(turn.reportedModel);
  if (turn.stopped) parts.push("stopped");
  return parts;
}

// Configured route for a target: combo members in their stored order, or the
// provider that owns a direct model. Never claims what actually served a reply.
export function buildRoutePlan(target, combos = [], providers = [], strategies = {}) {
  if (!target?.value) {
    return { kind: "none", label: "No target", summary: "Pick a model to see its route.", strategy: "", rows: [], connections: 0 };
  }

  const names = [target.value, target.name].filter(Boolean);
  const combo = (Array.isArray(combos) ? combos : []).find(
    (entry) => names.includes(entry.name) || (entry.publicName && names.includes(entry.publicName)),
  );

  if (combo) {
    const members = (Array.isArray(combo.models) ? combo.models : []).filter(Boolean);
    const rows = members.map((member, index) => ({
      index: index + 1,
      member,
      provider: member.includes("/") ? member.slice(0, member.indexOf("/")) : "",
      model: member.includes("/") ? member.slice(member.indexOf("/") + 1) : member,
      role: index === 0 ? "primary" : `fallback ${index}`,
    }));
    const preview = rows.slice(0, 3).map((row) => row.member).join(" → ");
    return {
      kind: "combo",
      label: "Combo chain",
      summary: `${rows.length} upstream${rows.length === 1 ? "" : "s"} · ${preview}${rows.length > 3 ? ` +${rows.length - 3}` : ""}`,
      strategy: strategies?.[combo.name]?.fallbackStrategy || "fallback",
      rows,
      connections: 0,
    };
  }

  const connections = (Array.isArray(providers) ? providers : []).filter(
    (connection) => connection && (connection.provider === target.providerId || connection.id === target.providerId),
  );
  const providerName = target.providerName || target.providerId || "provider";
  return {
    kind: "direct",
    label: "Direct",
    summary: connections.length > 1 ? `${connections.length} connections · ${providerName}` : `Single upstream · ${providerName}`,
    strategy: "direct",
    rows: [{
      index: 1,
      member: target.value,
      provider: target.providerId || "",
      model: shortModelName(target.name || target.value, 48),
      role: "primary",
    }],
    connections: connections.length,
  };
}

export const RAW_LIMIT = 256 * 1024;
// Display-only stand-in for the key: a copied cURL must never carry a live one.
const API_KEY_PLACEHOLDER = "***";

export function buildPayload({ model, history = [], systemPrompt = "", params }) {
  const messages = [];
  const system = String(systemPrompt || "").trim();
  if (system) messages.push({ role: "system", content: system });
  for (const message of history) {
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    if (!message.content) continue;
    messages.push({ role: message.role, content: message.content });
  }

  const payload = { model: model.value, messages, stream: params?.stream !== false };
  if (!params?.useDefaults) {
    const temperature = Number.parseFloat(params?.temperature);
    if (Number.isFinite(temperature)) payload.temperature = temperature;
    const maxTokens = Number.parseInt(params?.maxTokens, 10);
    if (Number.isFinite(maxTokens) && maxTokens > 0) payload.max_tokens = maxTokens;
    const topP = Number.parseFloat(params?.topP);
    if (Number.isFinite(topP)) payload.top_p = topP;
  }
  if (params?.jsonMode) payload.response_format = { type: "json_object" };
  return payload;
}

export function maskRequestHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^authorization$/i.test(key)) {
      const token = String(value || "").replace(/^Bearer\s+/i, "");
      out.Authorization = token ? `Bearer ••••${token.slice(-4)}` : "Bearer ••••";
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

const shellQuote = (value) => String(value).replace(/'/g, "'\''");

export function buildCurl({ url, headers = {}, body }) {
  const args = [`curl -X POST '${shellQuote(url)}'`];
  for (const [key, value] of Object.entries(headers)) {
    if (/^authorization$/i.test(key) || /^content-type$/i.test(key)) continue;
    args.push(`  -H '${key}: ${shellQuote(value)}'`);
  }
  args.push(`  -H 'Authorization: Bearer ${API_KEY_PLACEHOLDER}'`);
  if (body !== undefined) {
    args.push(`  -H 'Content-Type: application/json'`);
    args.push(`  -d '${shellQuote(JSON.stringify(body))}'`);
  }
  return args.join(" \\\n");
}

// Reads an OpenAI-style SSE body. Mirrors the parser the playground shipped with,
// with request/response capture for the JSON inspector.
export async function consumeSseStream(body, { onDelta } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage = null;
  let finishReason = "";
  let responseModel = "";
  let frames = 0;
  let rawText = "";
  let truncated = false;

  const capture = (text) => {
    if (truncated) return;
    const room = RAW_LIMIT - rawText.length;
    if (room <= 0) {
      truncated = true;
      return;
    }
    if (text.length > room) {
      rawText += text.slice(0, room);
      truncated = true;
      return;
    }
    rawText += text;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunkText = decoder.decode(value, { stream: true });
    capture(chunkText);
    buffer += chunkText;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      frames += 1;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      if (chunk?.error) throw new Error(errorMessageFrom(chunk) || "Request failed.");

      const choice = chunk?.choices?.[0];
      const deltaText = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
      const deltaReasoning = reasoningDeltaFrom(choice?.delta);
      if (deltaText || deltaReasoning) {
        content += deltaText;
        reasoning += deltaReasoning;
        if (onDelta) onDelta({ content, reasoning });
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
      if (typeof chunk?.model === "string" && chunk.model) responseModel = chunk.model;
    }
  }

  return { content, reasoning, usage, finishReason, responseModel, frames, rawText, truncated };
}

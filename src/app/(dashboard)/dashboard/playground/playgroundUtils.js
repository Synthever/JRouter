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

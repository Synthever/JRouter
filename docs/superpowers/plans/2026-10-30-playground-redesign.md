# Playground Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/playground` as a full-height routing workbench: intro + three KPI cards, chat panel, execution rail, and three working modes (Single, Compare, JSON API) on the dashboard's existing design language.

**Architecture:** Chat logic moves out of the 928-line client into a per-lane hook (`usePlaygroundLane`) built on pure helpers (`playgroundUtils.js`) that are unit-tested in Node. The page becomes composition only: it owns mode, lane instances, KPI data and the rail; presentational components (`PlaygroundStats`, `PlaygroundTranscript`, `PlaygroundRail`, `PlaygroundJsonView`) render. No server or API change.

**Tech Stack:** Next.js App Router client components, plain JavaScript (ESM), CSS Modules, existing shared components (`WidgetGrid`, `SegmentedControl`, `Toggle`, `Tooltip`, `Button`, `ModelPickerPopover`, `PlaygroundMarkdown`, `ProviderIcon`, `Icon`), Vitest in the independent `tests/` package.

**Spec:** `docs/superpowers/specs/2026-10-30-playground-redesign-design.md`

## Global Constraints

- Plain JavaScript ESM only; no TypeScript, no new npm dependencies.
- `@/*` resolves to `src/*`; CSS Modules for all styles in this route.
- Reuse tokens only: `--surface`, `--surface-2`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--brand-pink`, `--brand-lavender`, `--brand-ochre`, `--r1`, `--r3`. No new colour literals outside the existing brand tokens.
- Honest telemetry: only the sources in spec §3. Missing values are omitted or shown as `—`; never fabricate upstream names, weights, cache headers or cost.
- Payload changes are limited to: optional `messages[0]` system message, sampling params only when `useDefaults` is false, `response_format: {type:"object"}`-style strict JSON toggle, and `stream` toggling. Everything else in the request stays byte-identical to today.
- Full-height layout stays: `src/shared/components/layouts/DashboardLayout.js` keeps `/dashboard/playground` in `isFullHeightPage` and `h-dvh`. Page-level scrolling is allowed only below a 700px viewport height via a media query.
- Do not touch `docs/templates/**`, `open-sse/**`, or any other dashboard route.
- Before the first component edit, read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `11-css.md` (repo rule: this Next version differs from training data).
- Commits: Conventional Commits (`feat(playground): …`, `test(playground): …`). Stage only the files listed in the task.
- Tests run from the `tests/` package: `cd tests && npx vitest run unit/<file>.test.js`. Root `npm install` and `cd tests && npm install` are already done in this checkout.
- Lint a file set with `npx eslint "src/app/(dashboard)/dashboard/playground"`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/app/(dashboard)/dashboard/playground/playgroundUtils.js` | Pure functions: metrics, cache share, route plan, payload, cURL, header masking, SSE reader, ids |
| `src/app/(dashboard)/dashboard/playground/usePlaygroundLane.js` | One conversation lane: model, messages, send/stop/retry/reset, request+response capture |
| `src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js` | Provider/combo icon with fallback (moved from client) |
| `src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js` | Message rendering: bubbles, reasoning, metrics row, actions, error bubble |
| `src/app/(dashboard)/dashboard/playground/PlaygroundStats.js` + `.module.css` | Three KPI widgets on `WidgetGrid` |
| `src/app/(dashboard)/dashboard/playground/PlaygroundRail.js` + `.module.css` | Parameters, route plan, last response |
| `src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.js` + `.module.css` | JSON API inspector (request / response / cURL) |
| `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` | Composition: fetches, mode, lanes, KPI model, handlers |
| `src/app/(dashboard)/dashboard/playground/playground.module.css` | Page, intro, workbench, chat panel, composer (rewritten) |
| `tests/unit/playground-utils.test.js` | Vitest coverage for every pure helper |
| `tests/unit/playground-full-chat.test.js` | Existing route contracts (updated, old "no header" assertions superseded) |

---

### Task 1: Metric, cache and route helpers

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/playgroundUtils.js`
- Test: `tests/unit/playground-utils.test.js`

**Interfaces:**
- Produces: `formatLatency(ms) -> string`, `formatCount(value) -> string`, `formatSpeed(usage, firstTokenMs, totalMs) -> string`, `shortModelName(name, max=28) -> string`, `estimateTokens(text) -> number`, `cacheShare(stats) -> {percent, cached, prompt, hasData}`, `buildMetricParts(turn) -> string[]`, `buildRoutePlan(target, combos, providers, strategies) -> {kind, label, summary, strategy, rows, connections}`, `createId() -> string`, `errorMessageFrom(payload) -> string`, `reasoningDeltaFrom(delta) -> string`.
- `turn` shape (produced by the lane hook in Task 3): `{firstTokenMs, totalMs, usage, finishReason, reportedModel, requestedModel, stopped}`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/playground-utils.test.js
import { describe, expect, it } from "vitest";
import {
  buildMetricParts,
  buildRoutePlan,
  cacheShare,
  estimateTokens,
  formatLatency,
  formatSpeed,
  shortModelName,
} from "@/app/(dashboard)/dashboard/playground/playgroundUtils.js";

describe("formatLatency", () => {
  it("uses ms below a second and seconds above", () => {
    expect(formatLatency(820)).toBe("820ms");
    expect(formatLatency(1240)).toBe("1.2s");
  });
  it("returns an empty string for missing values", () => {
    expect(formatLatency(0)).toBe("");
    expect(formatLatency(null)).toBe("");
    expect(formatLatency(Number.NaN)).toBe("");
  });
});

describe("formatSpeed", () => {
  it("divides completion tokens by the post-first-token window", () => {
    expect(formatSpeed({ completion_tokens: 420 }, 500, 5500)).toBe("84 tok/s");
  });
  it("stays empty without usage or a positive window", () => {
    expect(formatSpeed(null, 500, 5500)).toBe("");
    expect(formatSpeed({ completion_tokens: 10 }, 500, 500)).toBe("");
    expect(formatSpeed({ completion_tokens: 10 }, null, 1000)).toBe("");
  });
});

describe("shortModelName", () => {
  it("keeps the tail after the last slash", () => {
    expect(shortModelName("deepseek-ai/DeepSeek-V4.1-Flash")).toBe("DeepSeek-V4.1-Flash");
  });
  it("truncates with an ellipsis past the limit", () => {
    expect(shortModelName("a/abcdefghijklmnopqrstuvwxyz012345", 10)).toBe("abcdefghi…");
  });
  it("handles empty values", () => {
    expect(shortModelName("")).toBe("");
    expect(shortModelName(null)).toBe("");
  });
});

describe("estimateTokens", () => {
  it("rounds characters up in fours", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("cacheShare", () => {
  it("reports no data when nothing was prompted", () => {
    expect(cacheShare({ totalCachedTokens: 0, totalPromptTokens: 0 })).toEqual({
      percent: 0, cached: 0, prompt: 0, hasData: false,
    });
  });
  it("computes a capped percentage", () => {
    expect(cacheShare({ totalCachedTokens: 942, totalPromptTokens: 1000 })).toMatchObject({
      percent: 94.2, cached: 942, prompt: 1000, hasData: true,
    });
    expect(cacheShare({ totalCachedTokens: 2000, totalPromptTokens: 1000 }).percent).toBe(100);
  });
  it("tolerates a missing payload", () => {
    expect(cacheShare(null)).toEqual({ percent: 0, cached: 0, prompt: 0, hasData: false });
  });
});

describe("buildMetricParts", () => {
  it("orders TTFT, total, speed and tokens", () => {
    expect(buildMetricParts({
      firstTokenMs: 500,
      totalMs: 5500,
      usage: { prompt_tokens: 1024, completion_tokens: 420 },
      finishReason: "stop",
      reportedModel: "vendor/model-x",
      requestedModel: "vendor/model",
    })).toEqual(["TTFT 500ms", "total 5.5s", "84 tok/s", "1,024 in / 420 out", "stop", "vendor/model-x"]);
  });
  it("never emits NaN", () => {
    expect(buildMetricParts({ firstTokenMs: null, totalMs: null, usage: null })).toEqual([]);
  });
  it("marks stopped turns", () => {
    expect(buildMetricParts({ totalMs: 900, stopped: true })).toContain("stopped");
  });
});

const combos = [
  { name: "fast-pool", publicName: "deepseek-flash", models: ["river/deepseek-v4", "beatapi/qwen", "custom/llama"] },
];
const providers = [
  { id: "c1", provider: "openai", name: "work" },
  { id: "c2", provider: "openai", name: "personal" },
];

describe("buildRoutePlan", () => {
  it("returns an empty plan without a target", () => {
    expect(buildRoutePlan(null, combos, providers)).toMatchObject({ kind: "none", rows: [] });
  });
  it("lists a combo chain in configured order", () => {
    const plan = buildRoutePlan(
      { value: "deepseek-flash", name: "deepseek-flash", isCombo: true },
      combos,
      providers,
      { "fast-pool": { fallbackStrategy: "round-robin" } },
    );
    expect(plan.kind).toBe("combo");
    expect(plan.rows.map((row) => row.role)).toEqual(["primary", "fallback 1", "fallback 2"]);
    expect(plan.rows[0]).toMatchObject({ provider: "river", model: "deepseek-v4" });
    expect(plan.strategy).toBe("round-robin");
    expect(plan.summary).toContain("3 upstreams");
  });
  it("reports a direct target with its connection count", () => {
    const plan = buildRoutePlan(
      { value: "openai/gpt-4o", name: "GPT-4o", providerId: "openai", providerName: "OpenAI" },
      combos,
      providers,
    );
    expect(plan).toMatchObject({ kind: "direct", label: "Direct", connections: 2 });
    expect(plan.rows).toHaveLength(1);
  });
  it("does not treat a non-combo model as a combo", () => {
    const plan = buildRoutePlan({ value: "river/deepseek-v4", name: "deepseek-v4", providerId: "river" }, combos, []);
    expect(plan.kind).toBe("direct");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: FAIL — `Failed to resolve import "@/app/(dashboard)/dashboard/playground/playgroundUtils.js"`.

- [ ] **Step 3: Implement the helpers**

```js
// src/app/(dashboard)/dashboard/playground/playgroundUtils.js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/playgroundUtils.js" tests/unit/playground-utils.test.js
git commit -m "feat(playground): add metric, cache and route helpers"
```

---

### Task 2: Payload builder, header masking, cURL and SSE reader

**Files:**
- Modify: `src/app/(dashboard)/dashboard/playground/playgroundUtils.js` (append)
- Test: `tests/unit/playground-utils.test.js` (append)

**Interfaces:**
- Consumes: `createId`, `errorMessageFrom`, `reasoningDeltaFrom` from Task 1.
- Produces: `buildPayload({model, history, systemPrompt, params}) -> object`, `maskRequestHeaders(headers) -> object`, `buildCurl({url, headers, body}) -> string`, `consumeSseStream(body, {onDelta}) -> Promise<{content, reasoning, usage, finishReason, responseModel, frames, rawText, truncated}>`, `RAW_LIMIT` (bytes cap, 262144).
- `params` shape: `{useDefaults: boolean, temperature: number|string, maxTokens: number|string, topP: number|string, stream: boolean, jsonMode: boolean}`.

- [ ] **Step 1: Write the failing tests**

```js
// appended to tests/unit/playground-utils.test.js
import {
  buildCurl,
  buildPayload,
  consumeSseStream,
  maskRequestHeaders,
  RAW_LIMIT,
} from "@/app/(dashboard)/dashboard/playground/playgroundUtils.js";

const params = { useDefaults: true, temperature: 0.7, maxTokens: 4096, topP: 0.95, stream: true, jsonMode: false };
const target = { value: "river/deepseek-v4", name: "deepseek-v4" };

describe("buildPayload", () => {
  it("omits sampling params while provider defaults are on", () => {
    const payload = buildPayload({ model: target, history: [], systemPrompt: "", params });
    expect(payload).toEqual({ model: "river/deepseek-v4", messages: [], stream: true });
  });
  it("prepends the system prompt and keeps only user/assistant turns", () => {
    const payload = buildPayload({
      model: target,
      history: [
        { role: "divider", content: "switched" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "" },
      ],
      systemPrompt: "  Be terse.  ",
      params,
    });
    expect(payload.messages).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
  it("sends sampling params, stream flag and JSON mode when requested", () => {
    const payload = buildPayload({
      model: target,
      history: [{ role: "user", content: "hi" }],
      systemPrompt: "",
      params: { ...params, useDefaults: false, stream: false, jsonMode: true },
    });
    expect(payload).toMatchObject({
      temperature: 0.7, max_tokens: 4096, top_p: 0.95, stream: false,
      response_format: { type: "json_object" },
    });
  });
});

describe("maskRequestHeaders", () => {
  it("masks bearer tokens and keeps other headers", () => {
    expect(maskRequestHeaders({
      Authorization: "Bearer sk-secret-1234abcd",
      "Content-Type": "application/json",
    })).toEqual({
      Authorization: "Bearer ••••abcd",
      "Content-Type": "application/json",
    });
  });
  it("never leaks the raw key", () => {
    const masked = JSON.stringify(maskRequestHeaders({ Authorization: "Bearer sk-live-9876wxyz" }));
    expect(masked).not.toContain("sk-live");
  });
});

describe("buildCurl", () => {
  it("uses an environment placeholder and escapes single quotes", () => {
    const curl = buildCurl({
      url: "/api/v1/chat/completions",
      headers: { Authorization: "Bearer sk-secret", "Content-Type": "application/json" },
      body: { model: "it's", messages: [] },
    });
    expect(curl).toContain("curl -X POST '/api/v1/chat/completions'");
    expect(curl).toContain("Authorization: Bearer $JROUTER_API_KEY");
    expect(curl).not.toContain("sk-secret");
    expect(curl).toContain("'\\''");
  });
});

describe("consumeSseStream", () => {
  const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

  it("accumulates content, reasoning, usage and model", async () => {
    const text = [
      frame({ choices: [{ delta: { reasoning_content: "think" } }] }),
      frame({ choices: [{ delta: { content: "Hel" } }] }),
      frame({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], model: "vendor/actual" }),
      frame({ usage: { prompt_tokens: 3, completion_tokens: 2 } }),
      "data: [DONE]\n\n",
    ].join("");
    const seen = [];
    const result = await consumeSseStream(new Response(text).body, { onDelta: (value) => seen.push(value.content) });
    expect(result).toMatchObject({
      content: "Hello",
      reasoning: "think",
      finishReason: "stop",
      responseModel: "vendor/actual",
      usage: { prompt_tokens: 3, completion_tokens: 2 },
      truncated: false,
    });
    expect(seen).toEqual(["", "Hel", "Hello"]);
    expect(result.frames).toBe(4);
  });

  it("throws the upstream error message", async () => {
    const body = new Response(frame({ error: { message: "quota exhausted" } })).body;
    await expect(consumeSseStream(body)).rejects.toThrow("quota exhausted");
  });

  it("caps the captured raw text", async () => {
    const big = "x".repeat(RAW_LIMIT + 1000);
    const body = new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: big } }] })}\n\n`).body;
    const result = await consumeSseStream(body);
    expect(result.rawText.length).toBeLessThanOrEqual(RAW_LIMIT);
    expect(result.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: FAIL — `buildPayload is not a function` (or missing export).

- [ ] **Step 3: Implement**

```js
// appended to src/app/(dashboard)/dashboard/playground/playgroundUtils.js

export const RAW_LIMIT = 256 * 1024;
const API_KEY_PLACEHOLDER = "$JROUTER_API_KEY";

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

const shellQuote = (value) => String(value).replace(/'/g, "'\\''");

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tests && npx vitest run unit/playground-utils.test.js`
Expected: PASS, 27 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/playgroundUtils.js" tests/unit/playground-utils.test.js
git commit -m "feat(playground): add payload builder, header masking and SSE reader"
```

---

### Task 3: Extract the lane engine hook

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/usePlaygroundLane.js`
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` (replace the turn logic with the hook; UI unchanged)

**Interfaces:**
- Consumes: `buildPayload`, `consumeSseStream`, `createId`, `errorMessageFrom` from Task 2.
- Produces: `usePlaygroundLane({apiKey, paramsRef, systemPromptRef, onRestoreDraft}) -> {model, selectModel, messages, isStreaming, send(text), stop(), retry(id), reset(), lastTurn, lastError, streamingRef}`.
- The composer draft is page state (`input`/`setInput`); the hook never owns it. On a failed turn the hook calls `onRestoreDraft(question)` so the page can put the prompt back if the composer is still empty.
- Message shape: `{id, role: "user"|"assistant"|"divider", content, reasoning?, status?, error?, modelName?, providerId?, providerName?, providerColor?, isCombo?, startedAt?, firstTokenMs?, totalMs?, meta?, request?, response?}`. `lastTurn` is the most recent assistant message with `request`/`response`.

- [ ] **Step 1: Create the hook with the moved logic**

```js
// src/app/(dashboard)/dashboard/playground/usePlaygroundLane.js
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildPayload,
  consumeSseStream,
  createId,
  errorMessageFrom,
  reasoningDeltaFrom,
} from "./playgroundUtils.js";

export const CHAT_ENDPOINT = "/api/v1/chat/completions";

function now() {
  return Date.now();
}

export default function usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft }) {
  const [model, setModel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState("");

  const abortRef = useRef(null);
  const streamingRef = useRef(false);
  const modelRef = useRef(null);
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchAssistant = useCallback((assistantId, patch) => {
    setMessages((previous) => previous.map((message) => (
      message.id === assistantId ? { ...message, ...patch } : message
    )));
  }, []);

  const runTurn = useCallback(async (question, base, target) => {
    if (!question || !target?.value || streamingRef.current) return;

    const assistantId = createId();
    const history = [...base, { id: createId(), role: "user", content: question }];
    const startedAt = now();

    setMessages([
      ...history,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        reasoning: "",
        status: "streaming",
        modelName: target.name,
        providerId: target.providerId,
        providerName: target.providerName,
        providerColor: target.providerColor,
        isCombo: target.isCombo,
        startedAt,
        meta: null,
      },
    ]);
    setLastError("");
    streamingRef.current = true;
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const params = paramsRef.current;
    const payload = buildPayload({
      model: target,
      history,
      systemPrompt: systemPromptRef.current,
      params,
    });
    const headers = { "Content-Type": "application/json", Accept: params.stream ? "text/event-stream" : "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const request = { url: CHAT_ENDPOINT, headers, body: payload };

    let content = "";
    let reasoning = "";
    let usage = null;
    let finishReason = "";
    let responseModel = "";
    let firstTokenMs = null;
    let totalMs = null;
    let httpStatus = 0;
    let httpContentType = "";

    const finalize = (status, extra = {}, response = {}) => {
      patchAssistant(assistantId, {
        content,
        reasoning,
        status,
        firstTokenMs,
        totalMs,
        meta: {
          usage,
          finishReason,
          reportedModel: responseModel,
          requestedModel: target.value,
          ...extra,
        },
        request,
        response,
      });
    };

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      httpStatus = response.status;
      httpContentType = contentType;

      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const message = errorMessageFrom(failure) || `Request failed (${response.status})`;
        setLastError(message);
        throw new Error(message);
      }
      if (!response.body) throw new Error("The response contained no body to read.");

      if (contentType.includes("application/json")) {
        const jsonPayload = await response.json().catch(() => null);
        const message = errorMessageFrom(jsonPayload);
        if (message) throw new Error(message);
        const messagePayload = jsonPayload?.choices?.[0]?.message;
        content = typeof messagePayload?.content === "string" ? messagePayload.content : "";
        reasoning = reasoningDeltaFrom(messagePayload);
        usage = jsonPayload?.usage || null;
        finishReason = jsonPayload?.choices?.[0]?.finish_reason || "";
        responseModel = typeof jsonPayload?.model === "string" ? jsonPayload.model : "";
        totalMs = now() - startedAt;
        finalize(content ? "done" : "empty", {}, {
          status: response.status,
          contentType,
          rawText: JSON.stringify(jsonPayload, null, 2),
          frames: 0,
          truncated: false,
          durationMs: totalMs,
        });
        return;
      }

      const streamed = await consumeSseStream(response.body, {
        onDelta: ({ content: nextContent, reasoning: nextReasoning }) => {
          content = nextContent;
          reasoning = nextReasoning;
          if (firstTokenMs === null) firstTokenMs = now() - startedAt;
          patchAssistant(assistantId, { content, reasoning, firstTokenMs });
        },
      });
      content = streamed.content;
      reasoning = streamed.reasoning;
      usage = streamed.usage;
      finishReason = streamed.finishReason;
      responseModel = streamed.responseModel;
      totalMs = now() - startedAt;
      finalize(content || reasoning ? "done" : "empty", {}, {
        status: response.status,
        contentType,
        rawText: streamed.rawText,
        frames: streamed.frames,
        truncated: streamed.truncated,
        durationMs: totalMs,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        totalMs = now() - startedAt;
        finalize("done", { stopped: true }, { status: 0, contentType: "", rawText: "", frames: 0, truncated: false, durationMs: totalMs });
      } else {
        const message = error?.message || "Request failed.";
        setLastError(message);
        patchAssistant(assistantId, {
          content,
          reasoning,
          status: "error",
          error: message,
          request,
          response: {
            status: httpStatus,
            contentType: httpContentType,
            rawText: message,
            frames: 0,
            truncated: false,
            durationMs: now() - startedAt,
          },
        });
        if (onRestoreDraft) onRestoreDraft(question);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      streamingRef.current = false;
      setIsStreaming(false);
    }
  }, [apiKey, onRestoreDraft, paramsRef, patchAssistant, systemPromptRef]);

  const selectModel = useCallback((next) => {
    if (!next?.value) return;
    const previous = modelRef.current;
    const changed = previous?.value !== next.value;
    const target = {
      value: next.value,
      name: next.name || next.value,
      providerId: next.providerId || "",
      providerName: next.providerName || "",
      providerColor: next.providerColor || "",
      isCombo: next.isCombo === true,
    };
    modelRef.current = target;
    setModel(target);
    setMessages((current) => (
      changed && current.some((message) => message.role !== "divider")
        ? [...current, { id: createId(), role: "divider", from: previous?.name || "", to: target.name, content: `Model switched to ${target.name}` }]
        : current
    ));
  }, []);

  const send = useCallback((text) => {
    const target = modelRef.current;
    const question = String(text ?? "").trim();
    if (!target || !question || streamingRef.current) return;
    return runTurn(question, messagesRef.current, target);
  }, [runTurn]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback((assistantId) => {
    if (streamingRef.current) return;
    const list = messagesRef.current;
    const index = list.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    const answered = list[index];
    let questionIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (list[cursor].role === "user") {
        questionIndex = cursor;
        break;
      }
    }
    if (questionIndex < 0) return;
    const target = {
      value: answered.meta?.requestedModel || "",
      name: answered.modelName || "",
      providerId: answered.providerId || "",
      providerName: answered.providerName || "",
      providerColor: answered.providerColor || "",
      isCombo: answered.isCombo === true,
    };
    if (!target.value) return;
    return runTurn(list[questionIndex].content, list.slice(0, questionIndex), target);
  }, [runTurn]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setIsStreaming(false);
    setMessages([]);
    setLastError("");
  }, []);

  const lastTurn = [...messages].reverse().find((message) => message.role === "assistant" && message.status !== "streaming") || null;

  return {
    model, selectModel, messages, isStreaming,
    send, stop, retry, reset, lastTurn, lastError, streamingRef,
  };
}
```

- [ ] **Step 2: Point the page at the hook, UI untouched**

In `PlaygroundPageClient.js`:
1. Delete the moved helpers (`createId`, `now`, `formatLatency`, `formatCount`, `errorMessageFrom`, `buildGenerationParams`, `toRequestMessages`, `reasoningDeltaFrom`, `buildMetaParts`) and the `runTurn/sendMessage/handleRetry/handleNewChat/handleSelectModel/handleStop/patchAssistant` block (current lines ~23–535, keeping `ModelIcon`, `ActivityGlyph`, `ActivityState`, `renderMessage` and the JSX).
2. Add at the top of the component:

```js
const paramsRef = useRef({ useDefaults: true, temperature: "0.7", maxTokens: "4096", topP: "0.95", stream: true, jsonMode: false });
const systemPromptRef = useRef("");
const [input, setInput] = useState("");
const restoreDraft = useCallback((text) => setInput((current) => current || text), []);
const lane = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
const { model: selectedModel, messages, isStreaming, send, stop, retry, reset: resetLane } = lane;
```

3. Keep the existing generation-settings popover writing into `generation` state for now, and mirror it into `paramsRef` in an effect so old behaviour (empty = provider default) still holds:

```js
useEffect(() => {
  paramsRef.current = {
    useDefaults: !generation.temperature && !generation.maxTokens && !generation.topP,
    temperature: generation.temperature,
    maxTokens: generation.maxTokens,
    topP: generation.topP,
    stream: true,
    jsonMode: false,
  };
}, [generation]);
```

4. Replace calls: `handleSelectModel` → `lane.selectModel` (+ close picker/focus input), `sendMessage` → `send(input)`, `handleStop` → `stop`, `handleRetry` → `retry`, `handleNewChat` → `resetLane` (+ close picker/settings).

- [ ] **Step 3: Lint and compile**

Run: `npx eslint "src/app/(dashboard)/dashboard/playground"`
Expected: no errors (unused-import warnings for moved helpers must be resolved).

Run the dev server against an isolated data dir to prove the route compiles:
```bash
DATA_DIR="$TMPDIR/jrouter-pg-verify" npx next dev --webpack --port 20129
```
Expected log: `✓ Compiled /dashboard/playground`. Stop the server.

- [ ] **Step 4: Manual smoke on the real instance**

With the existing dev server on 20128 (`DATA_DIR=%APPDATA%\jrouter`): open `/dashboard/playground`, pick a model, send one message, stop a second one mid-stream, retry the first. Behaviour must match the pre-refactor page exactly.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/usePlaygroundLane.js" "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js"
git commit -m "refactor(playground): extract per-lane turn engine into a hook"
```

---

### Task 4: KPI cards

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundStats.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundStats.module.css`
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` (data + render)
- Modify: `playground.module.css` (add `.statsSlot`)

**Interfaces:**
- Consumes: `shortModelName`, `cacheShare` from Task 1.
- Produces: `PlaygroundStats({targetLabel, targetNote, targetStatus, cachePercent, cacheNote, saverNote, hasCache, routeLabel, routeNote, routeStrategy})`.

- [ ] **Step 1: Create the component (copy the `EndpointStats` pattern)**

```js
// src/app/(dashboard)/dashboard/playground/PlaygroundStats.js
"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { RotateCcw } from "lucide-react";
import WidgetGrid, { normalizeLayout } from "@/shared/components/ui/bento-grid";
import styles from "./PlaygroundStats.module.css";

const LAYOUT_STORAGE_KEY = "jrouter.playground.statsLayout.v1";

const ITEMS = [
  { id: "activeTarget", title: "Active target", defaultSpan: 2 },
  { id: "cacheCompression", title: "Cache & compression", defaultSpan: 2 },
  { id: "routingPipeline", title: "Routing pipeline", defaultSpan: 2 },
];

const DEFAULT_LAYOUT = normalizeLayout(null, ITEMS);

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export default function PlaygroundStats({
  targetLabel,
  targetNote,
  targetStatus,
  cachePercent,
  cacheNote,
  saverNote,
  hasCache,
  routeLabel,
  routeNote,
  routeStrategy,
}) {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = browserStorage()?.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLayout(normalizeLayout(JSON.parse(saved), ITEMS));
      }
    } catch {
      // A blocked store must not disable the grid.
    }
  }, []);

  const saveLayout = (next) => {
    const canonical = normalizeLayout(next, ITEMS);
    setLayout(canonical);
    try {
      browserStorage()?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(canonical));
    } catch {
      // Keep the accepted layout in memory when persistence is unavailable.
    }
  };

  const resetLayout = () => {
    restored.current = true;
    try {
      browserStorage()?.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
      // Reset still applies for this mount.
    }
    setLayout(DEFAULT_LAYOUT);
    setLayoutVersion((version) => version + 1);
  };

  const items = [
    {
      ...ITEMS[0],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value} title={targetLabel}>{targetLabel}</p>
          <p className={styles.note}>{targetNote}</p>
          <p className={styles.micro}>{targetStatus}</p>
        </div>
      ),
    },
    {
      ...ITEMS[1],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{hasCache ? `${cachePercent}%` : "—"}</p>
          <p className={styles.note}>{cacheNote}</p>
          <div className={styles.track} aria-hidden="true">
            <span style={{ width: `${hasCache ? cachePercent : 0}%` }} />
          </div>
          <p className={styles.micro}>{saverNote}</p>
        </div>
      ),
    },
    {
      ...ITEMS[2],
      render: () => (
        <div className={styles.metric}>
          <p className={styles.value}>{routeLabel}</p>
          <p className={styles.note}>{routeNote}</p>
          <p className={styles.micro}>{routeStrategy}</p>
        </div>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Playground summary">
      <WidgetGrid
        items={items}
        key={layoutVersion}
        layout={layout}
        narrowColumns={1}
        onLayoutChange={setLayout}
        onLayoutCommit={saveLayout}
        rowHeight={128}
      />
      <div className={styles.footer}>
        <p>Drag the grip to move a card. Drag its corner to resize.</p>
        <button type="button" onClick={resetLayout} aria-label="Reset layout" className={styles.reset}>
          <RotateCcw size={14} aria-hidden="true" /> Reset layout
        </button>
      </div>
    </section>
  );
}

PlaygroundStats.propTypes = {
  targetLabel: PropTypes.string.isRequired,
  targetNote: PropTypes.string.isRequired,
  targetStatus: PropTypes.string.isRequired,
  cachePercent: PropTypes.number.isRequired,
  cacheNote: PropTypes.string.isRequired,
  saverNote: PropTypes.string.isRequired,
  hasCache: PropTypes.bool.isRequired,
  routeLabel: PropTypes.string.isRequired,
  routeNote: PropTypes.string.isRequired,
  routeStrategy: PropTypes.string.isRequired,
};
```

- [ ] **Step 2: Create the compact card CSS**

```css
/* src/app/(dashboard)/dashboard/playground/PlaygroundStats.module.css */
.section { min-width: 0; color: var(--text); font-family: var(--font-sans); }

.section [data-widget-id] {
  --text: var(--on-color);
  --text-2: #272320;
  --text-3: #3a3430;
  --surface-2: rgb(255 250 240 / 35%);
  --surface-inset: rgb(10 10 10 / 10%);
  --line: transparent;
  --line-2: rgb(10 10 10 / 30%);
  --wg-padding: 16px 20px 18px;
  --wg-title-size: 12px;
  --wg-title-weight: 600;
  --wg-accent: var(--on-color);
}

.section [data-widget-id="activeTarget"] {
  --surface: var(--brand-pink);
  --text: #ffffff;
  --text-2: #ffffff;
  --text-3: #ffe3ec;
  --surface-2: rgb(255 255 255 / 20%);
  --surface-inset: rgb(255 255 255 / 22%);
  --line-2: rgb(255 255 255 / 40%);
}

.section [data-widget-id="cacheCompression"] { --surface: var(--brand-lavender); }
.section [data-widget-id="routingPipeline"] { --surface: var(--brand-ochre); }

.metric { display: flex; height: 100%; min-width: 0; flex-direction: column; }

.value {
  margin: auto 0 0;
  color: var(--text);
  font-size: clamp(20px, 2.2vw, 28px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note {
  margin: 8px 0 0;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.micro {
  margin: 6px 0 0;
  color: var(--text-3);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

.track {
  height: 6px;
  margin-top: 8px;
  border-radius: var(--r-full, 999px);
  background: rgb(10 10 10 / 20%);
  overflow: hidden;
}

.track span { display: block; height: 100%; background: rgb(28 19 53 / 85%); }

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 10px;
  color: var(--text-2);
  font-size: 12px;
}

.footer p { margin: 0; }

.reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}

.reset:hover { color: var(--text); background: var(--surface-2); }
.reset:focus-visible { outline: 2px solid var(--text-2); outline-offset: 2px; }

@container (max-width: 575.99px) {
  .note { font-size: 12px; }
  .reset { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .reset { transition: none; }
}
```

- [ ] **Step 3: Feed the cards from real data**

In `PlaygroundPageClient.js`:
1. Extend the existing mount fetch to also load `/api/combos`, `/api/usage/stats?period=today`, `/api/settings` (all `cache: "no-store"`, each failure isolated with `Promise.allSettled`). Store `combos`, `usageStats`, `settings`.
2. Compute the card props:

```js
const targets = [lane.model].filter(Boolean);   // Compare adds laneB in Task 8
const primaryTarget = targets[0] || null;
const cache = cacheShare(usageStats);
const routePlan = buildRoutePlan(primaryTarget, combos, providers, settings?.comboStrategies || {});
const saverNote = settings === null
  ? "Token saver status unavailable"
  : `Token saver: RTK ${settings.rtkEnabled ? "on" : "off"} · Headroom ${settings.headroomEnabled ? "on" : "off"}`;

const statsProps = {
  targetLabel: primaryTarget ? shortModelName(primaryTarget.name) : "No target",
  targetNote: primaryTarget
    ? `${primaryTarget.providerName || "Unknown provider"} · ${primaryTarget.isCombo ? "combo" : "direct"}`
    : "Pick a model to start",
  targetStatus: primaryTarget ? (isStreaming ? "streaming" : "ready") : "idle",
  cachePercent: cache.percent,
  cacheNote: cache.hasData ? `${formatCount(cache.cached)} cached tokens today` : "No prompt tokens today",
  saverNote,
  hasCache: cache.hasData,
  routeLabel: routePlan.label,
  routeNote: routePlan.summary,
  routeStrategy: `${routePlan.strategy} · from config`,
};
```

3. Render above the workspace:
```jsx
<PlaygroundStats {...statsProps} />
```

- [ ] **Step 4: Verify**

Run: `npx eslint "src/app/(dashboard)/dashboard/playground"`.
Then load `/dashboard/playground`: three cards render in pink/lavender/ochre; values match `/api/usage/stats?period=today` and `/api/settings`; dragging and resizing persists after reload; Reset layout restores the 3-across default.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundStats.js" "src/app/(dashboard)/dashboard/playground/PlaygroundStats.module.css" "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" "src/app/(dashboard)/dashboard/playground/playground.module.css"
git commit -m "feat(playground): add active-target, cache and routing KPI cards"
```

---

### Task 5: Page shell — intro, workbench split, chat panel skin

**Files:**
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js`
- Modify: `src/app/(dashboard)/dashboard/playground/playground.module.css`

**Interfaces:**
- Produces CSS classes consumed by later tasks: `.page`, `.intro`, `.introText`, `.title`, `.sub`, `.introActions`, `.statsSlot`, `.workbench`, `.chat`, `.chatHeader`, `.chatBody`, `.rail`, `.railCollapsed`.
- Produces page state used later: `mode` (only `"single"` reachable in this task), `railOpen`.

- [ ] **Step 1: Rewrite the page layout CSS**

Replace `playground.module.css` lines 1–211 (page vars through toolbar) with:

```css
/* Full-height routing workbench inside the existing dashboard shell. */
.page {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 16px 32px 20px;
  container-type: inline-size;
  --pg-pad-x: 32px;
  --pg-inset: 20px;
  --pg-mono: var(--font-mono, "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace);
  --pg-sans: var(--font-sans, "Geist", system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--text);
}

@media (max-width: 1023px) { .page { padding: 12px 24px 16px; --pg-pad-x: 24px; --pg-inset: 16px; } }
@media (max-width: 639px) { .page { padding: 8px 12px 12px; --pg-pad-x: 12px; --pg-inset: 12px; gap: 12px; } }

.intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.introText { min-width: 0; }

.title {
  color: var(--text);
  font-size: clamp(24px, 2.6vw, 34px);
  font-weight: 500;
  letter-spacing: -0.05em;
  line-height: 1.1;
}

.sub {
  margin-top: 4px;
  color: var(--text-2);
  font-size: 14px;
  max-width: 60ch;
}

.introActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.statsSlot { flex-shrink: 0; min-width: 0; }

/* Two-column workbench: chat owns the height, the rail scrolls itself. */
.workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.workbench[data-rail="closed"] { grid-template-columns: minmax(0, 1fr); }

.chat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  overflow: hidden;
}

.chatHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
}

.chatBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* Short viewports fall back to page scrolling so the composer stays reachable. */
@media (max-height: 699px) {
  .page { height: auto; min-height: 100%; overflow-y: auto; }
  .workbench { flex: none; min-height: 480px; }
}

@media (max-width: 1279px) {
  .workbench { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .rail { flex-direction: row; flex-wrap: wrap; overflow-y: visible; }
  .rail > * { flex: 1 1 300px; }
}

@media (max-width: 639px) {
  .title { font-size: 22px; }
  .introActions { width: 100%; }
}
```

Keep lines 212–910 (conversation through settings) verbatim in this task, with exactly one edit:
- `.scroll` becomes `.chatBody` (same properties, `flex: 1`).

Add to the composer block: `.composerWrap { border-top: 1px solid var(--line); background: var(--surface); }`.

The settings block (lines 790–910) is deleted in Task 6 together with the popover it styles, so this commit stays visually complete.

- [ ] **Step 2: Restructure the page JSX**

Replace the return block with (chat internals unchanged, moved into the panel):

```jsx
return (
  <div className={styles.page}>
    <header className={styles.intro}>
      <div className={styles.introText}>
        <h1 className={styles.title}>Playground</h1>
        <p className={styles.sub}>Test models, combos, prompt routing, and streaming latencies in real time.</p>
      </div>
      <div className={styles.introActions}>
        <Button variant="secondary" size="sm" icon="refresh" onClick={handleResetSession}>Reset session</Button>
      </div>
    </header>

    <div className={styles.statsSlot}>
      <PlaygroundStats {...statsProps} />
    </div>

    <div className={styles.workbench} data-rail={railOpen ? "open" : "closed"}>
      <section className={styles.chat} aria-label="Playground chat">
        <div className={styles.chatHeader}>
          {/* the existing modelTriggerWrap and toolbarActions move here unchanged in this task;
              pills arrive in Task 7, the rail toggle replaces the settings button in Task 6 */}
        </div>
        <div className={styles.chatBody} ref={scrollRef} onScroll={handleScroll} role="region" aria-label="Conversation" tabIndex={0}>
          <div className={styles.canvas}>
            {loadError ? <p className={styles.loadError} role="alert"><Icon>error</Icon>{loadError}</p> : null}
            {messages.length === 0 ? (/* existing empty state unchanged */) : messages.map(renderMessage)}
          </div>
        </div>
        <div className={styles.composerWrap}>
          {/* existing composer unchanged */}
        </div>
      </section>

      {railOpen ? (
        <aside className={styles.rail} aria-label="Execution parameters">
          {/* PlaygroundRail is added in Task 6; until then keep the settings popover mounted here */}
        </aside>
      ) : null}
    </div>
  </div>
);
```

`handleResetSession` = `resetLane()` + `setThinkingOpen({})` + `setPickerOpen(false)`. `statsProps` is the object built in Task 4 Step 3. Add `const [railOpen, setRailOpen] = useState(true);` next to the other page state.

- [ ] **Step 3: Verify**

Run: `npx eslint "src/app/(dashboard)/dashboard/playground"`, then open `/dashboard/playground` at 1440×900:
- intro title/subtitle render; Reset session clears the transcript;
- the workbench fills the remaining height, only the transcript scrolls;
- the empty state is centered in the chat panel and suggestions still work;
- no double scrollbar; at 390×844 the layout stacks cleanly.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" "src/app/(dashboard)/dashboard/playground/playground.module.css"
git commit -m "feat(playground): rebuild page shell with intro and two-column workbench"
```

---

### Task 6: Execution rail

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundRail.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundRail.module.css`
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` (remove settings popover, mount rail, params state)
- Modify: `playground.module.css` (delete the settings section — the `.settingsAnchor` / `.settings*` blocks at lines 790–910 of the pre-rewrite file; add `.headerPills` later in Task 7)

**Interfaces:**
- Consumes: `buildMetricParts` from Task 1; route plan from Task 4; `lastTurn` from the lane.
- Produces: `PlaygroundRail({params, onParamsChange, onResetParams, routePlans, lastTurn, saver, onOpenTokenSaver})`.

- [ ] **Step 1: Create the rail**

```jsx
// src/app/(dashboard)/dashboard/playground/PlaygroundRail.js
"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import Toggle from "@/shared/components/Toggle";
import { buildMetricParts } from "./playgroundUtils.js";
import styles from "./PlaygroundRail.module.css";

const SLIDERS = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05 },
  { key: "maxTokens", label: "Max tokens", min: 256, max: 16384, step: 256 },
  { key: "topP", label: "Top P", min: 0, max: 1, step: 0.05 },
];

export default function PlaygroundRail({ params, onParamsChange, onResetParams, routePlans, lastTurn, saver, onOpenTokenSaver }) {
  const setParam = (key) => (value) => onParamsChange({ ...params, [key]: value });
  const metrics = lastTurn ? buildMetricParts({
    firstTokenMs: lastTurn.firstTokenMs,
    totalMs: lastTurn.totalMs,
    usage: lastTurn.meta?.usage,
    finishReason: lastTurn.meta?.finishReason,
    reportedModel: lastTurn.meta?.reportedModel,
    requestedModel: lastTurn.meta?.requestedModel,
    stopped: lastTurn.meta?.stopped,
  }) : [];

  return (
    <>
      <section className={styles.card} aria-label="Execution parameters">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Execution parameters</span>
          <button type="button" className={styles.link} onClick={onResetParams}>Reset defaults</button>
        </div>

        <Toggle
          size="sm"
          checked={params.useDefaults}
          onChange={(value) => onParamsChange({ ...params, useDefaults: value })}
          label="Use provider defaults"
          description="When on, no sampling parameters are sent."
        />

        {SLIDERS.map((slider) => (
          <label key={slider.key} className={styles.field} data-disabled={params.useDefaults ? "true" : "false"}>
            <span className={styles.fieldHead}>
              <span className={styles.fieldLabel}>{slider.label}</span>
              <input
                type="number"
                className={styles.number}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={params[slider.key]}
                disabled={params.useDefaults}
                onChange={(event) => setParam(slider.key)(event.target.value)}
              />
            </span>
            <input
              type="range"
              className={styles.range}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={params[slider.key]}
              disabled={params.useDefaults}
              aria-label={slider.label}
              onChange={(event) => setParam(slider.key)(event.target.value)}
            />
          </label>
        ))}

        <div className={styles.toggles}>
          <Toggle size="sm" checked={params.stream} onChange={(value) => onParamsChange({ ...params, stream: value })} label="Stream responses" />
          <Toggle size="sm" checked={params.jsonMode} onChange={(value) => onParamsChange({ ...params, jsonMode: value })} label="Strict JSON" />
        </div>

        <button type="button" className={styles.saver} onClick={onOpenTokenSaver}>
          <Icon>bolt</Icon>
          <span>{saver.label}</span>
          <Icon>chevron_right</Icon>
        </button>
      </section>

      <section className={styles.card} aria-label="Route plan">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Route plan</span>
          <span className={styles.tag}>from config</span>
        </div>
        {routePlans.map((entry) => (
          <div key={entry.key} className={styles.plan}>
            {routePlans.length > 1 ? <p className={styles.planName}>Lane {entry.key.toUpperCase()}</p> : null}
            {entry.plan.rows.length === 0 ? (
              <p className={styles.empty}>{entry.plan.summary}</p>
            ) : entry.plan.rows.map((row) => (
              <div key={`${entry.key}-${row.index}`} className={styles.row}>
                <span className={styles.dot} data-role={row.role === "primary" ? "primary" : "fallback"} />
                <span className={styles.rowText}>
                  <strong>{row.provider || "provider"}</strong>
                  <small>{row.model}</small>
                </span>
                <span className={styles.rowRole}>{row.role}</span>
              </div>
            ))}
            <p className={styles.foot}>{entry.plan.summary}</p>
          </div>
        ))}
        <p className={styles.foot}>Route plan from config. The upstream that served a reply is shown per message.</p>
      </section>

      <section className={styles.card} aria-label="Last response">
        <div className={styles.head}>
          <span className={styles.cardTitle}>Last response</span>
          {lastTurn ? <span className={styles.tag}>{lastTurn.status === "error" ? "error" : "200 OK"}</span> : null}
        </div>
        {lastTurn ? (
          <div className={styles.metrics}>
            {metrics.length ? metrics.map((part) => <span key={part} className={styles.metricChip}>{part}</span>) : (
              <span className={styles.empty}>No metrics reported.</span>
            )}
          </div>
        ) : (
          <p className={styles.empty}>No response yet.</p>
        )}
      </section>
    </>
  );
}
```

`PlaygroundRail.propTypes` mirrors the props: `params` (shape), `onParamsChange`/`onResetParams`/`onOpenTokenSaver` functions, `routePlans` array of `{key, plan}`, `lastTurn` object|null, `saver` shape `{label}`.

- [ ] **Step 2: Style the rail**

```css
/* src/app/(dashboard)/dashboard/playground/PlaygroundRail.module.css */
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  min-width: 0;
}

.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

.cardTitle { color: var(--text); font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }

.tag {
  padding: 2px 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-full, 999px);
  color: var(--text-2);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.link {
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  font-family: var(--pg-mono, ui-monospace, monospace);
  cursor: pointer;
}

.link:hover { color: var(--text); }

.field { display: flex; flex-direction: column; gap: 6px; }
.field[data-disabled="true"] { opacity: 0.55; }

.fieldHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fieldLabel { color: var(--text-2); font-size: 12px; }

.number {
  width: 72px;
  padding: 3px 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--r1);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.number:focus-visible, .range:focus-visible, .link:focus-visible, .saver:focus-visible, .reset:focus-visible {
  outline: 2px solid var(--text-2);
  outline-offset: 2px;
}

.range { width: 100%; height: 4px; accent-color: var(--brand-pink); cursor: pointer; }

.toggles { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); }

.saver {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.saver span { flex: 1; min-width: 0; }
.saver:hover { color: var(--text); border-color: var(--line-2); }

.plan { display: flex; flex-direction: column; gap: 6px; }
.planName { color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  background: var(--surface-2);
}

.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
.dot[data-role="primary"] { background: var(--brand-pink); }
.dot[data-role="fallback"] { background: var(--warn); }

.rowText { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.rowText strong { color: var(--text); font-size: 12px; font-weight: 600; }
.rowText small { color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowRole { color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; text-transform: uppercase; }

.metrics { display: flex; flex-wrap: wrap; gap: 6px; }

.metricChip {
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-full, 999px);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.empty { margin: 0; color: var(--text-3); font-size: 12px; }
.foot { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.45; }
```

- [ ] **Step 3: Wire the page**

1. Replace the `generation` state and the settings popover with:

```js
const [params, setParams] = useState({
  useDefaults: true, temperature: 0.7, maxTokens: 4096, topP: 0.95, stream: true, jsonMode: false,
});
useEffect(() => { paramsRef.current = params; }, [params]);
```

2. Remove the settings anchor/popover JSX, the `settingsOpen`/`settingsRef` state and effects.
3. Mount the rail in the `<aside>`:

```jsx
<PlaygroundRail
  params={params}
  onParamsChange={setParams}
  onResetParams={() => setParams({ useDefaults: true, temperature: 0.7, maxTokens: 4096, topP: 0.95, stream: true, jsonMode: false })}
  routePlans={[{ key: "a", plan: routePlan }]}
  lastTurn={lane.lastTurn}
  saver={{ label: saverNote }}
  onOpenTokenSaver={() => router.push("/dashboard/token-saver")}
/>
```

`router` = `useRouter()` from `next/navigation`. Add the rail toggle button in the chat header:

```jsx
<Tooltip text={railOpen ? "Hide parameters" : "Show parameters"}>
  <button type="button" className={styles.iconButton} onClick={() => setRailOpen((open) => !open)} aria-expanded={railOpen} aria-label="Toggle execution rail">
    <Icon>tune</Icon>
  </button>
</Tooltip>
```

- [ ] **Step 4: Verify**

`npx eslint "src/app/(dashboard)/dashboard/playground"` clean. Then: sliders disabled while provider defaults are on; turning it off sends `temperature`/`max_tokens`/`top_p` (check DevTools request body); Stream off returns a JSON body and the rail's last-response chips populate; Strict JSON adds `response_format`; the route plan matches `/dashboard/combos`; the token-saver row navigates to `/dashboard/token-saver`; rail collapse expands the chat.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundRail.js" "src/app/(dashboard)/dashboard/playground/PlaygroundRail.module.css" "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" "src/app/(dashboard)/dashboard/playground/playground.module.css"
git commit -m "feat(playground): add execution rail with parameters, route plan and last response"
```

---

### Task 7: Transcript component, metrics row and system instructions

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js`
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js`
- Modify: `src/app/(dashboard)/dashboard/playground/playground.module.css` (add `.systemCard` styles, adapt `.meta`)

**Interfaces:**
- Consumes: `buildMetricParts`, `estimateTokens` (Task 1), `buildCurl` (Task 2), `ModelIcon` props `{providerId, providerName, providerColor, isCombo, size}`.
- Produces: `PlaygroundTranscript({messages, thinkingOpen, onToggleThinking, copied, onCopy, onRetry})`; `ModelIcon` default export for header/composer use.

- [ ] **Step 1: Move the icon and the message renderer**

Source of truth for the moved bodies is the pre-refactor client at the spec commit:
`git show b3e9eb3b:"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js"` — `ModelIcon` + `providerInitials` at the lines that follow `function providerInitials`, and `ActivityGlyph`, `ActivityState`, `renderMessage` below it.

`PlaygroundModelIcon.js`: move `providerInitials` + `ModelIcon` verbatim, importing `Icon`, `ProviderIcon` and `styles` from `./playground.module.css` (class `.modelFallback` stays in that file).

`PlaygroundTranscript.js`: move `renderMessage` into a component that maps `messages`:

```jsx
"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import { Button } from "@/shared/components";
import PlaygroundMarkdown from "./PlaygroundMarkdown";
import ModelIcon from "./PlaygroundModelIcon";
import { buildMetricParts } from "./playgroundUtils.js";
import styles from "./playground.module.css";

function ActivityGlyph() { /* moved verbatim from the client */ }
function ActivityState({ label, startedAt }) { /* moved verbatim */ }

export default function PlaygroundTranscript({ messages, thinkingOpen, onToggleThinking, copied, onCopy, onRetry }) {
  const renderMessage = (message) => {
    // Moved verbatim from PlaygroundPageClient.renderMessage, with two changes:
    // 1. numeric/latency helpers come from buildMetricParts:
    const metaParts = message.meta
      ? buildMetricParts({
        firstTokenMs: message.firstTokenMs,
        totalMs: message.totalMs,
        usage: message.meta.usage,
        finishReason: message.meta.finishReason,
        reportedModel: message.meta.reportedModel,
        requestedModel: message.meta.requestedModel,
        stopped: message.meta.stopped,
      })
      : [];
    // 2. actions call onCopy(message) / onRetry(message.id) / onToggleThinking(message.id)
    // Everything else (bubbles, thinking accordion, caret, error block, notes) stays.
  };

  return messages.map(renderMessage);
}

PlaygroundTranscript.propTypes = {
  messages: PropTypes.array.isRequired,
  thinkingOpen: PropTypes.object.isRequired,
  onToggleThinking: PropTypes.func.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
};
```

- [ ] **Step 2: Add the system instructions card**

In the page, above the transcript inside `.chatBody`:

```jsx
<details className={styles.systemCard} open={systemOpen} onToggle={(event) => setSystemOpen(event.currentTarget.open)}>
  <summary className={styles.systemHead}>
    <span className={styles.systemTitle}><Icon>description</Icon> System instructions</span>
    <span className={styles.systemMeta}>
      {systemPrompt.trim() ? `~${estimateTokens(systemPrompt)} tokens` : "empty"}
      <Icon className={styles.chevronSmall}>{systemOpen ? "expand_less" : "expand_more"}</Icon>
    </span>
  </summary>
  <textarea
    className={styles.systemInput}
    rows={3}
    value={systemPrompt}
    onChange={(event) => setSystemPrompt(event.target.value)}
    placeholder="Sent as the first message of every request."
    aria-label="System instructions"
  />
</details>
```

State: `const [systemPrompt, setSystemPrompt] = useState(""); const [systemOpen, setSystemOpen] = useState(false);` and `systemPromptRef.current = systemPrompt` via effect. The request already picks it up through `buildPayload`.

- [ ] **Step 3: Chat header pills and actions**

The chat header keeps the model trigger and adds the real status facts from spec §6:

```jsx
const caps = useModelCaps();
const contextWindow = selectedModel ? caps.getCaps(selectedModel.value)?.contextWindow : 0;
const headerCurl = lane.lastTurn?.request ? buildCurl(lane.lastTurn.request) : "";
```

```jsx
<div className={styles.headerPills}>
  {selectedModel?.isCombo ? <span className={styles.pill}>combo</span> : null}
  {contextWindow ? <span className={styles.pill}>{formatContext(contextWindow)} ctx</span> : null}
  <span className={styles.pill} data-tone={isStreaming ? "live" : "idle"}>
    {params.stream ? "SSE stream" : "JSON"}
  </span>
</div>

<div className={styles.toolbarActions}>
  <Tooltip text="Copy as cURL">
    <button type="button" className={styles.iconButton} onClick={() => copy(headerCurl, "curl")} disabled={!headerCurl} aria-label="Copy request as cURL">
      <Icon>terminal</Icon>
    </button>
  </Tooltip>
  <Tooltip text="Clear thread">
    <button type="button" className={styles.iconButton} onClick={handleClearThread} disabled={messages.length === 0} aria-label="Clear thread">
      <Icon>delete</Icon>
    </button>
  </Tooltip>
</div>
```

`formatContext` in `playgroundUtils.js` (append), with a test appended to `tests/unit/playground-utils.test.js`: `1_048_576 -> "1M"`, `128_000 -> "128K"`, `0 -> ""`.

```js
export function formatContext(tokens) {
  const value = Number(tokens) || 0;
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return value > 0 ? String(value) : "";
}
```

`handleClearThread` = `resetLane()` + `setThinkingOpen({})`; `copy` comes from `useCopyToClipboard()` already in the page.

- [ ] **Step 4: Add the styles**

```css
.systemCard {
  margin: 16px 20px 0;
  border: 1px solid var(--line);
  border-radius: var(--r3);
  background: var(--surface-2);
  overflow: hidden;
}

.systemHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  list-style: none;
}

.systemHead::-webkit-details-marker { display: none; }
.systemTitle { display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-weight: 500; }
.systemMeta { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; }

.systemInput {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-top: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
}

.systemInput:focus-visible { outline: 2px solid var(--text-2); outline-offset: -2px; }

.headerPills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.pill {
  padding: 2px 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-full, 999px);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pill[data-tone="live"] { border-color: color-mix(in srgb, var(--pos) 45%, transparent); color: var(--pos); }
```

- [ ] **Step 5: Verify**

`npx eslint "src/app/(dashboard)/dashboard/playground"`. Then: a reply shows `TTFT …`, `total …`, `tok/s`, tokens, finish reason; a non-streaming reply shows the same minus tok/s when it cannot be computed; reasoning still collapses; Copy/Retry still work; a system prompt appears in the request body as `messages[0]` and the token estimate updates; empty messages are not sent.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundModelIcon.js" "src/app/(dashboard)/dashboard/playground/PlaygroundTranscript.js" "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" "src/app/(dashboard)/dashboard/playground/playground.module.css" "src/app/(dashboard)/dashboard/playground/playgroundUtils.js" tests/unit/playground-utils.test.js
git commit -m "feat(playground): add transcript metrics row, header pills and system instructions"
```

---

### Task 8: Compare mode

**Files:**
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js`
- Modify: `src/app/(dashboard)/dashboard/playground/playground.module.css`

**Interfaces:**
- Consumes: two `usePlaygroundLane` instances; `SegmentedControl`; page-level composer state.
- Produces: `mode` (`"single" | "compare" | "json"`), persisted at `jrouter.playground.mode.v1`; lane tabs for narrow viewports; per-lane scroll refs.

- [ ] **Step 1: Instantiate both lanes and the mode switch**

```js
const laneA = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
const laneB = usePlaygroundLane({ apiKey, paramsRef, systemPromptRef, onRestoreDraft: restoreDraft });
const [mode, setMode] = useState("single");
const [activeLane, setActiveLane] = useState("a");
const [jsonLane, setJsonLane] = useState("a");
const scrollRefs = useRef({ a: null, b: null });
const atBottomRefs = useRef({ a: true, b: true });

// KPI inputs for two lanes: `targets` feeds the Active-target card, and each lane
// gets its own route plan for the rail.
const targets = (mode === "compare" ? [laneA.model, laneB.model] : [laneA.model]).filter(Boolean);
const routePlanA = buildRoutePlan(laneA.model, combos, providers, settings?.comboStrategies || {});
const routePlanB = buildRoutePlan(laneB.model, combos, providers, settings?.comboStrategies || {});

// Rename the Task 4 `routePlan` to `routePlanA`, then rebuild `statsProps`:
// targets.length > 1 ? "2 targets" : targets[0] ? shortModelName(targets[0].name) : "No target"
// targetStatus: targets.length ? (composerBusy ? "streaming" : "ready") : "idle"
// routeLabel/routeNote/routeStrategy: routePlanA keeps the card honest in single mode;
// in compare mode the card reads "2 targets" and the rail lists both plans.
// Rail: routePlans={mode === "compare" ? [{ key: "a", plan: routePlanA }, { key: "b", plan: routePlanB }] : [{ key: "a", plan: routePlanA }]}

useEffect(() => {
  try {
    const saved = localStorage.getItem("jrouter.playground.mode.v1");
    if (saved === "single" || saved === "compare" || saved === "json") setMode(saved);
  } catch {}
}, []);

const changeMode = (next) => {
  setMode(next);
  try { localStorage.setItem("jrouter.playground.mode.v1", next); } catch {}
};
```

Intro actions render:

```jsx
<SegmentedControl
  aria-label="Playground mode"
  value={mode}
  onChange={changeMode}
  options={[
    { value: "single", label: "Single" },
    { value: "compare", label: "Compare" },
    { value: "json", label: "JSON API" },
  ]}
/>
```

- [ ] **Step 2: Render lanes**

`const lanes = mode === "compare" ? [{ key: "a", lane: laneA }, { key: "b", lane: laneB }] : [{ key: "a", lane: laneA }];`

Chat panel body becomes:

```jsx
<div className={styles.lanes} data-mode={mode} data-active={activeLane}>
  {lanes.map(({ key, lane }) => (
    <section key={key} className={styles.lane} data-lane={key}>
      <div className={styles.laneHead}>
        <span className={styles.laneLetter}>{key.toUpperCase()}</span>
        <div className={styles.modelTriggerWrap}>
          <button
            type="button"
            data-model-trigger
            className={styles.modelTrigger}
            onClick={() => setPickerFor(pickerFor === key ? null : key)}
            aria-haspopup="dialog"
            aria-expanded={pickerFor === key}
          >
            <ModelIcon
              providerId={lane.model?.providerId}
              providerName={lane.model?.providerName}
              providerColor={lane.model?.providerColor}
              isCombo={lane.model?.isCombo}
              size={18}
            />
            <span className={styles.modelTriggerText}>
              <span className={styles.modelNameRow}>
                <span className={styles.modelName}>
                  {lane.model ? lane.model.name : loading ? "Loading models…" : "Select a model"}
                </span>
                {lane.model?.isCombo ? <span className={styles.modelBadge}>combo</span> : null}
              </span>
              <span className={styles.modelProvider}>
                {lane.model ? lane.model.providerName || lane.model.value : "Choose from connected providers"}
              </span>
            </span>
            <Icon className={styles.chevron}>{pickerFor === key ? "expand_less" : "expand_more"}</Icon>
          </button>
          <ModelPickerPopover
            isOpen={pickerFor === key}
            onClose={() => setPickerFor(null)}
            onSelect={(model) => { lane.selectModel(model); setPickerFor(null); }}
            selectedModel={lane.model?.value}
            activeProviders={providers}
            modelAliases={modelAliases}
          />
        </div>
        <span className={styles.laneStatus}>{lane.isStreaming ? "streaming" : lane.model ? "ready" : "no model"}</span>
      </div>
      <div
        className={styles.laneBody}
        ref={(element) => { scrollRefs.current[key] = element; }}
        onScroll={() => handleLaneScroll(key)}
      >
        {mode === "single" ? systemCard : null}
        <div className={styles.canvas}>
          {lane.messages.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><Icon>science</Icon></span>
              <p className={styles.emptyTitle}>{mode === "compare" ? `Lane ${key.toUpperCase()}` : "Start a conversation"}</p>
              <p className={styles.emptyHint}>{emptyHintFor(lane, key)}</p>
              {lane.model && hasCatalog ? (
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" className={styles.suggestion} onClick={() => handleSuggestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <PlaygroundTranscript
              messages={lane.messages}
              thinkingOpen={thinkingOpen}
              onToggleThinking={toggleThinking}
              copied={copied}
              onCopy={copyMessage}
              onRetry={lane.retry}
            />
          )}
        </div>
      </div>
    </section>
  ))}
</div>
```

Supporting page code (replaces the single-lane `scrollToBottom`/`atBottomRef` effect):

```js
const [pickerFor, setPickerFor] = useState(null);

const handleLaneScroll = (key) => {
  const element = scrollRefs.current[key];
  if (!element) return;
  atBottomRefs.current[key] = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
};

const followLane = useCallback((key, messages) => {
  const element = scrollRefs.current[key];
  if (element && atBottomRefs.current[key]) element.scrollTop = element.scrollHeight;
}, []);

useEffect(() => { followLane("a", laneA.messages); }, [laneA.messages, followLane]);
useEffect(() => { followLane("b", laneB.messages); }, [laneB.messages, followLane]);

const emptyHintFor = (lane, key) => {
  if (mode === "compare") return lane.model ? `Test ${lane.model.name} against lane ${key === "a" ? "B" : "A"}.` : `Pick a model for lane ${key.toUpperCase()}, then send a prompt to compare both.`;
  return selectedModel ? `Test ${selectedModel.name} through JRouter.` : !loading && providers.length === 0
    ? "No providers connected yet. Connect one from the Providers page to test models here."
    : "Pick a model, then send your first message through JRouter.";
};
```

Composer stays single and broadcasts (`copyMessage` and `handleSuggestion` stay as they are on the page; replace the old `sendMessage` with `submit` in the textarea's Enter handler and the send button):

```js
const composerBusy = laneA.isStreaming || laneB.isStreaming;
const composerTargets = mode === "compare" ? [laneA, laneB] : [laneA];
const canSend = !composerBusy && composerTargets.every((lane) => lane.model) && input.trim().length > 0;

const submit = () => {
  const text = input.trim();
  if (!text || composerBusy) return;
  const ready = composerTargets.filter((lane) => lane.model);
  if (ready.length === 0) return;
  setInput("");
  ready.forEach((lane) => lane.send(text));
};
```

Lane tabs in the chat header (`mode === "compare"` only):

```jsx
{mode === "compare" ? (
  <SegmentedControl
    size="sm"
    aria-label="Active lane"
    value={activeLane}
    onChange={setActiveLane}
    options={[{ value: "a", label: "Lane A" }, { value: "b", label: "Lane B" }]}
  />
) : null}
```

- [ ] **Step 3: Style lanes**

```css
.lanes { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-height: 0; }
.lanes[data-mode="compare"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.lanes[data-mode="compare"] .lane + .lane { border-left: 1px solid var(--line); }

.lane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.laneHead { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.laneLetter { color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.12em; }
.laneStatus { margin-left: auto; color: var(--text-3); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; text-transform: uppercase; }
.laneBody { flex: 1; min-height: 0; overflow-y: auto; }

/* Below 1100px only the selected lane is shown, switched by the lane tabs. */
@media (max-width: 1099px) {
  .lanes[data-mode="compare"] { grid-template-columns: minmax(0, 1fr); }
  .lanes[data-mode="compare"] .lane { display: none; }
  .lanes[data-mode="compare"][data-active="a"] .lane[data-lane="a"],
  .lanes[data-mode="compare"][data-active="b"] .lane[data-lane="b"] { display: flex; }
  .lanes[data-mode="compare"] .lane + .lane { border-left: 0; }
}
```

Add lane tabs (`Lane A` / `Lane B`, `SegmentedControl`) in the chat header only when `mode === "compare"`.

- [ ] **Step 4: Verify**

`npx eslint "src/app/(dashboard)/dashboard/playground"`. Then: Compare shows two pickers; sending one prompt streams both lanes; stopping stops both; one broken model errors only in its lane while the other finishes; KPI card 1 reads `2 targets`; route plan lists both lanes; at 1024px width only the selected lane renders and the tabs switch it; mode persists after reload.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js" "src/app/(dashboard)/dashboard/playground/playground.module.css"
git commit -m "feat(playground): add compare mode with two independent lanes"
```

---

### Task 9: JSON API inspector

**Files:**
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.js`
- Create: `src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.module.css`
- Modify: `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js`

**Interfaces:**
- Consumes: `maskRequestHeaders`, `buildCurl` (Task 2); `lastTurn` with `request`/`response` (Task 3); `useCopyToClipboard`.
- Produces: `PlaygroundJsonView({turns, activeKey, onSelectKey})` where `turns = [{key, label, turn}]`.

- [ ] **Step 1: Build the inspector**

```jsx
"use client";

import PropTypes from "prop-types";
import { useState } from "react";
import Icon from "@/shared/components/Icon";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildCurl, maskRequestHeaders } from "./playgroundUtils.js";
import styles from "./PlaygroundJsonView.module.css";

const TABS = [
  { value: "request", label: "Request" },
  { value: "response", label: "Response" },
  { value: "curl", label: "cURL" },
];

function CopyButton({ text, label }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button type="button" className={styles.copy} onClick={() => copy(text, label)} disabled={!text}>
      <Icon>{copied === label ? "check" : "content_copy"}</Icon>
      {copied === label ? "Copied" : "Copy"}
    </button>
  );
}

export default function PlaygroundJsonView({ turns, activeKey, onSelectKey }) {
  const [tab, setTab] = useState("request");
  const active = turns.find((entry) => entry.key === activeKey) || turns[0] || null;
  const turn = active?.turn || null;
  const request = turn?.request || null;
  const response = turn?.response || null;
  const body = request ? JSON.stringify(request.body, null, 2) : "";
  const headers = request ? maskRequestHeaders(request.headers) : {};
  const curl = request ? buildCurl(request) : "";

  return (
    <section className={styles.panel} aria-label="JSON API inspector">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.method}>POST</span>
          <code className={styles.path}>/api/v1/chat/completions</code>
        </div>
        <div className={styles.controls}>
          {turns.length > 1 ? (
            <SegmentedControl
              size="sm"
              aria-label="Lane"
              value={active?.key}
              onChange={onSelectKey}
              options={turns.map((entry) => ({ value: entry.key, label: entry.label }))}
            />
          ) : null}
          <SegmentedControl size="sm" aria-label="Inspector tab" value={tab} onChange={setTab} options={TABS} />
        </div>
      </header>

      {!turn ? (
        <p className={styles.empty}>Send a request to inspect it.</p>
      ) : (
        <div className={styles.body}>
          {tab === "request" ? (
            <>
              <div className={styles.blockHead}>
                <span>Headers</span>
                <CopyButton text={JSON.stringify(headers, null, 2)} label="headers" />
              </div>
              <pre className={styles.code}>{JSON.stringify(headers, null, 2)}</pre>
              <div className={styles.blockHead}>
                <span>Body</span>
                <CopyButton text={body} label="body" />
              </div>
              <pre className={styles.code}>{body}</pre>
            </>
          ) : null}

          {tab === "response" ? (
            <>
              <div className={styles.facts}>
                <span>status {response?.status || 0}</span>
                <span>{response?.contentType || "unknown content-type"}</span>
                <span>{response?.frames ? `${response.frames} frames` : "buffered JSON"}</span>
                <span>{response?.durationMs ? `${response.durationMs}ms` : "—"}</span>
                {response?.truncated ? <span className={styles.warn}>truncated at 256 KB</span> : null}
              </div>
              <pre className={styles.code}>{response?.rawText || "Empty body."}</pre>
            </>
          ) : null}

          {tab === "curl" ? (
            <>
              <div className={styles.blockHead}>
                <span>Reproduce with the gateway key in your environment</span>
                <CopyButton text={curl} label="curl" />
              </div>
              <pre className={styles.code}>{curl}</pre>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Style it**

```css
/* src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.module.css */
.panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
}

.titleRow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.method { padding: 2px 6px; border-radius: var(--r1); background: var(--brand-pink); color: #fff; font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; font-weight: 700; }
.path { color: var(--text-2); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }

.blockHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }

.copy { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: var(--r1); background: var(--surface-2); color: var(--text-2); font-size: 11px; padding: 3px 8px; cursor: pointer; }
.copy:hover:not(:disabled) { color: var(--text); border-color: var(--line-2); }
.copy:disabled { opacity: 0.5; cursor: default; }

.code {
  margin: 0 0 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--pg-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.facts { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-2); font-family: var(--pg-mono, ui-monospace, monospace); font-size: 10px; }
.facts span { padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--r-full, 999px); }
.warn { color: var(--warn); }

.empty { margin: 0; padding: 32px 16px; color: var(--text-3); font-size: 13px; text-align: center; }
```

- [ ] **Step 3: Wire JSON mode into the page**

```jsx
{mode === "json" ? (
  <section className={styles.chat} aria-label="JSON API">
    <PlaygroundJsonView
      turns={[
        { key: "a", label: "Lane A", turn: laneA.lastTurn },
        ...(laneB.model ? [{ key: "b", label: "Lane B", turn: laneB.lastTurn }] : []),
      ]}
      activeKey={jsonLane}
      onSelectKey={setJsonLane}
    />
    <div className={styles.composerWrap}>
      {/* the same composer as the chat panel, still bound to the page input */}
    </div>
  </section>
) : (
  /* existing chat panel */
)}
```

Composer stays visible in JSON mode (so a new request can be sent); the transcript and system card are hidden. `jsonLane` defaults to `"a"`.

- [ ] **Step 4: Verify**

`npx eslint "src/app/(dashboard)/dashboard/playground"`. Then: after a streaming turn, Response shows frames, status 200, duration, and raw `data:` lines; Request shows the masked `Authorization`; cURL copies with `$JROUTER_API_KEY` and no real key; a non-streaming turn shows `buffered JSON`; a long reply shows the truncation chip; switching to JSON API before sending shows the empty state; Compare + JSON API offers a Lane A/B switch.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.js" "src/app/(dashboard)/dashboard/playground/PlaygroundJsonView.module.css" "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js"
git commit -m "feat(playground): add JSON API request and response inspector"
```

---

### Task 10: Contract tests, responsive polish and full verification

**Files:**
- Modify: `tests/unit/playground-full-chat.test.js`
- Modify: `src/app/(dashboard)/dashboard/playground/playground.module.css` (a11y/reduced-motion only)
- Verify only: `src/shared/components/layouts/DashboardLayout.js`

**Interfaces:**
- Consumes everything above. No new exports.

- [ ] **Step 1: Rewrite the route contract test**

Replace the "renders no page header block" and "no top-bar title" cases with the new contracts, keep the full-height and composer cases:

```js
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Playground redesign contracts", () => {
  it("keeps the playground a full-height route", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    expect(layout).toContain('pathname === "/dashboard/playground" ? "h-dvh" : "h-screen"');
    expect(layout).toContain('pathname === "/dashboard/basic-chat" || pathname === "/dashboard/playground"');
  });

  it("renders the page intro and the three KPI cards", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js");
    expect(source).toContain("<h1 className={styles.title}>Playground</h1>");
    expect(source).toContain("<PlaygroundStats");
    const stats = read("src/app/(dashboard)/dashboard/playground/PlaygroundStats.js");
    expect(stats).toContain('id: "activeTarget"');
    expect(stats).toContain('id: "cacheCompression"');
    expect(stats).toContain('id: "routingPipeline"');
  });

  it("offers three working modes", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js");
    for (const value of ["single", "compare", "json"]) {
      expect(source).toContain(`{ value: "${value}"`);
    }
    expect(source).toContain("<PlaygroundJsonView");
  });

  it("never fabricates upstream telemetry", () => {
    const rail = read("src/app/(dashboard)/dashboard/playground/PlaygroundRail.js");
    expect(rail).toContain("Route plan from config.");
    expect(rail).not.toMatch(/x-jrouter-upstream|x-cache-hit|Weight:\s*\d/);
  });

  it("caps a multiline mobile input relative to the viewport height", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    const mobile = source.slice(source.lastIndexOf("@media (max-width: 639px)"));
    expect(mobile).toContain("max-height: min(200px, 25dvh)");
  });

  it("keeps a multiline input within a short landscape viewport", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    const landscape = source.slice(source.indexOf("@media (max-width: 1023px) and (max-height: 500px)"));
    expect(landscape).toContain("max-height: min(200px, 20dvh)");
  });
});
```

Keep the header title test that asserts `Header.js` has no playground-specific title (it still holds).

- [ ] **Step 2: Run both test files**

Run: `cd tests && npx vitest run unit/playground-utils.test.js unit/playground-full-chat.test.js`
Expected: PASS (28 + 7 tests).

- [ ] **Step 3: Responsive and accessibility sweep**

In `playground.module.css` ensure: `@media (prefers-reduced-motion: reduce)` disables the activity/caret animations that remain; every new interactive element has `:focus-visible`; the rail toggle exposes `aria-expanded`; the lane tab control is labelled.

Manual matrix (real dev server on 20128):
- 1440×900 — three KPI across, chat + 360px rail, no page scrollbar.
- 1280×800 — same, rail intact.
- 1279×800 — rail stacks under the chat, both readable.
- 1099×800 — Compare shows one lane + tabs.
- 390×844 — everything stacks, composer stays visible, transcript scrolls.
- 1024×500 — short landscape: page scrolls, input capped, no clipped controls.

- [ ] **Step 4: Full lint and production build**

Run: `npx eslint .` (repo gate; pre-existing warnings elsewhere are allowed only if unchanged).
Then, in the background with completion notification (repo-wide `.next` lock, 15–20 min expected):

```bash
npm run build
```

Expected: `Compiled successfully`, `/dashboard/playground` in the route list, no ESLint build errors. If another agent holds the build lock, wait for it rather than running a second build.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/playground-full-chat.test.js "src/app/(dashboard)/dashboard/playground/playground.module.css"
git commit -m "test(playground): cover redesign contracts and finish responsive polish"
```

---

## Manual Verification Record (fill during execution)

| Check | Expected | Result |
| --- | --- | --- |
| Single streaming | metrics row, stop, retry | |
| Non-streaming | JSON branch, transport chip | |
| Compare | both lanes stream; isolated error | |
| JSON API | request/response/cURL for a real turn | |
| KPI cache % | matches `/api/usage/stats?period=today` | |
| Route plan | matches combo chain in `/dashboard/combos` | |
| Token saver row | navigates to token-saver page | |
| Heights 1440/1280/1099/390, 500 tall | no clipped composer | |
| `npx eslint .` | no new errors | |
| `npm run build` | compiled successfully | |

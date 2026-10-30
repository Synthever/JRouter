// tests/unit/playground-utils.test.js
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  normalizeSettings,
  normalizeMessage,
  restoreSessions,
  stripReasoning,
  readStorage,
  writeStorage,
  persistSessions,
  sanitizeTitle,
  localTitle,
  parseFollowUps,
  toRequestMessages,
  buildTurnBody,
  buildExportBody,
  renderCurl,
  renderJavaScript,
  renderPython,
  relativeTime,
  formatLatency,
  formatSeconds,
  buildMetaParts,
  nextActiveId,
} from "@/app/(dashboard)/dashboard/playground/playgroundUtils";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};

const SETTINGS = { system: "Be brief.", temperature: 0.7, maxTokens: 2048, topP: "", helper: true, think: false };
const SESSION = {
  model: { value: "ag/gemini-3.8-flash-high", name: "Gemini", isCombo: false },
  messages: [
    { role: "divider", content: "Model switched" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "assistant", content: "   " },
  ],
};

describe("playgroundUtils settings", () => {
  it("falls back to defaults and clamps ranges", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ temperature: 5 }).temperature).toBe(2);
    expect(normalizeSettings({ temperature: -1 }).temperature).toBe(0);
    expect(normalizeSettings({ maxTokens: "16000" }).maxTokens).toBe(16000);
    expect(normalizeSettings({ maxTokens: 0 }).maxTokens).toBe(2048);
    expect(normalizeSettings({ topP: "" }).topP).toBe("");
    expect(normalizeSettings({ topP: 3 }).topP).toBe("1");
    expect(normalizeSettings({ helper: false }).helper).toBe(false);
  });
});

describe("playgroundUtils restore", () => {
  it("normalizes message status and caps reasoning", () => {
    expect(normalizeMessage({ id: "a", role: "assistant", content: "hi", status: "streaming" }).status).toBe("done");
    expect(normalizeMessage({ id: "a", role: "assistant", content: "", status: "streaming" }).status).toBe("empty");
    expect(normalizeMessage({ role: "system" })).toBeNull();
    expect(normalizeMessage({ id: "a", role: "assistant", reasoning: "x".repeat(5000) }).reasoning.length).toBe(4000);
  });

  it("restores sessions, active id and caps", () => {
    expect(restoreSessions({ activeId: "s1", conversations: [{ id: "s1", messages: [] }] }).activeId).toBe("s1");
    expect(restoreSessions({ activeId: "missing", conversations: [{ id: "s1", messages: [] }] }).activeId).toBe("s1");
    expect(restoreSessions({ conversations: [] })).toBeNull();
    expect(restoreSessions([{ id: "s1", messages: [] }]).conversations.length).toBe(1);
    const many = Array.from({ length: 80 }, (_, index) => ({ id: `s${index}`, messages: [] }));
    expect(restoreSessions({ conversations: many }).conversations.length).toBe(MAX_CONVERSATIONS);
    const messages = Array.from({ length: 250 }, (_, index) => ({ id: `m${index}`, role: "user", content: String(index) }));
    const restored = restoreSessions({ conversations: [{ id: "s1", messages }] });
    expect(restored.conversations[0].messages.length).toBe(MAX_MESSAGES);
    expect(restored.conversations[0].messages.at(-1).content).toBe("249");
    expect(stripReasoning({ activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "x" }] }] }).conversations[0].messages[0].reasoning).toBe("");
  });
});

describe("playgroundUtils storage", () => {
  it("round trips and rejects invalid shapes", () => {
    const storage = memoryStorage();
    expect(writeStorage("k", { a: 1 }, storage)).toBe(true);
    expect(readStorage("k", (value) => typeof value.a === "number", storage)).toEqual({ a: 1 });
    storage.setItem("k2", JSON.stringify({ a: "x" }));
    expect(readStorage("k2", (value) => typeof value.a === "number", storage)).toBeNull();
  });

  it("survives a throwing storage", () => {
    const storage = { getItem: () => { throw new Error("boom"); }, setItem: () => { throw new Error("boom"); } };
    expect(readStorage("k", () => true, storage)).toBeNull();
    expect(writeStorage("k", {}, storage)).toBe(false);
  });

  it("treats an unreadable localStorage getter as missing storage", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError: storage is blocked");
        },
      });
      expect(readStorage("k", () => true)).toBeNull();
      expect(writeStorage("k", {})).toBe(false);
      expect(persistSessions({ activeId: "s1", conversations: [{ id: "s1", messages: [] }] })).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete globalThis.localStorage;
    }
    expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(original);
  });

  it("trims long reasoning before writing", () => {
    const storage = { saved: null, setItem: (key, value) => { storage.saved = JSON.parse(value); } };
    const sessions = { activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "x".repeat(5000) }] }] };
    expect(persistSessions(sessions, storage)).toBe(true);
    expect(storage.saved.conversations[0].messages[0].reasoning.length).toBe(4000);
  });

  it("retries without reasoning on quota failure", () => {
    let attempts = 0;
    const storage = {
      setItem: (key, value) => {
        attempts += 1;
        if (attempts === 1) throw new Error("quota");
        storage.saved = JSON.parse(value);
      },
    };
    expect(persistSessions({ activeId: "s1", conversations: [{ id: "s1", messages: [{ reasoning: "long" }] }] }, storage)).toBe(true);
    expect(attempts).toBe(2);
    expect(storage.saved.conversations[0].messages[0].reasoning).toBe("");
  });
});

describe("playgroundUtils titles and follow-ups", () => {
  it("sanitizes and falls back locally", () => {
    expect(sanitizeTitle('"Combo fallback explained"')).toBe("Combo fallback explained");
    expect(sanitizeTitle("  a\n\n b  ")).toBe("a b");
    expect(sanitizeTitle("x".repeat(80)).length).toBe(60);
    expect(localTitle("how   does fallback work in a combo please")).toBe("How does fallback work in a");
    expect(localTitle("hello there?")).toBe("Hello there");
    expect(localTitle("   ")).toBe("New chat");
  });

  it("parses follow-up arrays leniently", () => {
    expect(parseFollowUps('["A", "B", "C"]')).toEqual(["A", "B", "C"]);
    expect(parseFollowUps('```json\n["A","B"]\n```')).toEqual(["A", "B"]);
    expect(parseFollowUps('Here: ["A"] done')).toEqual(["A"]);
    expect(parseFollowUps('["A","B","C","D"]')).toEqual(["A", "B", "C"]);
    expect(parseFollowUps('["A", 2, null, "B"]')).toEqual(["A", "B"]);
    expect(parseFollowUps("no json here")).toEqual([]);
    expect(parseFollowUps('["A",]')).toEqual([]);
  });
});

describe("playgroundUtils request bodies", () => {
  it("drops dividers and blank content", () => {
    expect(toRequestMessages(SESSION.messages, "Be brief.")).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("builds the turn body", () => {
    const body = buildTurnBody(SESSION, SETTINGS);
    expect(body.model).toBe("ag/gemini-3.8-flash-high");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
    expect(body.top_p).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(buildTurnBody(SESSION, { ...SETTINGS, topP: "0.95" }).top_p).toBe(0.95);
    expect(buildTurnBody(SESSION, { ...SETTINGS, think: true }).reasoning_effort).toBe("high");
  });

  it("builds the export body with a Hello fallback", () => {
    const body = buildExportBody({ model: null, messages: [] }, SETTINGS);
    expect(body.messages).toEqual([{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }]);
    expect(body.model).toBe("YOUR_MODEL");
    expect(buildExportBody(SESSION, SETTINGS).messages.at(-1).content).toBe("hello");
  });
});

describe("playgroundUtils code renderers", () => {
  const body = buildExportBody(SESSION, SETTINGS);
  const origin = "http://localhost:20128";

  it("renders cURL with the env placeholder", () => {
    const code = renderCurl(body, origin);
    expect(code).toContain("curl http://localhost:20128/v1/chat/completions");
    expect(code).toContain("$JROUTER_API_KEY");
    expect(code).toContain("Content-Type: application/json");
    expect(renderCurl({ ...body, messages: [{ role: "user", content: "it's" }] }, origin)).toContain("it'\\''s");
  });

  it("renders JavaScript and Python with env placeholders", () => {
    expect(renderJavaScript(body, origin)).toContain("process.env.JROUTER_API_KEY");
    expect(renderJavaScript(body, origin)).toContain("JSON.stringify");
    expect(renderPython(body, origin)).toContain("os.environ['JROUTER_API_KEY']");
    expect(renderPython(body, origin)).toContain("requests.post");
    for (const code of [renderCurl(body, origin), renderJavaScript(body, origin), renderPython(body, origin)]) {
      expect(code).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
    }
  });
});

describe("playgroundUtils formatting", () => {
  it("formats relative time, latencies and meta parts", () => {
    const now = Date.now();
    expect(relativeTime(now - 5000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60000, now)).toBe("12m ago");
    expect(relativeTime(now - 3 * 3600000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86400000, now)).toBe("2d ago");
    expect(relativeTime(now + 5000, now)).toBe("just now");
    expect(formatLatency(420)).toBe("420ms");
    expect(formatLatency(4200)).toBe("4.2s");
    expect(formatLatency(0)).toBe("");
    expect(formatSeconds(3100)).toBe("3.1s");
    expect(buildMetaParts({
      latencyMs: 4200,
      usage: { prompt_tokens: 1200, completion_tokens: 300 },
      finishReason: "stop",
      responseModel: "m2",
      requestedModel: "m1",
    })).toEqual(["4.2s", "1,200 in", "300 out", "stop", "m2"]);
    expect(buildMetaParts({ usage: { total_tokens: 900 } })).toEqual(["900 tokens"]);
    expect(buildMetaParts({ stopped: true, latencyMs: 900 })).toEqual(["900ms", "stopped"]);
    expect(buildMetaParts({ finishReason: "length" })).toEqual(["length"]);
  });

  it("picks the next active id", () => {
    expect(nextActiveId([{ id: "a" }, { id: "b" }], "a")).toBe("b");
    expect(nextActiveId([{ id: "a" }], "a")).toBe("");
  });
});

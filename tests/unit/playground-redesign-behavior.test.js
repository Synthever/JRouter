import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PLAYGROUND = "src/app/(dashboard)/dashboard/playground";

describe("playground sessions", () => {
  it("persists through the shared session helpers", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain("SESSIONS_KEY");
    expect(source).toContain("persistSessions");
    expect(source).toContain("restoreSessions");
    expect(source).toContain("readStorage");
    expect(source).toContain("setTimeout(() => persistSessions");
  });

  it("creates a session with the template defaults", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain('title: "New chat"');
    expect(source).toContain("messages: []");
    expect(source).toContain("export function createSession");
  });

  it("exposes the CRUD surface the page needs", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    for (const name of ["activeSession", "setActiveId", "newSession", "duplicateSession", "deleteSession", "updateSession"]) {
      expect(source).toContain(name);
    }
  });

  it("caps copied titles", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    expect(source).toContain("MAX_TITLE_CHARS");
    expect(source).toContain("(copy)");
  });

  it("normalises a duplicated streaming placeholder into a finished reply", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundSessions.js`);
    const duplicate = source.slice(
      source.indexOf("const duplicateSession"),
      source.indexOf("const deleteSession"),
    );
    // Nothing streams into the copy: left as streaming it would render a permanent
    // waiting… card with no actions, so the status is finished on the way in.
    expect(duplicate).toContain("messages: source.messages.map");
    expect(duplicate).toMatch(/message\.status === "streaming"[^}]*"done"/);
    expect(duplicate).toContain("...message");
  });
});

describe("playground turn engine", () => {
  it("streams through the documented endpoint", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain('const CHAT_ENDPOINT = "/api/v1/chat/completions"');
    expect(source).toContain('Accept: "text/event-stream"');
    expect(source).toContain("buildTurnBody");
  });

  it("reads reasoning and usage deltas", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("reasoning_content");
    expect(source).toContain("finish_reason");
    expect(source).toContain("chunk?.usage");
  });

  it("reports partial turns as stopped", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain('error?.name === "AbortError"');
    expect(source).toContain("stopped: true");
    expect(source).toContain("abortRef.current?.abort()");
  });

  it("carries the stopped flag through to onFinish", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("onFinish?.({");
    expect(source).toContain("stopped: extra.stopped === true");
  });

  it("treats a zero-millisecond first token as measured", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("firstTokenMs == null");
    expect(source).not.toContain("if (!firstTokenMs)");
  });

  it("pushes every update through the page callbacks", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toContain("onAppend(sessionId");
    expect(source).toContain("onPatch(sessionId");
  });
});

describe("playground AI helper", () => {
  it("uses non-streaming calls with tight token budgets", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("stream: false");
    expect(source).toContain("24");
    expect(source).toContain("160");
    expect(source).toContain("/api/v1/chat/completions");
  });

  it("parses instead of trusting the model", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("sanitizeTitle");
    expect(source).toContain("parseFollowUps");
  });

  it("is abortable and silent on failure", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundHints.js`);
    expect(source).toContain("AbortController");
    expect(source).toContain("cancelAll");
    expect(source).toContain('error?.name !== "AbortError"');
  });
});

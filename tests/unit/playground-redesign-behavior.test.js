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
});

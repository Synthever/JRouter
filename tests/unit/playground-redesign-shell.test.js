import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PLAYGROUND = "src/app/(dashboard)/dashboard/playground";

describe("playground transcript shell", () => {
  it("renders the empty state art and four suggestions", () => {
    const source = read(`${PLAYGROUND}/PlaygroundEmpty.js`);
    expect(source).toContain("Start a conversation");
    expect(source).toContain("aria-hidden=\"true\"");
    expect(source.match(/suggestion\b/g)?.length).toBeGreaterThan(0);
    expect(source).toContain("Explain how fallback works in a combo");
    expect(source).toContain("Write a curl command to test my endpoint");
    expect(source).toContain("Draft a system prompt for a code reviewer");
    expect(source).toContain("Summarize this stack trace and suggest a fix");
  });

  it("scrolls only its own viewport", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toContain('role="log"');
    expect(source).toContain("aria-label=\"Conversation\"");
    expect(source).toContain("BOTTOM_THRESHOLD = 80");
    expect(source).toContain("element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD");
    expect(source).toContain("Scroll to bottom");
  });

  it("autoscrolls only while the reader is at the bottom", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toMatch(/if \(!atBottomRef\.current\) return/);
    expect(source).toContain("onScroll");
  });
});

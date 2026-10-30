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

describe("playground message row", () => {
  it("keeps the template message anatomy", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("YOU");
    expect(source).toContain("Thought for");
    expect(source).toContain("Retry");
    expect(source).toContain("Rendered");
    expect(source).toContain("Raw");
    expect(source).toContain("Delete reply");
  });

  it("renders user bubbles on the right and dividers between turns", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("rowUser");
    expect(source).toContain("divider");
  });

  it("keeps the real metric line", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("buildMetaParts");
    expect(source).toContain("metaSep");
  });

  it("only offers retry on the last reply", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("isLast ?");
  });
});

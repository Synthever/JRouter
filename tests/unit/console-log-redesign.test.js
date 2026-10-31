import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PAGE = "src/app/(dashboard)/dashboard/console-log";

describe("console log redesign", () => {
  it("mounts the themed page shell instead of a raw tailwind card", () => {
    const source = read(`${PAGE}/ConsoleLogClient.js`);
    expect(source).toContain("dashboard-surface");
    expect(source).toContain("console-log.module.css");
    expect(source).not.toContain("bg-black");
    expect(source).not.toContain("<Card");
  });

  it("keeps the live terminal accessible and controlled", () => {
    const source = read(`${PAGE}/ConsoleLogClient.js`);
    expect(source).toContain('role="log"');
    expect(source).toContain('aria-live="off"');
    expect(source).toContain("Filter console output");
    expect(source).toContain("Pause");
    expect(source).toContain("Confirm clear");
    expect(source).toContain("Jump to latest");
  });

  it("only follows the tail while the reader is at the bottom", () => {
    const source = read(`${PAGE}/ConsoleLogClient.js`);
    expect(source).toContain("if (!node || paused || !atBottom) return;");
    expect(source).toContain("scrollHeight - node.scrollTop - node.clientHeight < 24");
  });

  it("styles the terminal with theme tokens, not literal colours", () => {
    const css = read(`${PAGE}/console-log.module.css`);
    expect(css).toContain("--color-brand-900");
    expect(css).toContain("--brand-mint");
    expect(css).toContain("--brand-ochre");
    expect(css).toContain("--brand-coral");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
  });
});

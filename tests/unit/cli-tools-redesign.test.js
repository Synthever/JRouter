/**
 * CLI Tools redesign — source-text contracts.
 *
 * The page and card files are JSX, so Vitest (node environment, no JSX
 * transform) cannot import them. These tests read the sources and assert the
 * structural promises the design makes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ROUTE = "src/app/(dashboard)/dashboard/cli-tools";

describe("CLI Tools index", () => {
  const page = read(`${ROUTE}/CLIToolsPageClient.js`);

  it("renders an intro, a metric strip and the sticky toolbar", () => {
    expect(page).toContain("styles.introTitle");
    expect(page).toContain("styles.metrics");
    expect(page).toContain("styles.toolbar");
  });

  it("renders search and status pills wired to state", () => {
    expect(page).toContain('type="search"');
    expect(page).toContain("aria-pressed={filter === option.value}");
    expect(page).toContain("setQuery");
  });

  it("renders one section per visible group", () => {
    expect(page).toContain("visibleGroups.map((group)");
    expect(page).toContain("styles.gridList");
    expect(page).toContain("<ToolCard");
  });

  it("keeps the toolbar pinned in CSS", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css).toContain("position: sticky");
  });

  it("keeps the card grid fluid with equal-height rows", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css).toContain("repeat(auto-fill, minmax(260px, 1fr))");
    // Equal-height rows: without this the footer chips land on two baselines.
    expect(css).toContain("grid-auto-rows: 1fr");
  });

  it("prints the gateway URL once, without a doubled /v1", () => {
    expect(page).not.toContain("${origin}/v1`");
    expect(page).toContain("<span className={styles.gatewayHint}>/v1</span>");
  });

  it("uses only tokens for the metric fills", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css).toContain("background: var(--brand-teal)");
    expect(css).toContain("background: var(--brand-ochre)");
    expect(css).toContain("background: var(--brand-lavender)");
    expect(css).toContain("background: var(--brand-peach)");
  });

  it("keeps the stylesheet free of raw hex colours", () => {
    const css = read(`${ROUTE}/cli-tools.module.css`);
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("no longer ships the old summary cards", () => {
    expect(() => read(`${ROUTE}/components/ToolSummaryCard.js`)).toThrow();
    expect(() => read(`${ROUTE}/components/MitmLinkCard.js`)).toThrow();
  });
});

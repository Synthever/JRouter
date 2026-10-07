import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatCompactTokens } from "@/app/(dashboard)/dashboard/usage/components/chartTheme.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const usagePath = "src/app/(dashboard)/dashboard/usage";
const usageFiles = [
  `${usagePath}/page.js`,
  `${usagePath}/components/OverviewCards.js`,
  `${usagePath}/components/UsageChart.js`,
  `${usagePath}/components/ProviderBarChart.js`,
  `${usagePath}/components/TopModelsChart.js`,
  `${usagePath}/components/UsageTable.js`,
  `${usagePath}/components/RequestDetailsTab.js`,
  `${usagePath}/components/ProviderTopology.js`,
  "src/shared/components/UsageStats.js",
];

describe("usage dashboard theme", () => {
  it("groups the page in shared Dashboard section surfaces", () => {
    const page = read(`${usagePath}/page.js`);
    expect(page).toContain("dashboard-surface ${styles.page}");
    const stats = read("src/shared/components/UsageStats.js");
    // Every section is a ui-card with an eyebrow heading, like Endpoint/Providers/Combos.
    expect(stats.match(/ui-card \$\{styles\.section\}/g)).toHaveLength(3);
    expect(stats).toContain('className="ui-eyebrow"');
    expect(stats).toContain("<StatusBadge");
    // Nested page-local card components were removed in favour of the shared surface.
    expect(stats).not.toContain("<Card");
    expect(stats).not.toContain("bg-bg-subtle");
    expect(stats).not.toContain("text-text-muted uppercase");
    const css = read(`${usagePath}/usage.module.css`);
    expect(css).not.toContain("backdrop-filter");
    expect(css).toMatch(/\.section\s*\{[^}]*padding: 20px;/);
    expect(css).not.toMatch(/\.section\s*\{[^}]*background:/);
  });

  it("charts use shadcn containers and a theme-derived neutral palette", () => {
    const theme = read(`${usagePath}/components/chartTheme.js`);
    expect(theme).toContain('export const CHART_GRID_STROKE = "var(--line)"');
    expect(theme).toContain('export const CHART_AXIS_STROKE = "var(--text-2)"');
    expect(theme).toContain("CHART_BAR_COLORS");
    expect(theme).toContain("color-mix(in srgb, var(--text)");
    for (const file of ["UsageChart.js", "ProviderBarChart.js", "TopModelsChart.js"]) {
      const source = read(`${usagePath}/components/${file}`);
      expect(source).toContain("chartTheme");
      expect(source).toContain("<ChartContainer");
      expect(source).toContain("<ChartTooltipContent");
      expect(source).not.toContain("ResponsiveContainer");
      // No hardcoded hex colours anywhere in the chart components.
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
    for (const file of ["ProviderBarChart.js", "TopModelsChart.js"]) {
      const source = read(`${usagePath}/components/${file}`);
      expect(source).toContain("maxBarSize=");
      expect(source).toContain("getBarColor");
    }
    const area = read(`${usagePath}/components/UsageChart.js`);
    expect(area).toContain('stroke="var(--color-volume)"');
    expect(area).toContain('stopColor="var(--color-volume)"');
    const dashboard = read("src/app/(dashboard)/dashboard/components/ActivityTimelineCard.js");
    expect(dashboard).toContain('stroke="var(--text)"');
  });

  it("keeps controls theme-aware with keyboard focus and mobile targets", () => {
    const segmented = read("src/shared/components/SegmentedControl.js");
    expect(segmented).toContain('role="group"');
    expect(segmented).toContain("aria-pressed={active}");
    expect(segmented).toContain("var(--surface-2)");
    expect(segmented).not.toMatch(/bg-primary|text-white|border-primary/);
    const css = read(`${usagePath}/usage.module.css`);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*flex-wrap: wrap;/);
    expect(css).toContain("prefers-reduced-motion: reduce");
    const table = read(`${usagePath}/components/UsageTable.js`);
    expect(table).toContain("aria-sort");
    // Numbers use the shared tabular cell class, not ad-hoc utilities.
    expect(table).toContain("styles.num");
    expect(table).not.toContain("px-6 py-3");
  });

  it("keeps Recent Requests vertically scrollable without a narrow horizontal scroller", () => {
    const stats = read("src/shared/components/UsageStats.js");
    const recent = stats.slice(stats.indexOf("function RecentRequests("), stats.indexOf("function sortData("));
    expect(recent).not.toContain("max-h-[380px]");
    expect(recent).not.toContain("truncate");
    expect(recent).toContain("no-scrollbar");
    expect(recent).toContain("tabIndex={0}");
    const css = read(`${usagePath}/usage.module.css`);
    expect(css).toMatch(/\.recentRequestsScroll\s*\{[^}]*flex: 1;[^}]*min-height: 0;[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.recentRequestsTable\s*\{[^}]*table-layout: fixed;/);
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toMatch(/\.gridSplit > \*\s*\{[^}]*grid-column: 1 \/ -1;/);
    expect(css).toMatch(/@container[^}]*\.gridSplit > \*\s*\{[^}]*grid-column: auto;/);
    expect(css).toMatch(/@container[\s\S]*\.recentRequests\s*\{[^}]*height: 0;[^}]*min-height: 100%;/);
  });

  it("keeps the usage route on the shared grid background", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const pages = layout.match(/const GRID_BACKGROUND_PAGES = (\[[\s\S]*?\]);/)?.[1];
    const expression = layout.match(/const hasGridBackground = ([^;]+);/)?.[1];
    expect(pages).toBeDefined();
    expect(expression).toBeDefined();
    const hasGridBackground = new Function(
      "pathname",
      `const GRID_BACKGROUND_PAGES = ${pages}; return (${expression});`
    );
    expect(hasGridBackground("/dashboard/usage")).toBe(true);
    expect(hasGridBackground("/dashboard/usage/detail")).toBe(false);
    for (const file of usageFiles) expect(read(file).length).toBeGreaterThan(0);
  });
});

describe("usage stat cards compact tokens + auto refresh", () => {
  it("truncates token counts to compact M/K/B labels", () => {
    expect(formatCompactTokens(172954215)).toBe("172M");
    expect(formatCompactTokens(692588)).toBe("692K");
    expect(formatCompactTokens(149776300)).toBe("149M");
    expect(formatCompactTokens(1234567890)).toBe("1B");
    expect(formatCompactTokens(1000)).toBe("1K");
    expect(formatCompactTokens(999)).toBe("999");
    expect(formatCompactTokens(0)).toBe("0");
  });

  it("wires the compact label into the overview cards, full value kept in the title", () => {
    const cards = read(`${usagePath}/components/OverviewCards.js`);
    expect(cards).toContain("formatCompactTokens(stats.totalPromptTokens)");
    expect(cards).toContain("formatCompactTokens(stats.totalCachedTokens)");
    expect(cards).toContain("formatCompactTokens(stats.totalCompletionTokens)");
    expect(cards).toContain("title={card.full || card.value}");
  });

  it("polls stats and chart data every 3s without a manual reload", () => {
    const stats = read("src/shared/components/UsageStats.js");
    expect(stats).toContain("setInterval(() => {");
    expect(stats).toContain("load({ silent: true })");
    expect(stats).toContain("}, 3000);");
    expect(stats).toContain("clearInterval(id)");
    expect(stats).toContain("if (!document.hidden)");
    const chart = read(`${usagePath}/components/UsageChart.js`);
    expect(chart).toContain("fetchData({ silent: true })");
    expect(chart).toContain("}, 3000);");
    expect(chart).toContain("clearInterval(id)");
    expect(chart).toContain("if (!document.hidden)");
  });
});

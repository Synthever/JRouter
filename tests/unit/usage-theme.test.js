import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("charts reuse the Dashboard chart tokens instead of a local palette", () => {
    const theme = read(`${usagePath}/components/chartTheme.js`);
    expect(theme).toContain('export const CHART_GRID_STROKE = "var(--line)"');
    expect(theme).toContain('export const CHART_AXIS_STROKE = "var(--text-2)"');
    expect(theme).toContain('export const CHART_BAR_FILL = "var(--text-2)"');
    for (const file of ["UsageChart.js", "ProviderBarChart.js", "TopModelsChart.js"]) {
      const source = read(`${usagePath}/components/${file}`);
      expect(source).toContain("chartTheme");
      // No hardcoded hex colours anywhere in the chart components.
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
    const area = read(`${usagePath}/components/UsageChart.js`);
    expect(area).toContain('stroke="var(--text)"');
    expect(area).toContain('stopColor="var(--text)"');
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

  it("keeps the usage route on the shared grid background", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const expression = layout.match(/\$\{([^{}]*"dashboard-grid-bg"[^{}]*)\}/)?.[1];
    expect(expression).toBeDefined();
    const backgroundClass = new Function("pathname", `return (${expression});`);
    expect(backgroundClass("/dashboard/usage")).toBe("dashboard-grid-bg");
    expect(backgroundClass("/dashboard/usage/detail")).toBe("");
    for (const file of usageFiles) expect(read(file).length).toBeGreaterThan(0);
  });
});

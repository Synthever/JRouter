import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const healthPath = "src/app/(dashboard)/dashboard/health";

describe("health dashboard theme contract", () => {
  it("renders the display intro, stats strip and themed panels", () => {
    const page = read(`${healthPath}/page.js`);
    const stats = read(`${healthPath}/components/HealthStats.js`);
    expect(page).toContain("styles.intro");
    expect(page).toContain("styles.title");
    expect(page).toContain("<HealthStats");
    expect(page).toContain("styles.panelHead");
    expect(page).toContain("styles.settingsStrip");
    expect(page).not.toContain("HealthSummaryCards");
    expect(stats).toContain('aria-label="Health summary"');
    expect(stats).toContain('const LAYOUT_STORAGE_KEY = "jrouter.health.statsLayout.v1";');
    expect(stats).toContain("rowHeight={168}");
    expect(stats).toContain("narrowColumns={1}");
    expect(stats).toContain('aria-label="Reset layout"');
  });

  it("keeps the health summary widgets adjustable like the other surfaces", () => {
    const stats = read(`${healthPath}/components/HealthStats.js`);
    expect(stats).toContain('from "@/shared/components/ui/bento-grid"');
    expect(stats).toMatch(/id: "availability", title: "Availability", defaultSpan: 2/);
    expect(stats).toMatch(/id: "attention", title: "Attention", defaultSpan: 2/);
    expect(stats).toMatch(/id: "latency", title: "Average latency", defaultSpan: 2/);
    expect(stats).toContain("normalizeLayout(JSON.parse(saved), ITEMS)");
    expect(stats).toContain("onLayoutCommit={saveLayout}");
  });

  it("styles the intro and panels like the endpoint surface", () => {
    const css = read(`${healthPath}/health.module.css`);
    expect(css).toMatch(/\.title\s*\{[^}]*font-size: clamp\(28px, 3\.4vw, 40px\);/s);
    expect(css).toMatch(/\.panel\s*\{[^}]*padding: 28px;/s);
    expect(css).toMatch(/\.panel\s*\{[^}]*border-radius: var\(--r4\);/s);
    expect(css).toMatch(/\.panelTitle\s*\{[^}]*font-size: 18px;/s);
    expect(css).toMatch(/\.panelDesc\s*\{[^}]*font-size: 14px;/s);
    expect(css).toContain("@container");
  });

  it("keeps the table and filters on the new-theme geometry", () => {    const css = read(`${healthPath}/health.module.css`);
    expect(css).toMatch(/\.table td\s*\{[^}]*padding: 16px 12px;/s);
    expect(css).toMatch(/\.search :global\(input\)\s*\{[^}]*height: 44px;/s);
    expect(css).toMatch(/\.select\s*\{[^}]*height: 44px;/s);
    const table = read(`${healthPath}/components/ModelsHealthTable.js`);
    expect(table).toContain("styles.panelHead");
    expect(table).toContain("styles.panelTitle");
    expect(table).not.toContain("ui-card");
  });

  it("exposes an apply-to-all action beside save settings", () => {
    const settings = read(`${healthPath}/components/HealthSettings.js`);
    expect(settings).toContain("Apply to all models");
    expect(settings).toContain("/api/model-health/config/all");
    expect(settings).toContain("<ConfirmModal");
    expect(settings).toContain("onSaved");
  });
});

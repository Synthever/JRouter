// Contract for the token saver surface: page hero followed directly by the four
// strategies as hairline rows inside one 24px/28px panel. These assertions lock
// the anatomy and the behaviours that must survive the redesign.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const tsPath = "src/app/(dashboard)/dashboard/token-saver";
const pageSource = () => read(`${tsPath}/TokenSaverClient.js`);
const pageCss = () => read(`${tsPath}/token-saver.module.css`);
const rowSource = () => read(`${tsPath}/components/StrategyRow.js`);

describe("token saver dashboard surface", () => {
  it("opens with the shared page hero instead of the old eyebrow header", () => {
    const source = pageSource();
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source).toContain("<h1 className={styles.title}>Token Saver</h1>");
    expect(source).toContain("styles.intro");
    expect(source).toContain("styles.sub");
    // The old page added a ui-card panel, an eyebrow title and its own padding.
    expect(source).not.toContain("ui-card");
    expect(source).not.toContain("ui-eyebrow");
    expect(source).not.toContain("space-y-6 p-6");
    expect(source).not.toContain("<Card");

    const css = pageCss();
    // Compose the approved Usage module rather than duplicating the design system.
    expect(css).toMatch(/\.page\s*\{\s*composes: page from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/\.section\s*\{\s*composes: section from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/composes: formScope from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/components\/DashboardControls\.module\.css";/);
    expect(css).toMatch(/\.title\s*\{[^}]*font-size: clamp\(28px, 3\.4vw, 40px\);/s);
    expect(css).not.toMatch(/backdrop-filter|#131315|linear-gradient/);
    expect(css).not.toContain("ui-card");
  });

  it("goes straight from the hero to the strategies panel, with no summary strip", () => {
    const source = pageSource();
    expect(source).not.toContain("TokenSaverStats");
    expect(source).not.toContain("statsLayout");
    expect(source).not.toContain("WidgetGrid");
    // The active count lives in the section title, not in a summary card.
    expect(source).toContain("<small>{activeCount} of {STRATEGY_COUNT} active</small>");
    expect(source.indexOf("styles.intro")).toBeLessThan(source.indexOf("<section"));
    // No strip means no strip module in the route folder.
    expect(() => read(`${tsPath}/components/TokenSaverStats.js`)).toThrow();
  });

  it("renders every strategy as a hairline row with identity tile, doc link and status pill", () => {
    const source = pageSource();
    const row = rowSource();
    expect(source).toContain("<StrategyRow");
    expect(row).toContain("styles.strategyHead");
    expect(row).toContain("styles.tile");
    expect(row).toContain("data-tone={tone}");
    expect(row).toContain("styles.docLink");
    expect(row).toContain('target="_blank"');
    expect(row).toContain("styles.badgeOn");
    expect(row).toContain("styles.actions");
    for (const tone of ["lavender", "ochre", "pink", "mint"]) {
      expect(source).toContain(`tone="${tone}"`);
    }

    const css = pageCss();
    expect(css).toMatch(/\.strategy\s*\{[^}]*padding: 20px 0;[^}]*border-bottom: 1px solid var\(--line\);/s);
    expect(css).toMatch(/\.strategy:last-child\s*\{[^}]*border-bottom: 0;/s);
    expect(css).toMatch(/\.tile\[data-tone="lavender"\]\s*\{[^}]*--brand-lavender/s);
    expect(css).toMatch(/\.badge\s*\{[^}]*height: 24px;[^}]*font-size: 12px;[^}]*font-weight: 600;/s);
    // No per-item cards: the collection grid class must not exist here.
    expect(css).not.toMatch(/\.grid\s*\{/);
  });

  it("preserves every strategy, level and settings call", () => {
    const source = pageSource();
    for (const preserved of [
      "Compress tool output", "Compress context", "Compress LLM output", "Lazy senior dev",
      "git/grep/ls/tree/logs → 60-90% fewer input tokens",
      "Terse-style system prompt → ~65% fewer output tokens (up to 87%)",
      "https://github.com/rtk-ai/rtk",
      "https://github.com/chopratejas/headroom",
      "https://github.com/JuliusBrussee/caveman",
      "https://github.com/DietrichGebert/ponytail",
      "Caveman compression level",
      "Ponytail level",
      "Each strategy is applied independently. Changes save immediately.",
    ]) {
      expect(source).toContain(preserved);
    }
    for (const endpoint of ["/api/settings", "/api/headroom/status", "/api/headroom/extras", "/api/headroom/start", "/api/headroom/stop", "/api/headroom/restart"]) {
      expect(source).toContain(endpoint);
    }
    // Validation fallbacks stay intact.
    expect(source).toContain("Number.isFinite(raw) && raw > 0 ? raw : 3000");
    // The unreachable PXPIPE row and its never-open modal are gone; the
    // /dashboard/pxpipe route that owns the feature is untouched.
    expect(source).not.toContain("pxpipe");
  });

  it("manages Headroom compression extras inside its Manage dialog", () => {
    const source = pageSource();
    expect(source).toContain('title={headroomRunning ? "Headroom" : "Setup Headroom"}');
    expect(source).toContain('size="lg"');
    expect(source).toContain("Compression extras");
    expect(source).toContain("Install [proxy,");
    expect(source).toContain("styles.installLog");
    expect(source).toContain("styles.chips");

    const modalStart = source.indexOf("<Modal");
    const modalEnd = source.indexOf("</Modal>", modalStart);
    const extrasIndex = source.indexOf("styles.extras");
    expect(modalStart).toBeGreaterThan(-1);
    expect(extrasIndex).toBeGreaterThan(modalStart);
    expect(extrasIndex).toBeLessThan(modalEnd);
  });

  it("uses the shared controls and the endpoint switch geometry", () => {
    const source = pageSource();
    expect(source).toContain("<Toggle");
    expect(source).toContain("SegmentedControl");
    expect(source).not.toMatch(/bg-primary|text-primary|border-primary|bg-success\/|text-success|text-error|text-warning|bg-warning\//);
    expect(source).not.toContain("border-border");

    const css = pageCss();
    expect(css).toMatch(/\.actions \[role="switch"\]\s*\{[^}]*width: 46px;[^}]*height: 28px;/s);
    expect(css).toMatch(/\.actions \[role="switch"\] > span\s*\{[^}]*translate: 3px 0;/s);
    expect(css).toMatch(/\.actions \[role="switch"\]\[aria-checked="true"\] > span\s*\{[^}]*translate: 21px 0;/s);
    expect(css).not.toMatch(/transform: translateX\(/);
    expect(css).toMatch(/\.segmented :global\(button\)\s*\{[^}]*border-radius: 99px;/s);
    expect(css).toMatch(/\.segmented :global\(button\[aria-pressed="true"\]\)\s*\{[^}]*background: var\(--canvas\);/s);
    expect(css).toContain("var(--danger)");
    expect(css).toContain("var(--warn)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 639px)");
    expect(css).toContain("min-height: 44px");
  });

  it("resolves every literal icon name to a real Icon entry", () => {
    const iconSrc = read("src/shared/components/Icon.js");
    const mapBlock = iconSrc.slice(iconSrc.indexOf("const ICON_MAP"), iconSrc.indexOf("export { Icon, ICON_MAP }"));
    const known = new Set([...mapBlock.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]));
    expect(known.size).toBeGreaterThan(100);

    // Icon silently falls back to a question mark for unknown names, so guard the
    // literal names used by the refactored pages.
    const files = [
      `${tsPath}/TokenSaverClient.js`,
      `${tsPath}/components/StrategyRow.js`,
      "src/shared/components/UsageStats.js",
      "src/shared/components/RequestLogger.js",
      "src/app/(dashboard)/dashboard/usage/page.js",
      "src/app/(dashboard)/dashboard/usage/components/UsageChart.js",
      "src/app/(dashboard)/dashboard/usage/components/ProviderBarChart.js",
      "src/app/(dashboard)/dashboard/usage/components/TopModelsChart.js",
      "src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js",
      "src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js",
    ];
    const unknown = [];
    for (const file of files) {
      const src = read(file);
      for (const m of src.matchAll(/<Icon\b[^>]*>\s*([A-Za-z_][\w-]*)\s*<\/Icon>/g)) {
        const name = m[1].trim();
        if (!known.has(name) && !known.has(name.replace(/-/g, "_")) && !known.has(name.replace(/_/g, "-"))) {
          unknown.push(`${file}: ${name}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("keeps the token-saver route on the shared grid background", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const pages = new Function(`return ${layout.match(/const GRID_BACKGROUND_PAGES = (\[[\s\S]*?\]);/)[1]};`)();
    const predicate = layout.match(/const hasGridBackground = (.+);/)?.[1];
    expect(predicate).toBeDefined();
    const backgroundClass = new Function(
      "pathname",
      "GRID_BACKGROUND_PAGES",
      `return (${predicate}) ? "dashboard-grid-bg" : "";`
    );
    expect(backgroundClass("/dashboard/token-saver", pages)).toBe("dashboard-grid-bg");
    expect(backgroundClass("/dashboard/token-saver/x", pages)).toBe("");
  });
});

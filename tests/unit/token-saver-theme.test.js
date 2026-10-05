import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const tsPath = "src/app/(dashboard)/dashboard/token-saver";

describe("token saver dashboard theme", () => {
  it("renders as a shared-surface page instead of a bare padded div", () => {
    const source = read(`${tsPath}/TokenSaverClient.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source).toContain("ui-card ${styles.section}");
    expect(source).toContain('className="ui-eyebrow');
    // The old page added its own padding inside the shell's padding.
    expect(source).not.toContain("space-y-6 p-6");
    expect(source).not.toContain("<Card");
    const css = read(`${tsPath}/token-saver.module.css`);
    // Compose the approved Usage module rather than duplicating the design system.
    expect(css).toMatch(/\.page\s*\{\s*composes: page from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/\.section\s*\{\s*composes: section from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/composes: formScope from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/components\/DashboardControls\.module\.css";/);
    expect(css).not.toContain("backdrop-filter");
  });

  it("uses the shared controls and semantic tokens throughout", () => {
    const source = read(`${tsPath}/TokenSaverClient.js`);
    // Shared switch, segmented control and badge system - no custom variants.
    expect(source).toContain("<Toggle");
    expect(source).toContain("SegmentedControl");
    expect(source).toContain("StatusBadge");
    expect(source).not.toMatch(/bg-primary|text-primary|border-primary|bg-success\/|text-success|text-error|text-warning|bg-warning\//);
    expect(source).not.toContain("border-border");
    const css = read(`${tsPath}/token-saver.module.css`);
    expect(css).toContain('[role="switch"][aria-checked="true"]');
    expect(css).toContain("var(--danger)");
    expect(css).toContain("var(--warn)");
    expect(css).toContain("var(--r1)");
    expect(css).toContain(":focus-visible");
  });

  it("preserves every strategy, level and settings call", () => {
    const source = read(`${tsPath}/TokenSaverClient.js`);
    for (const preserved of [
      "Compress tool output", "Compress context", "Compress LLM output", "Lazy senior dev",
      "git/grep/ls/tree/logs → 60-90% fewer input tokens",
      "Terse-style system prompt → ~65% fewer output tokens (up to 87%)",
      "https://github.com/rtk-ai/rtk",
      "https://github.com/chopratejas/headroom",
      "https://github.com/JuliusBrussee/caveman",
      "https://github.com/DietrichGebert/ponytail",
    ]) {
      expect(source).toContain(preserved);
    }
    for (const endpoint of ["/api/settings", "/api/headroom/status", "/api/headroom/extras", "/api/headroom/start", "/api/headroom/stop", "/api/headroom/restart"]) {
      expect(source).toContain(endpoint);
    }
    // Validation fallbacks stay intact.
    expect(source).toContain("Number.isFinite(raw) && raw > 0 ? raw : 3000");
    expect(source).toContain("Math.max(0, Number(pxpipeMinChars) || 25000)");
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
    const expression = layout.match(/\$\{([^{}]*"dashboard-grid-bg"[^{}]*)\}/)?.[1];
    expect(expression).toBeDefined();
    const backgroundClass = new Function("pathname", `return (${expression});`);
    expect(backgroundClass("/dashboard/token-saver")).toBe("dashboard-grid-bg");
    expect(backgroundClass("/dashboard/token-saver/x")).toBe("");
  });
});

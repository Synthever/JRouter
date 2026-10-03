import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const combosPath = "src/app/(dashboard)/dashboard/combos";

describe("combos dashboard theme", () => {
  it("uses solid themed panels so nested model pickers escape dashboard layers", () => {
    const source = read(`${combosPath}/page.js`);
    expect(source).toContain("styles.page");
    expect(source).toContain("styles.panel");
    expect(source).toContain("styles.comboCard");
    const css = read(`${combosPath}/combos.module.css`);
    expect(css).not.toContain("backdrop-filter:");
    expect(css).toMatch(/\.panel\s*\{[^}]*background: var\(--surface\);/);
    expect(css).toMatch(/\.comboCard\s*\{[^}]*background: #0A0A0B;/i);
    expect(source).toContain("<ModelSelectModal");
  });

  it("keeps controls theme-aware with keyboard focus and mobile targets", () => {
    const source = read(`${combosPath}/page.js`);
    expect(source).not.toContain("styles.strategySummary");
    expect(source).toContain('<Icon className="text-text text-[18px]">layers</Icon>');
    expect(source).toContain('<Icon className="shrink-0 text-text text-[18px]">{cap.icon}</Icon>');
    expect(source).not.toMatch(/text-primary|bg-primary|border-primary|bg-black\/\[0\.015\]/);
    const css = read(`${combosPath}/combos.module.css`);
    expect(css).toMatch(/\.primary\s*\{[^}]*background: var\(--text\);[^}]*color: var\(--bg\);/);
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("scopes the shared dashboard background to the combos list route", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const expression = layout.match(/\$\{([^{}]*"dashboard-grid-bg"[^{}]*)\}/)?.[1];
    expect(expression).toBeDefined();
    const backgroundClass = new Function("pathname", `return (${expression});`);
    expect(backgroundClass("/dashboard/combos")).toBe("dashboard-grid-bg");
    expect(backgroundClass("/dashboard/combos/custom")).toBe("");
  });
});
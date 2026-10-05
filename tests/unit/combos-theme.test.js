import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const combosPath = "src/app/(dashboard)/dashboard/combos";

describe("combos dashboard theme", () => {
  it("reuses the shared Dashboard section surface instead of page-specific cards", () => {
    const source = read(`${combosPath}/page.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source.match(/<section className={`ui-card \$\{styles.panel\}`}/g)).toHaveLength(2);
    const css = read(`${combosPath}/combos.module.css`);
    expect(css).not.toContain("backdrop-filter");
    expect(css).not.toContain("comboCard");
    // .panel only adds density; the surface itself comes from globals + ui-card.
    expect(css).toMatch(/\.panel\s*\{[^}]*padding: 20px;/);
    expect(css).not.toMatch(/\.panel\s*\{[^}]*background:/);
    // Rows reuse the shared control styles rather than re-declaring buttons/dialogs.
    expect(css).toMatch(/\.iconAction\s*\{\s*composes: iconButton from/);
    expect(css).toMatch(/\.dialog\s*\{\s*composes: dialog from/);
    expect(source).toContain("<ModelSelectModal");
    const shared = read("src/app/globals.css");
    expect(shared).toContain(".dashboard-surface .ui-card");
  });

  it("keeps controls theme-aware with semantic status colors", () => {
    const source = read(`${combosPath}/page.js`);
    expect(source).not.toMatch(/text-primary|bg-primary|border-primary|bg-black\/\[0\.015\]|!bg-white/);
    expect(source).toContain('variant="contrast"');
    expect(source).toContain("<StatusBadge");
    expect(source).toContain("<Toggle");
    const css = read(`${combosPath}/combos.module.css`);
    expect(css).toMatch(/\.success\s*\{[^}]*color: var\(--pos\);/);
    expect(css).toMatch(/\.dangerAction[\s\S]*?color: var\(--danger\);/);
    expect(css).toContain('[role="switch"][aria-checked="true"]');
    expect(css).toContain("var(--text-2)");
    expect(css).toContain("var(--font-mono)");
  });

  it("keeps keyboard controls visible and mobile content shrinkable", () => {
    const source = read(`${combosPath}/page.js`);
    expect(source).toContain("aria-label={`Select ${combo.name}`}");
    expect(source).toContain('title="Drag to reorder"');
    expect(source).toContain("aria-label={`Move ${model} up`}");
    const css = read(`${combosPath}/combos.module.css`);
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":focus-within");
    expect(css).toMatch(/\.comboRow,\s*\.adapterRow\s*\{[^}]*border-bottom: 1px solid var\(--line\);/);
    expect(css).toMatch(/@media \(max-width: 1199px\)\s*\{\s*\.rowContent\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
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

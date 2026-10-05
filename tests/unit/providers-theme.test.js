import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const providersPath = "src/app/(dashboard)/dashboard/providers";

describe("providers dashboard theme", () => {
  it("shares Dashboard section surfaces and uses separated rows", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source.match(/<section className={`ui-card \$\{styles.panel\}`}/g)).toHaveLength(4);
    const css = read(`${providersPath}/providers.module.css`);
    expect(css).not.toContain("backdrop-filter");
    expect(css).not.toContain("providerCard");
    expect(css).toMatch(/\.providerRow\s*\{[^}]*border-bottom: 1px solid var\(--line\);/);
    const shared = read("src/app/globals.css");
    expect(shared).toContain(".dashboard-surface .ui-card");
    expect(shared).toContain("prefers-reduced-transparency: reduce");
  });

  it("uses theme-aware controls and semantic status colors", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).not.toMatch(/!bg-white|border-primary|bg-primary|text-primary/);
    const css = read(`${providersPath}/providers.module.css`);
    expect(source).toContain('variant="contrast"');
    expect(source).toContain("<StatusBadge");
    expect(source).toContain("<Toggle");
    expect(css).toMatch(/\.success\s*\{[^}]*color: var\(--pos\);/);
    expect(css).toMatch(/\.error\s*\{[^}]*color: var\(--danger\);/);
    expect(css).toContain('[role="switch"][aria-checked="true"]');
  });

  it("keeps keyboard controls visible and mobile content shrinkable", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).toContain('htmlFor="provider-status-filter"');
    expect(source).toContain('id="provider-status-filter"');
    expect(source).toContain('aria-label={`${allDisabled ? "Enable" : "Disable"} ${provider.name}`}');
    expect(source).toContain('<ul className={styles.list}>');
    const css = read(`${providersPath}/providers.module.css`);
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":focus-within");
    expect(css).toContain("grid-template-columns: 36px minmax(0, 1fr);");
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

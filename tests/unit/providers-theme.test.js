import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const providersPath = "src/app/(dashboard)/dashboard/providers";

describe("providers dashboard theme", () => {
  it("uses scoped section panels without nesting backdrop filters on provider cards", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).toContain("styles.page");
    expect(source.match(/<section className={styles.panel}/g)).toHaveLength(4);
    const css = read(`${providersPath}/providers.module.css`);
    expect(css).toContain("backdrop-filter: blur(18px) saturate(130%);");
    expect(css).toContain("backdrop-filter: blur(24px);");
    expect(css).toMatch(/\.providerCard\s*\{[^}]*background: transparent;/);
    expect(css).toMatch(/prefers-reduced-transparency: reduce[\s\S]*background: var\(--surface\);/);
  });

  it("uses theme-aware controls and semantic status colors", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).not.toMatch(/!bg-white|border-primary|bg-primary|text-primary/);
    const css = read(`${providersPath}/providers.module.css`);
    expect(css).toMatch(/\.primary\s*\{[^}]*background: var\(--text\);[^}]*color: var\(--bg\);/);
    expect(css).toMatch(/\.success\s*\{[^}]*color: var\(--pos\);/);
    expect(css).toMatch(/\.error\s*\{[^}]*color: var\(--danger\);/);
    expect(css).toContain('[role="switch"][aria-checked="true"]');
  });

  it("keeps keyboard controls visible and mobile content shrinkable", () => {
    const source = read(`${providersPath}/page.js`);
    expect(source).toContain('htmlFor="provider-status-filter"');
    expect(source).toContain('id="provider-status-filter"');
    expect(source.match(/aria-label={`\$\{allDisabled \? "Enable" : "Disable"\} \$\{provider.name\}`}/g)).toHaveLength(2);
    const css = read(`${providersPath}/providers.module.css`);
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":focus-within");
    expect(css).toMatch(/\.grid\s*\{[^}]*minmax\(min\(100%, 240px\), 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("dashboard navigation styling contract", () => {
  it("scopes navigation surfaces and controls to the dashboard", () => {
    const header = read("src/shared/components/Header.js");
    const sidebar = read("src/shared/components/Sidebar.js");
    const css = read("src/app/globals.css");

    expect(header).toContain('className="dashboard-header');
    expect(sidebar).toContain('className="dashboard-sidebar');
    expect(css).toContain(".dashboard-header .dashboard-header__action");
    expect(css).toContain(".dashboard-sidebar__item.is-active");
    expect(css).toContain(".dashboard-sidebar__item:focus-visible");
    expect(header).not.toContain("hover:text-white");
  });

  it("uses the same header control for theme, language and menu", () => {
    expect(read("src/shared/components/Header.js")).toContain('<ThemeToggle className="dashboard-header__action"');
    for (const name of ["HeaderLanguage", "HeaderMenu"]) {
      expect(read(`src/shared/components/${name}.js`)).toContain('className="dashboard-header__action"');
    }
  });

  it("exposes the selected navigation route and accordion state", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    expect(sidebar).toContain('aria-label="Main navigation"');
    expect(sidebar.match(/aria-current=/g)).toHaveLength(6);
    expect(sidebar).toContain("aria-expanded={mediaOpen}");
    expect(sidebar).toContain("aria-controls={mediaPanelId}");
    expect(sidebar).toContain("id={mediaPanelId}");
    expect(sidebar).not.toContain("#FF5F56");
  });

  it("retains mobile sizing, reduced motion and opaque surface fallbacks", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.dashboard-sidebar__item[\s\S]*?min-height: 44px/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.dashboard-header/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-sidebar__item/);
  });

  it("keeps header blur off the containing block of fixed confirmation overlays", () => {
    const css = read("src/app/globals.css");
    const headerRules = [...css.matchAll(/\.dashboard-header\s*\{([^}]+)\}/g)];
    for (const [, declarations] of headerRules) {
      expect(declarations).not.toContain("backdrop-filter");
    }
    expect(css).toMatch(/\.dashboard-header::before\s*\{[^}]*backdrop-filter: blur\(18px\)/);
  });
});
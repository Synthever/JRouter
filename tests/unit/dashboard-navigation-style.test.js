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

  it("keeps language and menu controls without a standalone theme button", () => {
    const header = read("src/shared/components/Header.js");
    expect(header).not.toContain("ThemeToggle");
    expect(header).toContain("<HeaderLanguage />");
    expect(header).toContain("<HeaderMenu onLogout={handleLogout} />");
    expect(read("src/shared/components/HeaderMenu.js")).toContain('label="Theme"');
    for (const name of ["HeaderLanguage", "HeaderMenu"]) {
      expect(read(`src/shared/components/${name}.js`)).toContain('className="dashboard-header__action"');
    }
  });

  it("keeps the dark navbar transparent without a shadow or bottom border", () => {
    const css = read("src/app/globals.css");
    const header = css.match(/\.dark \.dashboard-header\s*\{([^}]+)\}/)?.[1] || "";
    const overlay = css.match(/\.dark \.dashboard-header::before\s*\{([^}]+)\}/)?.[1] || "";
    const card = css.match(/\.dark \.dashboard-overview :is\(\.stat-card, \.ui-card\)\s*\{([^}]+)\}/)?.[1] || "";
    const base = css.match(/\n\.dashboard-header\s*\{([^}]+)\}/)?.[1] || "";

    for (const declaration of ["background-color: transparent;", "background-image: none;"]) {
      expect(header).toContain(declaration);
      expect(overlay).toContain(declaration);
    }
    expect(card).toContain("background-color: var(--surface);");
    expect(base).toContain("border-bottom: 0;");
    expect(header).toContain("box-shadow: none;");
    expect(overlay).toContain("backdrop-filter: blur(24px);");
    expect(css).toMatch(/@supports[^\{]+\{\s*\.dashboard-header,\s*\.dark \.dashboard-header\s*\{\s*background: transparent;/);
  });

  it("keeps navbar icon controls unframed in normal and interactive states", () => {
    const css = read("src/app/globals.css");
    const action = css.match(/\.dashboard-header \.dashboard-header__action\s*\{([^}]+)\}/)?.[1] || "";
    const hover = css.match(/\.dashboard-header \.dashboard-header__action\[aria-expanded="true"\]\s*\{([^}]+)\}/)?.[1] || "";
    const active = css.match(/\.dashboard-header \.dashboard-header__action:active\s*\{([^}]+)\}/)?.[1] || "";

    expect(action).toContain("border: 0;");
    expect(action).toContain("background: transparent;");
    expect(hover).toContain("background: transparent;");
    expect(hover).not.toContain("border-color:");
    expect(active).not.toContain("background:");
    expect(active).toContain("color: var(--text);");
    expect(css).toMatch(/\.dashboard-header \.dashboard-header__action:focus-visible,[\s\S]*?outline: 2px solid var\(--text-2\)/);
  });

  it("matches the dark sidebar surface to the cards and keeps an opaque fallback", () => {
    const css = read("src/app/globals.css");
    const rules = [...css.matchAll(/\.dark \.dashboard-sidebar\s*\{([^}]+)\}/g)];
    const sidebar = rules[0]?.[1] || "";

    expect(sidebar).toContain("background-color: rgba(0, 0, 0, 0.3);");
    expect(sidebar).toContain("background-image: none;");
    expect(sidebar).toContain("box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);");
    expect(rules.some(([, declarations]) => declarations.includes("backdrop-filter: blur(24px);"))).toBe(true);

    const fallback = [...css.matchAll(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .find(([, body]) => body.includes(".dashboard-sidebar"))?.[1] || "";
    expect(fallback).toContain(".dark .dashboard-sidebar");
    expect(fallback).toContain("background-color: var(--surface);");
    expect(fallback).toContain("backdrop-filter: none;");
  });

  it("hides only the sidebar scrollbar while preserving navigation scrolling", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    const css = read("src/app/globals.css");

    expect(sidebar).toContain('className="dashboard-sidebar__nav flex-1 min-h-0 overflow-y-auto no-scrollbar"');
    expect(css).toMatch(/\.no-scrollbar,[\s\S]*?scrollbar-width: none !important;/);
    expect(css).toMatch(/\.no-scrollbar::-webkit-scrollbar,[\s\S]*?display: none !important;/);
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
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.dark \.dashboard-header::before,[\s\S]*?background-color: var\(--surface\)/);
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
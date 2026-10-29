import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("dashboard navigation styling contract", () => {
  it("scopes the shell surfaces and controls to the dashboard chrome", () => {
    const header = read("src/shared/components/Header.js");
    const sidebar = read("src/shared/components/Sidebar.js");
    const css = read("src/app/globals.css");

    // The header owns the avatar/bell popovers, so it must stack above the
    // sticky page toolbars (z-30) that scroll beneath it; z-20 let those bars
    // paint over an open dropdown.
    expect(header).toContain('className="dashboard-header shrink-0 relative z-40"');
    expect(sidebar).toContain('className="dashboard-sidebar');
    expect(css).toContain(".dashboard-header .dashboard-header__action");
    expect(css).toContain(".dashboard-sidebar__item.is-active");
    expect(css).toContain(".dashboard-sidebar__item:focus-visible");
    expect(header).not.toContain("hover:text-white");
  });

  it("renders the reference topbar structure: workspace crumb, search trigger, date, bell and avatar", () => {
    const header = read("src/shared/components/Header.js");
    const css = read("src/app/globals.css");

    expect(header).toContain('className="dashboard-header__workspace"');
    expect(header).toContain('className="dashboard-header__search-trigger"');
    expect(header).toContain('className="dashboard-header__date"');
    expect(header).toContain('className="dashboard-header__action dashboard-header__bell"');
    expect(header).toContain('className="dashboard-header__popover"');
    expect(header).toContain("<HeaderMenu initials={initials}");
    expect(css).toContain("min-height: 74px;");
    expect(css).toContain("padding: 0 38px;");
    expect(css).toContain("border-bottom: 1px solid var(--line);");
    expect(css).toContain(".dashboard-header__avatar");
    expect(css).toMatch(/\.dashboard-palette\s*\{[^}]*position: fixed;[^}]*top: 16vh;[^}]*left: 50%;/);
    expect(css).toContain(".dashboard-palette__backdrop");
  });

  it("moves the language switcher into the avatar menu and keeps the theme entry", () => {
    const header = read("src/shared/components/Header.js");
    const menu = read("src/shared/components/HeaderMenu.js");

    expect(header).not.toContain("<HeaderLanguage />");
    expect(header).toContain("<HeaderMenu initials=");
    expect(menu).toContain('<HeaderLanguage variant="menu" />');
    expect(menu).toContain('label="Theme"');
    expect(menu).toContain('label="Logout"');
    expect(menu).toContain('className="dashboard-header__avatar"');
    expect(read("src/shared/components/HeaderLanguage.js")).toContain('variant === "menu" ? "dashboard-header__menu-item"');
  });

  it("groups the sidebar with reference labels while keeping the route highlighting sites", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    const registry = read("src/shared/constants/dashboardNav.js");

    for (const group of ["Workspace", "Gateway", "Studio", "Monitor", "Tools"]) {
      expect(registry).toContain(`title: "${group}"`);
    }
    expect(sidebar).toContain("const navGroups = DASHBOARD_NAV_GROUPS;");
    expect(sidebar).toContain("dashboard-sidebar__section-title");
    expect(sidebar).toContain("System");
    expect(sidebar.match(/aria-current=/g)).toHaveLength(6);
    expect(sidebar).toContain("aria-expanded={mediaOpen}");
    expect(sidebar).toContain("aria-controls={mediaPanelId}");
    expect(sidebar).toContain("id={mediaPanelId}");
    expect(sidebar).toContain("DASHBOARD_SETTINGS_ITEM.href");
    expect(sidebar).toContain("GATEWAY / v{APP_CONFIG.version}");
    expect(sidebar).toContain("<AppLogo size={38}");
    expect(sidebar).not.toContain("#FF5F56");
    expect(sidebar).not.toContain("9Remote");
    expect(sidebar).not.toContain("9English");
  });

  it("keeps the active navigation item a solid ink pill and the labels uppercase", () => {
    const css = read("src/app/globals.css");
    const active = css.match(/\.dashboard-sidebar__item\.is-active\s*\{([^}]+)\}/)?.[1] || "";
    const title = css.match(/\.dashboard-sidebar__section-title\s*\{([^}]+)\}/)?.[1] || "";
    const sidebar = css.match(/\n\.dashboard-sidebar\s*\{([^}]+)\}/)?.[1] || "";

    expect(active).toContain("background: var(--text);");
    expect(active).toContain("color: var(--bg);");
    expect(title).toContain("text-transform: uppercase;");
    expect(title).toContain("letter-spacing: 0.12em;");
    expect(sidebar).toContain("width: 246px;");
    // Sidebar shares the header's canvas token so both surfaces match in both themes.
    expect(sidebar).toContain("background: var(--canvas);");
  });

  it("paints the sidebar and the header from the same canvas token in both themes", () => {
    const css = read("src/app/globals.css");
    const sidebar = css.match(/\n\.dashboard-sidebar\s*\{([^}]+)\}/)?.[1] || "";
    const header = css.match(/\n\.dashboard-header\s*\{([^}]+)\}/)?.[1] || "";

    expect(sidebar).toContain("background: var(--canvas);");
    expect(header).toContain("background: var(--canvas);");
  });

  it("hands the mobile menu button and search collapse to the responsive shell rules", () => {
    const css = read("src/app/globals.css");
    const mobile = css.match(/@media \(max-width: 1023px\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

    expect(mobile).toContain(".dashboard-header__menu-button");
    expect(mobile).toContain("display: inline-grid;");
    expect(mobile).toContain("min-height: 64px;");
    expect(css).toMatch(/@media \(max-width: 735px\)[\s\S]*?\.dashboard-header__search-trigger \{[\s\S]*?width: 36px;/);
    expect(css).toMatch(/\.dashboard-header__search-label,\s*\n\s*\.dashboard-header__kbd\s*\{\s*display: none;/);
    expect(css).toMatch(/\.dashboard-header__menu-button\s*\{\s*display: none;\s*\}/);
  });

  it("keeps a reduced-transparency fallback for both shell surfaces", () => {
    const css = read("src/app/globals.css");
    const fallback = css.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

    expect(fallback).toContain(".dashboard-header");
    expect(fallback).toContain(".dashboard-sidebar");
    expect(fallback).toContain("background-color: var(--surface);");
    expect(fallback).toContain("backdrop-filter: none;");
  });

  it("always offers page search and uses lucide icons for topbar actions", () => {
    const header = read("src/shared/components/Header.js");
    const registry = read("src/shared/constants/dashboardNav.js");

    expect(header).toContain("buildDashboardSearchIndex()");
    expect(header).toContain("<Bell size={18}");
    expect(header).toContain("<Search size={16}");
    expect(header).toContain('from "lucide-react"');
    expect(header).not.toContain('name="notifications"');
    expect(registry).toContain("export function buildDashboardSearchIndex");
    expect(registry).toContain('href: "/dashboard/usage"');
    expect(header).toContain('className="dashboard-palette"');
    expect(header).toContain('className="dashboard-palette__backdrop"');
    expect(header).toContain("createPortal(");
  });

  it("keeps the header free of backdrop filters on its containing block", () => {
    const css = read("src/app/globals.css");
    for (const [, declarations] of css.matchAll(/\.dashboard-header\s*\{([^}]+)\}/g)) {
      expect(declarations).not.toContain("backdrop-filter");
    }
  });

  it("hides the scrollbar on the dashboard route and in the page-search palette", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const css = read("src/app/globals.css");

    expect(layout).toContain('const hidesPageScrollbar = pathname === "/dashboard";');
    expect(layout).toContain('${hidesPageScrollbar ? "no-scrollbar" : ""}');
    expect(css).toMatch(/\.dashboard-palette__results \{[^}]*scrollbar-width: none;/);
    expect(css).toMatch(/\.dashboard-palette__results::-webkit-scrollbar \{\s*display: none;/);
  });

  it("hides only the sidebar scrollbar while preserving navigation scrolling", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    const css = read("src/app/globals.css");

    expect(sidebar).toContain('className="dashboard-sidebar__nav flex-1 min-h-0 overflow-y-auto no-scrollbar"');
    expect(css).toMatch(/\.no-scrollbar,[\s\S]*?scrollbar-width: none !important;/);
    expect(css).toMatch(/\.no-scrollbar::-webkit-scrollbar,[\s\S]*?display: none !important;/);
  });
});

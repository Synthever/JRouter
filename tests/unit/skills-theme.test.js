import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const skillsPath = "src/app/(dashboard)/dashboard/skills";

describe("skills dashboard theme", () => {
  it("renders as a shared-surface page instead of a self-constrained column", () => {
    const source = read(`${skillsPath}/page.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source).toContain("ui-card ${styles.section}");
    expect(source).toContain('className="ui-eyebrow');
    // The page used to narrow itself and stack a Card per skill.
    expect(source).not.toContain("max-w-4xl");
    expect(source).not.toContain("<Card");
    const css = read(`${skillsPath}/skills.module.css`);
    // Compose the approved Usage module rather than duplicating the design system.
    expect(css).toMatch(/\.page\s*\{\s*composes: page from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/\.section\s*\{\s*composes: section from "\.\.\/usage\/usage\.module\.css";/);
    expect(css).toMatch(/composes: formScope from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/components\/DashboardControls\.module\.css";/);
    expect(css).not.toContain("backdrop-filter");
  });

  it("keeps every skill in one section with hairline separators, not per-row cards", () => {
    const css = read(`${skillsPath}/skills.module.css`);
    expect(css).toMatch(/\.row\s*\{[^}]*border-bottom: 1px solid var\(--line\);/);
    expect(css).toMatch(/\.row:last-child\s*\{[^}]*border-bottom: 0;/);
    // Rows must not reintroduce per-row radius or shadow.
    expect(css).not.toMatch(/\.row\s*\{[^}]*box-shadow/);
    expect(css).not.toMatch(/\.row\s*\{[^}]*border-radius:\s*var\(--r[23]\)/);
    const source = read(`${skillsPath}/page.js`);
    expect(source).toContain("<ul className={styles.rows}>");
    expect(source).toContain("<li className={styles.row}>");
  });

  it("uses the shared badge, button and token system", () => {
    const source = read(`${skillsPath}/page.js`);
    expect(source).toContain("StatusBadge");
    expect(source).toContain('variant="secondary"');
    expect(source).toContain("useCopyToClipboard");
    expect(source).not.toMatch(/bg-primary|text-primary|border-brand|text-white|bg-surface |border-border-subtle/);
    const css = read(`${skillsPath}/skills.module.css`);
    expect(css).toContain("var(--surface-inset)");
    expect(css).toContain("var(--font-mono)");
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/@media \(max-width: 639px\)/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("preserves every skill, endpoint and link target", () => {
    const source = read(`${skillsPath}/page.js`);
    for (const preserved of [
      "getSkillRawUrl",
      "getSkillBlobUrl",
      "SKILLS_REPO_URL",
      "SKILLS.map",
      "Paste this to your AI:",
      "Read this skill and use it:",
      "More on GitHub",
      "View on GitHub",
    ]) {
      expect(source).toContain(preserved);
    }
    // Skill data itself is untouched: 8 skills, one entry skill, 7 endpoints.
    const data = read("src/shared/constants/skills.js");
    expect((data.match(/^\s{2}\{\s*$/gm) || []).length).toBe(8);
    expect(data).toContain("isEntry: true");
    for (const endpoint of [
      "/v1/chat/completions", "/v1/images/generations", "/v1/audio/speech",
      "/v1/audio/transcriptions", "/v1/embeddings", "/v1/search", "/v1/web/fetch",
    ]) {
      expect(data).toContain(endpoint);
    }
  });

  it("resolves every skill icon name to a real Icon entry", () => {
    const iconSrc = read("src/shared/components/Icon.js");
    const mapBlock = iconSrc.slice(iconSrc.indexOf("const ICON_MAP"), iconSrc.indexOf("export { Icon, ICON_MAP }"));
    const known = new Set([...mapBlock.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]));
    const resolves = (n) => known.has(n) || known.has(n.replace(/-/g, "_")) || known.has(n.replace(/_/g, "-"));

    const data = read("src/shared/constants/skills.js");
    const iconNames = [...data.matchAll(/icon:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(iconNames).toHaveLength(8);
    expect(iconNames.filter((n) => !resolves(n))).toEqual([]);

    // Icon silently falls back to a question mark, so guard the page's own literal names too.
    const source = read(`${skillsPath}/page.js`);
    const literals = [...source.matchAll(/<Icon\b[^>]*>\s*([A-Za-z_][\w-]*)\s*<\/Icon>/g)].map((m) => m[1].trim());
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter((n) => !resolves(n))).toEqual([]);
  });

  it("keeps the skills route on the shared grid background", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const expression = layout.match(/\$\{([^{}]*"dashboard-grid-bg"[^{}]*)\}/)?.[1];
    expect(expression).toBeDefined();
    const backgroundClass = new Function("pathname", `return (${expression});`);
    expect(backgroundClass("/dashboard/skills")).toBe("dashboard-grid-bg");
    expect(backgroundClass("/dashboard/skills/detail")).toBe("");
  });
});

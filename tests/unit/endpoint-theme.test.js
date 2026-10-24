// Contract for the Endpoint & key surface. The page follows the Claude reference
// layout (docs/templates/endpoint/main.html): page intro, three summary cards,
// a wide API-keys column and a sticky endpoint rail. These assertions lock the
// structure and the behaviours that must survive the redesign.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const endpointPath = "src/app/(dashboard)/dashboard/endpoint";
const pageSource = () => read(`${endpointPath}/EndpointPageClient.js`);
const pageCss = () => read(`${endpointPath}/endpoint.module.css`);

describe("endpoint dashboard surface", () => {
  it("shares the overview background with endpoint, providers, combos, and usage only", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const pages = new Function(`return ${layout.match(/const GRID_BACKGROUND_PAGES = (\[[\s\S]*?\]);/)[1]};`)();
    const predicate = layout.match(/const hasGridBackground = (.+);/)?.[1];
    expect(predicate).toBeDefined();
    const backgroundClass = new Function(
      "pathname",
      "GRID_BACKGROUND_PAGES",
      `return (${predicate}) ? "dashboard-grid-bg" : "";`
    );

    for (const pathname of ["/dashboard", "/dashboard/endpoint", "/dashboard/providers", "/dashboard/combos", "/dashboard/usage"]) {
      expect(backgroundClass(pathname, pages)).toBe("dashboard-grid-bg");
    }
    for (const pathname of ["/dashboard/providers/kiro", "/dashboard/combos/detail", "/dashboard/usage/detail", "/dashboard/basic-chat"]) {
      expect(backgroundClass(pathname, pages)).toBe("");
    }
  });

  it("renders the reference layout: intro, three summary cards, keys column and endpoint rail", () => {
    const source = pageSource();
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source).toContain("<h1 className={styles.title}>Endpoint &amp; key</h1>");
    expect(source.match(/<article className=\{`\$\{styles\.stat\}/g)).toHaveLength(3);
    expect(source).toContain("<div className={styles.layout}>");
    expect(source).toContain("${styles.keysPanel}");
    expect(source).toContain("${styles.endpointRail}");
    expect(source).not.toContain("ui-card");
    expect(source).not.toContain("styles.header");
  });

  it("derives the summary cards from the real key list", () => {
    const source = pageSource();
    expect(source).toContain("const activeKeyCount = keys.filter((key) => key.isActive !== false && !key.isExpired).length;");
    expect(source).toContain("const limitedKeyCount = keys.filter((key) => (key.allowedModels?.length || 0) + (key.blockedModels?.length || 0) > 0).length;");
    expect(source).toContain("const lastUsedKey = keys");
    expect(source).toContain('{lastUsedKey ? `${lastUsedKey.name} sent the latest request` : "No requests recorded yet"}');
    expect(source).toContain('{requireApiKey ? "On" : "Off"}');
  });

  it("keeps the require-key switch, name filter and copyable endpoints", () => {
    const source = pageSource();
    expect(source).toContain('aria-label="Require API key"');
    expect(source).toContain('placeholder="Filter keys by name"');
    expect(source).toContain("${matchingKeys.length} of ${keys.length} keys");
    expect(source).toContain('aria-label="Copy curl command"');
    expect(source).toContain('onClick={() => copy(curlSnippet, "curl")}');
  });

  it("renders server-masked keys and fetches credentials only for Copy", () => {
    const source = pageSource();
    expect(source).toContain("/api/keys?view=settings");
    expect(source).toContain("{key.keyPrefix}");
    expect(source).toContain("/api/keys/${keyId}/secret");
    expect(source).not.toContain("visibleKeys");
  });

  it("matches the reference scale and two-column layout in CSS", () => {
    const css = pageCss();
    expect(css).toMatch(/\.title\s*\{[^}]*font-size: clamp\(28px, 3\.4vw, 40px\);/s);
    expect(css).toMatch(/\.stats\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.stat\s*\{[^}]*min-height: 168px;[^}]*border-radius: 24px;/s);
    expect(css).toMatch(/\.statValue\s*\{[^}]*font-size: clamp\(40px, 4\.4vw, 56px\);/s);
    expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 400px;[^}]*grid-template-areas: "keys endpoint";/s);
    expect(css).toMatch(/\.panel\s*\{[^}]*padding: 28px;[^}]*border-radius: 24px;/s);
    expect(css).toMatch(/\.endpointRail\s*\{[^}]*position: sticky;[^}]*top: 24px;/s);
    expect(css).not.toMatch(/backdrop-filter|#131315|linear-gradient/);
  });

  it("stacks to one column with the endpoint rail first when the surface narrows", () => {
    const css = pageCss();
    const wide = css.slice(css.indexOf("@container (max-width: 1099px)"));
    expect(wide).toMatch(/\.layout\s*\{[^}]*grid-template-areas:\s*"endpoint"\s*"keys";/s);
    expect(wide).toMatch(/\.endpointRail\s*\{[^}]*position: static;/s);
    expect(wide).toMatch(/\.stats\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(css).toContain("container-type: inline-size;");
  });

  it("keeps key rows on a fixed identity grid with mobile touch targets", () => {
    const css = pageCss();
    expect(css).toMatch(/\.keyRow\s*\{[^}]*grid-template-columns: 44px minmax\(0, 1fr\) auto;/s);
    expect(css).toMatch(/\.keyRow\s*\{[^}]*padding: 20px 0;/s);
    const mobile = css.slice(css.indexOf("@container (max-width: 640px)"));
    expect(mobile).toMatch(/\.keyRow\s*\{[^}]*grid-template-columns: 44px minmax\(0, 1fr\);/s);
    expect(mobile).toMatch(/\.keyActions\s*\{[^}]*grid-column: 1 \/ -1;/s);
    expect(mobile).toMatch(/min-height: 44px;/);
    expect(mobile).toMatch(/\.filter\s*\{[^}]*width: 100%;/s);
  });

  it("uses theme tokens for endpoint fields and keeps long values readable", () => {
    const css = pageCss();
    const row = read(`${endpointPath}/components/EndpointRow.js`);
    expect(row).toContain('aria-label={`${label} endpoint`}');
    expect(row).toContain('aria-label={`Copy ${label} endpoint`}');
    expect(row).toContain("<output");
    expect(row).toContain("styles.endpointValue");
    expect(css).toMatch(/\.endpointValue\s*\{[^}]*color: var\(--text\);[^}]*white-space: nowrap;[^}]*overflow-x: auto;/s);
    expect(css).toMatch(/\.urlBox\s*\{[^}]*border-radius: 12px;[^}]*background: var\(--surface-2\);/s);
    expect(css).toMatch(/\.keyValue\s*\{[^}]*overflow-wrap: anywhere;/s);
  });

  it("keeps primary actions and switches neutral in both themes", () => {
    const source = pageSource();
    const css = pageCss();
    expect(source).not.toMatch(/text-primary|bg-primary|from-indigo|to-purple|bg-input/);
    expect(source).toContain('variant="contrast"');
    const button = read("src/shared/components/Button.js");
    expect(button).toMatch(/contrast: "bg-\[var\(--text\)\].*text-\[var\(--bg\)\]/);
    expect(css).toMatch(/\[role="switch"\]\[aria-checked="true"\][\s\S]*background: var\(--text\);/);
    expect(css).toMatch(/\[role="switch"\]\[aria-checked="true"\] > span\s*\{[^}]*background: var\(--bg\);/s);
    expect(css).toContain(":focus-visible");
  });

  it("keeps the API key delete button transparent, including on hover", () => {
    const css = pageCss();
    expect(css).toMatch(/\.keyRow \.dangerButton,\s*\.keyRow \.dangerButton:hover:not\(:disabled\)\s*\{[^}]*background: transparent;/);
    expect(css).toMatch(/\.dangerButton\s*\{[^}]*color: var\(--danger\);/);
  });

  it("uses semantic colors for security warnings and status alerts", () => {
    const warning = read(`${endpointPath}/components/SecurityWarning.js`);
    const status = read(`${endpointPath}/components/StatusAlert.js`);
    expect(warning).toContain("styles.warning");
    expect(status).toContain("styles.success");
    expect(status).toContain("styles.error");
    expect(warning + status).not.toMatch(/amber-\d|green-\d|yellow-\d|red-\d/);
    const css = pageCss();
    expect(css).toMatch(/\.warning\s*\{[^}]*background: var\(--brand-peach\);/s);
    expect(css).toMatch(/\.error\s*\{[^}]*var\(--danger\) 6%, var\(--surface\)/);
    expect(css).toMatch(/\.tooltip\s*\{[^}]*bottom: calc\(100% \+ 8px\);/);
  });
});

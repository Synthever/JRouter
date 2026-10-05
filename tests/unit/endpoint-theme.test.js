import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const endpointPath = "src/app/(dashboard)/dashboard/endpoint";

describe("endpoint dashboard theme", () => {
  it("shares the overview background with endpoint, providers, and combos only", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const expression = layout.match(/\$\{([^{}]*"dashboard-grid-bg"[^{}]*)\}/)?.[1];
    expect(expression).toBeDefined();
    const backgroundClass = new Function("pathname", `return (${expression});`);

    for (const pathname of ["/dashboard", "/dashboard/endpoint", "/dashboard/providers", "/dashboard/combos"]) {
      expect(backgroundClass(pathname)).toBe("dashboard-grid-bg");
    }
    for (const pathname of ["/dashboard/providers/kiro", "/dashboard/combos/detail", "/dashboard/usage", "/dashboard/basic-chat"]) {
      expect(backgroundClass(pathname)).toBe("");
    }
  });

  it("uses scoped overview-style panels and opaque reduced-transparency fallback", () => {
    const source = read(`${endpointPath}/EndpointPageClient.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source.match(/<Card className=\{`ui-card \$\{styles.panel\}`\}/g)).toHaveLength(2);

    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).not.toMatch(/backdrop-filter|#131315|linear-gradient/);
    const shared = read("src/app/globals.css");
    expect(shared).toMatch(/\.dashboard-surface \.ui-card,\s*\.dashboard-overview :is\(\.stat-card, \.ui-card\)\s*\{/);
    expect(shared).toContain("backdrop-filter: blur(18px) saturate(130%);");
    expect(shared).toContain("backdrop-filter: blur(24px);");
    expect(shared).toMatch(/prefers-reduced-transparency: reduce[\s\S]*\.dashboard-surface \.ui-card,[\s\S]*background-color: var\(--surface\);/);
  });

  it("keeps primary actions and switches neutral in both themes", () => {
    const source = read(`${endpointPath}/EndpointPageClient.js`);
    expect(source).not.toMatch(/text-primary|bg-primary|from-indigo|to-purple|bg-input/);
    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(source).toContain('variant="contrast"');
    expect(source).not.toContain("styles.primary");
    const button = read("src/shared/components/Button.js");
    expect(button).toMatch(/contrast: "bg-\[var\(--text\)\].*text-\[var\(--bg\)\]/);
    expect(css).toMatch(/\[role="switch"\]\[aria-checked="true"\][\s\S]*background: var\(--text\);/);
    expect(css).toContain(":focus-visible");
  });

  it("allows long endpoint URLs and keys to shrink or wrap on mobile", () => {
    const row = read(`${endpointPath}/components/EndpointRow.js`);
    expect(row).toContain('aria-label={`${label} endpoint`}');
    expect(row).toContain('aria-label={`Copy ${label} endpoint`}');
    expect(row).toContain("<output");
    expect(row).toContain("styles.endpointValue");
    const cssValue = read(`${endpointPath}/endpoint.module.css`);
    expect(cssValue).toMatch(/\.endpointValue\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(cssValue).toMatch(/\.endpointValue\s*\{[^}]*white-space: pre-wrap;/);
    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).toMatch(/\.field\s*\{[^}]*min-width: 0;/);
    expect(css).toMatch(/\.keyValue\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
  });

  it("uses theme tokens for endpoint fields instead of white-on-white overrides", () => {
    const css = read(`${endpointPath}/endpoint.module.css`);
    const field = css.match(/\.endpointValue\s*\{([^}]*)\}/)?.[1];
    expect(field).toContain("color: var(--text);");
    expect(field).toContain("border: 1px solid var(--line-2);");
    expect(field).toContain("background: var(--surface-2);");
    expect(css).toMatch(/\.endpointValue:focus\s*\{[^}]*border-color: var\(--text-2\);/);
  });

  it("gives key credentials a full-width mobile row below name and state controls", () => {
    const source = read(`${endpointPath}/EndpointPageClient.js`);
    expect(source).toContain("className={styles.keyDetails}");
    expect(source).toContain("className={styles.keyCredential}");
    expect(source).toContain("className={styles.keyActions}");
    const css = read(`${endpointPath}/endpoint.module.css`);
    const mobile = css.slice(css.indexOf("@media (max-width: 639px)"));
    expect(mobile).toMatch(/\.keyRow\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(mobile).toMatch(/\.keyDetails\s*\{[^}]*display: contents;/);
    expect(mobile).toMatch(/\.keyCredential\s*\{[^}]*grid-column: 1 \/ -1;/);
    expect(mobile).toMatch(/\.keyActions\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
  });

  it("keeps masked keys compact without changing revealed or copied credentials", () => {
    const source = read(`${endpointPath}/EndpointPageClient.js`);
    const maskSource = source.match(/const maskKey = \(fullKey\) => \{([\s\S]*?)\n  \};/)?.[1];
    expect(maskSource).toBeDefined();
    const maskKey = new Function("fullKey", maskSource);
    const key = "sk-" + "a".repeat(64) + "b95e";
    expect(maskKey(key)).toBe(key.slice(0, 6) + "•".repeat(6) + "b95e");
    expect(maskKey("short")).toBe("short");
    expect(maskKey(null)).toBe("");
    expect(source).toContain("visibleKeys.has(key.id) ? key.key : maskKey(key.key)");
    expect(source).toContain("copy(key.key, key.id)");
  });

  it("keeps the API key delete button transparent, including on hover", () => {
    const css = read(`${endpointPath}/endpoint.module.css`);
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
    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).toMatch(/\.error\s*\{[^}]*var\(--danger\) 3%, var\(--surface\)/);
    expect(css).toMatch(/\.tooltip\s*\{[^}]*bottom: calc\(100% \+ 8px\);/);
  });
});

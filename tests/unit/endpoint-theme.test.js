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
    expect(source).toContain("styles.page");
    expect(source.match(/<Card className={styles.panel}/g)).toHaveLength(2);

    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).toContain("backdrop-filter: blur(18px) saturate(130%);");
    expect(css).toContain("backdrop-filter: blur(24px);");
    expect(css).toContain("background-color: rgba(0, 0, 0, 0.3);");
    expect(css).toMatch(/prefers-reduced-transparency: reduce[\s\S]*background: var\(--surface\);/);
  });

  it("keeps primary actions and switches neutral in both themes", () => {
    const source = read(`${endpointPath}/EndpointPageClient.js`);
    expect(source).not.toMatch(/text-primary|bg-primary|from-indigo|to-purple|bg-input/);
    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).toMatch(/\.primary\s*\{[^}]*background: var\(--text\);[^}]*color: var\(--bg\);/);
    expect(css).toMatch(/\[role="switch"\]\[aria-checked="true"\][\s\S]*background: var\(--text\);/);
    expect(css).toContain(":focus-visible");
  });

  it("allows long endpoint URLs and keys to shrink or wrap on mobile", () => {
    const row = read(`${endpointPath}/components/EndpointRow.js`);
    expect(row).toContain('aria-label={`${label} endpoint`}');
    expect(row).toContain('aria-label={`Copy ${label} endpoint`}');
    expect(row).toContain("inputClassName=\"font-mono\"");
    const css = read(`${endpointPath}/endpoint.module.css`);
    expect(css).toMatch(/\.field\s*\{[^}]*min-width: 0;/);
    expect(css).toMatch(/\.keyValue\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
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
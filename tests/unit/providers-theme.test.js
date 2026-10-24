import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const providersPath = "src/app/(dashboard)/dashboard/providers";

describe("providers dashboard layout contract", () => {
  it("renders a summary strip, sticky chips and four card-grid panels", () => {
    const source = read(`${providersPath}/page.js`);
    const stats = read(`${providersPath}/components/ProviderStats.js`);
    expect(source).toContain("dashboard-surface ${styles.page}");
    expect(source).toContain("computeProviderSummary(");
    expect(source).toContain("<ProviderStats");
    expect(stats).toContain('aria-label="Provider summary"');
    expect(source).toContain('aria-label="Jump to a provider section"');
    expect(
      source.match(/className=\{styles\.section\} aria-labelledby=/g),
    ).toHaveLength(4);
    expect(source.match(/<ul className=\{styles\.grid\}>/g)).toHaveLength(4);
    expect(source).toContain('id="s-custom"');
    expect(source).toContain('id="s-oauth"');
    expect(source).toContain('id="s-free"');
    expect(source).toContain('id="s-apikey"');
    expect(source).not.toContain("<select");
  });

  it("styles the summary strip and provider card grid like the reference", () => {
    const css = read(`${providersPath}/providers.module.css`);
    const statsCss = read(`${providersPath}/components/ProviderStats.module.css`);
    expect(css).not.toContain("backdrop-filter");
    expect(css).toMatch(
      /\.grid\s*\{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(250px, 1fr\)\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 639px\)\s*\{[\s\S]*?\.grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // The strip's grid now only hosts the loading skeletons.
    expect(css).toMatch(/\.stats\s*\{[^}]*grid-template-columns: repeat\(3,/);
    expect(statsCss).toMatch(/\[data-widget-id="providersInUse"\]\s*\{[^}]*--surface: var\(--brand-lavender\);/);
    expect(statsCss).toMatch(/\[data-widget-id="mostConnections"\]\s*\{[^}]*--surface: var\(--brand-ochre\);/);
    expect(statsCss).toMatch(/\[data-widget-id="freeToTry"\]\s*\{[^}]*--surface: var\(--brand-teal\);/);
    expect(statsCss).toMatch(/\.value\s*\{[^}]*font-size: clamp\(40px, 4\.4vw, 56px\);/s);
    expect(statsCss).toMatch(/\.valueName\s*\{[^}]*font-size: clamp\(24px, 2\.4vw, 34px\);/s);
    expect(css).toMatch(/\.cardLive\s*\{[^}]*background: var\(--surface-card\);/);
    expect(css).toMatch(/\.cardLink\s*\{[^}]*position: absolute;[^}]*inset: 0;/);
    expect(css).toMatch(/\.tabs\s*\{[^}]*border-radius: var\(--r-full\);/);
    expect(css).toMatch(
      /\.tab\[aria-pressed="true"\]\s*\{[^}]*background: var\(--canvas\);/,
    );
  });

  it("keeps the provider summary cards adjustable like the dashboard KPIs", () => {
    const stats = read(`${providersPath}/components/ProviderStats.js`);
    expect(stats).toContain('from "@/shared/components/ui/bento-grid"');
    expect(stats).toMatch(/id: "providersInUse", title: "Providers in use", defaultSpan: 2/);
    expect(stats).toMatch(/id: "mostConnections", title: "Most connections", defaultSpan: 2/);
    expect(stats).toMatch(/id: "freeToTry", title: "Free to try", defaultSpan: 2/);
    expect(stats).toContain('const LAYOUT_STORAGE_KEY = "jrouter.providers.statsLayout.v1";');
    expect(stats).toContain("normalizeLayout(JSON.parse(saved), ITEMS)");
    expect(stats).toContain("rowHeight={168}");
    expect(stats).toContain("narrowColumns={1}");
    expect(stats).toContain("onLayoutChange={setLayout}");
    expect(stats).toContain("onLayoutCommit={saveLayout}");
    expect(stats).toContain('aria-label="Reset layout"');
    expect(stats).toContain("Drag the grip to move a card. Drag its corner to resize.");
  });

  it("keeps semantic status, filter and toggle controls", () => {
    const source = read(`${providersPath}/page.js`);
    const css = read(`${providersPath}/providers.module.css`);
    expect(source).not.toMatch(/!bg-white|border-primary|bg-primary|text-primary/);
    expect(source).toContain("<StatusBadge");
    expect(source).toContain("<Toggle");
    expect(source).toContain("aria-pressed={statusFilter === option.value}");
    expect(source).toContain(
      'aria-label={`${allDisabled ? "Enable" : "Disable"} ${provider.name}`}',
    );
    expect(source).toContain("aria-label={`Open ${provider.name}`}");
    expect(source).toContain("<ProviderIcon");
    expect(css).toMatch(/\.success\s*\{[^}]*color: var\(--pos\);/);
    expect(css).toMatch(/\.error\s*\{[^}]*color: var\(--danger\);/);
    expect(css).toContain('[role="switch"][aria-checked="true"]');
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":focus-within");
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*min-height: 44px;/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps the shared styles the provider detail route composes", () => {
    const css = read(`${providersPath}/providers.module.css`);
    [
      ".page",
      ".panel",
      ".dialog",
      ".description",
      ".fieldGroup",
      ".settingsGroup",
      ".testRow",
      ".modelRow",
      ".detailTitle",
      ".detailLink",
      ".customHeaderRow",
      ".iconButton",
      ".errorBadge",
      ".success",
      ".error",
    ].forEach((selector) => {
      expect(css).toMatch(new RegExp(`\\${selector}\\b`));
    });
    const detail = read(`${providersPath}/[id]/page.js`);
    expect(detail).toContain("styles.panel");
    expect(detail).toContain("styles.detailTitle");
  });
});


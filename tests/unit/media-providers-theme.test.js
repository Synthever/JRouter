// Contract for the media-providers listing surfaces (phase 1): page hero, one
// 24/28 panel per kind holding a provider card grid, and combo rows above it.
// These assertions lock the anatomy and the data paths that must survive.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const base = "src/app/(dashboard)/dashboard/media-providers";
const kindPage = () => read(`${base}/[kind]/page.js`);
const webPage = () => read(`${base}/web/page.js`);
const card = () => read(`${base}/components/MediaProviderCard.js`);
const comboList = () => read(`${base}/components/ProviderComboList.js`);
const toggleHook = () => read(`${base}/components/useProviderToggle.js`);
const css = () => read(`${base}/media-providers.module.css`);

function moduleClasses() {
  return new Set([...css().matchAll(/^\.([A-Za-z0-9_-]+)/gm)].map((m) => m[1]));
}

describe("media providers listing surfaces", () => {
  it("renders each listing page as a shared-surface hero plus one panel", () => {
    const kind = kindPage();
    expect(kind).toContain("dashboard-surface ${styles.page}");
    expect(kind).toContain("<h1 className={styles.title}>{kindConfig.label}</h1>");
    expect(kind).toContain("styles.intro");
    expect(kind).toContain("styles.sub");
    expect(kind).toContain("kindConfig.endpoint.path");
    expect(kind).toContain("styles.section");
    expect(kind).toContain('id="media-providers-heading"');
    // The old shared Card shell and its colour utilities are gone.
    expect(kind).not.toMatch(/<Card\b/);
    expect(kind).not.toMatch(/text-text-muted|border-border|bg-primary|padding="xs"/);

    const web = webPage();
    expect(web).toContain("dashboard-surface ${styles.page}");
    expect(web).toContain("<h1 className={styles.title}>Web Search &amp; Fetch</h1>");
    expect(web).toContain('title="Web Search"');
    expect(web).toContain('title="Web Fetch"');
    expect(web).not.toMatch(/<Card\b/);
    expect(web).not.toMatch(/text-text-muted|border-border|bg-primary|padding="xs"/);
  });

  it("keeps one shared provider card for both listing pages", () => {
    for (const page of [kindPage(), webPage()]) {
      expect(page).toContain('from "../components/MediaProviderCard"');
      expect(page).toContain("<MediaProviderCard");
    }
    const src = card();
    expect(src).toContain("styles.cardLink");
    expect(src).toContain("styles.cardLive");
    expect(src).toContain("styles.cardOff");
    expect(src).toContain("styles.providerAddress");
    expect(src).toContain("onToggle?.(provider.id, allDisabled)");
    for (const status of ["Ready", "Disabled", "No connections", "Connected", "Error", "Added"]) {
      expect(src).toContain(status);
    }
  });

  it("keeps combo rows above the grid with the detail link", () => {
    const list = comboList();
    expect(list).toContain("href={`/dashboard/media-providers/combo/${combo.id}`}");
    expect(list).toContain("combo.models.slice(0, 6)");
    expect(list).toContain("+{combo.models.length - 6}");
    expect(kindPage()).toContain("<ProviderComboList combos={kindCombos} />");
    expect(webPage()).toContain("<ProviderComboList combos={combos} />");
  });

  it("persists provider toggles through the shared hook", () => {
    const hook = toggleHook();
    expect(hook).toContain("fetch(`/api/providers/${c.id}`");
    expect(hook).toContain('method: "PUT"');
    expect(hook).toContain("JSON.stringify({ isActive: newActive })");
    expect(hook).toContain("Promise.allSettled");
    expect(kindPage()).toContain("useProviderToggle(connections, setConnections)");
    expect(webPage()).toContain("useProviderToggle(connections, setConnections)");
  });

  it("preserves the kind page data paths and modals", () => {
    const kind = kindPage();
    expect(kind).toContain('if (kind === "webSearch" || kind === "webFetch")');
    expect(kind).toContain('router.replace("/dashboard/media-providers/web")');
    expect(kind).toContain('fetch("/api/providers", { cache: "no-store" })');
    expect(kind).toContain('fetch("/api/provider-nodes", { cache: "no-store" })');
    expect(kind).toContain('type === "custom-embedding"');
    expect(kind).toContain("<AddCustomEmbeddingModal");
    expect(kind).toContain("handleCreateCombo");
    expect(kind).toContain('body: JSON.stringify({ name, models: [], kind })');
    expect(kind).toContain("if (!kindConfig) return notFound();");

    const web = webPage();
    expect(web).toContain('getProvidersByKind("webSearch")');
    expect(web).toContain('getProvidersByKind("webFetch")');
    expect(web).toContain('c.kind === "webSearch"');
    expect(web).toContain('c.kind === "webFetch"');
    expect(web).toContain("handleCreateCombo(\"webSearch\")");
    expect(web).toContain("handleCreateCombo(\"webFetch\")");
  });

  it("styles the shared module like the sibling collection surfaces", () => {
    const sheet = css();
    expect(sheet).toMatch(/\.page\s*\{\s*composes: page from "\.\.\/usage\/usage\.module\.css";/);
    expect(sheet).toMatch(/\.section\s*\{\s*composes: section from "\.\.\/usage\/usage\.module\.css";/);
    expect(sheet).toMatch(/\.title\s*\{[^}]*font-size: clamp\(28px, 3\.4vw, 40px\);/s);
    const grid = sheet.match(/\.grid \{([^}]+)\}/)?.[1] || "";
    expect(grid).toContain("repeat(auto-fill, minmax(min(290px, 100%), 1fr))");
    const cardRule = sheet.match(/\n\.card \{([^}]+)\}/)?.[1] || "";
    expect(cardRule).toContain("border-radius: var(--r3);");
    expect(cardRule).toContain("padding: 16px;");
    expect(sheet).toMatch(/\.badge\s*\{[^}]*height: 24px;[^}]*font-size: 12px;[^}]*font-weight: 600;/s);
    expect(sheet).toMatch(/\.empty\s*\{[^}]*border: 1px dashed var\(--line-2\);/s);
    expect(sheet).toContain('.page [role="switch"][aria-checked="true"]');
    expect(sheet).toContain("prefers-reduced-motion: reduce");
    expect(sheet).not.toMatch(/backdrop-filter|#131315|linear-gradient/);
  });

  it("resolves every styles.* class used by the listing pages", () => {
    const defined = moduleClasses();
    const consumers = [
      `${base}/[kind]/page.js`,
      `${base}/web/page.js`,
      `${base}/components/MediaProviderCard.js`,
      `${base}/components/ProviderComboList.js`,
    ];
    const missing = [];
    for (const file of consumers) {
      const used = new Set([...read(file).matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
      for (const name of used) {
        if (!defined.has(name)) missing.push(`${file}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

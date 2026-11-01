// Contract for the media-providers listing surfaces (phase 1): page hero, one
// 24/28 panel per kind holding a provider card grid, and combo rows above it.
// These assertions lock the anatomy and the data paths that must survive.
import { existsSync, readFileSync } from "node:fs";
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

// Phase 2: the provider detail surface — hero, panels, rows, model chips and
// the per-kind example cards all live in the same module as the listing.
const detailBase = `${base}/[kind]/[id]`;
const detailPage = () => read(`${detailBase}/page.js`);
const configPanel = () => read(`${detailBase}/components/ProviderConfigPanel.js`);
const connectionsCard = () => read("src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js");
const modelsCard = () => read("src/app/(dashboard)/dashboard/providers/components/ModelsCard.js");
const exampleCards = () => [
  `${detailBase}/components/EmbeddingExampleCard.js`,
  `${detailBase}/components/GenericExampleCard.js`,
  `${detailBase}/components/TtsExampleCard.js`,
  `${detailBase}/components/SttExampleCard.js`,
];

describe("media provider detail surface", () => {
  it("renders the detail page as hero → panels → examples in the shared surface", () => {
    const page = detailPage();
    expect(page).toContain("dashboard-surface ${styles.page}");
    expect(page).toContain("styles.backLink");
    expect(page).toContain("<h1 className={styles.detailTitle}>");
    expect(page).toContain("styles.detailLogo");
    expect(page).toContain("styles.detailBadges");
    expect(page).toContain("styles.detailSub");
    expect(page).toContain("styles.badgeCurrent");
    expect(page).toContain("styles.noticeWarn");
    expect(page).toContain("styles.noticeInfo");
    expect(page).toContain("styles.detailActions");
    expect(page).toContain("<ConnectionsCard");
    expect(page).toContain("<ModelsCard");
    expect(page).toContain("<ProviderConfigPanel");
    expect(page).toContain("<EmbeddingExampleCard");
    expect(page).toContain("<TtsExampleCard");
    expect(page).toContain("<GenericExampleCard");
    expect(page).not.toMatch(/<Card\b/);
    expect(page).not.toMatch(/text-text-muted|border-border|bg-primary|padding="xs"/);
  });

  it("keeps the data paths and modals of the detail page", () => {
    const page = detailPage();
    expect(page).toContain('fetch("/api/provider-nodes", { cache: "no-store" })');
    expect(page).toContain('fetch(`/api/provider-nodes/${id}`, { method: "DELETE" })');
    expect(page).toContain("isCustomEmbeddingProvider(id)");
    expect(page).toContain("<NoAuthProxyCard providerId={id} />");
    expect(page).toContain("<AddCustomEmbeddingModal");
    expect(page).toContain("if (!kindConfig) return notFound();");
    expect(page).toContain("KIND_EXAMPLE_CONFIG[kind]");
    expect(page).toContain('kind !== "tts" && kind !== "webSearch" && kind !== "webFetch"');
  });

  it("moves the connections and models cards onto theme panels", () => {
    for (const src of [connectionsCard(), modelsCard()]) {
      expect(src).toContain("styles.panel");
      expect(src).toContain("styles.panelHead");
      expect(src).toContain("styles.panelTitle");
      expect(src).toContain("styles.panelDesc");
      expect(src).not.toMatch(/<Card\b/);
      expect(src).not.toMatch(/text-text-muted|border-border|bg-primary|bg-sidebar/);
    }
    const connections = connectionsCard();
    expect(connections).toContain("styles.rowItem");
    expect(connections).toContain("styles.rowActions");
    expect(connections).toContain("styles.iconBtn");
    expect(connections).toContain("styles.badgeOn");
    expect(connections).toContain('fetch("/api/providers", { cache: "no-store" })');
    expect(connections).toContain("applyDemotionOverlay(connections)");
    expect(connections).toContain("swapWithId");

    const models = modelsCard();
    expect(models).toContain("styles.modelChip");
    expect(models).toContain("styles.modelGrid");
    expect(models).toContain('fetch("/api/models/test"');
    expect(models).toContain("getModelsByProviderId(providerId)");
  });

  it("renders provider config as label/value rows", () => {
    const panel = configPanel();
    expect(panel).toContain("styles.kvGrid");
    expect(panel).toContain("styles.kvRow");
    expect(panel).toContain("styles.kvLabel");
    expect(panel).toContain("styles.kvValue");
    expect(panel).toContain("const FIELD_SCHEMA");
    expect(panel).not.toMatch(/<Card\b|text-text-muted|border-border/);
  });

  it("drops the old shared ProviderInfoCard", () => {
    expect(existsSync(new URL("../../src/shared/components/ProviderInfoCard.js", import.meta.url))).toBe(false);
    expect(read("src/shared/components/index.js")).not.toContain("ProviderInfoCard");
  });

  it("styles every example card with the shared code/field classes", () => {
    for (const file of exampleCards()) {
      const src = read(file);
      expect(src).toContain("styles.panel");
      expect(src).toContain("styles.codeBlock");
      expect(src).toContain("styles.copyBtn");
      expect(src).toContain('id="media-example-heading"');
      expect(src).not.toMatch(/<Card\b/);
      expect(src).not.toMatch(/text-text-muted|border-border|bg-sidebar|bg-primary|text-red-500/);
    }
    expect(read(`${detailBase}/components/exampleShared.js`)).toContain("styles.fieldRow");
  });

  it("resolves every styles.* class used by the detail consumers", () => {
    const defined = moduleClasses();
    const consumers = [
      `${detailBase}/page.js`,
      `${detailBase}/components/ProviderConfigPanel.js`,
      ...exampleCards(),
      `${detailBase}/components/exampleShared.js`,
      `${base}/combo/[id]/page.js`,
      "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js",
      "src/app/(dashboard)/dashboard/providers/components/ModelsCard.js",
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

// Phase 3: the combo detail surface.
const comboPage = () => read(`${base}/combo/[id]/page.js`);

describe("media combo detail surface", () => {
  it("renders the combo as hero plus four panels", () => {
    const page = comboPage();
    expect(page).toContain("dashboard-surface ${styles.page}");
    expect(page).toContain("styles.backLink");
    expect(page).toContain("<h1 className={styles.detailTitle}>{combo.name}</h1>");
    expect(page).toContain("styles.detailBadges");
    expect(page).toContain("styles.detailSub");
    expect(page).toContain("styles.detailActions");
    for (const id of ["combo-settings-heading", "combo-providers-heading", "combo-test-heading", "combo-logs-heading"]) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).toContain("styles.settingsRow");
    expect(page).toContain("styles.rowItem");
    expect(page).toContain("styles.logoTile");
    expect(page).toContain("styles.indexNum");
    expect(page).toContain("styles.codeBlock");
    expect(page).toContain("styles.mediaPreview");
    expect(page).not.toMatch(/<Card\b/);
    expect(page).not.toMatch(/text-text-muted|border-border|bg-primary|bg-black\/\[|dark:bg-white/);
  });

  it("keeps the combo data paths, ordering and destructive action", () => {
    const page = comboPage();
    expect(page).toContain("fetch(`/api/combos/${id}`");
    for (const endpoint of ["/api/settings", "/api/usage/logs", "/api/keys", "/api/providers", "/api/models/alias"]) {
      expect(page).toContain(`fetch("${endpoint}"`);
    }
    expect(page).toContain('fallbackStrategy: "round-robin"');
    expect(page).toContain("handleMove(idx, -1)");
    expect(page).toContain("handleMove(idx, 1)");
    expect(page).toContain("handleRemoveProvider(idx)");
    expect(page).toContain("router.push(getListingHref(combo.kind))");
    expect(page).toContain("maskB64(data)");
    expect(page).toContain("<ModelSelectModal");
    expect(page).toContain("kindFilter={combo.kind}");
    expect(page).toContain("addedModelValues={providers}");
    expect(page).toContain("if (!combo) return notFound();");
  });
});

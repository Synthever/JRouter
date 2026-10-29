// /dashboard/quota now shares the dashboard/endpoint/providers/combos surface:
// page intro, bento summary, one sticky toolbar and a 24/28 panel holding the
// account list plus its pagination.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const page = read("src/app/(dashboard)/dashboard/quota/page.js");
const limits = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");
const css = read("src/app/(dashboard)/dashboard/quota/quota.module.css");
const stats = read("src/app/(dashboard)/dashboard/quota/components/QuotaStats.js");

describe("quota surface redesign", () => {
  it("renders the shared page intro outside the suspended data boundary", () => {
    expect(page).toContain("<h1 className={styles.title}>Quota</h1>");
    expect(page).toContain("Remaining capacity, account limits and reset times across your providers.");
    expect(page).toContain("<header className={styles.intro}>");
    expect(page.indexOf("<header")).toBeLessThan(page.indexOf("<Suspense"));
  });

  it("mounts the bento summary with a per-surface layout key", () => {
    expect(stats).toContain("WidgetGrid");
    expect(stats).toContain("jrouter.quota.statsLayout.v1");
    expect(stats).toContain("Reset layout");
    expect(limits).toContain("<QuotaStats");
  });

  it("keeps filters in a sticky toolbar and bulk actions behind More", () => {
    expect(limits).toContain("className={styles.toolbar}");
    expect(limits).toContain("<SegmentedControl");
    expect(limits).toContain('aria-label="Bulk account actions"');
    for (const label of ["Turn off Empty", "Turn on Available", "Extend all", "Shorten all"]) {
      expect(limits).toContain(label);
    }
  });

  it("styles the panel and toolbar like the sibling dashboards", () => {
    const section = css.match(/\n\.section \{([^}]+)\}/)?.[1] || "";
    expect(section).toContain("padding: 28px;");
    expect(section).toContain("border-radius: 24px;");

    const toolbar = css.match(/\n\.toolbar \{([^}]+)\}/)?.[1] || "";
    expect(toolbar).toContain("position: sticky;");
    expect(toolbar).toContain("calc(-1 * var(--quota-stick-offset))");
  });

  it("keeps account pagination inside the account panel", () => {
    const panelStart = limits.indexOf('<section className={styles.section} aria-labelledby="quota-sources-heading" aria-busy={connectionsLoading}>');
    const panelEnd = limits.indexOf("</section>", panelStart);
    const pagination = limits.indexOf('<div className={styles.pagination}>');
    expect(panelStart).toBeGreaterThan(-1);
    expect(pagination).toBeGreaterThan(panelStart);
    expect(pagination).toBeLessThan(panelEnd);
  });
});

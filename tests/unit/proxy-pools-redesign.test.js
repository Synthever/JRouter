import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PAGE = "src/app/(dashboard)/dashboard/proxy-pools";

describe("proxy pools redesign", () => {
  it("mounts the themed dashboard surface", () => {
    const source = read(`${PAGE}/page.js`);
    expect(source).toContain("dashboard-surface");
    expect(source).toContain("proxy-pools.module.css");
    expect(source).toContain("ProxyPoolRow");
    expect(source).toContain("RelayMenu");
  });

  it("keeps the pool controls and search", () => {
    const source = read(`${PAGE}/page.js`);
    expect(source).toContain("Search proxy pools");
    expect(source).toContain("Health Check");
    expect(source).toContain("Batch Import");
    expect(source).toContain("Select all proxy pools");
    expect(source).toContain("Add Proxy Pool");
  });

  it("uses theme tokens and no raw colours", () => {
    const css = read(`${PAGE}/proxy-pools.module.css`);
    expect(css).toContain("var(--surface)");
    expect(css).toContain("var(--brand-lavender)");
    expect(css).toContain("var(--danger)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("approved system theme contract", () => {
  it("exposes the complete design palette and compatible semantic aliases", () => {
    const css = read("src/app/globals.css");
    for (const [name, value] of Object.entries({
      "brand-pink": "#ff4d8b", "brand-teal": "#1a3a3a", "brand-lavender": "#b8a4ed",
      "brand-peach": "#ffb084", "brand-ochre": "#e8b94a", "brand-mint": "#a4d4c5", "brand-coral": "#ff6b5a", "canvas": "#fffaf0",
    })) expect(css.toLowerCase()).toContain(`--${name}: ${value}`);
    expect(css).toContain("--color-bg: var(--bg)");
  });
  it("loads Inter while preserving theme prepaint and code typography", () => {
    const layout = read("src/app/layout.js");
    expect(layout).toContain("Inter({");
    expect(layout).toContain("--font-inter");
    expect(layout).toContain("localStorage.getItem('theme')");
    expect(layout).toContain("geistMono.variable");
  });
  it("keeps dark surfaces neutral charcoal instead of a teal tint", () => {
    const css = read("src/app/globals.css");
    const dark = css.match(/\n\.dark\s*\{([^}]+)\}/)?.[1] || "";
    const tokens = ["--bg", "--bg-2", "--surface", "--surface-2", "--surface-inset", "--canvas", "--surface-soft", "--surface-card", "--surface-strong"];
    for (const token of tokens) {
      const hex = dark.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
      expect(hex, `${token} must be a hex colour`).toBeTruthy();
      const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${token} ${hex} must stay neutral`).toBeLessThanOrEqual(3);
    }
  });
});

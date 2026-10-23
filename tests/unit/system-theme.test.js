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
});

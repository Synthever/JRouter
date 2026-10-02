import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("landing shader monochrome grain", () => {
  it("desaturates only the shader field, not the landing content", () => {
    const shader = read("src/app/landing/components/HeroShaderBackground.js");
    const landing = read("src/app/landing/page.js");

    expect(shader).toMatch(/className="landing-shader-field w-full h-full"\s+style=\{\{[^}]*filter: "grayscale\(1\)"/);
    expect(landing).not.toContain("grayscale(");
    expect(landing).not.toContain("grayscale-");
  });

  it("preserves the existing grain, animation and pixel density", () => {
    const shader = read("src/app/landing/components/HeroShaderBackground.js");

    expect(shader).toContain('grain="on"');
    expect(shader).toContain('animate="on"');
    expect(shader).toContain("uSpeed={0.3}");
    expect(shader).toContain("Math.min(window.devicePixelRatio || 1, 2)");
  });

  it("keeps all gradient colors neutral before the grain pass", () => {
    const shader = read("src/app/landing/components/HeroShaderBackground.js");
    const colors = [...shader.matchAll(/color[123]="(#\w{6})"/g)];

    expect(colors).toHaveLength(3);
    for (const [, color] of colors) {
      const red = color.slice(1, 3);
      expect(color.slice(3, 5)).toBe(red);
      expect(color.slice(5, 7)).toBe(red);
    }
  });
});
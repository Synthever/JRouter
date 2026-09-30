import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../src/app/manifest.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const logoPath = "/brand/jrouter.svg";

describe("application branding", () => {
  it.each([
    "src/app/landing/components/Navigation.js",
    "src/app/landing/components/Footer.js",
    "src/app/landing/components/HowItWorks.js",
    "src/app/landing/components/FlowAnimation.js",
    "src/shared/components/Sidebar.js",
    "src/shared/components/Footer.js",
    "src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js",
  ])("uses the shared logo in %s", (path) => {
    expect(/<AppLogo\b/.test(read(path))).toBe(true);
  });

  it("uses the selected SVG without a background tile", () => {
    expect(read("src/shared/constants/branding.js").includes(logoPath)).toBe(true);
    const component = read("src/shared/components/AppLogo.js");
    expect(component.includes("APP_LOGO_URL")).toBe(true);
    expect(/bg-white|bg-black|shadow-|rounded-/.test(component)).toBe(false);
    expect(component.includes("size = 36")).toBe(true);
  });

  it("uses the same logo for browser and install icons", () => {
    expect(read("src/app/layout.js").includes(logoPath)).toBe(true);
    expect(manifest().icons).toEqual([
      { src: logoPath, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ]);
    expect(read("public/sw.js").includes(logoPath)).toBe(true);
  });
});
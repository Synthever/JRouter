/**
 * Profile redesign — source-text contracts.
 * The page is JSX, so Vitest (node environment, no JSX transform) reads the
 * sources and asserts the structural promises instead of importing them.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ROUTE = "src/app/(dashboard)/dashboard/profile";

describe("Profile shell", () => {
  const page = read(`${ROUTE}/page.js`);

  it("renders the intro and the sticky chip toolbar", () => {
    expect(page).toContain("styles.introTitle");
    expect(page).toContain("styles.toolbar");
    expect(page).toContain("PROFILE_SECTIONS.map");
  });

  it("wires the scroll spy to the section offsets", () => {
    expect(page).toContain("activeSectionId");
    expect(page).toContain("aria-current");
  });
});

describe("Profile panels", () => {
  it("no longer renders a Card wrapper anywhere in the page", () => {
    expect(read(`${ROUTE}/page.js`)).not.toContain("<Card");
  });

  it("renders one panel component per section", () => {
    const page = read(`${ROUTE}/page.js`);
    for (const name of [
      "PreferencesPanel",
      "SecurityPanel",
      "SsoPanel",
      "RoutingPanel",
      "NetworkPanel",
      "ObservabilityPanel",
      "SessionPanel",
    ]) {
      expect(page).toContain(`<${name}`);
    }
  });

  it("derives every panel id from the section metadata", () => {
    const meta = read(`${ROUTE}/profileSections.js`);
    const ids = [...meta.matchAll(/id: "(profile-[a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(7);
    for (const file of [
      "PreferencesPanel",
      "SecurityPanel",
      "SsoPanel",
      "RoutingPanel",
      "NetworkPanel",
      "ObservabilityPanel",
      "SessionPanel",
    ]) {
      expect(read(`${ROUTE}/components/${file}.js`)).toMatch(/PROFILE_SECTIONS\[\d\]/);
    }
  });
});

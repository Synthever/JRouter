/**
 * Model Playground — redesign contracts.
 *
 * The playground is JSX, so it cannot be imported in Vitest without a JSX
 * transform.  These tests read the source text (and the CSS module) and check
 * the contracts the redesign promised: a full-height route, the page intro
 * with three KPI cards, three working modes, config-only route plans, and
 * composer height caps for short viewports.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Playground redesign contracts", () => {
  it("keeps the playground a full-height route", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    expect(layout).toContain('pathname === "/dashboard/playground" ? "h-dvh" : "h-screen"');
    expect(layout).toContain('pathname === "/dashboard/basic-chat" || pathname === "/dashboard/playground"');
  });

  it("renders the page intro and the three KPI cards", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js");
    expect(source).toContain("<h1 className={styles.title}>Playground</h1>");
    expect(source).toContain("<PlaygroundStats");
    const stats = read("src/app/(dashboard)/dashboard/playground/PlaygroundStats.js");
    expect(stats).toContain('id: "activeTarget"');
    expect(stats).toContain('id: "cacheCompression"');
    expect(stats).toContain('id: "routingPipeline"');
  });

  it("offers three working modes", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js");
    for (const value of ["single", "compare", "json"]) {
      expect(source).toContain(`{ value: "${value}"`);
    }
    expect(source).toContain("<PlaygroundJsonView");
  });

  it("never fabricates upstream telemetry", () => {
    const rail = read("src/app/(dashboard)/dashboard/playground/PlaygroundRail.js");
    expect(rail).toContain("Route plan from config.");
    expect(rail).not.toMatch(/x-jrouter-upstream|x-cache-hit|Weight:\s*\d/);
  });

  it("caps a multiline mobile input relative to the viewport height", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    const mobile = source.slice(source.lastIndexOf("@media (max-width: 639px)"));
    expect(mobile).toContain("max-height: min(200px, 25dvh)");
  });

  it("keeps a multiline input within a short landscape viewport", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    const landscape = source.slice(source.indexOf("@media (max-width: 1023px) and (max-height: 500px)"));
    expect(landscape).toContain("max-height: min(200px, 20dvh)");
  });

  it("renders no playground-specific top-bar title", () => {
    const source = read("src/shared/components/Header.js");
    expect(source).not.toContain('includes("/playground")');
    expect(source).not.toContain('title: "Model Playground"');
  });
});

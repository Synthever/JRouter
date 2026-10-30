/**
 * Model Playground — full-height chat room.
 *
 * PlaygroundPageClient.js and Header.js are JSX so we cannot import them in
 * Vitest without a JSX transform.  Read the source text and verify the
 * header/scrim removal directly.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Model Playground full-height chat", () => {
  it("renders no page header block so the chat room fills the page", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js");
    expect(source).not.toContain("Test and compare models through JRouter");
    expect(source).not.toContain("styles.header");
    expect(source).not.toContain("styles.eyebrow");
  });

  it("renders no top-bar title for the playground route", () => {
    const source = read("src/shared/components/Header.js");
    expect(source).not.toContain('includes("/playground")');
    expect(source).not.toContain('title: "Model Playground"');
  });

  it("sizes the playground shell to the visible mobile viewport", () => {
    const source = read("src/shared/components/layouts/DashboardLayout.js");
    expect(source).toContain('pathname === "/dashboard/playground" ? "h-dvh" : "h-screen"');
  });

  it("lets full-height content shrink without scrolling the outer page", () => {
    const source = read("src/shared/components/layouts/DashboardLayout.js");
    expect(source).toContain('"flex flex-col min-h-0 overflow-hidden"');
    expect(source).toContain('"flex-1 min-h-0 w-full flex flex-col"');
    expect(source).not.toContain("flex-1 overflow-y-auto custom-scrollbar");
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

  it("keeps the composer free of the fade scrim and elevation shadow", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    expect(source).not.toContain(".composerWrap::before");
    const composer = source.slice(source.indexOf(".composer {"), source.indexOf(".composer:focus-within"));
    expect(composer).not.toContain("box-shadow");
  });
});

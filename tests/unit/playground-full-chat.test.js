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

  it("keeps the composer free of the fade scrim and elevation shadow", () => {
    const source = read("src/app/(dashboard)/dashboard/playground/playground.module.css");
    expect(source).not.toContain(".composerWrap::before");
    const composer = source.slice(source.indexOf(".composer {"), source.indexOf(".composer:focus-within"));
    expect(composer).not.toContain("box-shadow");
  });
});

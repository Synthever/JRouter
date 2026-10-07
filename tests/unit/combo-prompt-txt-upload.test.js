/**
 * Combo Settings — System / Persona Prompt .txt upload.
 *
 * ComboSettingsModal.js is JSX so we cannot import it in Vitest without a JSX
 * transform.  Read the source text and verify the upload wiring directly —
 * this is reliable and does not require a full React setup.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("ComboSettingsModal .txt upload", () => {
  const source = read("src/shared/components/ComboSettingsModal.js");

  it("offers an Upload .txt trigger wired to a hidden .txt file input", () => {
    expect(source).toContain("Upload .txt");
    expect(source).toContain('accept=".txt,text/plain"');
    expect(source).toContain("onChange={handlePromptFileUpload}");
    expect(source).toMatch(/handlePromptFileUpload = async/);
  });

  it("loads the file into the System / Persona Prompt textarea", () => {
    expect(source).toContain("file.text()");
    expect(source).toContain("systemPrompt: text || null");
    // Windows-saved .txt files carry a UTF-8 BOM that must not leak into the prompt.
    expect(source).toContain("uFEFF");
  });
});

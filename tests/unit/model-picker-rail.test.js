import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("shared model picker rail variant", () => {
  it("is opt-in and keeps chips as the default", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain('variant = "chips"');
    expect(source).toContain('variant === "rail"');
  });

  it("renders the rail and row markers", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain("data-picker-rail");
    expect(source).toContain("data-model-row");
  });

  it("does not reuse the chip attribute on rail rows", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    const railStart = source.indexOf('variant === "rail"');
    expect(railStart).toBeGreaterThan(-1);
    // The chip branch deliberately follows the rail branch, so bound the slice
    // at the chip-only marker instead of running to end of file.
    const chipStart = source.indexOf("data-model-scroll", railStart);
    expect(chipStart).toBeGreaterThan(railStart);
    const railBranch = source.slice(railStart, chipStart);
    expect(railBranch).toContain("data-model-row");
    expect(railBranch).not.toContain("data-model-option");
  });

  it("handles arrow keys and Enter", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain('"ArrowDown"');
    expect(source).toContain('"ArrowUp"');
    expect(source).toContain('"Enter"');
  });

  it("sizes the rail with a container query", () => {
    const css = read("src/shared/components/ModelPickerList.module.css");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("@container (max-width: 620px)");
  });

  it("keeps the favourite star optional", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    // The star must be gated on the handler, not on the favorites list: callers
    // that never pass onToggleFavorite get rows with no star button at all.
    expect(source).toContain("onToggleFavorite ? (");
    expect(source).toContain("favorites = []");
    expect(source).toContain("onToggleFavorite(row.model.value)");
  });
});

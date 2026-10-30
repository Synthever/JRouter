import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Slice out a single CSS rule body so a contract is asserted against the rule that
// owns it, not against any later rule that happens to repeat the same declaration.
const rule = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

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

  it("revalidates the parked tab against the computed entries", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    // Favorites and Combos are conditional entries, so the parked key must be
    // resolved against the entry list rather than against a hard-coded allow-list.
    expect(source).toContain("entries.some((entry) => entry.key === railKey)");
    expect(source).toContain("if (rail.activeKey !== railKey) setRailKey(rail.activeKey);");
    expect(source).toContain("aria-selected={rail.activeKey === entry.key}");
    // The old effect exempted the conditional tabs, which is exactly what let the
    // rail stay parked on a tab that had already been removed from the rail.
    expect(source).not.toContain('railKey === "favorites" || railKey === "combos"');
    expect(source).not.toContain("shownGroups.some(([providerId]) => providerId === railKey)");
  });

  it("scrolls the keyboard cursor into view", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain('[data-cursor="true"]');
    expect(source).toContain('scrollIntoView({ block: "nearest" })');
  });

  it("keeps the keyboard cursor on a real row", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    expect(source).toContain("Math.max(0, Math.min(rail.rows.length - 1, index + 1))");
  });

  it("counts providers, not rail tabs", () => {
    const source = read("src/shared/components/ModelPickerList.js");
    // Favorites and Combos are tabs without a providerId; they are not providers.
    expect(source).toContain("entries.filter((entry) => entry.providerId).length");
    expect(source).not.toContain("rail.entries.length - 1");
  });

  it("bounds the rail height so the panes scroll inside the popover", () => {
    const css = read("src/shared/components/ModelPickerList.module.css");
    expect(rule(css, ".railWrap")).toContain("min-height: 0");
    expect(rule(css, ".railBody")).toContain("min-height: 0");
    expect(rule(css, ".railBody")).toContain("flex: 1");
    expect(rule(css, ".rail")).toContain("min-height: 0");
    expect(css).toContain("@container (max-width: 620px)");
  });
});

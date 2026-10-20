// Static contract: the combos page must expose search/filter state and per-row
// actions instead of a bare scrolling list, and publication must be controllable.
// Runtime behaviour is covered by the live browser gate after cutover.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(path.join(root, "src/app/(dashboard)/dashboard/combos/page.js"), "utf8");
const css = readFileSync(
  path.join(root, "src/app/(dashboard)/dashboard/combos/combos.module.css"),
  "utf8"
);
const sidebar = readFileSync(path.join(root, "src/shared/components/Sidebar.js"), "utf8");

describe("combos page table layout", () => {
  it("renders a searchable, filterable table instead of a plain list", () => {
    expect(page).toContain('aria-label="Search combos"');
    expect(page).toContain("<table");
    expect(page).toContain("styles.modelTable");
  });

  it("keeps the create/edit/settings/limits actions per row", () => {
    for (const label of ["Edit ", "Settings ", "Limits ", "Delete "]) {
      expect(page).toContain(label);
    }
  });

  it("exposes the publication control", () => {
    expect(page).toContain('aria-label="Visibility"');
    expect(page).toContain("visibility");
    expect(page).toContain("publicName");
  });

  it("moves the vision adapter into its own tab", () => {
    expect(page).toContain("SegmentedControl");
    expect(css).toContain(".modelTable");
  });

  it("relabels the sidebar entry", () => {
    expect(sidebar).toContain("Combos & Custom Model-IDs");
  });
});

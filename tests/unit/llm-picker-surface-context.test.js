import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

describe("LLM picker surface and catalog context enforcement", () => {
  it("enforces catalogContext='invocation' across all 20 CLI tool card modal sites in 17 files", () => {
    const cliDir = join(root, "src/app/(dashboard)/dashboard/cli-tools/components");
    const files = readdirSync(cliDir).filter((file) => file.endsWith(".js"));
    const sites = [];

    for (const file of files) {
      const content = read(`src/app/(dashboard)/dashboard/cli-tools/components/${file}`);
      const matches = [...content.matchAll(/<ModelSelectModal\b[\s\S]*?(?:\/>|<\/ModelSelectModal>)/g)];
      for (const match of matches) {
        sites.push({
          file,
          props: match[0],
          hasContext: /catalogContext\s*=\s*["']invocation["']/.test(match[0]),
        });
      }
    }

    expect(sites.length).toBe(20);
    const uniqueFiles = new Set(sites.map((s) => s.file));
    expect(uniqueFiles.size).toBe(17);

    const nonCompliant = sites.filter((s) => !s.hasContext);
    expect(nonCompliant).toEqual([]);
  });

  it("verifies management modal sites specify explicit members or media context", () => {
    const comboModal = read("src/shared/components/ComboFormModal.js");
    expect(comboModal).toMatch(/catalogContext\s*=\s*\{kindFilter && kindFilter !== ["']llm["'] \? ["']media["'] : ["']members["']\}/);

    const mediaComboPage = read("src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js");
    expect(mediaComboPage).toContain('catalogContext="media"');
  });

  it("ensures ModelPickerPopover receives and renders filteredAliases alongside combos", () => {
    const popover = read("src/app/(dashboard)/dashboard/playground/ModelPickerPopover.js");
    expect(popover).toContain("aliases={");
    expect(popover).toMatch(/filteredAliases|aliases/);
  });

  it("ensures ApiKeySettingsSections ModelRestrictions provides LLM and Media branches with correct contexts", () => {
    const settings = read("src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js");
    expect(settings).toContain("key-allow");
    expect(settings).toContain("key-block");
    expect(settings).toMatch(/branch|tab|media/i);
  });
});

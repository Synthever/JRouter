import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/KeyAccessControls.js", import.meta.url), "utf8");
describe("key access controls integration", () => {
  it("uses JRouter icons rather than a font absent from the dashboard", () => {
    expect(source).toContain('import Icon from "@/shared/components/Icon"');
    expect(source).toContain('<Icon name="close"');
    expect(source).toContain('<Icon name="add"');
    expect(source).not.toContain("material-symbols-outlined");
  });
});

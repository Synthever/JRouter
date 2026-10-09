import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/shared/hooks/useModelCatalog.js", import.meta.url), "utf8");
describe("shared model picker compatible nodes", () => {
  it("includes registered compatible models without requiring a connection in the LLM picker", () => {
    expect(source).toContain("const compatibleNodeIds = kindFilter");
    expect(source).toMatch(/customModels\s*\.map\(\(m\) => m.providerAlias\)/);
    expect(source).toMatch(/new Set\(\[\.\.\.activeConnectionIds, \.\.\.noAuthIds, \.\.\.compatibleNodeIds\]\)/);
  });
});

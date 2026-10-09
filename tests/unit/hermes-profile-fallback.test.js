import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js", import.meta.url), "utf8");
describe("Hermes deleted profile fallback", () => {
  it("reloads default settings without recursing on a missing default profile", () => {
    expect(source).toContain('res.status === 404 && profile !== "default"');
    expect(source).toMatch(/setActiveProfile\("default"\);\s*hasInitializedModel.current = false;\s*await checkStatus\("default"\);/);
  });
});

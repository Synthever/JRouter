import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("header title store", () => {
  it("exposes crumbs and a setter", () => {
    const store = read("src/store/headerTitleStore.js");
    expect(store).toContain("useHeaderTitleStore");
    expect(store).toContain("crumbs");
    expect(store).toContain("setCrumbs");
    expect(store).toContain("clearCrumbs");
  });

  it("lets the header prefer store crumbs", () => {
    const header = read("src/shared/components/Header.js");
    expect(header).toContain("useHeaderTitleStore");
    expect(header).toContain("storeCrumbs");
  });

  it("does not hardcode the playground route in the header", () => {
    const header = read("src/shared/components/Header.js");
    expect(header).not.toContain('includes("/playground")');
    expect(header).not.toContain('title: "Model Playground"');
  });
});

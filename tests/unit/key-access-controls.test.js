import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/KeyAccessControls.js", import.meta.url), "utf8");
describe("key access controls integration", () => {
  it("uses Configure as the only model-restriction control on Endpoint", () => {
    const endpoint = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js", import.meta.url), "utf8");
    expect(endpoint).toContain("ConfigureApiKeyDialog");
    expect(endpoint).not.toContain("KeyAccessControls");
    expect(endpoint).not.toContain("handleUpdateKeyAccess");
    expect(endpoint).not.toContain("Restrict API Key");
    expect(settings).toContain('title="Allowed Models"');
    expect(settings).toContain('title="Blocked Models"');
  });
  it("uses JRouter icons rather than a font absent from the dashboard", () => {
    expect(source).toContain('import Icon from "@/shared/components/Icon"');
    expect(source).toContain('<Icon name="close"');
    expect(source).toContain('<Icon name="add"');
    expect(source).not.toContain("material-symbols-outlined");
  });
});

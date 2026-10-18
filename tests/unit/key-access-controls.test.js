// The per-key "Restrict access" toggle was removed from the Endpoint API Keys
// panel: policy-based allowedModels/blockedModels (Settings → API Keys →
// Configure) are the single model-restriction mechanism. The legacy
// accessRestricted/accessAllow backend stays evaluated server-side, but the
// dashboard must not offer a second, differently-schemed control again.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url), "utf8");

describe("endpoint key access UI", () => {
  it("no longer renders the redundant per-key Restrict access toggle", () => {
    expect(source).not.toContain("KeyAccessControls");
    expect(source).not.toContain("Restrict API Key");
    expect(source).not.toContain("handleUpdateKeyAccess");
  });

  it("still surfaces the policy-based model restrictions per key", () => {
    expect(source).toContain('" · Restricted models"');
  });
});

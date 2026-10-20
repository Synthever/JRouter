// Static contract: the role control must exist in the settings dialog, persist
// through its save payload, and default the create flow to `user` — accidental
// owner-key issuance should require a deliberate selection.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const sections = read("src/app/(dashboard)/dashboard/endpoint/components/ApiKeySettingsSections.js");
const dialog = read("src/app/(dashboard)/dashboard/endpoint/components/ConfigureApiKeyDialog.js");
const page = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

describe("api key role control", () => {
  it("offers owner and user with the consequence spelled out", () => {
    expect(sections).toContain("export function KeyRoleSection");
    expect(sections).toContain("Owner");
    expect(sections).toContain("User");
    expect(sections).toContain("Custom Model-ID");
  });

  it("is mounted in the settings dialog and survives the save payload", () => {
    expect(dialog).toContain("KeyRoleSection");
    // The save payload is built from DEFAULT_KEY_POLICY keys; role must be added
    // explicitly or the control silently does nothing.
    expect(dialog).toContain("settings.role");
  });

  it("defaults toForm's role when the key has none", () => {
    expect(dialog).toContain('role: key.role === "user" ? "user" : "owner"');
  });

  it("is offered when creating a key, defaulting to user", () => {
    expect(page).toContain('aria-label="Key role"');
    expect(page).toContain('"user"');
    expect(page).toMatch(/role:\s*newKeyRole/);
  });
});

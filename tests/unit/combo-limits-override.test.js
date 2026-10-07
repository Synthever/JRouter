/**
 * Combos — manual ctx/max limits.
 *
 * The modal and the page are JSX and the resolution modules are ESM with
 * Next-only aliases, so the paths are verified against the source text.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("manual ctx/max limits", () => {
  it("stores the pin in one file and normalizes the provider alias", () => {
    const source = read("open-sse/providers/limitOverride.js");
    expect(source).toContain('"model-limits-overrides.json"');
    expect(source).toContain("export const MAX_OVERRIDE_TOKENS = 10_000_000");
    expect(source).toContain("resolveProviderAlias");
    // Atomic publish: a crash mid-write must not leave half-written JSON.
    expect(source).toContain("fs.renameSync(tmp, LIMITS_OVERRIDE_FILE)");
    expect(source).toContain("export async function installLimitOverrideSource()");
    expect(source).toContain("setLimitOverrideSource({ getLimits: getLimitOverride })");
  });

  it("applies the pin inside the capabilities chokepoint and keeps auto reachable", () => {
    const source = read("open-sse/providers/capabilities.js");
    expect(source).toContain("globalThis.__9rLimitOverrideSource");
    expect(source).toContain("export function setLimitOverrideSource(source)");

    // A pinned field only wins when it holds a real number.
    const apply = source.slice(source.indexOf("function applyLimitOverrides"), source.indexOf("export function getCapabilitiesForModel"));
    expect(apply).toContain("pinned.contextWindow > 0");
    expect(apply).toContain("pinned.maxOutput > 0");

    // Every caller gets the pin; only the dashboard asks for the auto value.
    expect(source).toContain("return applyLimitOverrides(resolveCapabilities(provider, model), provider, model);");
    const auto = source.slice(source.indexOf("export function getAutoCapabilitiesForModel"));
    expect(auto).toContain("return resolveCapabilities(provider, model);");
    expect(auto).not.toContain("applyLimitOverrides");
  });

  it("installs the pin reader on the server", () => {
    const source = read("src/instrumentation.js");
    expect(source).toContain("installLimitOverrideSource");
    expect(source.indexOf("installLimitOverrideSource")).toBeGreaterThan(source.indexOf("installCatalogSource"));
  });

  it("exposes the pins over an authenticated endpoint", () => {
    const source = read("src/app/api/models/limits/route.js");
    expect(source).toContain("export async function GET(request)");
    expect(source).toContain("export async function PUT(request)");
    expect(source).toContain("canManageApiKeys");

    // Split on the first slash so namespaced model ids survive.
    expect(source).toContain("const slash = key.indexOf(\"/\")");
    expect(source).toContain("model: key.slice(slash + 1)");
  });

  it("keeps the manual pins out of the catalog sync deltas", () => {
    const source = read("src/lib/modelCatalog/sync.js");
    expect(source).toContain("getAutoCapabilitiesForModel");
    expect(source).not.toContain("getCapabilitiesForModel(provider, model)");
  });

  it("opens the limits dialog from the ctx/max line on a combo row", () => {
    const page = read("src/app/(dashboard)/dashboard/combos/page.js");
    expect(page).toContain('import ComboLimitsModal from "@/shared/components/ComboLimitsModal"');
    expect(page).toContain("onEditLimits={() => setLimitsCombo(combo)}");
    expect(page).toContain("<ComboLimitsModal");
    expect(page).toContain("styles.metadataButton");

    const css = read("src/app/(dashboard)/dashboard/combos/combos.module.css");
    expect(css).toContain(".metadataButton");
  });

  it("edits, resets and saves the per-model limits from the dialog", () => {
    const source = read("src/shared/components/ComboLimitsModal.js");
    expect(source).toContain('fetch(`/api/models/limits?models=');
    expect(source).toContain('method: "PUT"');
    // Empty field = automatic value, and the empty patch clears the pin.
    expect(source).toContain("const contextWindow = row.ctx ? Number(row.ctx) : null");
    expect(source).toContain("const maxOutput = row.max ? Number(row.max) : null");
    // The combo list caches /api/models, so the save has to tell it to refetch.
    expect(source).toContain('new Event("modelLimitsChanged")');
    const hook = read("src/shared/hooks/useModelCaps.js");
    expect(hook).toContain('addEventListener("modelLimitsChanged"');
  });

  it("keeps the server-side ceiling in step with the dialog", () => {
    const modal = read("src/shared/components/ComboLimitsModal.js");
    const route = read("src/app/api/models/limits/route.js");
    expect(modal).toContain("const MAX_TOKENS = 10_000_000");
    expect(route).toContain("MAX_OVERRIDE_TOKENS");
  });
});

/**
 * Manual ctx/max limits — behavior of the real modules.
 *
 * limitOverride.js reads DATA_DIR at import time, so the temp dir has to be in
 * place before the dynamic imports below.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "9r-limits-"));
process.env.DATA_DIR = tmp;

const {
  LIMITS_OVERRIDE_FILE,
  MAX_OVERRIDE_TOKENS,
  getLimitOverride,
  listLimitOverrides,
  setLimitOverride,
  installLimitOverrideSource,
} = await import("open-sse/providers/limitOverride.js");
const { getAutoCapabilitiesForModel, getCapabilitiesForModel } = await import("open-sse/providers/capabilities.js");

const PROVIDER = "codex";
const MODEL = "gpt-6-luna";

describe("manual ctx/max limits", () => {
  it("writes the pin to DATA_DIR and pushes it into the capabilities chokepoint", async () => {
    const auto = getAutoCapabilitiesForModel(PROVIDER, MODEL);
    expect(auto.contextWindow).toBeGreaterThan(0);

    const pinned = 1_050_000;
    setLimitOverride(PROVIDER, MODEL, { contextWindow: pinned, maxOutput: 200_000 });

    expect(LIMITS_OVERRIDE_FILE.startsWith(tmp)).toBe(true);
    expect(JSON.parse(fs.readFileSync(LIMITS_OVERRIDE_FILE, "utf8")).version).toBe(1);
    expect(fs.existsSync(`${LIMITS_OVERRIDE_FILE}.tmp`)).toBe(false);

    // Server install: the reader capabilities.js consults at runtime.
    await installLimitOverrideSource();
    expect(getCapabilitiesForModel(PROVIDER, MODEL).contextWindow).toBe(pinned);
    expect(getCapabilitiesForModel(PROVIDER, MODEL).maxOutput).toBe(200_000);
    // The automatic value stays reachable for the dashboard's reset.
    expect(getAutoCapabilitiesForModel(PROVIDER, MODEL).contextWindow).toBe(auto.contextWindow);
  });

  it("hits the same entry through the display alias the combo seats use", async () => {
    await installLimitOverrideSource();
    setLimitOverride("cx", MODEL, { contextWindow: 900_000 });

    expect(getLimitOverride(PROVIDER, MODEL).contextWindow).toBe(900_000);
    expect(getCapabilitiesForModel("cx", MODEL).contextWindow).toBe(900_000);
    // One model, one entry — the alias did not create a second one.
    expect(Object.keys(listLimitOverrides())).toEqual([PROVIDER]);
  });

  it("only overrides the field that was pinned", async () => {
    await installLimitOverrideSource();
    setLimitOverride(PROVIDER, MODEL, { contextWindow: null, maxOutput: 123_000 });

    const caps = getCapabilitiesForModel(PROVIDER, MODEL);
    expect(caps.maxOutput).toBe(123_000);
    expect(caps.contextWindow).toBe(getAutoCapabilitiesForModel(PROVIDER, MODEL).contextWindow);
  });

  it("clears the entry back to auto when every field is emptied", () => {
    setLimitOverride(PROVIDER, MODEL, { contextWindow: null, maxOutput: null });

    expect(getLimitOverride(PROVIDER, MODEL)).toBeNull();
    expect(listLimitOverrides()).toEqual({});
  });

  it("refuses values that are typos rather than limits", () => {
    setLimitOverride(PROVIDER, MODEL, { contextWindow: MAX_OVERRIDE_TOKENS + 1, maxOutput: 0 });

    expect(getLimitOverride(PROVIDER, MODEL)).toBeNull();
    expect(getCapabilitiesForModel(PROVIDER, MODEL).contextWindow).toBe(
      getAutoCapabilitiesForModel(PROVIDER, MODEL).contextWindow,
    );
  });
});

// River provider wiring: registered as a first-class API-key provider on the
// rvr alias with the live-verified catalog; generic OpenAI-compatible executor.
import { describe, expect, it } from "vitest";
import registryRiver from "open-sse/providers/registry/river.js";
import { PROVIDER_OAUTH, PROVIDERS, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { APIKEY_PROVIDERS } from "@/shared/constants/providers.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

describe("river provider wiring", () => {
  it("registers as an API-key provider on the rvr alias with the live catalog", () => {
    expect(registryRiver.id).toBe("river");
    expect(registryRiver.alias).toBe("rvr");
    expect(registryRiver.category).toBe("apikey");
    expect(registryRiver.transport.baseUrl).toBe("https://api.river.ai/v1/chat/completions");
    expect(PROVIDER_MODELS.rvr.map((m) => m.id)).toEqual([
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4",
      "zai-org/GLM-5.3-Flash",
    ]);
    expect(APIKEY_PROVIDERS.river).toBeTruthy();
    expect(PROVIDERS.river).toBeTruthy();
    expect(PROVIDER_OAUTH.river).toBeUndefined(); // apikey-only, no oauth block
  });

  it("resolves sensible default capabilities for its models", () => {
    // Unknown families ride the generic OpenAI-compatible defaults…
    const nemotron = getCapabilitiesForModel("rvr", "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4");
    expect(nemotron.reasoning).toBe(true);
    expect(nemotron.thinkingFormat).toBeNull(); // derived from transport at runtime
    // …while known families keep their native wire format (zai-org → zai).
    const glm = getCapabilitiesForModel("rvr", "zai-org/GLM-5.3-Flash");
    expect(glm.reasoning).toBe(true);
    expect(glm.thinkingFormat).toBe("zai");
  });
});

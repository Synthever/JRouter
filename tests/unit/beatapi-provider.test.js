import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";

describe("BeatAPI provider", () => {
  const entry = REGISTRY.find((e) => e.id === "beatapi");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("beatapi");
    expect(entry.aliases).toContain("beat");
  });

  it("points at the verified OpenAI-compatible base URL", () => {
    expect(PROVIDERS.beatapi.baseUrl).toBe("https://api.beatapi.io/v1/chat/completions");
    expect(PROVIDERS.beatapi.validateUrl).toBe("https://api.beatapi.io/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.beatapi.format).toBe("openai");
  });

  it("seeds only the free text model ids from the public catalogue", () => {
    const ids = (PROVIDER_MODELS.beatapi || []).map((m) => m.id);
    expect(ids).toEqual([
      "glm-5.3-free",
      "glm-5.3-flash-free",
      "deepseek-v4.1-flash-free",
      "deepseek-v4-flash-0731-free",
      "gemini-3.8-flash-free",
    ]);
  });

  it("keeps dynamic discovery on the public text catalogue and passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://api.beatapi.io/v1/text/models",
      type: "beatapi-free",
    });
    // The endpoint answers anonymously (verified live), so a modelsFetcher is
    // legitimate here — unlike agnes, whose /v1/models requires a token.
  });

  it("stays a single-transport provider (chat only, per the free-models docs)", () => {
    // Free ids are served via Chat Completions; a multi-transport entry (or a
    // claude format) would route Anthropic-format clients to /v1/messages,
    // which the free docs never promised.
    expect(entry.transports).toBeUndefined();
    expect(PROVIDERS.beatapi.transports).toBeUndefined();
    // No per-model format declarations on the single openai lane.
    expect(getModelSupportedFormats("beatapi", "glm-5.3-free")).toBeNull();
    expect(getModelTargetFormat("beatapi", "glm-5.3-free")).toBeNull();
  });

  it("routes through the shared DefaultExecutor with Bearer auth", () => {
    const executor = getExecutor("beatapi");
    expect(executor).toBeInstanceOf(DefaultExecutor);
    // No transport.auth → resolveAuthDescriptor falls back to BEARER (Authorization: Bearer)
    expect(PROVIDERS.beatapi.auth).toBeUndefined();
  });

  it("keeps every registry id unique after adding beatapi", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

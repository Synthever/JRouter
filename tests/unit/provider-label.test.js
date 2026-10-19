import { describe, expect, it } from "vitest";

import { providerDisplayLabel } from "../../src/lib/db/helpers/providerLabel.js";

describe("providerDisplayLabel", () => {
  it("returns the registry provider name as-is", () => {
    expect(providerDisplayLabel("river", { river: "River" })).toBe("River");
    expect(providerDisplayLabel("openai", {})).toBe("OpenAI");
  });

  it("resolves a live custom node id to its saved node name", () => {
    const nodes = { "openai-compatible-chat-abc12345": "Dahl" };
    expect(providerDisplayLabel("openai-compatible-chat-abc12345", nodes)).toBe("Dahl");
  });

  it("falls back to a readable label for a deleted custom node instead of a raw UUID", () => {
    const label = providerDisplayLabel("openai-compatible-chat-b5a227a6-2995-45ae-a409-7f1c6e6719e1", {});
    expect(label).toBe("Custom provider");
    expect(label).not.toContain("b5a227a6");
    expect(label).not.toContain("openai-compatible-chat");
  });

  it("labels deleted anthropic-compatible nodes the same way", () => {
    expect(providerDisplayLabel("anthropic-compatible-b5a227a6", {})).toBe("Custom provider");
  });

  it("leaves aliases and unknown ids readable but never renders a bare uuid", () => {
    expect(providerDisplayLabel("rvr", {})).toBe("River");
    expect(providerDisplayLabel("", {})).toBe("Unknown");
    expect(providerDisplayLabel(null, {})).toBe("Unknown");
  });

  it("prefers a node name even when the id is not in the registry", () => {
    const nodes = { "openai-compatible-chat-x": "My Gateway" };
    expect(providerDisplayLabel("openai-compatible-chat-x", nodes)).toBe("My Gateway");
  });
});

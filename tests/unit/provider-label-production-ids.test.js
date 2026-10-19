import { describe, expect, it } from "vitest";

import { providerDisplayLabel } from "../../src/lib/db/helpers/providerLabel.js";

// Real provider ids observed in the production usage history (2026-10-19):
// one deleted custom node that used to serve 6.4k requests, one live "Dahl"
// node, plus the River registry provider.
const LIVE_NODES = { "openai-compatible-chat-2bf75408-9a1b-4ebb-910c-929dbbfef720": "Dahl" };
const DELETED_NODE = "openai-compatible-chat-b5a227a6-2995-45ae-a409-7f1c6e6719e1";

describe("provider labels on real production ids", () => {
  it("shows River for the registry provider instead of the raw id", () => {
    expect(providerDisplayLabel("river")).toBe("River");
  });

  it("shows a readable label for the deleted custom node", () => {
    expect(providerDisplayLabel(DELETED_NODE, LIVE_NODES)).toBe("Custom provider");
  });

  it("shows Dahl for its live node instead of the uuid", () => {
    expect(providerDisplayLabel("openai-compatible-chat-2bf75408-9a1b-4ebb-910c-929dbbfef720", LIVE_NODES)).toBe("Dahl");
  });

  it("never returns a raw uuid for any custom compatible id", () => {
    const ids = [
      "openai-compatible-chat-29ccbb08-ad01-4ec3-9399-49d31414f45e",
      "openai-compatible-chat-5a4333cc-e54e-43ea-b74d-743658ad7ce9",
      "openai-compatible-chat-6e053304-494d-4bf0-ad3f-e482e32bf38c",
      "openai-compatible-chat-87420fd4-5e7f-4d8f-94fe-c4799ba8af9f",
      "openai-compatible-chat-d5b1ac19-f300-4b50-9029-fb2a1e9562e3",
    ];
    for (const id of ids) {
      const label = providerDisplayLabel(id, LIVE_NODES);
      expect(label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(label).not.toContain("openai-compatible");
    }
  });
});

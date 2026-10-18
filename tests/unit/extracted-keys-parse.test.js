// Extracted-keys JSON parser: the format written by the provider connections
// "Extract Keys" endpoint, plus tolerant variants.
import { describe, expect, it } from "vitest";
import { parseExtractedKeys } from "@/shared/utils/extractedKeys.js";

const payload = {
  provider: "commandcode",
  exportedAt: "2026-10-18T16:30:00Z",
  count: 3,
  keys: [
    { name: "Key 1", apiKey: "user_abc", isActive: true },
    { name: "Key 2", apiKey: "user_def", isActive: false },
    { name: "", apiKey: "user_ghi" },
    { apiKey: "" },
  ],
};

describe("parseExtractedKeys", () => {
  it("parses the extract payload, skipping inactive and empty entries", () => {
    const r = parseExtractedKeys(JSON.stringify(payload));
    expect(r.error).toBeNull();
    expect(r.provider).toBe("commandcode");
    expect(r.entries).toEqual([
      { name: "Key 1", apiKey: "user_abc" },
      { name: "", apiKey: "user_ghi" },
    ]);
    expect(r.skipped).toBe(2);
  });

  it("accepts a bare array and trims whitespace", () => {
    const r = parseExtractedKeys(JSON.stringify([{ name: "  X  ", apiKey: "  k1  " }]));
    expect(r.entries).toEqual([{ name: "X", apiKey: "k1" }]);
    expect(r.provider).toBeNull();
  });

  it("rejects non-JSON and JSON without a keys array", () => {
    expect(parseExtractedKeys("not json").error).toMatch(/Invalid JSON/);
    expect(parseExtractedKeys('{"foo":1}').error).toMatch(/keys/);
    expect(parseExtractedKeys('{"keys":[{"isActive":false}]}').error).toMatch(/No usable keys/);
  });

  it("round-trips with the extract endpoint shape", async () => {
    // Contract: whatever GET .../connections/keys returns feeds back in.
    const serverShape = {
      provider: "openai-compatible-chat-1234",
      exportedAt: "2026-10-18T16:30:00Z",
      count: 1,
      keys: [{ name: "Key 7", apiKey: "sk-x", isActive: true, priority: 2 }],
    };
    const r = parseExtractedKeys(JSON.stringify(serverShape));
    expect(r.entries).toEqual([{ name: "Key 7", apiKey: "sk-x" }]);
  });
});

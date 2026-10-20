// Publication validation for Custom Model-IDs. A collision here silently routes
// a client's request to the wrong combo, so every namespace is pinned.
import { describe, it, expect } from "vitest";
import { validatePublication } from "@/shared/utils/publicModelId.js";

const combos = [
  { id: "c1", name: "Main", visibility: "public", publicName: "gpt-fast", models: ["openai/model-a"] },
  { id: "c2", name: "other", visibility: "private", publicName: null, models: ["openai/model-b"] },
];
const nodes = [{ id: "openai-compatible-chat-n1", prefix: "mock" }];

const run = (input, extra = {}) =>
  validatePublication(input, { combos, nodes, selfId: null, ...extra });

describe("custom model-id publication validation", () => {
  it("accepts a well-formed public name", () => {
    expect(run({ visibility: "public", publicName: "fresh-name", models: ["openai/model-c"] })).toEqual({
      visibility: "public",
      publicName: "fresh-name",
    });
  });

  it("accepts private combos with no public name", () => {
    expect(run({ visibility: "private", publicName: null, models: [] })).toEqual({
      visibility: "private",
      publicName: null,
    });
  });

  it("rejects publishing a combo with no members", () => {
    expect(() => run({ visibility: "public", publicName: "empty", models: [] })).toThrow(
      /at least one model/i
    );
  });

  it("rejects a name already used by another combo's public id or name", () => {
    expect(() => run({ visibility: "public", publicName: "gpt-fast", models: ["x/y"] })).toThrow(
      /already in use/i
    );
    expect(() => run({ visibility: "public", publicName: "other", models: ["x/y"] })).toThrow(
      /already in use/i
    );
  });

  it("allows a combo to keep its own name", () => {
    expect(
      run({ visibility: "public", publicName: "Main", models: ["x/y"] }, { selfId: "c1" })
    ).toEqual({ visibility: "public", publicName: "Main" });
  });

  it("rejects provider ids, provider aliases and node prefixes", () => {
    expect(() => run({ visibility: "public", publicName: "openai", models: ["x/y"] })).toThrow(
      /reserved/i
    );
    expect(() => run({ visibility: "public", publicName: "cx", models: ["x/y"] })).toThrow(
      /reserved/i
    );
    expect(() => run({ visibility: "public", publicName: "mock", models: ["x/y"] })).toThrow(
      /reserved/i
    );
  });

  it("rejects bad grammar and overlong names", () => {
    expect(() => run({ visibility: "public", publicName: "has space", models: ["x/y"] })).toThrow(
      /letters, numbers/i
    );
    expect(() => run({ visibility: "public", publicName: "a".repeat(65), models: ["x/y"] })).toThrow(
      /64/
    );
  });

  it("rejects visibility values outside the enum", () => {
    expect(() => run({ visibility: "published", publicName: null, models: [] })).toThrow(
      /visibility/i
    );
  });

  it("is case-insensitive when detecting collisions", () => {
    expect(() => run({ visibility: "public", publicName: "GPT-Fast", models: ["x/y"] })).toThrow(
      /already in use/i
    );
    expect(() => run({ visibility: "public", publicName: "OpenAI", models: ["x/y"] })).toThrow(
      /reserved/i
    );
  });

  it("treats an empty public name as null", () => {
    expect(run({ visibility: "private", publicName: "", models: [] })).toEqual({
      visibility: "private",
      publicName: null,
    });
  });

  it("defaults visibility to private when omitted", () => {
    expect(run({ models: [] })).toEqual({ visibility: "private", publicName: null });
  });
});

import { describe, expect, it } from "vitest";

import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

// Fixtures mirror the live GET https://api.beatapi.io/v1/text/models shape.
// The route unwraps ONE level (raw = json.data ?? json.models ?? json), so the
// filter receives [{data:[…]}] — a single-element array carrying the envelope
// (same normalization minimax-code rides with).
const ENVELOPE = [
  {
    data: [
      { id: "glm-5.3", family: "glm", endpoints: ["openai", "anthropic", "openai-response"] },
      { id: "glm-5.3-free", family: "free", endpoints: ["openai"] },
      { id: "glm-5.3-flash-free", family: "free", endpoints: ["openai"] },
      { id: "deepseek-v4.1-flash-free", family: "free", endpoints: ["openai"] },
      { id: "deepseek-v4-flash-0731-free", family: "free", endpoints: ["openai"] },
      { id: "gemini-3.8-flash-free", family: "free", endpoints: ["openai"] },
      // paid family with a -free-ish tail must not leak in
      { id: "glm-5.3-free-preview", family: "glm", endpoints: ["openai"] },
    ],
  },
];
const EXPECTED = [
  "deepseek-v4-flash-0731-free",
  "deepseek-v4.1-flash-free",
  "gemini-3.8-flash-free",
  "glm-5.3-flash-free",
  "glm-5.3-free",
];

describe("beatapi-free suggested-models filter", () => {
  it("unwraps the route-normalized envelope and keeps only family=free -free ids", () => {
    const out = FILTERS["beatapi-free"](ENVELOPE);
    expect(out.map((m) => m.id).sort()).toEqual(EXPECTED);
  });

  it("accepts a bare envelope object; envelope-less arrays degrade to empty", () => {
    const bare = { data: [{ id: "glm-5.3-free", family: "free" }] };
    expect(FILTERS["beatapi-free"](bare)).toEqual([{ id: "glm-5.3-free", name: "glm-5.3-free" }]);
    // A plain array of rows is not a shape the route produces for this
    // catalogue: element 0 would be treated as an envelope and has no data —
    // degrade to empty rather than guessing.
    expect(FILTERS["beatapi-free"]([{ id: "glm-5.3-free", family: "free" }])).toEqual([]);
  });

  it("degrades to empty on malformed input", () => {
    expect(FILTERS["beatapi-free"](null)).toEqual([]);
    expect(FILTERS["beatapi-free"]("nope")).toEqual([]);
    expect(FILTERS["beatapi-free"]([null, {}, { id: 5 }])).toEqual([]);
  });
});

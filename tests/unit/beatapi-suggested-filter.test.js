import { describe, expect, it } from "vitest";

import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

// Fixtures mirror the live GET https://api.beatapi.io/v1/text/models shape
// ({data:{data:[entries]}} unwrapped by the route before filtering).
const CATALOGUE = [
  { id: "glm-5.3", family: "glm", endpoints: ["openai", "anthropic", "openai-response"] },
  { id: "glm-5.3-free", family: "free", endpoints: ["openai"] },
  { id: "glm-5.3-flash-free", family: "free", endpoints: ["openai"] },
  { id: "deepseek-v4.1-flash-free", family: "free", endpoints: ["openai"] },
  { id: "deepseek-v4-flash-0731-free", family: "free", endpoints: ["openai"] },
  { id: "gemini-3.8-flash-free", family: "free", endpoints: ["openai"] },
  // paid sibling carrying a -free-like tail inside another family must not leak
  { id: "glm-5.3-free-preview", family: "glm", endpoints: ["openai"] },
];

describe("beatapi-free suggested-models filter", () => {
  it("keeps only family=free ids ending in -free", () => {
    const out = FILTERS["beatapi-free"](CATALOGUE);
    expect(out.map((m) => m.id).sort()).toEqual([
      "deepseek-v4-flash-0731-free",
      "deepseek-v4.1-flash-free",
      "gemini-3.8-flash-free",
      "glm-5.3-flash-free",
      "glm-5.3-free",
    ]);
  });

  it("passes route-normalized real payload shape through", () => {
    // suggested-models route normalizes {data:{data:[…]}} into a flat array
    const out = FILTERS["beatapi-free"]([{ id: "glm-5.3-free", family: "free" }]);
    expect(out).toEqual([{ id: "glm-5.3-free", name: "glm-5.3-free" }]);
  });

  it("degrades to empty on malformed input", () => {
    expect(FILTERS["beatapi-free"](null)).toEqual([]);
    expect(FILTERS["beatapi-free"]("nope")).toEqual([]);
    expect(FILTERS["beatapi-free"]([null, {}, { id: 5 }])).toEqual([]);
  });
});

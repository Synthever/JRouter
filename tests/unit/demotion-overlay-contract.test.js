import { describe, expect, it } from "vitest";

import { applyDemotionOverlay, shouldDemoteStatus } from "../../src/sse/services/demotion.js";

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe("applyDemotionOverlay", () => {
  it("places demoted keys after healthy keys, oldest failure first", () => {
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2, demotedAt: iso(1000) },
      { id: "c", priority: 3 },
      { id: "d", priority: 4, demotedAt: iso(2000) },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["a", "c", "d", "b"]);
  });

  it("all-demoted keeps relative priority order", () => {
    const t = iso(5);
    const conns = [
      { id: "x", priority: 1, demotedAt: t },
      { id: "y", priority: 2, demotedAt: t },
      { id: "z", priority: 3, demotedAt: t },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["x", "y", "z"]);
  });

  it("moves the latest failure to the tail even when every key is demoted", () => {
    const conns = [
      { id: "a", priority: 1, demotedAt: iso(0) },
      { id: "b", priority: 2, demotedAt: iso(3000) },
      { id: "c", priority: 3, demotedAt: iso(2000) },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps timestamp ties deterministic by curated priority", () => {
    const conns = [
      { id: "b", priority: 2, demotedAt: iso(1) },
      { id: "a", priority: 1, demotedAt: iso(1) },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("restores a recovered key to its original priority without mutation", () => {
    const conns = [
      { id: "a", priority: 1, demotedAt: null },
      { id: "b", priority: 2 },
      { id: "c", priority: 3, demotedAt: iso(1) },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(conns.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("no demotions → priority order unchanged", () => {
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
    ];
    expect(applyDemotionOverlay(conns).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("input array is not mutated", () => {
    const t = iso(1);
    const conns = [
      { id: "a", priority: 1 },
      { id: "b", priority: 2, demotedAt: t },
      { id: "c", priority: 3 },
    ];
    const snapshot = JSON.stringify(conns);
    applyDemotionOverlay(conns);
    expect(JSON.stringify(conns)).toBe(snapshot);
  });
});

describe("shouldDemoteStatus", () => {
  // Payload-caused 4xx (the existing no-fallback band in checkFallbackError:
  // 400/404-class request errors say nothing about the credential) do not demote.
  it.each([400, 404, 405, 413, 422])("does not demote payload-caused %i", (status) => {
    expect(shouldDemoteStatus(status)).toBe(false);
  });

  // Everything that makes the existing loop retry with another account demotes.
  it.each([401, 402, 403, 429, 500, 502, 503, 504])("demotes credential/server error %i", (status) => {
    expect(shouldDemoteStatus(status)).toBe(true);
  });

  it("demotes a connection failure (no HTTP status)", () => {
    expect(shouldDemoteStatus(null)).toBe(true);
    expect(shouldDemoteStatus(undefined)).toBe(true);
    expect(shouldDemoteStatus(0)).toBe(true);
  });
});

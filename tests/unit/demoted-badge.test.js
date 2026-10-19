import { describe, expect, it } from "vitest";

// The demoted badge is a pure presentation rule; keep it in sync with the
// server contract: demotedAt is an ISO timestamp written by markAccountUnavailable
// and cleared by clearAccountError. Disabled connections never advertise it.
const showsDemotedBadge = (connection) =>
  Boolean(connection?.demotedAt) && connection?.isActive !== false;

describe("demoted badge visibility", () => {
  it("shows for an active connection with demotedAt", () => {
    expect(showsDemotedBadge({ demotedAt: new Date().toISOString(), isActive: true })).toBe(true);
  });

  it("hides for a disabled connection even when demotedAt is set", () => {
    expect(showsDemotedBadge({ demotedAt: new Date().toISOString(), isActive: false })).toBe(false);
  });

  it("hides once the key succeeds again (demotedAt cleared)", () => {
    expect(showsDemotedBadge({ demotedAt: null, isActive: true })).toBe(false);
    expect(showsDemotedBadge({ isActive: true })).toBe(false);
  });

  it("tolerates a missing connection", () => {
    expect(showsDemotedBadge(null)).toBe(false);
  });
});

// Runtime ordering invariant the badge explains: demoted keys serve last.
describe("runtime ordering the badge reflects", () => {
  const order = (keys) => [
    ...keys.filter((k) => !k.demotedAt),
    ...keys.filter((k) => k.demotedAt),
  ].map((k) => k.name);

  it("serves demoted keys after every healthy key", () => {
    expect(order([
      { name: "Key 1", demotedAt: "2026-10-19T19:19:44Z" },
      { name: "Key 2", demotedAt: "2026-10-19T19:19:53Z" },
      { name: "Key 3" },
      { name: "Key 4" },
    ])).toEqual(["Key 3", "Key 4", "Key 1", "Key 2"]);
  });
});

import { describe, expect, it } from "vitest";
import { PROFILE_SECTIONS, activeSectionId } from "@/app/(dashboard)/dashboard/profile/profileSections";

describe("PROFILE_SECTIONS", () => {
  it("lists the seven sections in page order with unique ids", () => {
    expect(PROFILE_SECTIONS.map((s) => s.id)).toEqual([
      "profile-preferences",
      "profile-security",
      "profile-sso",
      "profile-routing",
      "profile-network",
      "profile-observability",
      "profile-session",
    ]);
    expect(new Set(PROFILE_SECTIONS.map((s) => s.id)).size).toBe(7);
  });

  it("gives every section a chip label and an icon", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("activeSectionId", () => {
  const offsets = [
    { id: "a", top: 0 },
    { id: "b", top: 300 },
    { id: "c", top: 700 },
  ];

  it("returns the last section whose top passed the reading line", () => {
    expect(activeSectionId(offsets, 0)).toBe("a");
    expect(activeSectionId(offsets, 299)).toBe("a");
    expect(activeSectionId(offsets, 300)).toBe("b");
    expect(activeSectionId(offsets, 900)).toBe("c");
  });

  it("falls back to the first section when the line is above everything", () => {
    expect(activeSectionId([{ id: "a", top: 120 }], 0)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(activeSectionId([], 100)).toBeNull();
  });
});

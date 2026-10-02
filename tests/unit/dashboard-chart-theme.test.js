import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/components/ActivityTimelineCard.js", import.meta.url), "utf8");

describe("activity timeline theme colors", () => {
  it("uses the theme foreground for the curve and area gradient", () => {
    const area = source.match(/<Area\s[\s\S]*?\/>/)?.[0] || "";
    const stops = [...source.matchAll(/<stop\s[^>]*\/>/g)];

    expect(area).toContain('stroke="var(--text)"');
    expect(area).toContain("strokeWidth={2}");
    expect(stops).toHaveLength(2);
    for (const [stop] of stops) {
      expect(stop).toContain('stopColor="var(--text)"');
    }
    expect(stops[0][0]).toContain("stopOpacity={0.14}");
  });

  it("uses readable theme labels and a theme-aware grid", () => {
    for (const axis of ["XAxis", "YAxis"]) {
      const props = source.match(new RegExp(`<${axis}\\s[\\s\\S]*?/>`))?.[0] || "";
      expect(props).toContain('stroke="var(--text-2)"');
    }
    const grid = source.match(/<CartesianGrid\s[^>]*\/>/)?.[0] || "";
    expect(grid).toContain('stroke="var(--line)"');
  });
});
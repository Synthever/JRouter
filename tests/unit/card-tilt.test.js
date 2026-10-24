import { describe, expect, it } from "vitest";
import { MAX_TILT_DEG, tiltFromPoint } from "../../src/shared/utils/cardTilt.js";

const rect = { left: 100, top: 50, width: 200, height: 100 };

describe("dashboard card tilt geometry", () => {
  it("lifts the hovered corner toward the viewer", () => {
    expect(tiltFromPoint(rect, 100, 50)).toMatchObject({ rotationX: -MAX_TILT_DEG, rotationY: MAX_TILT_DEG, mx: 0, my: 0 });
    expect(tiltFromPoint(rect, 300, 150)).toMatchObject({ rotationX: MAX_TILT_DEG, rotationY: -MAX_TILT_DEG, mx: 100, my: 100 });
    expect(tiltFromPoint(rect, 300, 50)).toMatchObject({ rotationX: -MAX_TILT_DEG, rotationY: -MAX_TILT_DEG });
    expect(tiltFromPoint(rect, 100, 150)).toMatchObject({ rotationX: MAX_TILT_DEG, rotationY: MAX_TILT_DEG });
  });

  it("returns a neutral pose at the center", () => {
    expect(tiltFromPoint(rect, 200, 100)).toEqual({ rotationX: 0, rotationY: 0, mx: 50, my: 50 });
  });

  it("clamps pointers outside the card to its edges", () => {
    expect(tiltFromPoint(rect, -500, -500)).toMatchObject({ rotationX: -MAX_TILT_DEG, rotationY: MAX_TILT_DEG, mx: 0, my: 0 });
    expect(tiltFromPoint(rect, 9999, 9999)).toMatchObject({ rotationX: MAX_TILT_DEG, rotationY: -MAX_TILT_DEG, mx: 100, my: 100 });
  });

  it("scales to a custom maximum and keeps two-decimal precision", () => {
    expect(tiltFromPoint(rect, 150, 50, 10)).toMatchObject({ rotationX: -10, rotationY: 5, mx: 25, my: 0 });
    expect(tiltFromPoint({ left: 0, top: 0, width: 3, height: 3 }, 1, 1)).toMatchObject({
      rotationX: -1.17,
      rotationY: 1.17,
    });
  });

  it.each([
    ["zero width", { left: 0, top: 0, width: 0, height: 10 }],
    ["zero height", { left: 0, top: 0, width: 10, height: 0 }],
    ["missing rect", null],
  ])("falls back to neutral for %s", (_label, input) => {
    expect(tiltFromPoint(input, 0, 0)).toEqual({ rotationX: 0, rotationY: 0, mx: 50, my: 50 });
  });

  it("falls back to neutral for non-finite pointer coordinates", () => {
    for (const [x, y] of [[Number.NaN, 0], [0, Number.NaN], [Number.POSITIVE_INFINITY, 0]]) {
      expect(tiltFromPoint(rect, x, y)).toEqual({ rotationX: 0, rotationY: 0, mx: 50, my: 50 });
    }
  });

  it("never emits non-finite values for a zero max tilt", () => {
    expect(tiltFromPoint(rect, 120, 60, 0)).toEqual({ rotationX: 0, rotationY: 0, mx: 50, my: 50 });
  });
});

// Pure geometry for the dashboard card tilt. Kept framework-free so the
// quadrant direction and clamping can be unit-tested without a DOM or GSAP.

export const MAX_TILT_DEG = 3.5;
export const TILT_PERSPECTIVE = 900;

const DEFAULT_TILT = { rotationX: 0, rotationY: 0, mx: 50, my: 50 };

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Maps a pointer position inside a card rectangle to a small 3D tilt.
 *
 * The corner nearest the pointer lifts toward the viewer:
 *   top-left     -> rotationX negative, rotationY positive
 *   bottom-right -> rotationX positive, rotationY negative
 *
 * Returns the pointer position as percentages (`mx`, `my`) so the caller can
 * move a radial spotlight with the same numbers. Invalid or zero-size rects
 * collapse to a neutral pose instead of producing NaN transforms.
 */
export function tiltFromPoint(rect, clientX, clientY, maxTilt = MAX_TILT_DEG) {
  const left = rect?.left;
  const top = rect?.top;
  const width = rect?.width;
  const height = rect?.height;

  if (
    ![left, top, width, height, clientX, clientY, maxTilt].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    maxTilt <= 0
  ) {
    return { ...DEFAULT_TILT };
  }

  const px = clamp01((clientX - left) / width);
  const py = clamp01((clientY - top) / height);

  return {
    rotationX: round((py - 0.5) * 2 * maxTilt),
    rotationY: round((0.5 - px) * 2 * maxTilt),
    mx: round(px * 100, 1),
    my: round(py * 100, 1),
  };
}

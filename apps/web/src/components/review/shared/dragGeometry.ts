// Pure pin-drag math, split out of useDraggablePin.ts so it's directly
// unit-testable under plain `node --test` -- the hook itself (useState/
// useRef/useCallback) needs a React render to exercise, which this repo has
// no jsdom/testing-library setup for.
export type NormalizedPoint = { x: number; y: number };

export const DRAG_THRESHOLD_PX = 4;

// Distinguishes a click (select the pin) from a drag (move it), since both
// gestures start with the same pointerdown -- only once the pointer has
// moved at least this far does it count as a drag.
export function hasCrossedDragThreshold(dx: number, dy: number, thresholdPx: number = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) >= thresholdPx;
}

// widthPx/heightPx are the rendered image/page's pixel dimensions at the
// current zoom -- startFocus.x/y are fractions (0-1) of those, so
// screen-space pointer deltas need to be converted through the current
// scale to stay anchored under the cursor regardless of zoom level. Result
// is clamped to [0, 1] so a drag can't push the pin off the image/page.
export function normalizedPointAfterDrag(
  startFocus: NormalizedPoint,
  dx: number,
  dy: number,
  widthPx: number,
  heightPx: number,
): NormalizedPoint {
  return {
    x: Math.min(1, Math.max(0, startFocus.x + dx / widthPx)),
    y: Math.min(1, Math.max(0, startFocus.y + dy / heightPx)),
  };
}

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  hasCrossedDragThreshold,
  normalizedPointAfterDrag,
  type NormalizedPoint,
} from "./dragGeometry.ts";

export type { NormalizedPoint };

/**
 * Session-only drag-to-reposition for annotation pins: lets a user nudge a
 * pin's on-canvas position to pull apart pins that landed close together,
 * without persisting the change anywhere -- reloading (or re-fetching
 * comments) restores each pin's real stored position. This is deliberately
 * not wired to any save/update call.
 *
 * Distinguishes a click (select the pin) from a drag (move it) via a small
 * movement threshold, since both start with the same pointerdown -- see
 * dragGeometry.ts for the pure math this delegates to.
 */
export function useDraggablePin() {
  const [overrides, setOverrides] = useState<Record<string, NormalizedPoint>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startFocus: NormalizedPoint;
    moved: boolean;
  } | null>(null);

  const resolveFocus = useCallback(
    (id: string, focus: NormalizedPoint): NormalizedPoint => overrides[id] ?? focus,
    [overrides]
  );

  const beginDrag = useCallback(
    (id: string, focus: NormalizedPoint, e: ReactPointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startFocus: overrides[id] ?? focus,
        moved: false,
      };
      setDraggingId(id);
    },
    [overrides]
  );

  const updateDrag = useCallback((e: ReactPointerEvent, widthPx: number, heightPx: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !widthPx || !heightPx) return false;

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && !hasCrossedDragThreshold(dx, dy)) return false;
    drag.moved = true;

    const next = normalizedPointAfterDrag(drag.startFocus, dx, dy, widthPx, heightPx);
    setOverrides((prev) => ({ ...prev, [drag.id]: next }));
    return true;
  }, []);

  // Returns whether the pointerup ended an actual drag (vs. a plain click),
  // so the caller can suppress its click-to-select handler for real drags.
  const endDrag = useCallback((e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    }
    dragRef.current = null;
    setDraggingId(null);
    return drag?.moved ?? false;
  }, []);

  return { resolveFocus, beginDrag, updateDrag, endDrag, draggingId };
}

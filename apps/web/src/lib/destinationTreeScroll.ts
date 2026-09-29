// Shared scroll math for the "Move to..." / "Copy to..." destination tree
// (BulkProjectActionDialog). Both the authenticated project view
// (CampaignDetails) and the guest share view (useGuestMoveDestination) drive
// the same tree and want the same "bring this row into view" behaviour.
//
// - "reveal"  : nudge the row just enough to be visible within a comfortable
//               band -- used when the user expands a node and we want its
//               newly-shown children on screen without yanking the viewport.
// - "context" : land the row roughly a quarter of the way down the viewport so
//               there is a bit of parent context above it -- used when the
//               dialog opens and we jump to where the selected files currently
//               live.

type RevealAlign = "reveal" | "context";

export function revealDestinationRow(
  scrollAreaRoot: HTMLElement | null,
  target: HTMLElement | null,
  align: RevealAlign = "reveal",
): void {
  if (!scrollAreaRoot || !target) return;
  const viewport = scrollAreaRoot.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (!viewport) return;

  const viewportRect = viewport.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const edgePadding = 16;

  if (align === "context") {
    // Position the row ~28% down the viewport (clamped so a tall row still
    // starts near the top). Only scrolls if it isn't already roughly there.
    const desiredTop = viewportRect.top + Math.min(viewportRect.height * 0.28, 220);
    const delta = targetRect.top - desiredTop;
    if (Math.abs(delta) > 4) {
      viewport.scrollBy({ top: delta, behavior: "smooth" });
    }
    return;
  }

  const revealHeight = Math.max(96, Math.min(240, viewportRect.height * 0.6));
  const targetBottomToReveal = Math.min(targetRect.bottom, targetRect.top + revealHeight);
  const bottomOverflow = targetBottomToReveal - (viewportRect.bottom - edgePadding);

  if (bottomOverflow > 0) {
    viewport.scrollBy({ top: bottomOverflow, behavior: "smooth" });
    return;
  }

  const topOverflow = targetRect.top - (viewportRect.top + edgePadding);
  if (topOverflow < 0) {
    viewport.scrollBy({ top: topOverflow, behavior: "smooth" });
  }
}

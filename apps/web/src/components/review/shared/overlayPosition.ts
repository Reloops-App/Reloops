/**
 * Clamps an anchor-relative overlay (a comment popover or inline composer
 * hanging off a pin) so it stays fully inside the stage on both axes.
 *
 * Only the horizontal axis was clamped before -- an overlay anchored near
 * the bottom of the stage would still compute a `top` that pushed its
 * (dynamic-height) content past the stage's bottom edge, getting visually
 * cut off by the stage's overflow clipping. Clamping `top` against a real
 * height the same way `left` was already clamped against `width` fixes
 * that for any edge.
 */
export function clampOverlayPosition(params: {
  anchorLeft: number;
  anchorTop: number;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  stageWidth: number;
  stageHeight: number;
  margin?: number;
}) {
  const {
    anchorLeft,
    anchorTop,
    xOffset,
    yOffset,
    width,
    height,
    stageWidth,
    stageHeight,
    margin = 12,
  } = params;

  const maxLeft = Math.max(margin, stageWidth - width - margin);
  const maxTop = Math.max(margin, stageHeight - height - margin);

  return {
    left: Math.max(margin, Math.min(maxLeft, anchorLeft + xOffset)),
    top: Math.max(margin, Math.min(maxTop, anchorTop + yOffset)),
  };
}

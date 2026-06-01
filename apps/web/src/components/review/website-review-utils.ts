export type WebsiteReviewAssetLike = {
  title?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

function isTallWebsiteCapture(width?: number | null, height?: number | null) {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return false;
  }

  const aspectRatio = height / width;
  const isMobileViewportWidth = width >= 320 && width <= 480;
  const isDesktopViewportWidth = width >= 1200 && width <= 2560;

  return aspectRatio >= 2 && height >= 1600 && (isMobileViewportWidth || isDesktopViewportWidth);
}

export function isLikelyWebsiteScreenshot(
  asset?: WebsiteReviewAssetLike | null,
  probedDimensions?: ImageDimensions | null
) {
  if (!asset?.mime_type?.startsWith("image/")) {
    return false;
  }

  return (
    /^Screenshot:/i.test(asset?.title ?? "") ||
    /(^|\/)Screenshot_/i.test(asset?.storage_path ?? "") ||
    isTallWebsiteCapture(asset?.width, asset?.height) ||
    isTallWebsiteCapture(probedDimensions?.width, probedDimensions?.height)
  );
}

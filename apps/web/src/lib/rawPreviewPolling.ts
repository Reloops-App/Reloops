// A camera RAW normally has its preview the moment it is uploaded (the browser extracts the embedded JPEG). When it does
// not yet (uploaded by an API/MCP client, or a format the browser cannot read), the viewer shows a normal loading state and
// polls for it so the picture appears by itself, with no "come back later" message. Pure logic, tested without a browser.
import { isRawImageAsset, getRawPreviewInfo, type AssetFileLike } from "./designFiles.ts";

export const RAW_POLL_INTERVAL_MS = 3000;
export const RAW_POLL_MAX_ATTEMPTS = 20; // 60 s, then the viewer says honestly that no preview could be made

/** True when the server recorded that no preview could be made for this file (ai_metadata.raw_preview_error). */
export function hasRawPreviewError(aiMetadata: unknown): boolean {
  if (typeof aiMetadata !== "object" || aiMetadata === null || Array.isArray(aiMetadata)) return false;
  const marker = (aiMetadata as Record<string, unknown>).raw_preview_error;
  return typeof marker === "object" && marker !== null;
}

/** True for a camera RAW whose web-safe preview is not available yet and has not been declared a failure. */
export function shouldPollRawPreview(asset: AssetFileLike | null | undefined): boolean {
  if (!asset) return false;
  return isRawImageAsset(asset) && getRawPreviewInfo(asset) === null && !hasRawPreviewError(asset.ai_metadata);
}

type PreviewFields = { cover_image_url?: string | null; ai_metadata?: unknown; width?: number | null; height?: number | null };

/** Copies only the preview-related fields from a freshly fetched row; nothing the user may have changed meanwhile is touched. */
export function mergeFreshRawPreview<T extends PreviewFields>(current: T, fresh: PreviewFields | null | undefined): T {
  if (!fresh) return current;
  return {
    ...current,
    cover_image_url: fresh.cover_image_url ?? current.cover_image_url,
    ai_metadata: fresh.ai_metadata ?? current.ai_metadata,
    width: fresh.width ?? current.width,
    height: fresh.height ?? current.height,
  };
}

type TileLike = AssetFileLike & { id: string; cover_image_url?: string | null };

/** Ids of camera-RAW tiles that have no cover yet and that the server has not given up on: the ones a grid should keep refreshing. */
export function rawAssetsAwaitingCover(assets: ReadonlyArray<TileLike>): string[] {
  return assets
    .filter((asset) => isRawImageAsset(asset) && !asset.cover_image_url && !hasRawPreviewError(asset.ai_metadata))
    .map((asset) => asset.id);
}

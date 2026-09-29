// A file that was just uploaded often has no cover yet: the browser could not make one (a video it cannot decode, a large
// file, a RAW with no embedded picture) and the server makes it a few seconds later. The grid keeps such
// tiles fresh until the cover arrives, so nobody stares at a black tile or has to reload the page.
import { hasRawPreviewError } from "./rawPreviewPolling.ts";
import { isRawImageAsset, type AssetFileLike } from "./designFiles.ts";

type TileLike = AssetFileLike & { id: string; cover_image_url?: string | null };

// Kinds the thumbnail worker produces a cover for. Anything else (text, archives, binaries) never gets one, so it is not waited for.
export function expectsServerCover(asset: AssetFileLike): boolean {
  const mime = String(asset.mime_type ?? asset.type ?? "").trim().toLowerCase();
  if (isRawImageAsset(asset)) return true;
  // Audio is left out: it only gets a picture from embedded artwork, which the browser reads itself. Waiting for the server would
  // show a "working" circle for a picture that will never come.
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}

/** Ids of tiles that have no cover yet, will get one from the server, and that the server has not given up on. */
export function assetsAwaitingServerCover(assets: ReadonlyArray<TileLike>): string[] {
  return assets
    .filter((asset) => !asset.cover_image_url && !hasRawPreviewError(asset.ai_metadata) && expectsServerCover(asset))
    .map((asset) => asset.id);
}

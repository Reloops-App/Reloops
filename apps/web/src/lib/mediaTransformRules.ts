// Pure classification rules for Cloudflare Image Transforms eligibility.
// Kept dependency-free (no "@/" imports, no import.meta.env) so it can be
// unit-tested directly under the plain Node test runner, matching the
// pattern used by designFiles.ts/ltdUsageAccounting.ts elsewhere in this
// codebase. src/lib/mediaDelivery.ts imports and re-exports from here.

import { isRawImageMime } from "./rawImageFormats.ts";

export type MediaMimeSource = {
  mime_type?: string | null;
  type?: string | null;
};

export type MediaTransformFormat = "auto" | "webp" | "jpeg" | "png";

// Mime types Cloudflare Image Resizing can actually transform. SVG can't be
// rasterized by it, and animated GIF needs anim=true verified before we rely
// on it — both keep using today's pre-generated-thumbnail path unchanged.
const NON_TRANSFORMABLE_IMAGE_MIME_TYPES = new Set(["image/svg+xml", "image/gif"]);

// PNG/WebP can carry transparency; format=auto is allowed to negotiate down
// to a plain JPEG for older clients, which would flatten that transparency
// onto a solid background. Same class of bug already fixed once for the
// pre-generated-thumbnail path (see AssetCard.tsx's coverUrl-priority fix).
const ALPHA_SENSITIVE_MIME_TYPES = new Set(["image/png", "image/webp"]);

export function isRealImageAsset(asset?: MediaMimeSource | null): boolean {
  const mime = String(asset?.mime_type ?? asset?.type ?? "").toLowerCase();
  if (!mime.startsWith("image/")) return false;
  // Camera RAW can carry an image/x-* mime but Cloudflare can't decode it.
  if (isRawImageMime(mime)) return false;
  return !NON_TRANSFORMABLE_IMAGE_MIME_TYPES.has(mime);
}

export function safeTransformFormat(
  mimeType: string | null | undefined,
  requested?: MediaTransformFormat,
): MediaTransformFormat {
  if (requested && requested !== "auto") return requested;
  const alphaSensitive = ALPHA_SENSITIVE_MIME_TYPES.has(String(mimeType ?? "").toLowerCase());
  return alphaSensitive ? "webp" : "auto";
}

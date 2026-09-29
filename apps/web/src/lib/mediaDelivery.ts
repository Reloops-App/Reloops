// Reloops OSS media URL resolution. Same exports as cloud's mediaDelivery, but OSS
// has no media CDN: files live in the private Supabase `assets` bucket.
// - Guest pages get a server-signed URL on every asset (`signed_url`), used first.
// - Signed-in members get the public-assets URL, which lib/assetFileUrl signs on
//   load/download (the bucket is private, so that URL is never fetched unsigned).
// - CDN-only features (image transforms, CORS hints, Bunny fallback) are no-ops.
import { isRealImageAsset, safeTransformFormat, type MediaTransformFormat } from "@/lib/mediaTransformRules";
import { isLiveUrlReviewAsset } from "@/lib/liveUrlReview";
import { rawPreviewFromAiMetadata } from "@/lib/rawPreview";

export { isRealImageAsset, safeTransformFormat, type MediaTransformFormat };

export type MediaUrlSource = {
  id?: string | null;
  signed_url?: string | null;
  delivery_url?: string | null;
  cdn_url?: string | null;
  storage_path?: string | null;
  url?: string | null;
  mime_type?: string | null;
  type?: string | null;
  coverUrl?: string | null;
  cover_image_url?: string | null;
  ai_metadata?: Record<string, unknown> | null;
};

const ABSOLUTE_URL_RE = /^(https?:|blob:|data:)/i;

function publicAssetBase() {
  return String(import.meta.env.VITE_ASSET_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function cleanPath(value: string) {
  return value.replace(/^\/+/, "");
}

export function isAbsoluteMediaUrl(value?: string | null) {
  return ABSOLUTE_URL_RE.test(String(value ?? "").trim());
}

export function resolveMediaUrl(pathOrUrl?: string | null) {
  const raw = String(pathOrUrl ?? "").trim();
  if (!raw) return "";
  if (ABSOLUTE_URL_RE.test(raw)) return raw;
  const base = publicAssetBase();
  return base ? `${base}/${cleanPath(raw)}` : `/${cleanPath(raw)}`;
}

export function isVideoMedia(asset?: MediaUrlSource | null) {
  const mime = String(asset?.mime_type ?? asset?.type ?? "").toLowerCase();
  return mime.startsWith("video/");
}

function signedUrlOf(asset?: MediaUrlSource | null) {
  return asset?.signed_url ?? asset?.delivery_url ?? asset?.cdn_url ?? null;
}

export function resolveAssetMediaUrl(asset?: MediaUrlSource | null) {
  if (isLiveUrlReviewAsset(asset)) return "";
  const rawPreview = rawPreviewFromAiMetadata(asset?.ai_metadata);
  if (rawPreview) return rawPreview.previewUrl;
  return signedUrlOf(asset) ?? resolveMediaUrl(asset?.storage_path ?? asset?.url ?? null);
}

// Cloud retries through a second CDN; OSS has a single source, so there is no fallback.
export function resolveAssetFallbackMediaUrl(_asset?: MediaUrlSource | null, _primaryUrl?: string | null) {
  return "";
}

export function resolveAssetDownloadUrl(asset?: MediaUrlSource | null) {
  if (isLiveUrlReviewAsset(asset)) return "";
  return signedUrlOf(asset) ?? resolveMediaUrl(asset?.storage_path ?? asset?.url ?? null);
}

export type MediaTransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  format?: MediaTransformFormat;
};

export const GRID_THUMBNAIL_TRANSFORM: MediaTransformOptions = { width: 640, quality: 80 };
export const REVIEW_PREVIEW_TRANSFORM: MediaTransformOptions = { width: 2560, quality: 85 };

export function withMediaTransform(url: string, _options: MediaTransformOptions, _mimeType?: string | null): string {
  return String(url ?? "").trim();
}

export function resolveImagePreviewUrl(asset: MediaUrlSource | null | undefined, _options: MediaTransformOptions): string {
  return resolveAssetMediaUrl(asset);
}

export function resolveGridPreviewUrl(_asset: MediaUrlSource | null | undefined, _options: MediaTransformOptions): string | null {
  return null;
}

export function withMediaDownloadHint(url: string) {
  return url;
}

export function withMediaCorsHint(url: string) {
  return String(url ?? "").trim();
}

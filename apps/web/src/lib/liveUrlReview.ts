// Detection for "live URL review" assets, mirroring
// components/review/website-review-utils.ts's marker-based approach --
// unlike that file, there's no legacy-asset fallback needed here (this is a
// brand new asset type, nothing pre-existing to backfill), so a live-url
// asset is *always* identified by its explicit ai_metadata.asset_type
// marker, set once at creation time by supabase/functions/live-url-review.

export type LiveUrlReviewAssetLike = {
  ai_metadata?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type LiveUrlReviewInfo = {
  url: string;
  origin: string;
  hostname: string;
  path: string;
  proxyToken: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isLiveUrlReviewAsset(asset?: LiveUrlReviewAssetLike | null): boolean {
  if (!asset) return false;
  const metadata = asset.ai_metadata ?? asset.metadata ?? null;
  if (!isRecord(metadata)) return false;
  return metadata.asset_type === "live-url-review";
}

export function getLiveUrlReviewInfo(asset?: LiveUrlReviewAssetLike | null): LiveUrlReviewInfo | null {
  if (!isLiveUrlReviewAsset(asset)) return null;

  const metadata = (asset!.ai_metadata ?? asset!.metadata) as Record<string, unknown>;
  const website = metadata.website;
  const proxyToken = metadata.proxy_token;

  if (!isRecord(website) || typeof proxyToken !== "string" || !proxyToken) return null;
  const { url, origin, hostname, path } = website as Record<string, unknown>;
  if (typeof url !== "string" || typeof origin !== "string" || typeof hostname !== "string" || typeof path !== "string") {
    return null;
  }

  return { url, origin, hostname, path, proxyToken };
}

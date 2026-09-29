import { useCallback, useEffect, useState } from "react";
import { resolveAssetFallbackMediaUrl, type MediaUrlSource } from "@/lib/mediaDelivery";

export function useAssetMediaFallback(asset: MediaUrlSource | null | undefined, primaryUrl: string) {
  const fallbackUrl = resolveAssetFallbackMediaUrl(asset, primaryUrl);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    setUsingFallback(false);
  }, [asset?.id, asset?.storage_path, asset?.url, fallbackUrl, primaryUrl]);

  const markPrimaryFailed = useCallback(() => {
    if (!fallbackUrl || usingFallback) return;
    setUsingFallback(true);
  }, [fallbackUrl, usingFallback]);

  return {
    activeUrl: usingFallback && fallbackUrl ? fallbackUrl : primaryUrl,
    fallbackUrl,
    usingFallback,
    canUseFallback: Boolean(fallbackUrl && !usingFallback),
    markPrimaryFailed,
  };
}

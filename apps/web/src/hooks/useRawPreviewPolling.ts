// Reloops OSS has no camera-RAW preview pipeline, so there is nothing to wait for:
// report "gave up" at once and the page shows its honest "no preview, download" state
// instead of a 60-second spinner. Same signature as cloud's hook.
import type { AssetFileLike } from "@/lib/designFiles";

type FreshRow = { ai_metadata?: unknown; cover_image_url?: string | null; width?: number | null; height?: number | null };

export function useRawPreviewPolling(_options: {
  asset: AssetFileLike | null | undefined;
  assetKey: string | null | undefined;
  fetchLatest: () => Promise<FreshRow | null>;
  onFresh: (fresh: FreshRow) => void;
}) {
  return { gaveUp: true };
}

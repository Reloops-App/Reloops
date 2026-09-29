import {
  type AssetFileLike,
  type FileTypeVisual,
  type TextFilePreviewInfo,
  getBrowserUnsupportedImagePreviewLabel,
  getFileTypeVisual,
  getRawPreviewInfo,
  getTextFilePreviewInfo,
  isBrowserUnsupportedImagePreviewAsset,
  isDesignPreviewUnavailableAsset,
} from "./designFiles.ts";

export type AssetPreviewClassification = {
  fileTypeVisual: FileTypeVisual | null;
  isTextFilePreview: boolean;
  textFilePreviewInfo: TextFilePreviewInfo | null;
  isUnsupportedDesignPreview: boolean;
  isUnsupportedBrowserImagePreview: boolean;
  browserUnsupportedImagePreviewLabel: string | null;
  designAssetLabel: string;
  unsupportedPreviewLabel: string | null;
  isUnsupportedPreview: boolean;
  /** Web-safe JPEG for a camera RAW file, once the thumbnail worker has made one. */
  rawPreviewUrl: string | null;
};

/**
 * Single source of truth for "can this asset be previewed inline, and if
 * not, what should the fallback card say" -- shared by every reviewer
 * surface (ReviewAsset.tsx and the three share-link pages: ShareAsset.tsx,
 * ShareCollectionAsset.tsx, ShareProjectAsset.tsx). Each of those pages used
 * to duplicate this logic independently, which is how archives/office-docs/
 * extended-design formats and plain-text/data files (JSON/Markdown/etc.)
 * ended up correctly routed in ReviewAsset.tsx but still falling through to
 * the broken ImageAnnotatorWithAnnotations catch-all on every share page --
 * none of those fixes had been applied there. Centralizing this prevents
 * that class of bug from recurring a 5th time.
 */
export function classifyAssetPreview(asset?: AssetFileLike | null): AssetPreviewClassification {
  const fileTypeVisual = getFileTypeVisual(asset);
  const isTextFilePreview = fileTypeVisual?.kind === "text";
  const textFilePreviewInfo = isTextFilePreview ? getTextFilePreviewInfo(asset) : null;

  const isUnsupportedDesignPreview =
    isDesignPreviewUnavailableAsset(asset) ||
    (fileTypeVisual !== null && fileTypeVisual.kind !== "text");

  const rawPreviewUrl = getRawPreviewInfo(asset)?.previewUrl ?? null;
  // A RAW file with a generated preview renders like any other image.
  const isUnsupportedBrowserImagePreview = isBrowserUnsupportedImagePreviewAsset(asset) && rawPreviewUrl === null;
  const browserUnsupportedImagePreviewLabel = getBrowserUnsupportedImagePreviewLabel(asset);
  const designAssetLabel = fileTypeVisual?.label ?? "Design";
  const unsupportedPreviewLabel = isUnsupportedBrowserImagePreview ? browserUnsupportedImagePreviewLabel : designAssetLabel;
  const isUnsupportedPreview = isUnsupportedDesignPreview || isUnsupportedBrowserImagePreview;

  return {
    fileTypeVisual,
    isTextFilePreview,
    textFilePreviewInfo,
    isUnsupportedDesignPreview,
    isUnsupportedBrowserImagePreview,
    browserUnsupportedImagePreviewLabel,
    designAssetLabel,
    unsupportedPreviewLabel,
    isUnsupportedPreview,
    rawPreviewUrl,
  };
}

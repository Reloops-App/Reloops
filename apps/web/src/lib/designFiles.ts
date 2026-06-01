type AssetFileLike = {
  mime_type?: string | null;
  type?: string | null;
  name?: string | null;
  title?: string | null;
  url?: string | null;
  storage_path?: string | null;
};

const AI_MIME_TYPES = new Set([
  "application/illustrator",
  "application/postscript",
  "application/vnd.adobe.illustrator",
]);

function normalizeMimeType(asset?: AssetFileLike | null) {
  return String(asset?.mime_type ?? asset?.type ?? "")
    .trim()
    .toLowerCase();
}

function normalizeFileReference(asset?: AssetFileLike | null) {
  return String(
    asset?.storage_path ??
      asset?.url ??
      asset?.name ??
      asset?.title ??
      "",
  ).toLowerCase();
}

function hasFileExtension(value: string, extension: string) {
  return value.endsWith(extension) || value.includes(`${extension}?`);
}

export function isSvgDesignAsset(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  const fileRef = normalizeFileReference(asset);
  return mimeType.includes("svg") || hasFileExtension(fileRef, ".svg");
}

export function isAiDesignAsset(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  const fileRef = normalizeFileReference(asset);
  return AI_MIME_TYPES.has(mimeType) || hasFileExtension(fileRef, ".ai");
}

export function isDesignPreviewUnavailableAsset(asset?: AssetFileLike | null) {
  return isSvgDesignAsset(asset) || isAiDesignAsset(asset);
}

export function getDesignAssetLabel(asset?: AssetFileLike | null) {
  if (isAiDesignAsset(asset)) return "AI";
  if (isSvgDesignAsset(asset)) return "SVG";
  return "Design";
}

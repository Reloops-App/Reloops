type AssetFileLike = {
  mime_type?: string | null;
  type?: string | null;
  name?: string | null;
  title?: string | null;
  url?: string | null;
  storage_path?: string | null;
};

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

export function isHtml5BannerAsset(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  if (mimeType === "text/html") return true;
  const fileRef = normalizeFileReference(asset);
  return hasFileExtension(fileRef, ".html") || hasFileExtension(fileRef, ".htm");
}

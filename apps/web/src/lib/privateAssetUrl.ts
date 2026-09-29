// The `assets` bucket is private, so `${VITE_ASSET_PUBLIC_BASE_URL}${storage_path}`
// URLs 400. Recognise them so they can be swapped for a signed URL.
export function storagePathFromPublicAssetUrl(url: string | null | undefined, publicBase: string | null | undefined): string | null {
  if (!url || !publicBase) return null;
  const base = publicBase.replace(/\/+$/, "");
  if (!url.startsWith(`${base}/`)) return null;
  const path = url.slice(base.length).replace(/^\/+/, "").split(/[?#]/)[0];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

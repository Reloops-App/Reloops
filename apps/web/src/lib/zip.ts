import JSZip from "jszip";
import type { CollectionAssetRow } from "./collections";

function saveBlob(blob: Blob, fileName: string) {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 5000);
}

export async function downloadCollectionZip(
  assets: CollectionAssetRow[],
  collectionName: string
): Promise<void> {
  const zip = new JSZip();

  // Deduplicate names if necessary
  const nameCounts = new Map<string, number>();

  for (const row of assets) {
    const asset = row.asset;
    if (!asset.storage_path && !asset.url) continue;

    const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
    const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
    const path = asset.storage_path
      ? (asset.storage_path.startsWith("/") ? asset.storage_path : `/${asset.storage_path}`)
      : asset.url;
    
    if (!path) continue;

    const downloadUrl = asset.storage_path ? `${base}${path}` : path;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Failed to fetch ${downloadUrl}`);
      const blob = await response.blob();

      let fileName = asset.name || "Untitled_asset";
      
      // Handle extension
      if (!fileName.includes(".")) {
        const rawType = asset.type || "";
        const rawExt = rawType.includes("/") ? rawType.split("/")[1] : rawType;
        if (rawExt) {
          fileName = `${fileName}.${rawExt}`;
        }
      }

      // Deduplicate
      let count = nameCounts.get(fileName) || 0;
      if (count > 0) {
        const parts = fileName.split(".");
        const ext = parts.length > 1 ? parts.pop() : "";
        const nameWithoutExt = parts.join(".");
        fileName = ext ? `${nameWithoutExt} (${count}).${ext}` : `${fileName} (${count})`;
      }
      nameCounts.set(fileName, count + 1);

      zip.file(fileName, blob);
    } catch (e) {
      console.error(`Error downloading asset ${asset.id}:`, e);
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  saveBlob(content, `${collectionName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_assets.zip`);
}

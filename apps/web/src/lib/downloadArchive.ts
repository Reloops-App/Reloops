import { toast } from "sonner";

export type ArchiveEntry = {
  path: string;
  url: string;
};

function withDownloadHint(url: string) {
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

function ensureZipName(fileName: string) {
  return fileName.toLowerCase().endsWith(".zip") ? fileName : `${fileName}.zip`;
}

function saveBlob(blob: Blob, fileName: string) {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = ensureZipName(fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 5000);
}

export async function downloadZipArchive(
  entries: ArchiveEntry[],
  archiveName: string,
  options?: { label?: string },
) {
  if (entries.length === 0) {
    toast.info(`No downloadable assets found in ${options?.label ?? archiveName}.`);
    return;
  }

  const label = options?.label ?? archiveName;
  const toastId = toast.loading(`Preparing ZIP for ${label}...`);

  try {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    let added = 0;
    let failed = 0;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      toast.loading(`Preparing ZIP for ${label} (${index + 1}/${entries.length})...`, { id: toastId });

      try {
        const response = await fetch(withDownloadHint(entry.url), {
          method: "GET",
          mode: "cors",
          credentials: "omit",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        zip.file(entry.path, blob);
        added += 1;
      } catch (error) {
        failed += 1;
        console.error("Failed to fetch archive entry", { entry, error });
      }
    }

    if (added === 0) {
      throw new Error("No files could be downloaded for this archive.");
    }

    toast.loading(`Finalizing ZIP for ${label}...`, { id: toastId });
    const blob = await zip.generateAsync({ type: "blob" });
    saveBlob(blob, archiveName);

    if (failed > 0) {
      toast.success(`Downloaded ZIP for ${label} with ${added} file${added === 1 ? "" : "s"}. ${failed} file${failed === 1 ? "" : "s"} could not be included.`, { id: toastId });
    } else {
      toast.success(`Downloaded ZIP for ${label}.`, { id: toastId });
    }
  } catch (error) {
    console.error("Failed to build ZIP archive", error);
    toast.error(`Failed to prepare ZIP for ${label}.`, { id: toastId });
  }
}

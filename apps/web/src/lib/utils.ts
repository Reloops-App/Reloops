import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FPS = 30;

export function fmtHMSF(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds)) return "00:00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const frames = Math.floor((totalSeconds - Math.floor(totalSeconds)) * FPS);
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":") + ":" + frames.toString().padStart(2, "0");
}

// Format an ISO string to "XX, month,YYYY" format or time ago if less than a day
export function formatTimetoDayMonth(isoString: string) {
  const date = new Date(isoString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInSeconds = Math.floor(diffInMs / 1000);

  if (diffInDays > 0) {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } else if (diffInHours > 0) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  } else if (diffInMinutes > 0) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  } else {
    return `${diffInSeconds} second${diffInSeconds !== 1 ? 's' : ''} ago`;
  }
}



import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { updateAsset } from "@/api";

export async function changeAssetStatus(
  assetId: string,
  newStatus: 'approved' | 'in_review' | 'needs_review' | 'archived' | 'deleted' | null
): Promise<PostgrestSingleResponse<any>> {

  const response = await updateAsset({ id: assetId, status: newStatus });
  const data = await response.json();
  const error = data?.error;
  if (error) {
    console.error('Error updating asset status:', error);
    return { error, data: null, count: null, status: 500, statusText: "Error" };
  }

  return { data, error: null, count: null, status: 200, statusText: "OK" };
}


export function rootIdOf(asset: { id: string; parent_asset_id?: string | null }) {
  return asset.parent_asset_id || asset.id; // v1 has parent_asset_id==id in root-pointer model
}


export function groupByRoot<T extends { id: string; parent_asset_id?: string | null; version_no?: number | null; createdAt?: string | null }>(assets: T[]) {
  const byRoot = new Map<string, T[]>();
  for (const a of assets) {
    const rid = rootIdOf(a);
    if (!byRoot.has(rid)) byRoot.set(rid, []);
    byRoot.get(rid)!.push(a);
  }
  // newest-first inside each stack
  for (const [, arr] of byRoot) {
    arr.sort((A: any, B: any) => {
      const vA = typeof A.version_no === 'number' ? A.version_no : -1;
      const vB = typeof B.version_no === 'number' ? B.version_no : -1;
      if (vA !== vB) return vB - vA;
      const tA = A.createdAt ? new Date(A.createdAt).getTime() : 0;
      const tB = B.createdAt ? new Date(B.createdAt).getTime() : 0;
      return tB - tA;
    });
  }
  return byRoot;
}


export function topOfStack<T>(stack: T[]) { return stack[0]; }

import { toast } from "sonner";

export async function downloadFile(url: string, fileName: string, options?: { silent?: boolean }) {
  const silent = options?.silent ?? false;
  const toastId = silent ? null : toast.loading(`Starting download: ${fileName}...`);
  try {
    // Try to hint the proxy to force download even in fetch
    const fetchUrl = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;

    const response = await fetch(fetchUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Longer timeout to ensure browser has started the download
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 5000);
    if (!silent) {
      toast.success(`Downloaded: ${fileName}`, { id: toastId ?? undefined });
    }
  } catch (error) {
    console.error("Download failed:", error);
    // Fallback if fetch fails (e.g. CORS or network error)
    // Try to hint the proxy to force download if it supports it
    const fallbackUrl = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
    window.open(fallbackUrl, "_blank");
    if (!silent) {
      toast.info("Opening in new tab (Download should start automatically)", { id: toastId ?? undefined });
    }
  }
}

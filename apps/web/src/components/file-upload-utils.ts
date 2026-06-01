
import { getSessionToken, supabase } from "@/lib/supabaseClient";
import * as Sentry from "@/lib/telemetry";

/** ---------- Config ---------- */
export const THUMBNAIL_BUCKET = "thumbnails";
export const THUMB_MAX = { w: 640, h: 640 };
export const THUMB_MIME = "image/jpeg";
export const THUMB_QUALITY = 0.85;
const TRANSPARENT_THUMBNAIL_TYPES = new Set(["image/png", "image/webp", "image/gif", "image/svg+xml"]);

export const ACCEPT = [
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "video/mp4", "video/quicktime", "video/webm", "video/x-matroska",
    ".mov", ".qt", ".m4v", ".mkv",
    "application/pdf",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/ogg",
    "text/plain", "text/csv", "application/json",
].join(",");

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
export const FALLBACK_PART_SIZE = 8 * 1024 * 1024;
export const FALLBACK_MAX_PARALLEL = 4;

// Threshold for single PUT path
export const SINGLE_PUT_THRESHOLD = 128 * 1024 * 1024; // 128MB

export type UploadStatus = "queued" | "uploading" | "completed" | "error" | "canceled";
export type UploadPhase = "prepare" | "upload" | "finalize" | "thumbnail" | "processing" | "done"; // UI stage labels

export interface UploadItem {
    id: string;
    uploadNonce: string; // stable per-file id
    file: File;
    name: string;
    type: string;
    size: number;
    relativePath?: string | null;
    folderId?: string | null;

    progress: number;
    status: UploadStatus;
    phase?: UploadPhase;

    uploadId?: string;
    objectKey?: string;
    uploadBatchId?: string;
    uploadBatchTotal?: number;

    // DB id returned by server
    assetId?: string;

    // thumbnail public URL (filled later; non-blocking)
    coverUrl?: string;
    url?: string;

    errorMessage?: string;
    controllers?: AbortController[];

}

/** ---------- small utils ---------- */
export function uid() { return Math.random().toString(36).slice(2); }
export function isVideo(t: string) { return t.startsWith("video/"); }
export function isImage(t: string) { return t.startsWith("image/"); }
export function isAudio(t: string) { return t.startsWith("audio/"); }
export function isPdf(t: string) { return t === "application/pdf"; }
export function inferFileContentType(file: Pick<File, "name" | "type">) {
    const browserType = String(file.type || "").trim().toLowerCase();
    const fileName = String(file.name || "").toLowerCase();

    if (browserType && browserType !== "application/octet-stream" && browserType !== "binary/octet-stream") {
        return browserType;
    }

    if (fileName.endsWith(".mov") || fileName.endsWith(".qt")) return "video/quicktime";
    if (fileName.endsWith(".m4v")) return "video/x-m4v";
    if (fileName.endsWith(".mp4")) return "video/mp4";
    if (fileName.endsWith(".webm")) return "video/webm";
    if (fileName.endsWith(".mkv")) return "video/x-matroska";

    return browserType || "application/octet-stream";
}
export function maxBytesForMime(t: string) {
    if (isVideo(t)) return MAX_VIDEO_BYTES;
    if (isAudio(t)) return MAX_AUDIO_BYTES;
    if (isPdf(t) || t.startsWith("text/") || t === "application/json") return MAX_DOCUMENT_BYTES;
    return MAX_IMAGE_BYTES;
}
export function formatBytes(bytes: number) {
    if (bytes === 0) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

const RELATIVE_PATH_SYMBOL = Symbol("relativePath");

type UploadableFile = File & {
    webkitRelativePath?: string;
    [RELATIVE_PATH_SYMBOL]?: string;
};

type WebkitFileSystemEntry = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
};

type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
    file: (successCallback: (file: File) => void, errorCallback?: (err: DOMException) => void) => void;
};

type WebkitFileSystemDirectoryReader = {
    readEntries: (
        successCallback: (entries: WebkitFileSystemEntry[]) => void,
        errorCallback?: (err: DOMException) => void,
    ) => void;
};

type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
    createReader: () => WebkitFileSystemDirectoryReader;
};

type DataTransferItemWithWebkitEntry = DataTransferItem & {
    webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

function attachRelativePath(file: File, relativePath?: string | null) {
    const uploadable = file as UploadableFile;
    if (relativePath) {
        Object.defineProperty(uploadable, RELATIVE_PATH_SYMBOL, {
            value: relativePath,
            configurable: true,
        });
    }
    return uploadable;
}

export function getRelativeFilePath(file: File) {
    const uploadable = file as UploadableFile;
    const path = uploadable[RELATIVE_PATH_SYMBOL] || uploadable.webkitRelativePath || "";
    return path.includes("/") ? path : null;
}

async function readAllDirectoryEntries(reader: WebkitFileSystemDirectoryReader): Promise<WebkitFileSystemEntry[]> {
    const entries: WebkitFileSystemEntry[] = [];

    while (true) {
        const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });

        if (!batch.length) break;
        entries.push(...batch);
    }

    return entries;
}

async function collectFilesFromEntry(entry: WebkitFileSystemEntry, parentPath = ""): Promise<File[]> {
    if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
            (entry as WebkitFileSystemFileEntry).file(resolve, reject);
        });
        const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
        return [attachRelativePath(file, relativePath)];
    }

    if (entry.isDirectory) {
        const directoryEntry = entry as WebkitFileSystemDirectoryEntry;
        const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        const childEntries = await readAllDirectoryEntries(directoryEntry.createReader());
        const nestedFiles = await Promise.all(childEntries.map((child) => collectFilesFromEntry(child, nextPath)));
        return nestedFiles.flat();
    }

    return [];
}

/** 
 * Deeply extract files from DataTransfer, handling possible placeholders or folders
 */
export async function getFilesFromEvent(e: React.DragEvent | DragEvent): Promise<File[]> {
    const files: File[] = [];
    const dt = e.dataTransfer;
    if (!dt) return [];

    if (dt.items && dt.items.length > 0) {
        const entryItems = Array.from(dt.items)
            .map((item) => item as DataTransferItemWithWebkitEntry)
            .map((item) => item.webkitGetAsEntry?.())
            .filter((entry): entry is WebkitFileSystemEntry => Boolean(entry));

        if (entryItems.length > 0) {
            const nestedFiles = await Promise.all(entryItems.map((entry) => collectFilesFromEntry(entry)));
            return nestedFiles.flat();
        }

        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }
    } else if (dt.files && dt.files.length > 0) {
        files.push(...Array.from(dt.files));
    }

    return files;
}

/**
 * Sanity check: is this a common media type that is suspiciously small?
 * (e.g. a video that is < 2KB is likely a shortcut or placeholder)
 */
export function isSuspiciouslySmall(file: File): { suspicious: boolean; message?: string } {
    const contentType = inferFileContentType(file);

    if (isVideo(contentType) && file.size < 5000) {
        Sentry.captureMessage("Suspiciously small video", {
            level: "warning",
            extra: { fileName: file.name, fileSize: file.size, fileType: file.type, contentType }
        });
        return { suspicious: true, message: "File is suspiciously small. Try clicking to upload instead of dragging." };
    }
    if (isImage(contentType) && file.size < 100) {
        Sentry.captureMessage("Suspiciously small image", {
            level: "warning",
            extra: { fileName: file.name, fileSize: file.size, fileType: file.type, contentType }
        });
        return { suspicious: true, message: "File is suspiciously small. Try clicking to upload instead of dragging." };
    }
    return { suspicious: false };
}

/** ---------- image/video helpers ---------- */
function imgFit(w: number, h: number, maxW: number, maxH: number) {
    const r = Math.min(maxW / w, maxH / h, 1);
    return { w: Math.round(w * r), h: Math.round(h * r) };
}

async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
    const ab = await file.arrayBuffer();
    const blob = new Blob([ab], { type: file.type });
    return await createImageBitmap(blob);
}

async function makeImageThumbnail(file: File): Promise<Blob> {
    const bitmap = await fileToImageBitmap(file);
    const { w, h } = imgFit(bitmap.width, bitmap.height, THUMB_MAX.w, THUMB_MAX.h);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const outputMime = TRANSPARENT_THUMBNAIL_TYPES.has(file.type) ? "image/png" : THUMB_MIME;
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), outputMime, THUMB_QUALITY));
    return blob;
}

export async function makeVideoThumbnail(file: File): Promise<Blob | null> {
    const url = URL.createObjectURL(file);

    try {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        // crossOrigin not needed for blob URLs, and can cause weirdness on some browsers
        // video.crossOrigin = "anonymous";

        // Ensure load kicks off
        video.load();

        // 1. Wait for metadata
        await new Promise<void>((resolve, reject) => {
            const onLoaded = () => resolve();
            const onError = (e: any) => {
                const videoError = video.error;
                const errorMsg = videoError
                    ? `Video metadata load error: code ${videoError.code}, msg: ${videoError.message}`
                    : (e?.message || "Video metadata load error");
                reject(new Error(errorMsg));
            };

            video.addEventListener("loadedmetadata", onLoaded, { once: true });
            video.addEventListener("error", onError, { once: true });
        });

        // 2. Choose a safe target time (midpoint, but not at t=0 or at duration)
        let duration = video.duration;
        if (!isFinite(duration) || duration <= 0) {
            duration = 1; // fallback
        }

        const mid = duration / 2;
        const targetTime = Math.min(duration - 0.1, Math.max(0.1, mid)); // between 0.1s and duration-0.1

        // 3. Seek with timeout so we don't hang forever
        await new Promise<void>((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                video.removeEventListener("seeked", onSeeked);
                video.removeEventListener("error", onError);
                reject(new Error("Video seek timeout"));
            }, 5000);

            const onSeeked = () => {
                clearTimeout(timeoutId);
                resolve();
            };

            const onError = (e: any) => {
                clearTimeout(timeoutId);
                const videoError = video.error;
                const errorMsg = videoError
                    ? `Video error during seek: code ${videoError.code}, msg: ${videoError.message}`
                    : (e?.message || "Video error during seek");
                reject(new Error(errorMsg));
                Sentry.captureException(new Error(`Video seek error for ${file.name}`), {
                    level: "error",
                    extra: { fileName: file.name, fileSize: file.size, fileType: file.type, originalError: e }
                });
            };

            video.addEventListener("seeked", onSeeked, { once: true });
            video.addEventListener("error", onError, { once: true });

            try {
                video.currentTime = targetTime;
            } catch (e) {
                clearTimeout(timeoutId);
                reject(e);
            }
        });

        // 4. Draw frame
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const { w, h } = imgFit(vw, vh, THUMB_MAX.w, THUMB_MAX.h);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get 2D context");

        ctx.drawImage(video, 0, 0, w, h);

        // 5. Convert to Blob (may be null in some browsers)
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, THUMB_MIME, THUMB_QUALITY)
        );

        return blob;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function generateThumbnailBlob(file: File): Promise<Blob | null> {
    try {
        const contentType = inferFileContentType(file);
        if (isImage(contentType)) return await makeImageThumbnail(file);
        if (isVideo(contentType)) return await makeVideoThumbnail(file);
        return null;
    } catch (e) {
        console.error("Thumbnail generation failed", e, "for file", file.name);
        Sentry.captureException(e, {
            extra: { fileName: file.name, fileSize: file.size, fileType: file.type, originalError: e }
        });
        return null;
    }
}


/** Supabase Storage upload + public URL */
export async function uploadThumbAndGetUrl(params: {
    workspaceId: string;
    assetId: string;
    baseName: string;
    blob: Blob | null;
}) {
    const { workspaceId, assetId, baseName, blob } = params;
    if (!blob) return null;
    const contentType = blob.type || THUMB_MIME;
    const ext = contentType === "image/png" ? ".png" : ".jpg";
    // sanitize: replace anything that isn't alphanumeric, dot, or hyphen with underscores
    const safeBase = baseName.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_").slice(0, 180) || "unnamed";
    const path = `assets/${workspaceId}/${assetId}/${safeBase}${ext}`;

    // Use manual fetch to bypass broken Supabase client session
    const token = await getSessionToken();
    if (!token) {
        console.error("No session token available for thumbnail upload");
        return null;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${THUMBNAIL_BUCKET}/${path}`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "x-upsert": "true",
            // Do NOT set Content-Type here, let browser set it with boundary for FormData
            // Actually for raw binary body, we DO set it.
            "Content-Type": contentType,
        },
        body: blob,
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error("Thumbnail upload failed", res.status, errText);
        Sentry.captureMessage("Thumbnail upload failed", {
            level: "error",
            extra: { status: res.status, error: errText, workspaceId, assetId, path, requestUrl: url }
        });
        throw new Error(`Thumbnail upload failed: ${res.status}`);
    }

    const { data } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
    Sentry.captureMessage("Thumbnail uploaded", {
        level: "info",
        extra: { status: res.status, workspaceId, assetId, path, requestUrl: url }
    });
    return data.publicUrl ?? null;
}

export async function setAssetCoverUrl(assetId: string, coverUrl: string) {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asset`;
    const res = await fetch(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${await getSessionToken()}`,
        },
        body: JSON.stringify({ id: assetId, cover_image_url: coverUrl }),
    });
    if (!res.ok) {
        const errText = await res.text();
        console.error("Failed to update cover url", res.status, errText);
        Sentry.captureException(new Error(`Failed to update cover url: ${res.status}`), {
            level: "error",
            extra: {
                status: res.status, error: errText, assetId, coverUrl, requestUrl: url
            }
        });
        throw new Error(`Failed to update cover url: ${res.status}`);
    }
    Sentry.captureMessage("Cover url updated", {
        level: "info",
        extra: { assetId, coverUrl, requestUrl: url }
    });
}

/** Adaptive parallel: mildly higher on desktop */
export function pickParallel(defaultParallel: number) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const cores = (navigator as any).hardwareConcurrency ?? 4;
    const base = isMobile ? Math.min(3, cores) : Math.min(8, Math.max(defaultParallel || 4, Math.ceil(cores / 2)));
    return Math.max(2, base);
}

/** Upload a small file with a single signed PUT, using XHR to get progress events */
export async function uploadSingleWithProgress(url: string, file: File, onProgress: (pct: number) => void, signal?: AbortSignal) {
    Sentry.captureMessage(`Starting single-put upload for ${file.name}`, {
        level: "info",
        extra: { fileName: file.name, fileSize: file.size }
    });

    // fetch() has no upload progress, so use XHR here
    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) onProgress(Math.floor((evt.loaded / evt.total) * 100));
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                console.log(`[XHR] Upload success for ${file.name}`);
                Sentry.captureMessage(`Upload success: ${file.name}`, {
                    level: "info",
                    extra: { url: url, status: xhr.status, fileName: file.name, fileSize: file.size }
                });
                resolve();
            } else {
                console.error(`[XHR] Upload failed for ${file.name} status ${xhr.status}`);
                Sentry.captureMessage(`Upload failed: ${file.name}`, {
                    level: "error",
                    extra: { url: url, status: xhr.status, fileName: file.name, fileSize: file.size }
                });
                reject(new Error(`PUT failed: ${xhr.status}`));
            }
        };
        xhr.onerror = (e) => {
            console.error(`[XHR] Network error for ${file.name}`);
            Sentry.captureMessage(`Upload network error: ${file.name}`, {
                level: "error",
                extra: { fileName: file.name, fileSize: file.size }
            });
            reject(new Error("Network error"));
        };
        if (signal) {
            const onAbort = () => {
                console.log(`[XHR] Aborted ${file.name}`);
                try { xhr.abort(); } catch { }
                reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
                Sentry.captureMessage(`Upload aborted: ${file.name}`, {
                    level: "info",
                    extra: { fileName: file.name, fileSize: file.size }
                });
            };
            signal.addEventListener("abort", onAbort, { once: true });
        }
        xhr.send(file);
    });
} 

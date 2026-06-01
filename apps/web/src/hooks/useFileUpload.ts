import { useEffect, useRef, useState } from "react";
import {
    UploadItem,
    uid,
    isPdf,
    maxBytesForMime,
    generateThumbnailBlob,
    isSuspiciouslySmall,
    getRelativeFilePath,
} from "@/components/file-upload-utils";
import { invokeEdgeFunction } from "@/api/edge";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export interface UseFileUploadProps {
    workspaceId: string;
    projectId?: string | null;
    folderId?: string | null;
    onUploaded?: (file: { id: string; name: string; type: string; sizeBytes: number; coverUrl?: string; url?: string; folderId?: string | null; projectId?: string | null }) => void;
}

function extensionFor(fileName: string) {
    const ext = fileName.split(".").pop()?.trim();
    return ext && ext !== fileName ? ext : "bin";
}

function publicUrl(bucket: string, path: string) {
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function useFileUpload({ workspaceId, projectId, folderId, onUploaded }: UseFileUploadProps) {
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [skippedNames, setSkippedNames] = useState<string[]>([]);
    const canceledRef = useRef<Set<string>>(new Set());
    const processingIdsRef = useRef<Set<string>>(new Set());
    const folderMapRef = useRef<Map<string, string>>(new Map());
    const folderCacheLoadedRef = useRef(false);

    function overLimit(file: File) {
        return file.size > maxBytesForMime(file.type || "application/octet-stream");
    }

    function folderKey(parentId: string | null, name: string) {
        return `${parentId ?? "__root__"}::${name}`;
    }

    async function ensureFolderCacheLoaded() {
        if (folderCacheLoadedRef.current) return;
        const { data, error } = await invokeEdgeFunction<{ data?: Array<{ id: string; name: string; parent_folder_id?: string | null }> }>("asset", {
            body: {
                action: "list_folders",
                workspace_id: workspaceId,
                ...(projectId ? { project_id: projectId } : {}),
            },
        });
        if (error) throw error;

        const nextMap = new Map<string, string>();
        for (const folder of Array.isArray(data?.data) ? data.data : []) {
            nextMap.set(folderKey(folder.parent_folder_id ? String(folder.parent_folder_id) : null, String(folder.name)), String(folder.id));
        }
        folderMapRef.current = nextMap;
        folderCacheLoadedRef.current = true;
    }

    async function createFolderInScope(name: string, parentFolderId: string | null) {
        const cacheKey = folderKey(parentFolderId, name);
        const existingId = folderMapRef.current.get(cacheKey);
        if (existingId) return existingId;

        const { data, error } = await invokeEdgeFunction<{ data?: { id: string; name: string; parent_folder_id?: string | null } }>("asset", {
            body: {
                action: "create_folder",
                workspace_id: workspaceId,
                ...(projectId ? { project_id: projectId } : {}),
                parent_folder_id: parentFolderId,
                name,
            },
        });

        if (error) throw error;
        if (!data?.data?.id) throw new Error("No folder returned");

        const createdFolderId = String(data.data.id);
        folderMapRef.current.set(cacheKey, createdFolderId);
        window.dispatchEvent(new CustomEvent("asset-folders:changed", {
            detail: { workspaceId, projectId: projectId ?? null, folderId: createdFolderId },
        }));
        return createdFolderId;
    }

    async function resolveFolderIdForFile(file: File) {
        const relativePath = getRelativeFilePath(file);
        if (!relativePath) return folderId ?? null;

        const segments = relativePath.split("/").filter(Boolean);
        if (segments.length <= 1) return folderId ?? null;

        await ensureFolderCacheLoaded();

        let parentFolderId = folderId ?? null;
        for (const segment of segments.slice(0, -1)) {
            parentFolderId = folderMapRef.current.get(folderKey(parentFolderId, segment)) ?? await createFolderInScope(segment, parentFolderId);
        }
        return parentFolderId;
    }

    function currentKeysSet(list: UploadItem[]) {
        return new Set(list.map((u) => `${u.relativePath ?? u.name}|${u.size}`));
    }

    function addFiles(files: FileList | File[]) {
        const list = Array.from(files);
        const uploadBatchId = crypto.randomUUID();
        const uploadBatchTotal = list.filter((f) => f.size > 0 && !!f.name).length;
        const incoming: UploadItem[] = list
            .filter((f) => f.size > 0 && !!f.name)
            .map((f) => {
                const check = isSuspiciouslySmall(f);
                return {
                    id: uid(),
                    uploadNonce: crypto.randomUUID(),
                    uploadBatchId,
                    uploadBatchTotal,
                    file: f,
                    name: f.name,
                    type: f.type || "application/octet-stream",
                    size: f.size,
                    relativePath: getRelativeFilePath(f),
                    folderId: getRelativeFilePath(f) ? undefined : (folderId ?? null),
                    progress: 0,
                    status: (overLimit(f) || check.suspicious) ? "error" : "queued",
                    errorMessage: overLimit(f)
                        ? `File exceeds limit (${Math.round(maxBytesForMime(f.type || "application/octet-stream") / 1024 / 1024)}MB).`
                        : check.suspicious ? check.message : undefined,
                } as UploadItem;
            });

        setUploads((prev) => {
            const keys = currentKeysSet(prev);
            const deduped: UploadItem[] = [];
            const skipped: string[] = [];
            for (const item of incoming) {
                const key = `${item.relativePath ?? item.name}|${item.size}`;
                if (keys.has(key)) {
                    skipped.push(item.name);
                    continue;
                }
                keys.add(key);
                deduped.push(item);
            }
            setSkippedNames(skipped);
            return [...prev, ...deduped];
        });
    }

    async function startUpload(item: UploadItem) {
        setUploads((prev) => prev.map((u) => u.id === item.id ? ({ ...u, status: "uploading", phase: "prepare", progress: 0 }) : u));

        try {
            const resolvedFolderId = await resolveFolderIdForFile(item.file);
            if (canceledRef.current.has(item.id)) return;

            const assetId = crypto.randomUUID();
            const objectKey = `${workspaceId}/${projectId ?? "library"}/${assetId}.${extensionFor(item.name)}`;

            setUploads((prev) => prev.map((u) => u.id === item.id ? ({ ...u, phase: "upload", folderId: resolvedFolderId }) : u));

            const { error: uploadError } = await supabase.storage
                .from("assets")
                .upload(objectKey, item.file, {
                    contentType: item.type || "application/octet-stream",
                    upsert: false,
                });
            if (uploadError) throw uploadError;

            if (canceledRef.current.has(item.id)) return;
            setUploads((prev) => prev.map((u) => u.id === item.id ? ({ ...u, phase: "thumbnail", progress: 100, assetId, objectKey }) : u));

            let coverUrl: string | null = null;
            let thumbnailPath: string | null = null;
            if (!isPdf(item.type)) {
                const blob = await generateThumbnailBlob(item.file).catch(() => null);
                if (blob) {
                    thumbnailPath = `${workspaceId}/${assetId}.jpg`;
                    const { error: thumbError } = await supabase.storage
                        .from("thumbnails")
                        .upload(thumbnailPath, blob, { contentType: blob.type || "image/jpeg", upsert: true });
                    if (!thumbError) coverUrl = publicUrl("thumbnails", thumbnailPath);
                }
            }

            const { error: insertError } = await supabase.from("assets").insert({
                id: assetId,
                workspace_id: workspaceId,
                project_id: projectId ?? null,
                folder_id: resolvedFolderId,
                title: item.name,
                storage_path: objectKey,
                cover_image_url: coverUrl,
                thumbnail_path: thumbnailPath,
                mime_type: item.type || "application/octet-stream",
                size_bytes: item.size,
                uploaded_by: (await supabase.auth.getUser()).data.user?.id ?? null,
                upload_batch_id: item.uploadBatchId ?? null,
                upload_batch_total: item.uploadBatchTotal ?? null,
            });
            if (insertError) throw insertError;

            setUploads((prev) => prev.map((u) => u.id === item.id ? ({
                ...u,
                status: "completed",
                phase: "done",
                progress: 100,
                coverUrl: coverUrl ?? undefined,
                url: objectKey,
            }) : u));

            onUploaded?.({
                id: assetId,
                name: item.name,
                type: item.type || "application/octet-stream",
                sizeBytes: item.size,
                coverUrl: coverUrl ?? undefined,
                url: objectKey,
                folderId: resolvedFolderId,
                projectId: projectId ?? null,
            });
        } catch (e: any) {
            const msg = e?.message || "Upload failed";
            console.error("[useFileUpload] Supabase upload failed", e);
            toast.error(msg);
            setUploads((prev) => prev.map((u) => u.id === item.id ? ({ ...u, status: "error", errorMessage: msg }) : u));
        } finally {
            processingIdsRef.current.delete(item.id);
        }
    }

    useEffect(() => {
        const queued = uploads.filter((u) => u.status === "queued" && !overLimit(u.file));
        for (const upload of queued) {
            if (processingIdsRef.current.has(upload.id)) continue;
            processingIdsRef.current.add(upload.id);
            void startUpload(upload);
        }
    }, [uploads]);

    useEffect(() => {
        folderMapRef.current = new Map();
        folderCacheLoadedRef.current = false;
    }, [workspaceId, projectId, folderId]);

    async function cancelUpload(id: string) {
        canceledRef.current.add(id);
        setUploads((prev) => prev.map((x) => x.id === id ? ({ ...x, status: "canceled" }) : x));
    }

    function removeUpload(id: string) {
        setUploads((prev) => prev.filter((x) => x.id !== id));
        canceledRef.current.delete(id);
    }

    function clearCompleted() {
        setUploads((prev) => prev.filter((u) => u.status !== "completed" && u.status !== "canceled"));
    }

    return {
        uploads,
        addFiles,
        cancelUpload,
        removeUpload,
        clearCompleted,
        skippedNames,
        activeUploads: uploads.filter((u) => u.status === "uploading" || u.status === "queued"),
        completedUploads: uploads.filter((u) => u.status === "completed"),
    };
}

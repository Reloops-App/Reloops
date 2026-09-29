import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Download, File as FileIcon, FolderInput, Loader2, Lock, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import { AssetCard } from "@/pages/Campaign/components/AssetCard";
import { appendDuplicateSuffix, folderPathParts, sanitizeDownloadName } from "@/pages/Campaign/CampaignDetailsSearch";
import FolderLevelCard from "@/pages/Campaign/components/FolderLevelCard";
import type { FolderRow } from "@/pages/Campaign/CampaignDetailsSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ShareAuthDialog } from "@/components/review/ShareAuthDialog";
import BulkProjectActionDialog from "@/pages/Campaign/components/BulkProjectActionDialog";
import { useGuestMoveDestination } from "./useGuestMoveDestination";
import { downloadZipArchive } from "@/lib/downloadArchive";
import { ensureFreshSupabaseSession, getSupabaseUserFromStorage } from "@/lib/supabaseAuthApi";
import { resolveAssetDownloadUrl } from "@/lib/mediaDelivery";
import { cn, downloadFile } from "@/lib/utils";
import { buildRecursiveFolderAssetCounts } from "@/lib/assetUtils";
import {
  createShareGuestIdentity,
  loadShareGuestIdentity,
  saveShareGuestIdentity,
  type ShareIdentity,
} from "@/lib/shareGuestIdentity";
import { clearSharePassword, setSharePassword, withSharePassword } from "@/lib/shareLinkPassword";
import { isDangerousFile, uid, uploadPartWithProgress, uploadSingleWithProgress, type UploadItem } from "@/components/file-upload-utils";
import { UploadProgressCard } from "@/components/upload/UploadProgressCard";
import { isRawImageFileName, isRawImageMime } from "@/lib/rawImageFormats";
import { generateThumbnailBlob, prepareRawPreview, type PreparedRawPreview } from "@/components/file-upload-utils";
import { RAW_POLL_INTERVAL_MS, RAW_POLL_MAX_ATTEMPTS } from "@/lib/rawPreviewPolling";
import { assetsAwaitingServerCover } from "@/lib/assetCoverWait";
import { keepRecentLocalRows, prependUploadedRow } from "@/lib/guestUploadRows";
import { AnimatePresence } from "framer-motion";

// Raw shape returned by the project-share edge function ("select *" on assets/asset_folders).
type SharedAssetRow = {
  id: string;
  title?: string | null;
  cover_image_url?: string | null;
  mime_type?: string | null;
  storage_path?: string | null;
  folder_id?: string | null;
  status?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  assigned_to?: string | null;
  version_no?: number | null;
  parent_asset_id?: string | null;
  comments_count?: number;
  uploaded_via_share_link_id?: string | null;
  // OSS: server-signed URL for the private assets bucket (see project-share).
  signed_url?: string | null;
};

type ProjectShareLink = {
  id: string;
  allow_upload: boolean;
  allow_download: boolean;
  project: { id: string; name: string; workspace_id: string };
  assets: SharedAssetRow[];
  folders: FolderRow[];
  folder_id: string | null;
  shared_folder: FolderRow | null;
  folder_ids: string[] | null;
  asset_root_ids: string[] | null;
  is_member?: boolean;
};

// Same field mapping the authenticated project page uses
// (apps/web/src/pages/Campaign/Campaign.tsx) to go from the wire shape to
// the shape AssetCard expects — kept in sync by hand since that file isn't
// touched by this feature.
//
// Memoized per raw row: `AssetCard` is `memo`'d on referential equality of its
// `asset` prop, so an in-place `setShare` (upload append / move patch) that
// keeps the untouched rows' object identity must also keep their display
// object's identity, or every card in the grid re-renders anyway.
const displayAssetCache = new WeakMap<SharedAssetRow, ReturnType<typeof buildDisplayAsset>>();
function toDisplayAsset(a: SharedAssetRow) {
  const cached = displayAssetCache.get(a);
  if (cached) return cached;
  const built = buildDisplayAsset(a);
  displayAssetCache.set(a, built);
  return built;
}
function buildDisplayAsset(a: SharedAssetRow) {
  return {
    id: a.id,
    name: a.title ?? "Untitled",
    type: a.mime_type ?? "",
    createdAt: a.created_at ?? undefined,
    coverUrl: a.cover_image_url ?? undefined,
    url: a.storage_path ?? undefined,
    status: a.status ?? undefined,
    version_no: a.version_no ?? undefined,
    parent_asset_id: a.parent_asset_id ?? undefined,
    comments_count: a.comments_count ?? 0,
    updated_at: a.updated_at ?? undefined,
    updated_by: a.updated_by ?? undefined,
    assigned_to: a.assigned_to ?? undefined,
    uploaded_via_share_link_id: a.uploaded_via_share_link_id ?? undefined,
    signed_url: a.signed_url ?? undefined,
  };
}

function selectionSummaryLabel(folderIds: string[], assetRootIds: string[]) {
  const parts: string[] = [];
  if (folderIds.length > 0) parts.push(`${folderIds.length} folder${folderIds.length === 1 ? "" : "s"}`);
  if (assetRootIds.length > 0) parts.push(`${assetRootIds.length} file${assetRootIds.length === 1 ? "" : "s"}`);
  return parts.join(", ") || "Shared selection";
}

async function callProjectShare(action: string, body: Record<string, unknown>) {
  const token = typeof body.token === "string" ? body.token : undefined;
  const finalBody = token ? withSharePassword(token, { action, ...body }) : { action, ...body };
  const { data, error } = await invokeEdgeFunction("project-share", { body: finalBody });
  if (error) {
    const err = new Error(error.message || "project-share request failed") as Error & { status?: number };
    err.status = error.status;
    throw err;
  }
  return data?.data;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

// A guest has no storage credentials, so the browser-made RAW cover + preview go through the share-upload function.
// Best effort: a failure never breaks the upload (the thumbnail worker still makes the preview).
async function saveGuestRawPreview(token: string, assetId: string, prepared: PreparedRawPreview) {
  try {
    const [cover_b64, preview_b64] = await Promise.all([blobToBase64(prepared.cover), blobToBase64(prepared.preview)]);
    const { error } = await invokeEdgeFunction("project-share-upload", {
      body: withSharePassword(token, { action: "set-preview", token, assetId, cover_b64, preview_b64, width: prepared.width, height: prepared.height }),
    });
    if (error) console.warn("Guest RAW preview not saved", error);
  } catch (error) {
    console.warn("Guest RAW preview not saved", error);
  }
}

// Reloops OSS has no thumbnail worker, so the guest's browser makes a video's
// cover (the same generator member uploads use) and stores it through the
// share-upload function. Best effort: without it the tile keeps its file icon.
async function saveGuestVideoCover(token: string, assetId: string, file: File) {
  try {
    const cover = await generateThumbnailBlob(file);
    if (!cover) return null;
    const { data, error } = await invokeEdgeFunction("project-share-upload", {
      body: withSharePassword(token, { action: "set-preview", token, assetId, cover_b64: await blobToBase64(cover) }),
    });
    if (error) {
      console.warn("Guest video cover not saved", error);
      return null;
    }
    return (data as { cover_image_url?: string } | null)?.cover_image_url ?? null;
  } catch (error) {
    console.warn("Guest video cover not saved", error);
    return null;
  }
}

// Mirrors project-share-upload/index.ts's own GUEST_SINGLE_PUT_MAX_BYTES --
// duplicated rather than shared, per this feature's isolation convention
// (see that file's header comment).
// OSS: Supabase Storage takes every guest file as one signed PUT (up to the 2 GB bucket limit).
const GUEST_SINGLE_PUT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const GUEST_MULTIPART_MAX_PARALLEL_FALLBACK = 4;

// Duplicate of lib/b2client.ts's splitParts -- same isolation reasoning as
// above, this feature never imports from the member-upload pipeline.
function splitFileParts(file: File, partSize: number) {
  const parts: { partNumber: number; start: number; end: number }[] = [];
  let partNumber = 1;
  for (let start = 0; start < file.size; start += partSize) {
    const end = Math.min(file.size, start + partSize);
    parts.push({ partNumber: partNumber++, start, end });
  }
  return parts;
}

async function uploadGuestFile(
  file: File,
  token: string,
  identity: ShareIdentity,
  folderId: string | null,
  onProgress: (uploadedBytes: number) => void,
  signal: AbortSignal,
) {
  if (file.size > GUEST_SINGLE_PUT_MAX_BYTES) {
    return uploadGuestFileMultipart(file, token, identity, folderId, onProgress, signal);
  }

  const presign = await invokeEdgeFunction("project-share-upload", {
    body: withSharePassword(token, {
      action: "presign",
      token,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      clientNonce: crypto.randomUUID(),
    }),
  });
  if (presign.error) throw new Error(presign.error.message || "Failed to start upload");
  const { url, assetId, objectKey } = presign.data as { url: string; assetId: string; objectKey: string };

  await uploadSingleWithProgress(
    url,
    file,
    (pct) => onProgress(Math.floor((pct / 100) * file.size)),
    signal,
    file.type || "application/octet-stream",
  );

  const complete = await invokeEdgeFunction("project-share-upload", {
    body: withSharePassword(token, {
      action: "complete",
      token,
      assetId,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      objectKey,
      folderId: folderId ?? undefined,
      guest_name: identity.type === "guest" ? identity.name : undefined,
      guest_email: identity.type === "guest" ? identity.email : undefined,
    }),
  });
  if (complete.error) throw new Error(complete.error.message || "Failed to finish upload");
  return { id: assetId, objectKey };
}

async function uploadGuestFileMultipart(
  file: File,
  token: string,
  identity: ShareIdentity,
  folderId: string | null,
  onProgress: (uploadedBytes: number) => void,
  signal: AbortSignal,
) {
  const contentType = file.type || "application/octet-stream";

  const start = await invokeEdgeFunction("project-share-upload", {
    body: withSharePassword(token, {
      action: "multipart-start",
      token,
      fileName: file.name,
      contentType,
      sizeBytes: file.size,
      clientNonce: crypto.randomUUID(),
    }),
  });
  if (start.error) throw new Error(start.error.message || "Failed to start upload");
  const { uploadId, objectKey, assetId, suggestedPartSize, maxParallel } = start.data as {
    uploadId: string;
    objectKey: string;
    assetId: string;
    suggestedPartSize: number;
    maxParallel: number;
  };

  const parts = splitFileParts(file, suggestedPartSize);

  const signBatch = await invokeEdgeFunction("project-share-upload", {
    body: withSharePassword(token, {
      action: "multipart-sign-batch",
      token,
      objectKey,
      uploadId,
      partNumbers: parts.map((p) => p.partNumber),
    }),
  });
  if (signBatch.error) throw new Error(signBatch.error.message || "Failed to prepare upload");
  const { urls } = signBatch.data as { urls: { partNumber: number; url: string }[] };
  const urlByPart = new Map(urls.map((u) => [u.partNumber, u.url]));

  const uploadedParts: { partNumber: number; etag?: string }[] = [];
  const queue = parts.slice();
  const bytesByPart = new Map<number, number>();
  let failure: unknown = null;

  function reportProgress() {
    let total = 0;
    for (const bytes of bytesByPart.values()) total += bytes;
    onProgress(total);
  }

  async function worker() {
    while (queue.length && !failure) {
      const part = queue.shift();
      if (!part) return;
      const url = urlByPart.get(part.partNumber);
      if (!url) {
        failure = new Error(`Missing upload URL for part ${part.partNumber}`);
        return;
      }
      try {
        const blob = file.slice(part.start, part.end);
        const etag = await uploadPartWithProgress(
          url,
          blob,
          (loadedBytes) => {
            bytesByPart.set(part.partNumber, loadedBytes);
            reportProgress();
          },
          signal,
        );
        uploadedParts.push({ partNumber: part.partNumber, etag });
      } catch (err) {
        failure = err;
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxParallel || GUEST_MULTIPART_MAX_PARALLEL_FALLBACK, parts.length) }, () => worker()),
  );

  if (failure) {
    await invokeEdgeFunction("project-share-upload", {
      body: withSharePassword(token, { action: "multipart-abort", token, objectKey, uploadId }),
    }).catch(() => {});
    throw failure instanceof Error ? failure : new Error("Upload failed");
  }

  uploadedParts.sort((a, b) => a.partNumber - b.partNumber);

  const complete = await invokeEdgeFunction("project-share-upload", {
    body: withSharePassword(token, {
      action: "multipart-complete",
      token,
      assetId,
      fileName: file.name,
      contentType,
      sizeBytes: file.size,
      objectKey,
      uploadId,
      parts: uploadedParts,
      folderId: folderId ?? undefined,
      guest_name: identity.type === "guest" ? identity.name : undefined,
      guest_email: identity.type === "guest" ? identity.email : undefined,
    }),
  });
  if (complete.error) throw new Error(complete.error.message || "Failed to finish upload");
  return { id: assetId, objectKey };
}

export default function ShareProject() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "expired" | "revoked" | "unknown" | null>(null);
  const [share, setShare] = useState<ProjectShareLink | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [identity, setIdentity] = useState<ShareIdentity | null>(null);
  const [checkingIdentity, setCheckingIdentity] = useState(true);
  const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  // Snapshotted at file-selection time (not upload time) so a guest who
  // navigates into a different folder while the identity prompt is open still
  // gets the upload placed where they were when they picked the files.
  const [pendingUploadFolderId, setPendingUploadFolderId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetIds, setMoveTargetIds] = useState<string[]>([]);
  const [movingAsset, setMovingAsset] = useState(false);
  const [pendingMoveAssetIds, setPendingMoveAssetIds] = useState<string[] | null>(null);
  // Lightweight multi-select for reorganising files the viewer added through
  // this link. Selection mode is DERIVED (Campaign-style): either the guest hit
  // "Select", or they ticked a hover checkbox and there's a selection. It can
  // only be entered by an identified viewer (see handleStartSelection).
  const [selectionIntent, setSelectionIntent] = useState(false);
  const [pendingSelectionIntent, setPendingSelectionIntent] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionMode = selectionIntent || selectedIds.length > 0;
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledRef = useRef<Set<string>>(new Set());
  const uploadBatchRef = useRef(0);
  // Object URLs for just-uploaded image previews (shown in place until the real
  // thumbnail arrives on the next natural refetch). Revoked on unmount.
  const previewBlobUrlsRef = useRef<string[]>([]);
  useEffect(() => () => {
    previewBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  // Latest share for the refresh below, which runs from a timer and must not read a stale closure.
  const shareRef = useRef<ProjectShareLink | null>(null);
  shareRef.current = share;
  const rawCoverPollRef = useRef<number | null>(null);
  // When each of this guest's own uploads was added to the grid, so a background refresh cannot drop a tile it does not have yet.
  const guestUploadedAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => () => {
    if (rawCoverPollRef.current !== null) window.clearInterval(rawCoverPollRef.current);
  }, []);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordSubmitError, setPasswordSubmitError] = useState<string | null>(null);
  const [checkingPassword, setCheckingPassword] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // The share payload names a landing folder (folder_id, or root). We jump to it
  // once, on first load. Later refreshes (after an upload / move / status
  // change re-fetch the share) must NOT re-run that jump, or a guest working
  // inside a subfolder gets thrown back out to the root every time.
  const initialFolderAppliedRef = useRef(false);

  useEffect(() => {
    initialFolderAppliedRef.current = false;
  }, [token]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const user = getSupabaseUserFromStorage();
      if (user && mounted) {
        setIdentity({
          type: "user",
          name: String((user as any).user_metadata?.full_name || (user as any).email || "User"),
          email: String((user as any).email || (user as any).user_metadata?.email || ""),
          userId: String((user as any).id),
          avatarUrl: (user as any).user_metadata?.avatar_url ?? null,
        });
        setCheckingIdentity(false);
        return;
      }
      const stored = loadShareGuestIdentity();
      if (stored && mounted) setIdentity(stored);
      if (mounted) setCheckingIdentity(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // `silent` = a background refresh after a mutation the UI has already
  // reflected locally. It must never flip `loading`, which would tear the whole
  // page down for a full-screen spinner. Only the cold load / password submit
  // pass through non-silently.
  const loadShare = useCallback(async ({ silent }: { silent?: boolean } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      await ensureFreshSupabaseSession();
      const payload = (await callProjectShare("get", { token })) as ProjectShareLink | undefined;
      if (!payload?.project) throw new Error("Project share not found");

      // A logged-in visitor -- workspace member or not -- stays on this same
      // guest-facing view rather than being redirected into the authenticated
      // app. Being logged in only changes identity (their real avatar/name
      // shown below instead of a guest form); it never grants extra access.
      setShare({ ...payload, assets: keepRecentLocalRows(payload.assets, shareRef.current?.assets ?? [], guestUploadedAtRef.current, Date.now()) });
      if (!initialFolderAppliedRef.current) {
        setCurrentFolderId(payload.folder_id ?? null);
        initialFolderAppliedRef.current = true;
      }
      setPasswordRequired(false);
    } catch (nextError: any) {
      const message = String(nextError?.message ?? nextError);
      if (nextError?.status === 401 && /password/i.test(message)) {
        clearSharePassword(token);
        setPasswordRequired(true);
        setPasswordSubmitError(null);
      } else if (nextError?.status === 403 && /password/i.test(message)) {
        clearSharePassword(token);
        setPasswordRequired(true);
        setPasswordSubmitError("Incorrect password. Try again.");
      } else if (message.toLowerCase().includes("expired")) setError("expired");
      else if (message.toLowerCase().includes("revoked")) setError("revoked");
      else setError("unknown");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadShare();
  }, [loadShare]);

  // A video, PDF or RAW the browser could not make a picture for gets its cover from the server a few seconds after upload.
  // Keep the grid fresh, quietly and for a bounded time, so the guest never has to reload to see it.
  const startRawCoverRefresh = useCallback(() => {
    if (rawCoverPollRef.current !== null) return;
    let attempts = 0;
    let inFlight = false;
    const stop = () => {
      if (rawCoverPollRef.current !== null) {
        window.clearInterval(rawCoverPollRef.current);
        rawCoverPollRef.current = null;
      }
    };
    rawCoverPollRef.current = window.setInterval(async () => {
      if (inFlight) return;
      attempts += 1;
      if (attempts > RAW_POLL_MAX_ATTEMPTS || assetsAwaitingServerCover(shareRef.current?.assets ?? []).length === 0) {
        stop();
        return;
      }
      inFlight = true;
      try {
        await loadShare({ silent: true });
      } finally {
        inFlight = false;
      }
    }, RAW_POLL_INTERVAL_MS);
  }, [loadShare]);

  async function handlePasswordSubmit() {
    if (!token || !passwordInput.trim()) return;
    setCheckingPassword(true);
    setSharePassword(token, passwordInput.trim());
    try {
      await loadShare();
    } finally {
      setCheckingPassword(false);
    }
  }

  const foldersById = useMemo(() => new Map((share?.folders ?? []).map((f) => [f.id, f])), [share?.folders]);

  // A folder-scoped share's `folders` payload only ever contains the shared
  // folder and its descendants (scoped server-side) -- so walking parent_folder_id
  // here naturally stops right at the shared folder, never reaching its real
  // ancestors in the rest of the project.
  const breadcrumb = useMemo(() => {
    const trail: FolderRow[] = [];
    let cursor = currentFolderId ? foldersById.get(currentFolderId) ?? null : null;
    while (cursor) {
      trail.unshift(cursor);
      cursor = cursor.parent_folder_id ? foldersById.get(cursor.parent_folder_id) ?? null : null;
    }
    return trail;
  }, [currentFolderId, foldersById]);

  const isFolderScoped = Boolean(share?.folder_id);
  const isSelectionScoped = Boolean(
    (share?.folder_ids && share.folder_ids.length) || (share?.asset_root_ids && share.asset_root_ids.length),
  );

  // A multi-select share's `assets` payload includes every version of each
  // selected file's stack (so drilling into a shared folder can still show
  // full version history) -- at the selection root we only want one card per
  // stack, the current/highest version, not one per version row.
  const selectionRootAssets = useMemo(() => {
    if (!isSelectionScoped) return [];
    const rootIds = new Set(share?.asset_root_ids ?? []);
    const byRoot = new Map<string, SharedAssetRow>();
    for (const asset of share?.assets ?? []) {
      const rootId = asset.parent_asset_id ?? asset.id;
      if (!rootIds.has(rootId)) continue;
      const existing = byRoot.get(rootId);
      if (!existing || (asset.version_no ?? 0) > (existing.version_no ?? 0)) {
        byRoot.set(rootId, asset);
      }
    }
    return Array.from(byRoot.values());
  }, [isSelectionScoped, share?.asset_root_ids, share?.assets]);

  // The shared folder itself is represented by the "Home" crumb below, not
  // repeated inside the trail.
  const displayBreadcrumb = useMemo(() => {
    if (isFolderScoped && breadcrumb.length > 0 && breadcrumb[0].id === share?.folder_id) {
      return breadcrumb.slice(1);
    }
    return breadcrumb;
  }, [breadcrumb, isFolderScoped, share?.folder_id]);

  const isSearching = search.trim().length > 0;

  // Any in-progress multi-select is about the files on screen right now --
  // drop it when the guest navigates to another folder or starts searching.
  useEffect(() => {
    exitGuestSelection();
  }, [currentFolderId, isSearching]);

  const visibleFolders = useMemo(() => {
    if (isSearching) return [];
    if (isSelectionScoped && currentFolderId === null) {
      // At the selection root, show only the directly-selected folders
      // themselves -- their contents only appear once a guest drills in.
      const ids = new Set(share?.folder_ids ?? []);
      return (share?.folders ?? []).filter((f) => ids.has(f.id));
    }
    return (share?.folders ?? []).filter((f) => (f.parent_folder_id ?? null) === currentFolderId);
  }, [currentFolderId, isSearching, isSelectionScoped, share?.folder_ids, share?.folders]);

  const visibleAssets = useMemo(() => {
    const assets = share?.assets ?? [];
    if (isSearching) {
      return assets.filter((a) => (a.title ?? "").toLowerCase().includes(search.trim().toLowerCase())).map(toDisplayAsset);
    }
    if (isSelectionScoped && currentFolderId === null) {
      return selectionRootAssets.map(toDisplayAsset);
    }
    return assets.filter((a) => (a.folder_id ?? null) === currentFolderId).map(toDisplayAsset);
  }, [currentFolderId, isSearching, isSelectionScoped, search, selectionRootAssets, share?.assets]);

  // Ids of the files on screen the guest is allowed to move (their own uploads
  // via this link). Drives the movable count and "Select all".
  const movableAssetIds = useMemo(
    () => visibleAssets.filter((a) => share?.allow_upload && !!identity && a.uploaded_via_share_link_id === share?.id).map((a) => a.id),
    [visibleAssets, share?.allow_upload, share?.id, identity],
  );
  const movableAssetCount = movableAssetIds.length;

  // Drives the authenticated "Move to..." dialog (BulkProjectActionDialog) for
  // the guest view -- same tree/search/breadcrumb UX, scoped to this one
  // project's shared folders, no folder creation.
  const guestMoveDestination = useGuestMoveDestination({
    open: moveDialogOpen,
    project: share?.project ?? { id: "", name: "" },
    folders: share?.folders ?? [],
    currentFolderId,
    count: moveTargetIds.length,
    allowRoot: !isFolderScoped,
  });

  const downloadAllEntries = useMemo(() => {
    if (!share?.allow_download) return [];

    const projectLabel = sanitizeDownloadName(share.project.name || "project") || "project";
    const usedPaths = new Map<string, number>();

    return (share.assets ?? []).flatMap((asset) => {
      const url = resolveAssetDownloadUrl(asset as any);
      if (!url) return [];

      const folderParts = folderPathParts(asset.folder_id ?? null, foldersById)
        .map((part) => sanitizeDownloadName(part))
        .filter(Boolean);
      const fileLabel = sanitizeDownloadName(asset.title || "asset") || "asset";
      const rawPath = [projectLabel, ...folderParts, fileLabel].join("/");
      const key = rawPath.toLowerCase();
      const seen = usedPaths.get(key) ?? 0;
      usedPaths.set(key, seen + 1);

      return [{ path: appendDuplicateSuffix(rawPath, seen), url }];
    });
  }, [foldersById, share]);

  // Same counting methodology the authenticated app uses (CampaignDetails.tsx's
  // folderCounts) -- recursive across the whole subtree, assets only (not
  // subfolders counted as items) -- so a folder's item count matches exactly
  // between the normal project view and a shared link.
  const folderCounts = useMemo(
    () => buildRecursiveFolderAssetCounts(share?.assets ?? [], share?.folders ?? []),
    [share?.assets, share?.folders],
  );

  function folderPreview(folderId: string) {
    const childAssets = (share?.assets ?? []).filter((a) => a.folder_id === folderId);
    return {
      itemCount: folderCounts.get(folderId) ?? 0,
      previewImages: childAssets.map((a) => a.cover_image_url).filter((url): url is string => Boolean(url)).slice(0, 3),
    };
  }

  function handleOpenAsset(assetId: string) {
    // Hand the review view the exact ordered list the guest is looking at right
    // now (current folder, or search results, or the selection root) so its
    // prev/next arrows step through THAT, not the whole flat project.
    navigate(`/share/project/${token}/asset/${assetId}`, { state: { siblingAssetIds: visibleAssets.map((a) => a.id) } });
  }

  const handleIdentity = (guestIdentity: { type: "guest"; name: string; email: string }) => {
    const nextIdentity = createShareGuestIdentity(guestIdentity);
    setIdentity(nextIdentity);
    saveShareGuestIdentity(nextIdentity);
    setIdentityPromptOpen(false);
    if (pendingUploadFiles) {
      const files = pendingUploadFiles;
      const folderId = pendingUploadFolderId;
      setPendingUploadFiles(null);
      setPendingUploadFolderId(null);
      void runUpload(files, nextIdentity, folderId);
    }
    if (pendingMoveAssetIds) {
      const ids = pendingMoveAssetIds;
      setPendingMoveAssetIds(null);
      setMoveTargetIds(ids);
      setMoveDialogOpen(true);
    }
    if (pendingSelectionIntent) {
      setPendingSelectionIntent(false);
      setSelectionIntent(true);
    }
  };

  async function runUpload(files: File[], activeIdentity: ShareIdentity, targetFolderId: string | null) {
    if (!token) return;
    const batch = ++uploadBatchRef.current;
    cancelledRef.current.clear();
    const items: UploadItem[] = files.map((file) => ({
      id: uid(),
      uploadNonce: uid(),
      file,
      name: file.name,
      type: file.type,
      size: file.size,
      status: "queued",
      progress: 0,
    }));
    setUploadItems(items);
    setUploading(true);

    let succeeded = 0;
    for (const item of items) {
      if (cancelledRef.current.has(item.id)) continue;
      const controller = new AbortController();
      controllersRef.current.set(item.id, controller);
      setUploadItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "uploading", uploadStartedAt: Date.now() } : i)));

      // A camera RAW: pull its embedded JPEG out in the browser now, so the picture shows on the upload card while it uploads.
      const isRawFile = isRawImageMime(item.file.type) || isRawImageFileName(item.file.name);
      const rawPrepared = isRawFile ? prepareRawPreview(item.file) : null;
      void rawPrepared?.then((prepared) => {
        if (!prepared) return;
        previewBlobUrlsRef.current.push(prepared.localUrl);
        setUploadItems((prev) => prev.map((i) => (i.id === item.id && !i.coverUrl ? { ...i, coverUrl: prepared.localUrl } : i)));
      });

      try {
        const result = await uploadGuestFile(
          item.file,
          token,
          activeIdentity,
          targetFolderId,
          (uploadedBytes) => {
            setUploadItems((prev) =>
              prev.map((i) => (i.id === item.id ? { ...i, uploadedBytes, progress: Math.floor((uploadedBytes / item.size) * 100) } : i)),
            );
          },
          controller.signal,
        );
        setUploadItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "completed", progress: 100, uploadedBytes: item.size, uploadFinishedAt: Date.now() } : i)),
        );
        if (result?.id && !cancelledRef.current.has(item.id)) {
          const isImage = (item.file.type || "").startsWith("image/") && !isRawImageMime(item.file.type) && !isRawImageFileName(item.file.name);
          let coverUrl: string | null = null;
          if (isImage) {
            coverUrl = URL.createObjectURL(item.file);
            previewBlobUrlsRef.current.push(coverUrl);
          } else if (rawPrepared) {
            const prepared = await rawPrepared;
            if (prepared) {
              coverUrl = prepared.localUrl;
              void saveGuestRawPreview(token, result.id, prepared);
            }
          } else if ((item.file.type || "").startsWith("video/")) {
            coverUrl = await saveGuestVideoCover(token, result.id, item.file);
          }
          const now = new Date().toISOString();
          // The tile appears the moment this file is done (not after the whole batch).
          const newRow: SharedAssetRow = {
            id: result.id,
            title: item.file.name,
            mime_type: item.file.type || null,
            storage_path: result.objectKey,
            cover_image_url: coverUrl,
            folder_id: targetFolderId,
            status: null,
            parent_asset_id: null,
            version_no: 1,
            comments_count: 0,
            size_bytes: item.file.size,
            created_at: now,
            updated_at: now,
            uploaded_via_share_link_id: share?.id ?? null,
          };
          guestUploadedAtRef.current.set(newRow.id, Date.now());
          setShare((prev) => (prev ? { ...prev, assets: prependUploadedRow(prev.assets, newRow) } : prev));
          if (assetsAwaitingServerCover([newRow]).length > 0) startRawCoverRefresh();
        }
        succeeded += 1;
      } catch (uploadError) {
        if (cancelledRef.current.has(item.id)) continue;
        console.error("Guest upload failed", uploadError);
        toast.error(`Failed to upload ${item.name}`);
        setUploadItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", errorMessage: uploadError instanceof Error ? uploadError.message : "Upload failed" }
              : i,
          ),
        );
      } finally {
        controllersRef.current.delete(item.id);
      }
    }

    setUploading(false);
    if (succeeded > 0) {
      toast.success(succeeded === 1 ? "File uploaded" : `${succeeded} files uploaded`);
    }
    setTimeout(() => {
      if (uploadBatchRef.current === batch) setUploadItems([]);
    }, 3000);
  }

  function handleCancelUpload(id: string) {
    cancelledRef.current.add(id);
    controllersRef.current.get(id)?.abort();
    setUploadItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "canceled" } : i)));
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const allFiles = Array.from(fileList);
    // Snapshot the folder the guest is looking at right now -- the upload
    // must land here even if they navigate away before it (or the identity
    // prompt) finishes.
    const targetFolderId = currentFolderId;

    const dangerousFiles = allFiles.filter(f => isDangerousFile(f));
    const files = allFiles.filter(f => !isDangerousFile(f));
    if (dangerousFiles.length > 0) {
      console.warn(`[ShareProject] Blocked ${dangerousFiles.length} potentially dangerous file(s).`);
      toast.error(
        `Blocked ${dangerousFiles.length} file${dangerousFiles.length === 1 ? "" : "s"} for security reasons.`,
        { description: dangerousFiles.map(f => f.name).slice(0, 3).join(", ") }
      );
    }
    if (files.length === 0) return;

    if (!identity) {
      setPendingUploadFiles(files);
      setPendingUploadFolderId(targetFolderId);
      setIdentityPromptOpen(true);
      return;
    }
    void runUpload(files, identity, targetFolderId);
  }

  async function handleStatusChange(assetId: string, status: string) {
    if (!token) return;
    if (!identity) {
      setIdentityPromptOpen(true);
      toast.info("Identify yourself to update this asset's status.");
      return;
    }

    setShare((prev) =>
      prev ? { ...prev, assets: prev.assets.map((a) => (a.id === assetId ? { ...a, status } : a)) } : prev,
    );

    try {
      const { error } = await invokeEdgeFunction("project-share", {
        body: withSharePassword(token, {
          action: "update-status",
          token,
          asset_id: assetId,
          status,
          guest_name: identity.type === "guest" ? identity.name : undefined,
          guest_email: identity.type === "guest" ? identity.email : undefined,
        }),
      });
      if (error) throw new Error(error.message);
      toast.success("Status updated");
    } catch (statusError) {
      console.error("Failed to update asset status", statusError);
      toast.error("Failed to update status");
      void loadShare();
    }
  }

  function toggleGuestSelection(id: string, next: boolean) {
    setSelectedIds((prev) => (next ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  }

  function selectAllMovable() {
    setSelectionIntent(true);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...movableAssetIds])));
  }

  // "Select" is always offered when the link allows uploads, but only an
  // identified viewer can actually enter selection mode -- mirror how "Upload
  // files" prompts for a name before doing anything.
  function handleStartSelection() {
    if (!identity) {
      setPendingSelectionIntent(true);
      setIdentityPromptOpen(true);
      toast.info("Add your name so the team can see who moved what.");
      return;
    }
    setSelectionIntent(true);
  }

  function exitGuestSelection() {
    setSelectionIntent(false);
    setPendingSelectionIntent(false);
    setSelectedIds([]);
  }

  function handleRequestMove(asset: { id: string }) {
    requestMove([asset.id]);
  }

  function requestMove(ids: string[]) {
    if (ids.length === 0) return;
    if (!identity) {
      setPendingMoveAssetIds(ids);
      setIdentityPromptOpen(true);
      toast.info(ids.length === 1 ? "Identify yourself to move this file." : "Identify yourself to move these files.");
      return;
    }
    setMoveTargetIds(ids);
    setMoveDialogOpen(true);
  }

  async function handleConfirmMove(folderId: string | null) {
    if (!token || moveTargetIds.length === 0 || !identity) return;
    const ids = moveTargetIds;
    setMovingAsset(true);
    try {
      const { error } = await invokeEdgeFunction("project-share-upload", {
        body: withSharePassword(token, {
          action: "move-asset",
          token,
          assetIds: ids,
          folderId: folderId ?? undefined,
          guest_name: identity.type === "guest" ? identity.name : undefined,
          guest_email: identity.type === "guest" ? identity.email : undefined,
        }),
      });
      if (error) throw new Error(error.message);
      setShare((prev) =>
        prev
          ? {
              ...prev,
              assets: prev.assets.map((a) =>
                ids.includes(a.id) || (a.parent_asset_id ? ids.includes(a.parent_asset_id) : false)
                  ? { ...a, folder_id: folderId }
                  : a,
              ),
            }
          : prev,
      );
      setMoveDialogOpen(false);
      setMoveTargetIds([]);
      exitGuestSelection();
      toast.success(ids.length === 1 ? "File moved" : `${ids.length} files moved`);
      // No reload: the optimistic folder_id patch above (which also covers
      // version children) is the source of truth, same as handleStatusChange.
    } catch (moveError) {
      console.error("Failed to move files", moveError);
      toast.error(moveError instanceof Error ? moveError.message : "Failed to move files");
    } finally {
      setMovingAsset(false);
    }
  }

  function handleDownloadAsset(asset: { name?: string | null; url?: string | null }) {
    if (!share?.allow_download) {
      toast.info("Downloads aren't allowed for this share link.");
      return;
    }
    const downloadUrl = resolveAssetDownloadUrl(asset as any);
    void downloadFile(downloadUrl, asset.name || "asset");
  }

  async function handleDownloadAll() {
    if (!share?.allow_download) {
      toast.info("Downloads aren't allowed for this share link.");
      return;
    }
    if (downloadAllEntries.length === 0) {
      toast.info("No downloadable assets found in this shared project.");
      return;
    }

    setDownloadingAll(true);
    try {
      const archiveName = `${sanitizeDownloadName(share.project.name || "project") || "project"}.zip`;
      await downloadZipArchive(downloadAllEntries, archiveName, { label: share.project.name || "project" });
    } finally {
      setDownloadingAll(false);
    }
  }

  if (loading || checkingIdentity) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading project
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-sm space-y-4 rounded-xl border bg-background/60 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <Lock className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Password required</h2>
            <p className="text-sm text-muted-foreground">This project is password-protected. Enter the password to continue.</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handlePasswordSubmit();
            }}
            className="space-y-3 text-left"
          >
            <Input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
            {passwordSubmitError ? <p className="text-sm text-destructive">{passwordSubmitError}</p> : null}
            <Button type="submit" className="w-full" disabled={checkingPassword || !passwordInput.trim()}>
              {checkingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (error || !share) {
    const messages: Record<string, string> = {
      expired: "This share link has expired.",
      revoked: "This share link has been revoked by its owner.",
      not_found: "This share link could not be found.",
      unknown: "This project could not be loaded.",
    };
    return (
      <div className="min-h-screen space-y-6 bg-background p-6 text-foreground">
        <Empty className="border border-dashed border-border/70 bg-background/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileIcon />
            </EmptyMedia>
            <EmptyTitle>Project unavailable</EmptyTitle>
            <EmptyDescription>{messages[error ?? "unknown"]}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShareAuthDialog
        open={identityPromptOpen && !identity}
        onIdentify={handleIdentity}
        onClose={() => {
          // Dismissed without identifying -- drop every stashed follow-up so it
          // doesn't silently replay the next time the guest identifies.
          setIdentityPromptOpen(false);
          setPendingUploadFiles(null);
          setPendingUploadFolderId(null);
          setPendingMoveAssetIds(null);
          setPendingSelectionIntent(false);
        }}
      />
      {share ? (
        <BulkProjectActionDialog
          {...guestMoveDestination.props}
          bulkProjectActionOpen={moveDialogOpen}
          setBulkProjectActionOpen={(o: boolean) => {
            setMoveDialogOpen(o);
            if (!o) setMoveTargetIds([]);
          }}
          runningBulkProjectAction={movingAsset}
          bulkProjectActionDisabled={movingAsset || !guestMoveDestination.canConfirm}
          handleBulkProjectAction={() => handleConfirmMove(guestMoveDestination.selectedDestinationFolderId)}
        />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />

      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isSelectionScoped ? "Shared selection" : isFolderScoped ? "Shared folder" : "Shared project"}
            </p>
            <h1 className="truncate text-xl font-semibold">
              {isSelectionScoped
                ? selectionSummaryLabel(share?.folder_ids ?? [], share?.asset_root_ids ?? [])
                : isFolderScoped ? (share?.shared_folder?.name ?? share?.project.name) : share.project.name}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {identity ? (
              <div
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 py-1 pl-1 pr-2.5"
                title={`Viewing as ${identity.name} (${identity.email})`}
              >
                {identity.type === "user" && identity.avatarUrl ? (
                  <img src={identity.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                    {identity.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[140px] truncate text-xs font-medium text-foreground">
                  {identity.name}
                </span>
              </div>
            ) : null}
            <div
              className={cn(
                "flex h-9 items-center overflow-hidden rounded-lg border bg-muted/40 transition-all duration-200",
                searchOpen || isSearching ? "w-[min(18rem,60vw)]" : "w-9",
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                aria-label="Search assets"
              >
                <Search className="h-4 w-4" />
              </Button>
              <div className={cn("flex min-w-0 flex-1 items-center", !(searchOpen || isSearching) && "pointer-events-none w-0 opacity-0")}>
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => {
                    if (!search.trim()) setSearchOpen(false);
                  }}
                  placeholder="Search files"
                  className="h-9 border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              {isSearching ? (
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSearch("")} aria-label="Clear search">
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            {selectionMode ? (
              <>
                <span className="hidden text-xs text-muted-foreground md:inline">
                  {movableAssetCount > 0
                    ? "Tick the files you added to move them. Files from the team are locked."
                    : "Nothing here you can move — you can only move files you added through this link."}
                </span>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.length} selected
                </span>
                <Button
                  onClick={() => requestMove(selectedIds)}
                  disabled={selectedIds.length === 0 || movingAsset}
                  className="gap-2"
                >
                  {movingAsset ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
                  Move to folder
                </Button>
                <Button
                  variant="ghost"
                  onClick={selectAllMovable}
                  disabled={movableAssetCount === 0 || selectedIds.length >= movableAssetCount}
                >
                  Select all
                </Button>
                <Button variant="outline" onClick={exitGuestSelection}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {share.allow_upload ? (
                  <Button
                    variant="outline"
                    onClick={handleStartSelection}
                    title={identity ? undefined : "Add your name to organise files you've uploaded"}
                  >
                    Select
                  </Button>
                ) : null}
                {share.allow_upload ? (
                  <Button onClick={handleUploadClick} disabled={uploading} className="gap-2">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload files
                  </Button>
                ) : null}
                {share.allow_download ? (
                  <Button variant="outline" onClick={() => void handleDownloadAll()} disabled={downloadingAll} className="gap-2">
                    {downloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download all
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {!isSearching && breadcrumb.length > 0 ? (
          <div className="flex items-center gap-1 px-6 pb-3 text-sm text-muted-foreground">
            <button
              className="hover:text-foreground hover:underline"
              onClick={() => setCurrentFolderId(isFolderScoped ? share?.folder_id ?? null : null)}
            >
              {isSelectionScoped ? "Shared Selection" : isFolderScoped ? (share?.shared_folder?.name ?? share?.project.name) : share?.project.name}
            </button>
            {displayBreadcrumb.map((folder) => (
              <span key={folder.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <button className="hover:text-foreground hover:underline" onClick={() => setCurrentFolderId(folder.id)}>
                  {folder.name}
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="p-6">
        {uploadItems.length > 0 ? (
          <section className="mb-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Uploading</h3>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {uploadItems.filter((i) => i.status === "queued" || i.status === "uploading").length} active
              </span>
            </div>
            <div className="grid items-start gap-5 grid-cols-[repeat(auto-fill,minmax(204px,1fr))] sm:grid-cols-[repeat(auto-fill,204px)]">
              <AnimatePresence mode="popLayout">
                {uploadItems.map((item, index) => (
                  <UploadProgressCard key={item.id} item={item} onCancel={handleCancelUpload} entranceDelay={Math.min(index, 10) * 0.035} />
                ))}
              </AnimatePresence>
            </div>
          </section>
        ) : null}
        {visibleFolders.length === 0 && visibleAssets.length === 0 ? (
          <Empty className="border border-dashed border-border/70 bg-background/60 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileIcon />
              </EmptyMedia>
              <EmptyTitle>{isSearching ? "No files match your search" : "This folder is empty"}</EmptyTitle>
              <EmptyDescription>
                {share.allow_upload ? "Use “Upload files” to add something here." : "Nothing has been shared here yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid items-start gap-5 grid-cols-[repeat(auto-fill,minmax(204px,1fr))] sm:grid-cols-[repeat(auto-fill,204px)]">
            {visibleFolders.map((folder) => {
              const { itemCount, previewImages } = folderPreview(folder.id);
              return (
                <FolderLevelCard
                  key={folder.id}
                  folder={folder}
                  itemCount={itemCount}
                  previewImages={previewImages}
                  onOpen={() => setCurrentFolderId(folder.id)}
                />
              );
            })}

            {visibleAssets.map((asset) => {
              const canMove = share.allow_upload && !!identity && asset.uploaded_via_share_link_id === share.id;
              // While selecting, a file the guest can't move is shown locked
              // (dimmed + lock chip) rather than silently missing its checkbox.
              const locked = selectionMode && !canMove;
              return (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onClick={() => handleOpenAsset(asset.id)}
                  onStatusChange={handleStatusChange}
                  onDownload={handleDownloadAsset}
                  onEdit={() => toast.info("Renaming isn't available in a shared view.")}
                  selectable={canMove || locked}
                  selectionMode={selectionMode}
                  selectionLocked={locked}
                  selectionLockedHint="Only files you added through this share link can be moved"
                  selected={selectedIds.includes(asset.id)}
                  onSelectedChange={canMove ? (next: boolean) => toggleGuestSelection(asset.id, next) : undefined}
                  onMoveToFolder={!selectionMode && canMove ? handleRequestMove : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

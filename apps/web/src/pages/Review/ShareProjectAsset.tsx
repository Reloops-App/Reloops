import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, DownloadIcon, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import AssetNotFound from "@/components/errors/AssetNotFound";
import { ShareAuthDialog } from "@/components/review/ShareAuthDialog";
import MobileShareReview from "@/components/review/mobile/MobileShareReview";
import { useIsMobile } from "@/hooks/use-mobile";
import { normalizeAnnotation } from "@/components/review/annotator-utils";
import UnsupportedAssetPreview from "@/components/review/UnsupportedAssetPreview";
import ImageAnnotatorWithAnnotations from "@/components/review/image";
import AudioReview from "@/components/review/audio";
import PdfAnnotatorWithAnnotations from "@/components/review/pdf";
import Html5BannerAnnotatorWithAnnotations from "@/components/review/html5Banner";
import VideoPlayerWithAnnotations, { type Annotation } from "@/components/review/video";
import WebScreenshotReview from "@/components/review/WebScreenshotReview";
import LiveUrlReview from "@/components/review/LiveUrlReview";
import LiveSnippetReview from "@/components/review/LiveSnippetReview";
import { isLikelyWebsiteScreenshot } from "@/components/review/website-review-utils";
import { isHtml5BannerAsset } from "@/lib/html5Banner";
import { isLiveUrlReviewAsset } from "@/lib/liveUrlReview";
import { isLiveEmbeddedReviewAsset } from "@/lib/liveSnippetReview";
import { AssetNavArrows } from "@/components/review/shared/AssetNavArrows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadAsset } from "@/lib/utils";
import { ReviewStatusActions } from "@/components/review/shared/ReviewStatusActions";
import { DetailsPanelToggle } from "@/components/review/shared/DetailsPanelToggle";
import { ensureFreshSupabaseSession, getSupabaseUserFromStorage } from "@/lib/supabaseAuthApi";
import { resolveAssetDownloadUrl, resolveAssetMediaUrl, withMediaTransform, REVIEW_PREVIEW_TRANSFORM } from "@/lib/mediaDelivery";
import { useAssetMediaFallback } from "@/hooks/useAssetMediaFallback";
import { classifyAssetPreview } from "@/lib/assetPreviewClassification";
import { lazyRoute } from "@/lib/lazyRoute";
import {
  clearShareGuestIdentity,
  createShareGuestIdentity,
  loadShareGuestIdentity,
  saveShareGuestIdentity,
  type ShareIdentity,
} from "@/lib/shareGuestIdentity";
import { clearSharePassword, getSharePassword, setSharePassword, withSharePassword } from "@/lib/shareLinkPassword";
import RawPreviewPending from "@/components/review/RawPreviewPending";
import { useRawPreviewPolling } from "@/hooks/useRawPreviewPolling";
import { mergeFreshRawPreview } from "@/lib/rawPreviewPolling";

const TextFileView = lazyRoute(() => import("@/components/review/TextFileView"));

type SharedAsset = {
  id: string;
  title?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  workspace_id?: string | null;
  cover_image_url?: string | null;
  status?: string | null;
  ai_metadata?: Record<string, unknown> | null;
  folder_id?: string | null;
  parent_asset_id?: string | null;
};

type ProjectShareLink = {
  id: string;
  allow_download: boolean;
  project: { id: string; workspace_id: string };
  assets: SharedAsset[];
  is_member?: boolean;
};

type CommentRow = {
  id: string;
  asset_id: string;
  author_user_id?: string | null;
  guest_name?: string | null;
  body: string;
  ms_offset: number | null;
  drawing_json?: unknown | null;
  created_at: string;
  can_manage?: boolean;
  can_delete?: boolean;
};

type AuthorProfile = { id: string; display_name?: string | null; avatar_url?: string | null };

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

async function callProjectShareComment(action: string, body: Record<string, unknown>) {
  const token = typeof body.token === "string" ? body.token : undefined;
  const finalBody = token ? withSharePassword(token, { action, ...body }) : { action, ...body };
  const { data, error } = await invokeEdgeFunction("project-share-comment", { body: finalBody });
  if (error) {
    const err = new Error(error.message || "project-share-comment request failed") as Error & { status?: number };
    err.status = error.status;
    throw err;
  }
  return (data ?? {}) as { data?: any; profiles?: Record<string, AuthorProfile> };
}

export default function ShareProjectAsset() {
  const { token, assetId } = useParams<{ token: string; assetId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  // The exact ordered id list the grid was showing when the guest opened this
  // asset (current folder / search results / selection root). Kept across
  // prev/next steps via navigateToSibling.
  const routeSiblingIds = useMemo<string[] | null>(() => {
    const ids = (location.state as { siblingAssetIds?: unknown } | null)?.siblingAssetIds;
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? (ids as string[]) : null;
  }, [location.state]);

  const [shareLoading, setShareLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "expired" | "revoked" | "unknown" | null>(null);
  const [share, setShare] = useState<ProjectShareLink | null>(null);
  const [asset, setAsset] = useState<SharedAsset | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, AuthorProfile>>({});
  const [identity, setIdentity] = useState<ShareIdentity | null>(null);
  const [checkingIdentity, setCheckingIdentity] = useState(true);
  const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordSubmitError, setPasswordSubmitError] = useState<string | null>(null);
  const [checkingPassword, setCheckingPassword] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(true);

  const mimeType = asset?.mime_type ?? null;
  const isVideo = Boolean(mimeType?.startsWith("video/"));
  const isAudio = Boolean(mimeType?.startsWith("audio/"));
  const isPdf = mimeType === "application/pdf";
  const isLiveUrlReview = isLiveUrlReviewAsset(asset);
  const isHtml5Banner = isHtml5BannerAsset({ mime_type: mimeType, title: asset?.title, storage_path: asset?.storage_path });
  const storagePath = asset?.storage_path ?? null;
  const primaryReviewAssetUrl = resolveAssetMediaUrl(asset);
  const reviewMedia = useAssetMediaFallback(asset, primaryReviewAssetUrl);
  const reviewAssetUrl = reviewMedia.activeUrl;
  const handleReviewMediaError = reviewMedia.canUseFallback ? reviewMedia.markPrimaryFailed : undefined;
  const {
    isTextFilePreview,
    textFilePreviewInfo,
    isUnsupportedBrowserImagePreview,
    unsupportedPreviewLabel,
    isUnsupportedPreview,
  } = classifyAssetPreview({
    mime_type: mimeType,
    title: asset?.title,
    storage_path: asset?.storage_path,
    ai_metadata: asset?.ai_metadata,
  });
  // A camera RAW without a web-safe preview yet shows a normal loading state and swaps to the picture by itself.
  const isRawPreviewPending = isUnsupportedBrowserImagePreview && unsupportedPreviewLabel === "RAW";
  const { gaveUp: rawPreviewGaveUp } = useRawPreviewPolling({
    asset,
    assetKey: assetId ?? null,
    fetchLatest: async () => {
      const payload = (await callProjectShare("get", { token })) as ProjectShareLink | undefined;
      return payload?.assets?.find((row) => row.id === assetId) ?? null;
    },
    onFresh: (fresh) => setAsset((prev) => (prev ? mergeFreshRawPreview(prev, fresh) : prev)),
  });

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

  // Effect A: fetch the project share payload once per token (+ whenever the
  // stored password changes, via handlePasswordSubmit re-invoking this) — NOT
  // per assetId, so stepping through prev/next doesn't re-fetch the entire
  // project (session refresh + full asset list + membership check) on every
  // click the way the old combined loadAsset() did.
  const loadShare = useCallback(
    async (mountedRef: { current: boolean }) => {
      if (!token) return;
      setShareLoading(true);
      setError(null);

      try {
        await ensureFreshSupabaseSession();
        const payload = (await callProjectShare("get", { token })) as ProjectShareLink | undefined;
        if (!payload?.project) throw new Error("not_found");

        if (mountedRef.current) {
          setShare(payload);
          setPasswordRequired(false);
        }
      } catch (nextError: any) {
        if (!mountedRef.current) return;
        const message = String(nextError?.message ?? nextError);
        if (nextError?.status === 401 && /password/i.test(message)) {
          clearSharePassword(token);
          setPasswordRequired(true);
          setPasswordSubmitError(null);
        } else if (nextError?.status === 403 && /password/i.test(message)) {
          clearSharePassword(token);
          setPasswordRequired(true);
          setPasswordSubmitError("Incorrect password. Try again.");
        } else if (message.toLowerCase().includes("expired")) {
          setError("expired");
        } else if (message.toLowerCase().includes("revoked")) {
          setError("revoked");
        } else {
          setError(message === "not_found" ? "not_found" : "unknown");
        }
      } finally {
        if (mountedRef.current) setShareLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const mountedRef = { current: true };
    void loadShare(mountedRef);
    return () => {
      mountedRef.current = false;
    };
  }, [loadShare]);

  // Effect B: reacts to assetId changes. Looks up the matching row from the
  // already-loaded share.assets (no network call) and fetches only that
  // asset's comments — the actual "seamless" part of prev/next navigation.
  useEffect(() => {
    if (!share || !assetId || !token) return;
    let mounted = true;

    const matchedAsset = share.assets.find((row) => row.id === assetId);
    if (!matchedAsset) {
      setError("not_found");
      return;
    }

    // A logged-in visitor -- workspace member or not -- stays on this same
    // guest-facing view rather than being redirected into the authenticated
    // app. Being logged in only changes identity (their real avatar/name
    // shown below instead of a guest form); it never grants extra access.
    setAsset(matchedAsset);

    (async () => {
      try {
        const commentResult = await callProjectShareComment("list", {
          token,
          asset_id: assetId,
          guest_author_token: identity?.type === "guest" ? identity.authorToken : undefined,
        });
        if (mounted) {
          setComments((commentResult.data ?? []) as CommentRow[]);
          setCommentProfiles(commentResult.profiles ?? {});
        }
      } catch (nextError) {
        // A comments-fetch hiccup shouldn't take down the whole viewer —
        // the asset is already visible from share.assets either way.
        console.error("Failed to load project share comments", nextError);
        if (mounted) {
          setComments([]);
          setCommentProfiles({});
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [share, assetId, identity, navigate, token]);

  const currentSharedAsset = useMemo(
    () => share?.assets.find((row) => row.id === assetId) ?? null,
    [share, assetId],
  );

  // Prefer the grid's exact click-time list (route state) when it still
  // contains this asset; otherwise fall back to a folder-scoped, one-stop-per-
  // version-stack slice of share.assets -- same idea as ReviewAsset.tsx.
  const siblingAssets = useMemo(() => {
    const all = share?.assets ?? [];
    if (all.length === 0) return [];
    if (routeSiblingIds) {
      const byId = new Map(all.map((row) => [row.id, row]));
      const ordered = routeSiblingIds.map((id) => byId.get(id)).filter((row): row is SharedAsset => Boolean(row));
      if (ordered.some((row) => row.id === assetId)) return ordered;
    }
    const folderId = currentSharedAsset?.folder_id ?? null;
    return all.filter((row) => (row.folder_id ?? null) === folderId && !row.parent_asset_id);
  }, [share, routeSiblingIds, assetId, currentSharedAsset]);

  const siblingIndex = useMemo(() => {
    if (!assetId) return -1;
    return siblingAssets.findIndex((row) => row.id === assetId);
  }, [siblingAssets, assetId]);
  const prevSiblingAsset = siblingIndex > 0 ? siblingAssets[siblingIndex - 1] : null;
  const nextSiblingAsset =
    siblingIndex >= 0 && siblingIndex < siblingAssets.length - 1
      ? siblingAssets[siblingIndex + 1]
      : null;

  // Warm the browser cache (and, for PDFs, the lazy-loaded viewer chunk) for
  // the immediate prev/next neighbors as soon as they're known — mirrors the
  // same fix in ReviewAsset.tsx / ShareCollectionAsset.tsx.
  useEffect(() => {
    for (const sibling of [prevSiblingAsset, nextSiblingAsset]) {
      if (!sibling) continue;
      const mime = sibling.mime_type ?? "";
      if (mime === "application/pdf") {
        void import("@/components/review/pdf");
        continue;
      }
      const prefetchUrl = mime.startsWith("video/")
        ? sibling.cover_image_url ?? null
        : withMediaTransform(resolveAssetMediaUrl(sibling), REVIEW_PREVIEW_TRANSFORM, mime);
      if (prefetchUrl) {
        const probe = new window.Image();
        probe.src = prefetchUrl;
      }
    }
  }, [prevSiblingAsset, nextSiblingAsset]);

  function navigateToSibling(target: SharedAsset) {
    // Carry the same scoped list forward so multi-step prev/next stays inside
    // the folder / search / selection the guest started from.
    navigate(`/share/project/${token}/asset/${target.id}`, {
      state: routeSiblingIds ? { siblingAssetIds: routeSiblingIds } : undefined,
    });
  }

  async function handlePasswordSubmit() {
    if (!token || !passwordInput.trim()) return;
    setCheckingPassword(true);
    setSharePassword(token, passwordInput.trim());
    try {
      await loadShare({ current: true });
    } finally {
      setCheckingPassword(false);
    }
  }

  // Website-screenshot detection relies only on stored asset.width/height and
  // filename/title markers — all available synchronously, no network needed.
  // This used to also fall back to downloading the entire full-resolution
  // original just to measure it when those signals were inconclusive, which
  // blocked the viewer from mounting at all (multi-second delay on large
  // originals) for the sake of a rarely-needed classification refinement.
  const baseWebsiteScreenshot = isLikelyWebsiteScreenshot(asset as any);
  const isWebsiteScreenshot = !isVideo && !isAudio && baseWebsiteScreenshot;
  const pendingImageReviewerType = false;
  const supportsCommentsPanel = Boolean(asset);

  const viewerAnnotations = useMemo<Annotation[]>(() => {
    return comments.map((comment) => {
      const authorName = comment.author_user_id
        ? commentProfiles[comment.author_user_id]?.display_name ?? "Team member"
        : comment.guest_name ?? "Guest";
      const timeSec = Number.isFinite(comment.ms_offset as number) ? (comment.ms_offset as number) / 1000 : Number.NaN;
      const base = normalizeAnnotation({ ...comment, time: timeSec, drawing: comment.drawing_json, author: authorName });
      return { ...base, author: authorName, canManageComment: comment.can_manage === true, canDeleteComment: comment.can_delete === true } as Annotation;
    });
  }, [comments, commentProfiles]);

  // Routes the shared viewer components' edit/delete calls at
  // project-share-comment instead of functions/comment (which has no concept
  // of project shares) — see commentEndpoint prop on each viewer below.
  // share_token is included (even though project-share-comment doesn't read
  // it) purely so the viewers' own `!commentMutationContext?.share_token`
  // check keeps correctly treating this as a share flow, not the
  // authenticated in-app view.
  const projectCommentMutationContext = useMemo(() => {
    if (!token || !asset?.id) return undefined;
    const password = getSharePassword(token);
    return {
      share_token: token,
      token,
      asset_id: asset.id,
      guest_author_token: identity?.type === "guest" ? identity.authorToken : undefined,
      ...(password ? { password } : {}),
    };
  }, [token, asset?.id, identity]);

  function toOptimisticComment(annotation: Annotation, assetIdValue: string, activeIdentity: ShareIdentity): CommentRow {
    return {
      id: annotation.id,
      asset_id: assetIdValue,
      author_user_id: activeIdentity.type === "user" ? activeIdentity.userId : null,
      guest_name: activeIdentity.type === "guest" ? activeIdentity.name : null,
      body: annotation.text,
      ms_offset: Number.isFinite(annotation.time) ? Math.round((annotation.time as number) * 1000) : null,
      drawing_json: annotation.page != null ? { page: annotation.page, strokes: annotation.drawing ?? [] } : annotation.drawing ?? null,
      created_at: annotation.createdAt ?? new Date().toISOString(),
      can_manage: true,
      can_delete: true,
    };
  }

  const handleIdentity = (guestIdentity: { type: "guest"; name: string; email: string }) => {
    const nextIdentity = createShareGuestIdentity(guestIdentity);
    setIdentity(nextIdentity);
    setIdentityPromptOpen(false);
    saveShareGuestIdentity(nextIdentity);
  };

  async function handleAddAnnotation(annotation: Annotation) {
    if (!asset?.id || !token) return;
    if (!identity) {
      setIdentityPromptOpen(true);
      toast.info("Identify yourself to leave a comment.");
      return;
    }

    const optimisticId = annotation.id;
    setComments((prev) =>
      prev.some((comment) => comment.id === optimisticId) ? prev : [...prev, toOptimisticComment(annotation, asset.id, identity)],
    );

    try {
      const result = await callProjectShareComment("create", {
        token,
        asset_id: asset.id,
        client_id: annotation.id,
        body: annotation.text,
        ms_offset: Number.isFinite(annotation.time) ? Math.round((annotation.time as number) * 1000) : null,
        drawing_json: annotation.page != null ? { page: annotation.page, strokes: annotation.drawing ?? [] } : annotation.drawing ?? null,
        parent_id: null,
        guest_name: identity.type === "guest" ? identity.name : undefined,
        guest_email: identity.type === "guest" ? identity.email : undefined,
        guest_author_token: identity.type === "guest" ? identity.authorToken : undefined,
      });

      const newComment = result.data as CommentRow;
      setComments((prev) => {
        const withoutOptimistic = prev.filter((comment) => comment.id !== optimisticId);
        return withoutOptimistic.some((comment) => comment.id === newComment.id) ? withoutOptimistic : [...withoutOptimistic, newComment];
      });

      // The profile lookup for a newly-authenticated commenter's own comment
      // hasn't been fetched yet (that only happens on the next full list
      // reload), so viewerAnnotations would otherwise fall back to the
      // generic "Team member" label until then. We already know who this is.
      if (identity.type === "user" && newComment.author_user_id) {
        setCommentProfiles((prev) =>
          prev[newComment.author_user_id!]
            ? prev
            : { ...prev, [newComment.author_user_id!]: { id: newComment.author_user_id!, display_name: identity.name, avatar_url: null } },
        );
      }
    } catch (nextError) {
      setComments((prev) => prev.filter((comment) => comment.id !== optimisticId));
      console.error("Failed to add project share comment", nextError);
      toast.error("Failed to add comment");
    }
  }

  async function handleStatusChange(status: "needs_review" | "in_review" | "approved") {
    if (!asset?.id || !token) return;
    if (!identity) {
      setIdentityPromptOpen(true);
      toast.info("Identify yourself to update this asset's status.");
      return;
    }

    setAsset((prev) => (prev ? { ...prev, status } : prev));
    try {
      const { error } = await invokeEdgeFunction("project-share", {
        body: withSharePassword(token, {
          action: "update-status",
          token,
          asset_id: asset.id,
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
    }
  }

  // Only replace the whole page with a bare loading state on the true first
  // load. Effect B resolves `asset` synchronously from share.assets on every
  // prev/next step, so gating on it being momentarily unset (between share
  // loading and Effect B's very next tick) would otherwise flash this plain
  // div on every navigation — same fix as ShareCollectionAsset.tsx.
  if (shareLoading || checkingIdentity || (!asset && !error && !passwordRequired)) {
    return <div className="p-6">Loading share link…</div>;
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

  if (!asset || error) {
    return (
      <AssetNotFound
        workspaceId=""
        projectId={undefined}
        assetId={assetId ?? ""}
        error={error ?? "not_found"}
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Below 767px, a video / image / PDF asset gets the dedicated mobile review
  // shell instead of the squeezed desktop viewer tree. Desktop/tablet widths
  // are byte-for-byte unchanged.
  const isImageReview = Boolean(mimeType?.startsWith("image/"))
    && !isWebsiteScreenshot && !isHtml5Banner && !isUnsupportedPreview && !isTextFilePreview;
  if (isMobile && !isLiveUrlReview && (isVideo || isPdf || isImageReview)) {
    return (
      <>
        <ShareAuthDialog
          open={identityPromptOpen && !identity}
          onIdentify={handleIdentity}
          onClose={() => setIdentityPromptOpen(false)}
          context="comment"
        />
        <MobileShareReview
          kind={isVideo ? "video" : isPdf ? "pdf" : "image"}
          title={asset.title || "Shared asset"}
          mediaUrl={reviewAssetUrl}
          poster={asset.cover_image_url}
          mimeType={mimeType}
          annotations={viewerAnnotations}
          identity={identity}
          status={asset.status}
          allowComments
          allowDownload={Boolean(storagePath) && Boolean(share?.allow_download)}
          downloadUrl={storagePath && share?.allow_download ? resolveAssetDownloadUrl(asset) : null}
          downloadFallbackUrl={reviewMedia.fallbackUrl}
          onAddComment={handleAddAnnotation}
          onChangeStatus={handleStatusChange}
          onRequestIdentify={() => setIdentityPromptOpen(true)}
          onChangeIdentity={identity?.type === "guest" ? () => {
            clearShareGuestIdentity();
            setIdentity(null);
            setIdentityPromptOpen(true);
          } : undefined}
          sibling={{
            currentIndex: siblingIndex,
            total: siblingAssets.length,
            hasPrev: Boolean(prevSiblingAsset),
            hasNext: Boolean(nextSiblingAsset),
            onPrev: () => prevSiblingAsset && navigateToSibling(prevSiblingAsset),
            onNext: () => nextSiblingAsset && navigateToSibling(nextSiblingAsset),
          }}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-x-hidden [height:100dvh]">
      <ShareAuthDialog open={identityPromptOpen && !identity} onIdentify={handleIdentity} onClose={() => setIdentityPromptOpen(false)} />

      <header className="sticky top-0 z-40 flex-shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/share/project/${token}`)} aria-label="Back to project">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{asset.title || "Shared asset"}</span>
            </div>
          </div>
          <AssetNavArrows
            currentIndex={siblingIndex}
            total={siblingAssets.length}
            hasPrev={Boolean(prevSiblingAsset)}
            hasNext={Boolean(nextSiblingAsset)}
            onPrev={() => prevSiblingAsset && navigateToSibling(prevSiblingAsset)}
            onNext={() => nextSiblingAsset && navigateToSibling(nextSiblingAsset)}
          />
          <ReviewStatusActions status={asset.status} onChange={handleStatusChange} />

          {supportsCommentsPanel ? (
            <DetailsPanelToggle
              open={commentsPanelOpen}
              onToggle={() => setCommentsPanelOpen((open) => !open)}
            />
          ) : null}

          {storagePath && share?.allow_download ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                downloadAsset(resolveAssetDownloadUrl(asset), asset.title || "asset", { fallbackUrl: reviewMedia.fallbackUrl });
              }}
            >
              <DownloadIcon className="h-4 w-4" />
            </Button>
          ) : null}

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
              <span className="max-w-[120px] truncate text-xs font-medium text-foreground">
                {identity.name}
              </span>
              {identity.type === "guest" && (
                <button
                  onClick={() => {
                    clearShareGuestIdentity();
                    setIdentity(null);
                    setIdentityPromptOpen(true);
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Change
                </button>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 min-w-0">
        <div className="min-h-0 min-w-0 w-full overflow-hidden">
          {isVideo ? (
            <VideoPlayerWithAnnotations
              title={asset.title ?? undefined}
              videoUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
              downloadUrl={storagePath && share?.allow_download ? resolveAssetDownloadUrl(asset) : null}
              downloadName={asset.title ?? undefined}
            />
          ) : isAudio ? (
            <AudioReview
              title={asset.title ?? undefined}
              audioUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset}
              onMediaError={handleReviewMediaError}
              fallbackDownloadUrl={reviewMedia.fallbackUrl}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : isPdf ? (
            <PdfAnnotatorWithAnnotations
              title={asset.title ?? undefined}
              pdfUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset as any}
              onMediaError={handleReviewMediaError}
              fallbackDownloadUrl={reviewMedia.fallbackUrl}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : isLiveEmbeddedReviewAsset(asset) ? (
            <LiveSnippetReview
              title={asset.title ?? undefined}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset as any}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
) : isLiveUrlReview ? (
            <LiveUrlReview
              title={asset.title ?? undefined}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset as any}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : isHtml5Banner ? (
            <Html5BannerAnnotatorWithAnnotations
              title={asset.title ?? undefined}
              htmlUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset as any}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : isTextFilePreview && textFilePreviewInfo ? (
            <Suspense fallback={null}>
              <UnsupportedAssetPreview
                title={asset.title ?? undefined}
                fileTypeLabel={textFilePreviewInfo.label}
                customPreview={
                  <TextFileView fileUrl={reviewAssetUrl} title={asset.title ?? undefined} lang={textFilePreviewInfo.lang} className="h-full w-full" />
                }
                downloadUrl={reviewAssetUrl || null}
                fallbackDownloadUrl={reviewMedia.fallbackUrl}
                downloadName={asset.title || "asset"}
                annotations={viewerAnnotations}
                onAddAnnotation={handleAddAnnotation}
                assetId={asset.id}
                asset={asset}
                commentMutationContext={projectCommentMutationContext}
                commentEndpoint="project-share-comment"
                commentsPanelOpen={commentsPanelOpen}
                onCommentsPanelOpenChange={setCommentsPanelOpen}
              />
            </Suspense>
          ) : isUnsupportedPreview ? (
            <UnsupportedAssetPreview
              title={asset.title ?? undefined}
              fileTypeLabel={unsupportedPreviewLabel ?? "Image"}
              message={isUnsupportedBrowserImagePreview && !isRawPreviewPending ? `${unsupportedPreviewLabel} preview isn't supported in this browser.` : undefined}
              customPreview={isRawPreviewPending ? (
                <RawPreviewPending
                  title={asset?.title}
                  coverUrl={asset?.cover_image_url ?? null}
                  failed={rawPreviewGaveUp}
                  downloadUrl={reviewAssetUrl || null}
                  fallbackDownloadUrl={reviewMedia.fallbackUrl}
                  downloadName={asset?.title}
                />
              ) : undefined}
              downloadUrl={reviewAssetUrl || null}
              fallbackDownloadUrl={reviewMedia.fallbackUrl}
              downloadName={asset.title || "asset"}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : pendingImageReviewerType ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/30" />
          ) : isWebsiteScreenshot ? (
            <WebScreenshotReview
              title={asset.title ?? undefined}
              imageUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              onMediaError={handleReviewMediaError}
              fallbackDownloadUrl={reviewMedia.fallbackUrl}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          ) : (
            <ImageAnnotatorWithAnnotations
              hideHeader
              title={asset.title ?? undefined}
              imageUrl={reviewAssetUrl}
              annotations={viewerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              asset={asset as any}
              onMediaError={handleReviewMediaError}
              fallbackDownloadUrl={reviewMedia.fallbackUrl}
              commentMutationContext={projectCommentMutationContext}
              commentEndpoint="project-share-comment"
              commentsPanelOpen={commentsPanelOpen}
              onCommentsPanelOpenChange={setCommentsPanelOpen}
            />
          )}
        </div>
      </div>
    </div>
  );
}

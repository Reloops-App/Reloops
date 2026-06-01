import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import AssetNotFound from "@/components/errors/AssetNotFound";
import { ShareAuthDialog } from "@/components/review/ShareAuthDialog";
import { normalizeAnnotation } from "@/components/review/annotator-utils";
import ImageAnnotatorWithAnnotations from "@/components/review/image";
import PdfAnnotatorWithAnnotations from "@/components/review/pdf";
import VideoPlayerWithAnnotations, { type Annotation } from "@/components/review/video";
import WebScreenshotReview from "@/components/review/WebScreenshotReview";
import { isLikelyWebsiteScreenshot, type ImageDimensions } from "@/components/review/website-review-utils";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/utils";
import { ensureFreshSupabaseSession, getSupabaseSessionFromStorage, getSupabaseUserFromStorage } from "@/lib/supabaseAuthApi";

type SharedAsset = {
  id: string;
  title?: string;
  name?: string;
  cover_image_url?: string | null;
  coverUrl?: string | null;
  storage_path?: string | null;
  file_url?: string | null;
  signed_url?: string | null;
  mime_type?: string | null;
  type?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
};

type CollectionShareLink = {
  id: string;
  allow_download: boolean;
  allow_comments: boolean;
  rows: Array<{ rootId: string; versionCount: number; asset: SharedAsset }>;
  is_member?: boolean;
};

type CommentRow = {
  id: string;
  asset_id: string;
  author_user_id: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  body: string;
  ms_offset: number | null;
  drawing_json?: unknown | null;
  created_at: string;
  status: string;
};

type Identity = {
  type: "user" | "guest";
  name: string;
  email: string;
  userId?: string;
};

const STORAGE_KEY = "share_guest_identity";

function buildEdgeHeaders(accessToken?: string | null) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken ?? anonKey}`,
  };
}

export default function ShareCollectionAsset() {
  const { token, assetId } = useParams<{ token: string; assetId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "expired" | "revoked" | "access_denied" | "unknown" | null>(null);
  const [share, setShare] = useState<CollectionShareLink | null>(null);
  const [asset, setAsset] = useState<SharedAsset | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [checkingIdentity, setCheckingIdentity] = useState(true);
  const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
  const [probedImageDimensions, setProbedImageDimensions] = useState<ImageDimensions | null>(null);
  const [imageProbeSettled, setImageProbeSettled] = useState(false);

  const mimeType = asset?.mime_type ?? asset?.type ?? null;
  const isVideo = Boolean(mimeType && mimeType.startsWith("video/"));
  const isPdf = mimeType === "application/pdf";
  const storagePath = asset?.storage_path ?? null;
  const reviewAssetUrl = asset?.file_url ?? asset?.signed_url ?? (storagePath ? `${import.meta.env.VITE_ASSET_PUBLIC_BASE_URL}${storagePath}` : "");

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
        });
        setCheckingIdentity(false);
        return;
      }

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && mounted) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.name && parsed.email) {
            setIdentity({
              type: "guest",
              name: parsed.name,
              email: parsed.email,
            });
          }
        } catch (nextError) {
          console.error("Failed to parse stored identity", nextError);
        }
      }

      if (mounted) setCheckingIdentity(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !assetId) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await ensureFreshSupabaseSession();
        const session = getSupabaseSessionFromStorage();
        const accessToken = session?.access_token ?? null;

        const { data, error: shareError } = await invokeEdgeFunction("share", {
          headers: buildEdgeHeaders(accessToken),
          body: {
            action: "get-collection-share-link",
            token,
          },
        });

        if (shareError) throw new Error(shareError.message || "Failed to load share link");
        const payload = data?.data as CollectionShareLink | undefined;
        if (!payload) {
          setError("not_found");
          return;
        }

        const matchedRow = Array.isArray(payload.rows)
          ? payload.rows.find((row) => row?.asset?.id === assetId)
          : null;

        if (!matchedRow?.asset) {
          setError("not_found");
          return;
        }

        if (payload.is_member && matchedRow.asset.workspace_id) {
          const workspaceId = matchedRow.asset.workspace_id;
          const projectId = matchedRow.asset.project_id;
          if (projectId) {
            navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${matchedRow.asset.id}`, { replace: true });
          } else {
            navigate(`/workspace/${workspaceId}/assets/${matchedRow.asset.id}`, { replace: true });
          }
          return;
        }

        if (mounted) {
          setShare(payload);
          setAsset(matchedRow.asset);
        }

        const commentsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment?share_token=${encodeURIComponent(token)}&asset_id=${encodeURIComponent(assetId)}`;
        const commentRes = await fetch(commentsUrl, {
          headers: buildEdgeHeaders(accessToken),
        });

        if (!commentRes.ok) {
          const message = await commentRes.text();
          throw new Error(message || "Failed to load comments");
        }

        const commentPayload = await commentRes.json();
        if (mounted) {
          setComments((commentPayload?.data ?? []) as CommentRow[]);
          setLoading(false);
        }
      } catch (nextError: any) {
        const message = String(nextError?.message ?? nextError);
        if (message.toLowerCase().includes("expired")) setError("expired");
        else if (message.toLowerCase().includes("revoked")) setError("revoked");
        else if (message.toLowerCase().includes("access")) setError("access_denied");
        else setError("unknown");
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [assetId, navigate, token]);

  useEffect(() => {
    setProbedImageDimensions(null);
    setImageProbeSettled(false);

    if (isVideo || isPdf || !mimeType?.startsWith("image/") || !reviewAssetUrl) {
      setImageProbeSettled(true);
      return;
    }

    let active = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (!active) return;
      setProbedImageDimensions({
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
      setImageProbeSettled(true);
    };
    probe.onerror = () => {
      if (!active) return;
      setImageProbeSettled(true);
    };
    probe.src = reviewAssetUrl;

    return () => {
      active = false;
    };
  }, [isPdf, isVideo, mimeType, reviewAssetUrl]);

  const baseWebsiteScreenshot = isLikelyWebsiteScreenshot(asset as any);
  const isWebsiteScreenshot = !isVideo && isLikelyWebsiteScreenshot(asset as any, probedImageDimensions);
  const pendingImageReviewerType = !isVideo && !isPdf && mimeType?.startsWith("image/") && !baseWebsiteScreenshot && !imageProbeSettled;

  const playerAnnotations = useMemo<Annotation[]>(() => {
    return comments.map((comment) => {
      const timeSec = Number.isFinite(comment.ms_offset as number) ? (comment.ms_offset as number) / 1000 : Number.NaN;
      const base = normalizeAnnotation({
        ...comment,
        time: timeSec,
        drawing: comment.drawing_json,
        author: comment.guest_name ?? "Guest",
      });
      return {
        ...base,
        author: comment.guest_name ?? base.author,
      } as Annotation;
    });
  }, [comments]);

  const handleIdentity = (guestIdentity: { type: "guest"; name: string; email: string }) => {
    setIdentity(guestIdentity);
    setIdentityPromptOpen(false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: guestIdentity.name, email: guestIdentity.email }));
  };

  async function handleAddAnnotation(annotation: Annotation) {
    if (!asset?.id || !token) return;
    if (!share?.allow_comments) {
      toast.error("Comments are disabled for this share link.");
      return;
    }
    if (!identity) {
      setIdentityPromptOpen(true);
      toast.info("Identify yourself to leave a comment.");
      return;
    }

    try {
      await ensureFreshSupabaseSession();
      const session = getSupabaseSessionFromStorage();
      const accessToken = session?.access_token ?? null;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment`, {
        method: "POST",
        headers: buildEdgeHeaders(accessToken),
        body: JSON.stringify({
          asset_id: asset.id,
          body: annotation.text,
          ms_offset: Number.isFinite(annotation.time) ? Math.round((annotation.time as number) * 1000) : null,
          drawing_json: annotation.page != null ? { page: annotation.page, strokes: annotation.drawing ?? [] } : annotation.drawing ?? null,
          share_token: token,
          guest_name: identity.name,
          guest_email: identity.email,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const payload = await response.json();
      const nextComment = payload?.data as CommentRow | undefined;
      if (nextComment) {
        setComments((prev) => prev.some((comment) => comment.id === nextComment.id) ? prev : [...prev, nextComment]);
      }
      toast.success("Comment added");
    } catch (nextError) {
      console.error("Failed to add shared collection comment", nextError);
      toast.error("Failed to add comment");
    }
  }

  if (loading || checkingIdentity) {
    return <div className="p-6">Loading shared asset…</div>;
  }

  if (!share || !asset || error) {
    return (
      <AssetNotFound
        workspaceId=""
        projectId={undefined}
        assetId={assetId ?? ""}
        error={error === "expired" || error === "revoked" || error === "access_denied" ? "access_denied" : "not_found"}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <ShareAuthDialog open={identityPromptOpen && !identity} onIdentify={handleIdentity} />

      <header className="sticky top-0 z-40 flex-shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-3 px-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/share/collection/${token}`)} aria-label="Back to collection">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{asset.title || asset.name || "Shared asset"}</span>
              {(!share.allow_comments || identity) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {!share.allow_comments ? <span>Comments are disabled for this share link.</span> : null}
                  {identity ? (
                    <div className="truncate">
                      Viewing as <span className="font-medium text-foreground">{identity.name || "Guest"}</span> ({identity.email})
                      {identity.type === "guest" ? (
                        <button
                          onClick={() => {
                            localStorage.removeItem(STORAGE_KEY);
                            setIdentity(null);
                            setIdentityPromptOpen(true);
                          }}
                          className="ml-2 text-primary hover:underline"
                        >
                          Change
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          {share.allow_download && storagePath ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const downloadUrl = `${import.meta.env.VITE_ASSET_PUBLIC_BASE_URL}${storagePath}`;
                void downloadFile(downloadUrl, asset.title || asset.name || "asset");
              }}
            >
              <DownloadIcon className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-full">
          {isVideo ? (
            <VideoPlayerWithAnnotations
              title={asset.title || asset.name}
              videoUrl={reviewAssetUrl}
              poster={asset.cover_image_url || asset.coverUrl || undefined}
              annotations={playerAnnotations}
              onAddAnnotation={handleAddAnnotation}
            />
          ) : isPdf ? (
            <PdfAnnotatorWithAnnotations
              title={asset.title || asset.name}
              pdfUrl={reviewAssetUrl}
              annotations={playerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
              asset={asset as any}
            />
          ) : pendingImageReviewerType ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/30" />
          ) : isWebsiteScreenshot ? (
            <WebScreenshotReview
              title={asset.title || asset.name}
              imageUrl={reviewAssetUrl}
              annotations={playerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              assetId={asset.id}
            />
          ) : (
            <ImageAnnotatorWithAnnotations
              hideHeader
              title={asset.title || asset.name}
              imageUrl={reviewAssetUrl}
              annotations={playerAnnotations}
              onAddAnnotation={handleAddAnnotation}
              asset={asset as any}
            />
          )}
        </div>
      </div>
    </div>
  );
}

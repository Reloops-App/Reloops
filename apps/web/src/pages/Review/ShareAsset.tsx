import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invokeEdgeFunction } from "@/api/edge";
import AssetNotFound from "@/components/errors/AssetNotFound";
import VideoPlayerWithAnnotations, { type Annotation } from "@/components/review/video";
import ImageAnnotatorWithAnnotations from "@/components/review/image";
import WebScreenshotReview from "@/components/review/WebScreenshotReview";
import PdfAnnotatorWithAnnotations from "@/components/review/pdf";
import UnsupportedAssetPreview from "@/components/review/UnsupportedAssetPreview";
import { normalizeAnnotation } from "@/components/review/annotator-utils";
import { isLikelyWebsiteScreenshot, type ImageDimensions } from "@/components/review/website-review-utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";
import { downloadFile } from "@/lib/utils";
import { ShareAuthDialog } from "@/components/review/ShareAuthDialog";
import { ensureFreshSupabaseSession, getSupabaseSessionFromStorage, getSupabaseUserFromStorage } from "@/lib/supabaseAuthApi";
import { getDesignAssetLabel, isDesignPreviewUnavailableAsset } from "@/lib/designFiles";

type Asset = {
    id: string;
    title: string;
    cover_image_url?: string | null;
    storage_path: string;
    file_url?: string | null;
    signed_url?: string | null;
    mime_type?: string | null;
    width?: number | null;
    height?: number | null;
    workspace_id?: string;
    project_id?: string | null;
};

type ShareLink = {
    id: string;
    asset_id: string;
    allow_download: boolean;
    allow_comments: boolean;
    assets: Asset;
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
        "apikey": anonKey,
        "Authorization": `Bearer ${accessToken ?? anonKey}`,
    };
}

export default function ShareAsset() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<"not_found" | "expired" | "revoked" | "unknown" | null>(null);
    const [share, setShare] = useState<ShareLink | null>(null);
    const [comments, setComments] = useState<CommentRow[]>([]);

    // Auth / Identity state
    const [identity, setIdentity] = useState<Identity | null>(null);
    const [checkingIdentity, setCheckingIdentity] = useState(true);
    const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
    const [pendingAnnotation, setPendingAnnotation] = useState<Annotation | null>(null);

    const asset = share?.assets ?? null;
    const isVideo = Boolean(asset?.mime_type && asset.mime_type.startsWith("video/"));
    const isPdf = asset?.mime_type === "application/pdf";
    const reviewImageUrl = asset?.file_url ?? asset?.signed_url ?? (asset?.storage_path ? `${import.meta.env.VITE_ASSET_PUBLIC_BASE_URL}${asset.storage_path}` : "");
    const isUnsupportedDesignPreview = isDesignPreviewUnavailableAsset({
        mime_type: asset?.mime_type,
        title: asset?.title,
        storage_path: asset?.storage_path,
    });
    const designAssetLabel = getDesignAssetLabel({
        mime_type: asset?.mime_type,
        title: asset?.title,
        storage_path: asset?.storage_path,
    });
    const [probedImageDimensions, setProbedImageDimensions] = useState<ImageDimensions | null>(null);
    const [imageProbeSettled, setImageProbeSettled] = useState(false);

    useEffect(() => {
        setProbedImageDimensions(null);
        setImageProbeSettled(false);

        if (isVideo || isPdf || isUnsupportedDesignPreview || !asset?.mime_type?.startsWith("image/") || !reviewImageUrl) {
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
        probe.src = reviewImageUrl;

        return () => {
            active = false;
        };
    }, [asset?.mime_type, isPdf, isUnsupportedDesignPreview, isVideo, reviewImageUrl]);

    const baseWebsiteScreenshot = isLikelyWebsiteScreenshot(asset);
    const isWebsiteScreenshot = !isVideo && isLikelyWebsiteScreenshot(asset, probedImageDimensions);
    const pendingImageReviewerType = !isUnsupportedDesignPreview && !isVideo && !isPdf && asset?.mime_type?.startsWith("image/") && !baseWebsiteScreenshot && !imageProbeSettled;

    // 1. Check Identity on Mount
	    useEffect(() => {
	        let mounted = true;
	        (async () => {
	            // Check logged in user
	            const user = getSupabaseUserFromStorage();
	            if (user && mounted) {
	                setIdentity({
	                    type: "user",
	                    name: String((user as any).user_metadata?.full_name || (user as any).email || "User"),
	                    email: String((user as any).email || (user as any).user_metadata?.email || ""),
	                    userId: String((user as any).id)
	                });
	                setCheckingIdentity(false);
	                return;
	            }

            // Check stored guest identity
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && mounted) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed.name && parsed.email) {
                        setIdentity({
                            type: "guest",
                            name: parsed.name,
                            email: parsed.email
                        });
                    }
                } catch (e) {
                    console.error("Failed to parse stored identity", e);
                }
            }
            if (mounted) setCheckingIdentity(false);
        })();

        return () => { mounted = false; };
    }, []);

    // 2. Fetch Share Data & Comments
    useEffect(() => {
        if (!token) return;
        let mounted = true;
        setLoading(true);
        setError(null);

	        (async () => {
	            try {
	                // Best-effort refresh; share can still be loaded for guests.
	                await ensureFreshSupabaseSession();
	                const session = getSupabaseSessionFromStorage();
	                const accessToken = session?.access_token ?? null;

                const { data, error: shareError } = await invokeEdgeFunction("share", {
                    headers: buildEdgeHeaders(accessToken),
                    body: {
                        action: "get-asset-share-link",
                        token
                    }
                });

                if (shareError) throw shareError;
                const shareData = data?.data as ShareLink | undefined;
                if (!shareData) {
                    setError("not_found");
                    return;
                }

                // Immediate redirect if member (backend check)
                if (shareData.is_member && shareData.assets?.workspace_id) {
                    const workspaceId = shareData.assets.workspace_id;
                    const projectId = shareData.assets.project_id;
                    const assetId = shareData.assets.id;

                    if (projectId) {
                        navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${assetId}`, { replace: true });
                    } else {
                        navigate(`/workspace/${workspaceId}/assets/${assetId}`, { replace: true });
                    }
                    return;
                }

	                if (mounted) {
	                    setShare(shareData);
	                }

                const commentUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment?share_token=${encodeURIComponent(token)}`;
	                const commentRes = await fetch(commentUrl, {
	                    headers: buildEdgeHeaders(accessToken)
	                });

                if (!commentRes.ok) {
                    const errText = await commentRes.text();
                    console.error("Failed to load comments", errText);
                } else {
                    const commentJson = await commentRes.json();
                    if (mounted) setComments((commentJson?.data ?? []) as CommentRow[]);
                }

                // Only set loading to false if we didn't redirect
                if (mounted) setLoading(false);

            } catch (err: any) {
                const message = String(err?.message ?? err);
                if (message.toLowerCase().includes("expired")) {
                    setError("expired");
                } else if (message.toLowerCase().includes("revoked")) {
                    setError("revoked");
                } else {
                    setError("unknown");
                }
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [token]);

    const playerAnnotations = useMemo<Annotation[]>(() => {
        return comments.map((c) => {
            const timeSec = Number.isFinite(c.ms_offset as number) ? (c.ms_offset as number) / 1000 : Number.NaN;
            const base = normalizeAnnotation({
                ...c,
                time: timeSec,
                drawing: c.drawing_json,
                author: c.guest_name ?? "Guest",
            });
            return {
                ...base,
                author: c.guest_name ?? base.author,
            } as Annotation;
        });
    }, [comments]);

    const submitAnnotation = useCallback(async (annotation: Annotation, activeIdentity: Identity) => {
        if (!asset?.id || !token) return false;

        try {
            const payload = {
                asset_id: asset.id,
                body: annotation.text,
                ms_offset: Number.isFinite(annotation.time) ? Math.round((annotation.time as number) * 1000) : null,
                drawing_json: annotation.page != null ? { page: annotation.page, strokes: annotation.drawing ?? [] } : annotation.drawing ?? null,
                share_token: token,
                guest_name: activeIdentity.name,
                guest_email: activeIdentity.email,
            };

            await ensureFreshSupabaseSession();
            const session = getSupabaseSessionFromStorage();
            const accessToken = session?.access_token ?? null;

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment`, {
                method: "POST",
                headers: buildEdgeHeaders(accessToken),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText);
            }

            const resData = await response.json();
            const data = resData?.data as CommentRow | undefined;
            if (data) {
                setComments((prev) => prev.some((c) => c.id === data.id) ? prev : [...prev, data]);
            }
            toast.success("Comment added");
            return true;
        } catch (e: any) {
            console.error("Failed to add comment", e);
            toast.error("Failed to add comment");
            return false;
        }
    }, [asset?.id, token]);

    const handleIdentity = (guestIdentity: { type: "guest"; name: string; email: string }) => {
        setIdentity(guestIdentity);
        setIdentityPromptOpen(false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: guestIdentity.name, email: guestIdentity.email }));

        if (pendingAnnotation) {
            const queued = pendingAnnotation;
            setPendingAnnotation(null);
            void submitAnnotation(queued, guestIdentity);
        }
    };

    async function handleAddAnnotation(a: Annotation) {
        if (!asset?.id || !token) return;
        if (!share?.allow_comments) {
            toast.error("Comments are disabled for this share link.");
            return;
        }

        if (!identity) {
            setPendingAnnotation(a);
            setIdentityPromptOpen(true);
            toast.info("Identify yourself to post this comment.");
            return;
        }

        await submitAnnotation(a, identity);
    }

    if (loading || checkingIdentity) {
        return <div className="p-6">Loading share link…</div>;
    }

    if (!share || error) {
        return (
            <AssetNotFound
                workspaceId={""}
                projectId={undefined}
                assetId={asset?.id ?? ""}
                error={error === "expired" || error === "revoked" ? "access_denied" : "not_found"}
                onRetry={() => window.location.reload()}
            />
        );
    }

    return (
        <div className="flex flex-col h-screen">
            <ShareAuthDialog open={identityPromptOpen && !identity} onIdentify={handleIdentity} />

            <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
                <div className="flex h-14 items-center gap-3 px-3">
                    <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{asset?.title ?? "Shared asset"}</span>
                            {( !share.allow_comments || identity) && (
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    {!share.allow_comments && (
                                        <span className="truncate">Comments are disabled for this share link.</span>
                                    )}
                                    {identity && (
                                        <div className="truncate">
                                            Viewing as <span className="font-medium text-foreground">{identity.name || "Guest"}</span> ({identity.email})
                                            {identity.type === 'guest' && (
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
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {share.allow_download && asset?.storage_path && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
                                const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
                                const path = asset.storage_path.startsWith("/") ? asset.storage_path : `/${asset.storage_path}`;
                                const downloadUrl = `${base}${path}`;
                                void downloadFile(downloadUrl, asset.title || "asset");
                            }}
                        >
                            <DownloadIcon className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </header>

            <div className="flex-1 min-h-0 flex">
                <div className="w-full">
                    {isVideo ? (
                        <VideoPlayerWithAnnotations
                            title={asset?.title}
                            videoUrl={reviewImageUrl}
                            poster={asset?.cover_image_url}
                            annotations={playerAnnotations}
                            onAddAnnotation={handleAddAnnotation}
                        />
                    ) : isPdf ? (
                        <PdfAnnotatorWithAnnotations
                            title={asset?.title}
                            pdfUrl={reviewImageUrl}
                            annotations={playerAnnotations}
                            onAddAnnotation={handleAddAnnotation}
                            assetId={asset?.id}
                            asset={asset}
                        />
                    ) : isUnsupportedDesignPreview ? (
                        <UnsupportedAssetPreview
                            title={asset?.title}
                            fileTypeLabel={designAssetLabel}
                            downloadUrl={reviewImageUrl || null}
                            downloadName={asset?.title || "asset"}
                        />
                    ) : pendingImageReviewerType ? (
                        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/30" />
                    ) : isWebsiteScreenshot ? (
                        <WebScreenshotReview
                            title={asset?.title}
                            imageUrl={reviewImageUrl}
                            annotations={playerAnnotations}
                            onAddAnnotation={handleAddAnnotation}
                            assetId={asset?.id}
                        />
                    ) : (
                        <ImageAnnotatorWithAnnotations
                            hideHeader
                            title={asset?.title}
                            imageUrl={reviewImageUrl}
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

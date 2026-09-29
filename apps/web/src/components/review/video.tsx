import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn, fmtHMSF, downloadAsset } from "@/lib/utils";
import { resolveAssetDownloadUrl } from "@/lib/mediaDelivery";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { Play, Pause, Volume2, VolumeX, Maximize2, Captions, Download, Loader2 } from "lucide-react";
import { SeekBar } from "../video-player/seekbar";
import CommentsPanel from "./CommentsPanel";
import type { Annotation, Stroke } from "./annotator-utils";
import { getDrawingBounds, mergeAnnotationOverrides } from "./annotator-utils";

// Re-export for convenience
export type { Annotation, Stroke };

type ReviewAsset = {
    id: string;
    title: string;
    description?: string | null;
    tags?: string[] | null;
    smart_tags?: string[] | null;
    smart_description?: string | null;
    status?: string | null;
    assigned_to?: string | null;
    uploaded_by?: string | null;
    created_at: string;
    updated_at?: string | null;
    uploaded_at?: string;
    mime_type?: string | null;
    size_bytes?: number | null;
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    version_no?: number | null;
    storage_path: string;
    signed_url?: string | null;
    delivery_url?: string | null;
    cdn_url?: string | null;
};

export type VideoPlayerProps = {
    src?: string;
    videoUrl?: string;
    poster?: string;
    annotations?: Annotation[];
    className?: string;
    title?: string;
    onAddAnnotation?: (a: Annotation) => void | Promise<void>;

    // Context for enhanced mentions
    projectId?: string | null;
    organizationId?: string | null;
    workspaceId?: string | null;
    assetId?: string | null;

    // Asset data for Fields tab
    asset?: ReviewAsset | null;
    onAssetMetadataSave?: (patch: { description: string | null; tags: string[] }) => Promise<void> | void;
    onRetagAsset?: () => void;
    retagStatus?: "idle" | "queued" | "error";
    commentsPanelOpen?: boolean;
    onCommentsPanelOpenChange?: (open: boolean) => void;
    commentMutationContext?: CommentMutationContext;
    // Which edge function edit/delete/toggle calls target — defaults to the
    // shared "comment" function used by every existing caller. A share flow
    // with its own isolated comment function (e.g. project-share-comment)
    // can point this elsewhere without changing behavior for anyone else.
    commentEndpoint?: string;
    isPreparingSource?: boolean;
    loadingLabel?: string;
    // Explicit download source for callers that don't pass a full `asset`
    // object (the guest share pages) — the in-player Download button was inert
    // for them because `handleDownload` needs `asset.storage_path`.
    downloadUrl?: string | null;
    downloadName?: string | null;
    profiles?: Record<string, {
        id: string;
        display_name?: string | null;
        avatar_url?: string | null;
    }>;
};

// Annotation drawing
import { useDrawing } from "./shared/useDrawing";
import CanvasOverlay from "./shared/CanvasOverlay";
import AnnotationToast from "./shared/AnnotationToast";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { ReviewModeBar, type ReviewMode } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";



import { TikTokOverlay } from "./TikTokOverlay";
import { SafeZoneOverlay, type SafeZoneAspectRatio } from "./SafeZoneOverlay";
import { InstagramOverlay, type InstagramMode } from "./InstagramOverlay";
import { YouTubeShortsOverlay } from "./YouTubeShortsOverlay";
import { DedicatedDevicePreview } from "./DedicatedDevicePreview";

// ------------------------------------------------------------
// Component
// ------------------------------------------------------------
function createAnchorStroke(point: { x: number; y: number }, color: string): Stroke {
    return {
        tool: "pen",
        color,
        points: [point],
    };
}

export default function VideoPlayerWithAnnotations({
    src: _src,
    videoUrl,
    poster,
    annotations: annotationsProp,
    className,
    onAddAnnotation,
    projectId,
    organizationId,
    workspaceId,
    assetId,
    asset,
    onAssetMetadataSave,
    onRetagAsset,
    retagStatus,
    commentsPanelOpen,
    commentMutationContext,
    commentEndpoint = "comment",
    isPreparingSource = false,
    loadingLabel = "Loading video...",
    downloadUrl,
    downloadName,
    profiles = {},
}: VideoPlayerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffering, setBuffering] = useState(false);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [showToast, setShowToast] = useState<Annotation | null>(null);
    const [search, setSearch] = useState("");
    const panelOpen = commentsPanelOpen ?? true;
    const canCompleteComments = !commentMutationContext?.share_token;

    // Edit/delete target the "comment" function by default (unchanged for
    // every existing caller). A share flow with its own isolated comment
    // function passes commentEndpoint to route here instead — that function
    // takes an action-based POST body rather than comment's PATCH-with-status.
    const editOrDeleteComment = useCallback(async (action: "edit" | "delete", fields: { id: string; body?: string }) => {
        if (commentEndpoint === "comment") {
            const body: Record<string, unknown> = { id: fields.id, ...(commentMutationContext ?? {}) };
            if (action === "edit") body.body = fields.body;
            else body.status = "deleted";
            return invokeEdgeFunction("comment", { method: "PATCH", body });
        }
        return invokeEdgeFunction(commentEndpoint, {
            method: "POST",
            body: { action, id: fields.id, body: fields.body, ...(commentMutationContext ?? {}) },
        });
    }, [commentEndpoint, commentMutationContext]);

    // —— NEW: annotation/drawing composer state ——
    const [includeTs, setIncludeTs] = useState(true);
    const {
        annotating,
        setAnnotating,
        tool,
        setTool,
        color,
        setColor,
        draftStrokes,
        activeStroke,
        allStrokes,
        pointerDown,
        pointerMove,
        pointerUp,
        pointerCancel,
        undoStroke,
        clearStrokes,
        addStroke,
    } = useDrawing();

    // Prefer explicit src, fall back to videoUrl
    const videoSrc = _src ?? videoUrl;
    const isVideoLoading = isPreparingSource || Boolean(videoSrc && buffering);
    const handleDownload = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        event.preventDefault();
        // Prefer the explicit download URL (guest pages pass it); fall back to
        // the full asset object (authed ReviewAsset).
        const url = downloadUrl ?? (asset?.storage_path ? resolveAssetDownloadUrl(asset) : null);
        if (!url) return;
        downloadAsset(url, downloadName ?? asset?.title ?? "video");
    }, [asset, downloadUrl, downloadName]);

    const enterFullscreen = useCallback(() => {
        const el = containerRef.current;
        const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        if (el?.requestFullscreen) {
            void el.requestFullscreen().catch(() => {});
            return;
        }
        // iPhone Safari: no Element.requestFullscreen — fullscreen the <video>.
        if (video?.webkitEnterFullscreen) {
            try { video.webkitEnterFullscreen(); } catch { /* metadata not ready */ }
        }
    }, []);

    // Holds only the fields the user has locally changed (delete/complete/
    // edit), keyed by annotation id, re-applied on every sync below -- see
    // mergeAnnotationOverrides for why: without it, deleting a comment and
    // then adding another one (or anything else that refreshes
    // annotationsProp) before the delete's own server round-trip/realtime
    // echo lands would silently resurrect it, since the next prop sync
    // still carries the pre-delete shape.
    const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
    const [annotations, setAnnotations] = useState<Annotation[]>([]);

    // Sync with incoming props when the component is controlled by a parent.
    useEffect(() => {
        if (annotationsProp) setAnnotations(mergeAnnotationOverrides(annotationsProp, annotationOverrides));
    }, [annotationsProp, annotationOverrides]);

    const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
        setAnnotationOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
        setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const visibleAnnotations = useMemo(
        () => annotations.filter((annotation) => !annotation.isDeleted),
        [annotations]
    );

    // allStrokes comes from useDrawing

    // Include persisted drawings for annotations near the current time (e.g., +/- 0.6s)
    const savedStrokes = useMemo<Stroke[]>(() => {
        const NEAR = 0.6;
        return visibleAnnotations
            .filter((a: Annotation) => Number.isFinite(a.time) && Math.abs((a.time as number) - current) < NEAR)
            .flatMap((a: Annotation) => a.drawing || []);
    }, [current, visibleAnnotations]);
    const draftAnchorBounds = useMemo(
        () => getDrawingBounds(draftStrokes),
        [draftStrokes]
    );
    const draftAnchorFocus = draftAnchorBounds
        ? {
            x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2,
            y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2,
        }
        : null;

    const [videoDimensions, setVideoDimensions] = useState({ width: 16, height: 9 });

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onTime = () => setCurrent(v.currentTime);
        const onLoadedMetadata = () => {
            setDuration(v.duration || 0);
            if (v.videoWidth && v.videoHeight) {
                setVideoDimensions({ width: v.videoWidth, height: v.videoHeight });
            }
        };
        v.addEventListener("timeupdate", onTime);
        v.addEventListener("loadedmetadata", onLoadedMetadata);
        return () => {
            v.removeEventListener("timeupdate", onTime);
            v.removeEventListener("loadedmetadata", onLoadedMetadata);
        };
    }, []);

    useEffect(() => {
        const v = videoRef.current;
        setPlaying(false);
        setBuffering(Boolean(videoSrc) && !isPreparingSource);
        setCurrent(0);
        setDuration(0);
        if (!v || !videoSrc || isPreparingSource) return;
        v.load();
    }, [videoSrc, isPreparingSource]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.volume = muted ? 0 : volume;
    }, [volume, muted]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.playbackRate = rate;
    }, [rate]);

    useEffect(() => {
        const near = visibleAnnotations.find((a: Annotation) => Math.abs(a.time - current) < 0.6);
        setShowToast(near ?? null);
    }, [current, visibleAnnotations]);

    const togglePlay = () => {
        const v = videoRef.current;
        if (!v || !videoSrc || isPreparingSource) return;
        if (v.paused) {
            void v.play();
            setPlaying(true);
        } else {
            v.pause();
            setPlaying(false);
        }
    };

    const seekTo = (t: number) => {
        const v = videoRef.current;
        if (!v || !Number.isFinite(t)) return;
        const d = v.duration || duration || 0;
        v.currentTime = Math.max(0, Math.min(t, d));
    };

    // —— Canvas sizing/rendering (HiDPI aware) ——
    // Canvas rendering is handled by CanvasOverlay now.

    // Pointer handling is delegated to CanvasOverlay and useDrawing.

    const filteredAnnotations = useMemo(() => {
        if (!search.trim()) return visibleAnnotations;
        return visibleAnnotations.filter((a: Annotation) =>
            `${a.text} ${a.author ?? ""}`.toLowerCase().includes(search.toLowerCase())
        );
    }, [search, visibleAnnotations]);

    const [showTikTokPreview] = useState(false);
    const [showYouTubeShortsPreview] = useState(false);
    const [instagramMode] = useState<InstagramMode | null>(null);
    const [safeZoneMode] = useState<SafeZoneAspectRatio | null>(null);
    const [viewMode, setViewMode] = useState<"player" | "preview">("player");
    const [reviewMode, setReviewMode] = useState<ReviewMode>("view");

    // Inline composer state for comment/draw modes
    const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
    const [inlineComposerText, setInlineComposerText] = useState("");
    const [dockComposerText, setDockComposerText] = useState("");

    const closeInlineComposer = useCallback(() => {
        setInlineComposerOpen(false);
        setInlineComposerText("");
        clearStrokes();
    }, [clearStrokes]);

    // Sync annotating state with reviewMode + pause video on comment/draw
    useEffect(() => {
        setAnnotating(reviewMode === "draw");
        if (reviewMode === "comment" || reviewMode === "draw") {
            // Pause video when entering annotation modes
            const v = videoRef.current;
            if (v && !v.paused) {
                v.pause();
                setPlaying(false);
            }
        }
    }, [reviewMode, setAnnotating]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 767px)");
        const syncViewMode = (event: MediaQueryList | MediaQueryListEvent) => {
            if (event.matches) setViewMode("player");
        };

        syncViewMode(mediaQuery);
        const listener = (event: MediaQueryListEvent) => syncViewMode(event);
        mediaQuery.addEventListener("change", listener);
        return () => mediaQuery.removeEventListener("change", listener);
    }, []);

    return (
        <div className={cn("w-full h-full overflow-hidden", className)}>
            <div className="border-0 rounded-none bg-background h-full">
                <div className="p-0 h-full">
                    <div className="flex h-full min-h-0 w-full flex-col lg:flex-row">
                        {/* Video area. On the mobile vertical stack it's sized to
                            the video's own aspect ratio (capped) so a portrait
                            "short" fills the width instead of floating in a black
                            letterbox; the comments panel scrolls below. On lg+ it's
                            the flex-1 stage next to the fixed sidebar. */}
                        <div
                            className={cn(
                                "relative flex min-h-0 min-w-0 shrink-0 flex-col bg-background",
                                "lg:shrink lg:basis-auto lg:flex-1 lg:min-h-0 lg:h-full",
                                panelOpen ? "lg:w-[calc(100%-360px)]" : "lg:w-full",
                            )}
                        >
                            {/* Unified mode bar: View | Comment | Draw */}
                            <ReviewModeBar
                                mode={reviewMode}
                                onModeChange={(m) => {
                                    closeInlineComposer();
                                    setReviewMode(m);
                                    // Sync viewMode with reviewMode
                                    if (m === "preview") {
                                        setViewMode("preview");
                                    } else {
                                        setViewMode("player");
                                    }
                                }}
                                tool={tool}
                                onToolChange={setTool}
                                color={color}
                                onColorChange={setColor}
                            />

                            {/* Video container - Flex center to handle aspect ratio wrapper */}
                            <div
                                className={cn(
                                    "group relative flex items-center justify-center overflow-hidden bg-black",
                                    // mobile: the stage IS the video — sized to its own aspect
                                    // (capped), centred. No black letterbox bars; the space
                                    // beside a portrait clip is the column's own background.
                                    "mx-auto aspect-[var(--stage-ar)] max-w-full",
                                    panelOpen ? "max-h-[62svh]" : "max-h-[82svh]",
                                    // lg+: fill the flex-1 stage, unchanged
                                    "lg:mx-0 lg:aspect-auto lg:min-h-0 lg:h-full lg:w-full lg:max-h-none lg:flex-1",
                                )}
                                style={{ "--stage-ar": `${videoDimensions.width} / ${videoDimensions.height}` } as React.CSSProperties}
                            >

                                {/* Aspect Ratio Wrapper */}
                                <div
                                    ref={containerRef}
                                    className={cn(
                                        "relative max-h-full max-w-full shadow-2xl transition-opacity duration-300",
                                        viewMode === "preview" && "opacity-0 pointer-events-none",
                                        reviewMode === "comment" && "cursor-copy",
                                        reviewMode === "draw" && "cursor-crosshair"
                                    )}
                                    style={{
                                        aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}`
                                    }}
                                >
                                    <video
                                        ref={videoRef}
                                        src={videoSrc || undefined}
                                        poster={poster}
                                        className="w-full h-full object-contain"
                                        preload="metadata"
                                        onLoadStart={() => setBuffering(Boolean(videoSrc) && !isPreparingSource)}
                                        onLoadedMetadata={() => setBuffering(false)}
                                        onWaiting={() => setBuffering(true)}
                                        onCanPlay={() => setBuffering(false)}
                                        onClick={() => {
                                            if (reviewMode === "view") {
                                                togglePlay();
                                            }
                                        }}
                                        onPlay={() => setPlaying(true)}
                                        onPlaying={() => {
                                            setPlaying(true);
                                            setBuffering(false);
                                        }}
                                        onPause={() => setPlaying(false)}
                                        onEnded={() => setPlaying(false)}
                                        controls={false}
                                        playsInline
                                    />

                                    {isVideoLoading && playing ? (
                                        <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center justify-center rounded-full bg-black/60 p-2 text-white shadow-lg backdrop-blur-sm">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        </div>
                                    ) : null}

                                    {reviewMode === "view" && viewMode === "player" && !playing && videoSrc ? (
                                        <button
                                            type="button"
                                            aria-label={isVideoLoading ? loadingLabel : "Play video"}
                                            title={isVideoLoading ? loadingLabel : "Play video"}
                                            className={cn(
                                                "absolute left-1/2 top-1/2 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-md ring-1 ring-white/10 transition-[opacity,transform,background-color,border-color] duration-150 hover:scale-105 hover:border-white/45 hover:bg-black/60 focus-visible:scale-105 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                                                "opacity-100 scale-100"
                                            )}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                togglePlay();
                                            }}
                                        >
                                            {isVideoLoading ? (
                                                <Loader2 className="h-8 w-8 animate-spin" />
                                            ) : (
                                                <Play className="ml-1 h-8 w-8 fill-current" />
                                            )}
                                        </button>
                                    ) : null}

                                    {/* Overlays - Now constrained to video size */}
                                    <TikTokOverlay visible={showTikTokPreview} />
                                    <YouTubeShortsOverlay visible={showYouTubeShortsPreview} />
                                    <InstagramOverlay visible={!!instagramMode} mode={instagramMode || "reels"} />
                                    <SafeZoneOverlay aspectRatio={safeZoneMode || "9:16"} visible={!!safeZoneMode} />

                                    {reviewMode === "comment" ? (
                                        <div
                                            className="absolute inset-0 z-10 cursor-copy"
                                            onClick={(event) => {
                                                const v = videoRef.current;
                                                if (v && !v.paused) {
                                                    v.pause();
                                                    setPlaying(false);
                                                }

                                                const rect = event.currentTarget.getBoundingClientRect();
                                                const point = {
                                                    x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) / rect.width,
                                                    y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) / rect.height,
                                                };

                                                addStroke(createAnchorStroke(point, color), true);
                                                setInlineComposerText(dockComposerText);
                                                setInlineComposerOpen(true);
                                            }}
                                        />
                                    ) : null}

                                    {/* Drawing canvas overlay */}
                                    <CanvasOverlay
                                        targetRef={videoRef as unknown as React.RefObject<HTMLElement>}
                                        annotating={annotating}
                                        strokes={[...savedStrokes, ...allStrokes]}
                                        onPointerDown={pointerDown}
                                        onPointerMove={pointerMove}
                                        onPointerUp={() => {
                                            const hadActiveStroke = !!activeStroke;
                                            pointerUp();
                                            if (!hadActiveStroke) return;
                                            setInlineComposerText(dockComposerText);
                                            setInlineComposerOpen(true);
                                        }}
                                        onPointerCancel={pointerCancel}
                                    />

                                    <AnnotationToast
                                        show={!!showToast}
                                        author={showToast?.author}
                                        time={showToast?.time}
                                        text={showToast?.text ?? ""}
                                        emoji={showToast?.emoji}
                                    />

                                    {reviewMode === "comment" && draftAnchorFocus ? (
                                        <div
                                            className="pointer-events-none absolute z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[11px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20"
                                            style={{ left: `${draftAnchorFocus.x * 100}%`, top: `${draftAnchorFocus.y * 100}%` }}
                                        >
                                            +
                                        </div>
                                    ) : null}

                                    {/* Inline composer (Comment + Draw) */}
                                    {inlineComposerOpen && draftAnchorFocus ? (
                                        <div
                                            className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                                            style={{
                                                left: `min(calc(${draftAnchorFocus.x * 100}% + 18px), calc(100% - 292px))`,
                                                top: `max(calc(${draftAnchorFocus.y * 100}% - 12px), 16px)`,
                                            }}
                                        >
                                            <InlineNoteComposer
                                                value={inlineComposerText}
                                                onChange={(value) => {
                                                    setInlineComposerText(value);
                                                    setDockComposerText(value);
                                                }}
                                                color={color}
                                                label={reviewMode === "comment" ? "Add note at this frame" : "Describe your annotation"}
                                                hint={`Timestamp: ${fmtHMSF(current)}`}
                                                projectId={projectId}
                                                organizationId={organizationId}
                                                workspaceId={workspaceId}
                                                assetId={assetId}
                                                onCancel={closeInlineComposer}
                                                onSubmit={async () => {
                                                    const text = inlineComposerText.trim();
                                                    if (!text) return;
                                                    try {
                                                        const payload: Annotation = {
                                                            id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
                                                            time: includeTs ? current : Number.NaN,
                                                            text,
                                                            author: await getLoggedInUserProfile().then((u) => u?.full_name),
                                                            authorId: await getLoggedInUserProfile().then((u) => u?.sub),
                                                            isCompleted: false,
                                                            isDeleted: false,
                                                            createdAt: new Date().toISOString(),
                                                            emoji: {},
                                                            drawing: [...allStrokes],
                                                        };
                                                        if (!onAddAnnotation) {
                                                            setAnnotations((prev) => { if (prev.some(a => a.id === payload.id)) return prev; return [...prev, payload]; });
                                                        }
                                                        closeInlineComposer();
                                                        setDockComposerText("");
                                                        setReviewMode("view");
                                                        if (onAddAnnotation) await onAddAnnotation(payload);
                                                    } catch (err) { console.error("Failed to submit comment:", err); }
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </div>

                                {/* Dedicated Device Preview Mode */}
                                <DedicatedDevicePreview
                                    videoSrc={videoSrc}
                                    videoRef={videoRef}
                                    visible={viewMode === "preview"}
                                />

                                {/* Floating Toolbar - Stays in the corner of the black area */}
                                {/* <div className={cn(
                                    "absolute right-3 top-3 z-30 opacity-100 transition-opacity duration-200 md:right-4 md:top-4 md:opacity-0 md:group-hover:opacity-100",
                                    viewMode === "preview" && "hidden" // Hide in preview mode
                                )}>
                                    <VideoToolbar
                                        showTikTokPreview={showTikTokPreview}
                                        onToggleTikTokPreview={() => setShowTikTokPreview(!showTikTokPreview)}
                                        showYouTubeShortsPreview={showYouTubeShortsPreview}
                                        onToggleYouTubeShortsPreview={() => setShowYouTubeShortsPreview(!showYouTubeShortsPreview)}
                                        instagramMode={instagramMode}
                                        onInstagramModeChange={setInstagramMode}
                                        safeZoneMode={safeZoneMode}
                                        onSafeZoneChange={setSafeZoneMode}
                                    />
                                </div> */}
                            </div>

                            {/* Timeline - outside video */}
                            <div className="border-t bg-background px-3 py-2 flex-shrink-0">
                                <SeekBar
                                    current={current}
                                    duration={duration}
                                    annotations={visibleAnnotations}
                                    onSeek={seekTo}
                                />
                            </div>

                            {/* Mobile controls - outside video */}
                            <div className="flex items-center gap-2 border-t bg-background px-3 py-2 md:hidden flex-shrink-0">
                                <Button variant="ghost" size="icon" onClick={togglePlay} className="h-8 w-8 shrink-0">
                                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                </Button>
                                <div className="min-w-0 rounded bg-muted px-2 py-1 text-xs tabular-nums">
                                    {fmtHMSF(current)}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={() => setMuted((m: boolean) => !m)}
                                    aria-label={muted ? "Unmute" : "Mute"}
                                >
                                    {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs">
                                            {rate.toFixed(1)}x
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-28">
                                        <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                                            <DropdownMenuItem key={r} onClick={() => setRate(r)}>
                                                {r.toFixed(2).replace(/\.00$/, "")}x
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <div className="ml-auto flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={handleDownload}
                                    >
                                        <Download className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={enterFullscreen}
                                    >
                                        <Maximize2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Desktop controls bar - outside video */}
                            <div className="hidden md:flex flex-wrap items-center gap-x-2 gap-y-2 border-t bg-background px-3 py-2 flex-shrink-0">
                                <Button variant="ghost" size="icon" onClick={togglePlay}>
                                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                                </Button>
                                <div className="text-xs tabular-nums bg-muted rounded px-2 py-1">
                                    {fmtHMSF(current)}
                                </div>
                                <Separator orientation="vertical" className="h-5" />

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setMuted((m: boolean) => !m)}
                                    aria-label={muted ? "Unmute" : "Mute"}
                                >
                                    {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                                </Button>
                                <div className="w-20 sm:w-24">
                                    <Slider
                                        value={[muted ? 0 : Math.round(volume * 100)]}
                                        onValueChange={([v]: number[]) => {
                                            setVolume(((v ?? 0) as number) / 100);
                                            if (v && muted) setMuted(false);
                                        }}
                                    />
                                </div>

                                <Separator orientation="vertical" className="h-5" />

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-7 gap-1">
                                            {rate.toFixed(1)}x
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-28">
                                        <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                                            <DropdownMenuItem key={r} onClick={() => setRate(r)}>
                                                {r.toFixed(2).replace(/\.00$/, "")}x
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <div className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon">
                                                    <Captions className="h-5 w-5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Subtitles/CC</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon">
                                                    <Badge variant="secondary" className="text-xs">HD</Badge>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>HD</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={handleDownload}
                                                >
                                                    <Download className="h-5 w-5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Download</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={enterFullscreen}
                                                >
                                                    <Maximize2 className="h-5 w-5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Fullscreen</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                        </div>

                        {/* Right panel — shared */}
                        {panelOpen ? (
                            <div className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none">
                                    <CommentsPanel
                                        items={filteredAnnotations.map((a: Annotation) => ({
                                            id: a.id,
                                            author: a.author,
                                            authorId: a.authorId,
                                            text: a.text,
                                            emoji: a.emoji,
                                            hasDrawing: !!(a.drawing && a.drawing.length > 0),
                                            timeSec: a.time,
                                            isCompleted: a.isCompleted,
                                            isDeleted: a.isDeleted,
                                            canManageComment: a.canManageComment,
                                            canDeleteComment: a.canDeleteComment,
                                            createdAt: a.createdAt,
                                        }))}
                                        onItemClick={(id) => {
                                            const ann = filteredAnnotations.find((a: Annotation) => a.id === id);
                                            if (ann && Number.isFinite(ann.time)) seekTo(ann.time);
                                        }}

                                        // Bottom dock props
                                        showCommentDock={true}
                                        currentTime={current}
                                        includeTimestamp={includeTs}
                                        onToggleTimestamp={() => setIncludeTs(!includeTs)}
                                        formatTime={fmtHMSF}
                                        annotating={reviewMode === "draw"}
                                        onToggleAnnotating={() => setReviewMode(reviewMode === "draw" ? "view" : "draw")}
                                        reviewMode={reviewMode === "comment" || reviewMode === "draw" ? reviewMode : "view"}
                                        onReviewModeChange={(mode) => {
                                            closeInlineComposer();
                                            setViewMode("player");
                                            setReviewMode(mode);
                                        }}
                                        tool={tool}
                                        onToolChange={setTool}
                                        color={color}
                                        onColorChange={setColor}
                                        canUndo={!!draftStrokes.length || !!activeStroke}
                                        onUndo={undoStroke}
                                        onClear={clearStrokes}
                                        onCommentSubmit={async (text: string) => {
                                            try {
                                                const payload: Annotation = {
                                                    id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)),
                                                    time: includeTs ? current : 0,
                                                    text,
                                                    author: await getLoggedInUserProfile().then((user) => user?.full_name),
                                                    authorId: await getLoggedInUserProfile().then((user) => user?.sub),
                                                    createdAt: new Date().toISOString(),
                                                    emoji: {},
                                                    drawing: [...draftStrokes], // Create a copy to avoid reference issues
                                                };

                                                if (!onAddAnnotation) {
                                                    setAnnotations((prev: Annotation[]) => {
                                                        const exists = prev.some(a => a.id === payload.id);
                                                        if (exists) return prev;
                                                        return [...prev, payload];
                                                    });
                                                }

                                                // Clear UI state immediately
                                                setSearch("");
                                                setReviewMode("view");
                                                setDockComposerText("");
                                                clearStrokes();

                                                // Call external handler if provided
                                                if (onAddAnnotation) {
                                                    await onAddAnnotation(payload);
                                                }
                                            } catch (error) {
                                                console.error('Failed to submit comment:', error);
                                                // TODO: Show user-friendly error message
                                                // Could revert optimistic update here if needed
                                            }
                                        }}
                                        commentValue={dockComposerText}
                                        onCommentChange={setDockComposerText}

                                        // Comment actions
                                        onEditComment={async (id: string, newText: string) => {
                                            applyLocalAnnotationUpdate(id, { text: newText });
                                            await editOrDeleteComment("edit", { id, body: newText });
                                        }}
                                        onDeleteComment={async (id: string) => {
                                            applyLocalAnnotationUpdate(id, { isDeleted: true });
                                            await editOrDeleteComment("delete", { id });
                                        }}
                                        onToggleCompleted={canCompleteComments ? async (id: string) => {
                                            const annotation = annotations.find(a => a.id === id);
                                            const newCompleted = !annotation?.isCompleted;

                                            // Optimistic update
                                            applyLocalAnnotationUpdate(id, { isCompleted: newCompleted });

                                            // Update database
                                            const { error } = await invokeEdgeFunction("comment", {
                                                method: "PATCH",
                                                body: { id, status: newCompleted ? 'completed' : 'active', ...(commentMutationContext ?? {}) }
                                            });

                                            if (error) {
                                                console.error("Failed to toggle completion status", error);
                                                // Revert on error
                                                applyLocalAnnotationUpdate(id, { isCompleted: annotation?.isCompleted });
                                            }
                                        } : undefined}

                                        // Context for enhanced mentions
                                        projectId={projectId}
                                        organizationId={organizationId}
                                        workspaceId={workspaceId}
                                        assetId={assetId}

                                        // Asset data for Fields tab
                                        asset={asset}
                                        onAssetMetadataSave={onAssetMetadataSave}
                                        onRetagAsset={onRetagAsset}
                                        retagStatus={retagStatus}
                                        profiles={profiles}
                                    />
                            </div>
                        ) : null}
                    </div>
                </div >
            </div >
        </div >
    );
}

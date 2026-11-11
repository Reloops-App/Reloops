import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { Move, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withMediaCorsHint } from "@/lib/mediaDelivery";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { getAvatarInitials } from "@/lib/avatar-utils";
import { lazyRoute } from "@/lib/lazyRoute";
import CommentsPanel from "./CommentsPanel";
import type { Annotation, Stroke } from "./annotator-utils";
import { normalizeAnnotationList, mergeAnnotationOverrides, getAnnotationFocusPoint, getDrawingBounds, drawStrokes } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import { BubblePin } from "./shared/PinMarker";
import { CommentPopover } from "./shared/CommentPopover";
import { ReviewModeBar, type ReviewMode } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { useDraggablePin } from "./shared/useDraggablePin";
import { useMeasuredSize } from "./shared/useMeasuredSize";

const Html5BannerCodeView = lazyRoute(() => import("@/components/review/Html5BannerCodeView"));

const DRAFT_PIN_ID = "__draft-anchor__";
const DEFAULT_ANNOTATION_COLOR = "#35c8d6";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// Fallback used only for the very first paint, before ResizeObserver has
// reported a real measurement.
const DEFAULT_FRAME_SIZE = { width: 800, height: 600 };

// A cross-origin sandboxed iframe (deliberately no allow-same-origin, so the
// banner's JS can never reach the parent app's cookies/DOM) can't be probed
// live for its own intrinsic content size -- there's no postMessage
// handshake with arbitrary third-party ad creatives to ask "how big are
// you." But we do have the raw file text before it's ever put in an iframe
// (a plain cross-origin fetch of the same URL, same CORS-hint technique
// image.tsx already uses to preprocess SVGs), so `detectBannerSize` below
// reads it directly: most real HTML5 ad tooling (Google Ad Manager,
// DoubleClick Studio, Celtra, and most others) writes a standard
// `<meta name="ad.size" content="width=W,height=H">` tag specifically so
// tools can determine the intended size, and hand-built banners without
// that convention usually still fix `html`/`body` to the exact ad
// dimensions via CSS, which the fallback regex below picks up instead.
// "Auto" uses whatever's detected, falling back to filling the stage
// (correct for full pages) when nothing is found; the fixed IAB presets let
// the reviewer override by hand when detection guesses wrong.
const SIZE_PRESETS: Array<{ id: string; label: string; width: number | null; height: number | null }> = [
  { id: "auto", label: "Auto-detect size", width: null, height: null },
  { id: "mrec", label: "300 × 250 · Medium Rectangle", width: 300, height: 250 },
  { id: "leaderboard", label: "728 × 90 · Leaderboard", width: 728, height: 90 },
  { id: "mobile", label: "320 × 50 · Mobile Banner", width: 320, height: 50 },
  { id: "skyscraper", label: "160 × 600 · Wide Skyscraper", width: 160, height: 600 },
  { id: "halfpage", label: "300 × 600 · Half Page", width: 300, height: 600 },
  { id: "billboard", label: "970 × 250 · Billboard", width: 970, height: 250 },
];

function detectBannerSize(html: string): { width: number; height: number } | null {
  const metaMatch = html.match(/<meta[^>]+name=["']ad\.size["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (metaMatch) {
    const content = metaMatch[1];
    const w = content.match(/width\s*=\s*(\d+)/i);
    const h = content.match(/height\s*=\s*(\d+)/i);
    if (w && h) {
      const width = Number(w[1]);
      const height = Number(h[1]);
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // Fallback for banners that skip the ad.size meta convention but still
  // fix html/body to the real ad dimensions via CSS (very common for
  // hand-built creatives).
  const ruleMatch = html.match(/(?:html|body)(?:\s*,\s*(?:html|body))?\s*\{([^}]*)\}/i);
  if (ruleMatch) {
    const block = ruleMatch[1];
    const w = block.match(/width\s*:\s*(\d+)px/i);
    const h = block.match(/height\s*:\s*(\d+)px/i);
    if (w && h) {
      const width = Number(w[1]);
      const height = Number(h[1]);
      if (width > 0 && height > 0 && width <= 4000 && height <= 4000) return { width, height };
    }
  }

  return null;
}

// Builds a modified copy of the asset's raw HTML for use as iframe srcDoc
// instead of `src`, adding two things without needing `allow-same-origin`
// (which would let the untrusted upload read cookies/storage for whatever
// origin it's served from -- a real risk we deliberately don't take just to
// get a height number):
//   1. A <base> tag pointing back at the asset's real URL, so relative
//      asset references (images, CSS, scripts) in the document still
//      resolve correctly once it's inlined as srcdoc instead of loaded by
//      URL.
//   2. A small script that measures document.documentElement's real
//      rendered height and reports it to the parent via postMessage.
//      postMessage works across a sandboxed iframe's opaque origin with
//      nothing but `allow-scripts` -- unlike contentDocument access, it was
//      designed for exactly this cross-origin case, so it doesn't need any
//      extra sandbox permission.
// Only used in fill mode (see isFillMode below) -- a real, sized banner ad
// never needs this since it's deliberately viewed at its own fixed size.
function buildMeasuredSrcDoc(html: string, sourceUrl: string): string {
  const baseTag = /<base[\s>]/i.test(html)
    ? ""
    : `<base href="${sourceUrl.replace(/"/g, "&quot;")}">`;
  const measurementScript = `<script>(function(){function report(){var doc=document.documentElement,body=document.body;var height=Math.max(doc?doc.scrollHeight:0,body?body.scrollHeight:0,doc?doc.offsetHeight:0,body?body.offsetHeight:0);window.parent.postMessage({source:"reloops-html5-banner",type:"content-height",height:height},"*");}if(window.ResizeObserver&&document.documentElement){new ResizeObserver(report).observe(document.documentElement);}window.addEventListener("load",report);document.addEventListener("DOMContentLoaded",report);setTimeout(report,50);setTimeout(report,500);setTimeout(report,1500);})();</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html
      .replace(/<head([^>]*)>/i, (match, attrs) => `<head${attrs}>${baseTag}`)
      .replace(/<\/body>/i, `${measurementScript}</body>`);
  }
  return `${baseTag}${measurementScript}${html}`;
}

function getAnnotationAccentColor(annotation: Annotation) {
  return annotation.drawing?.find((stroke) => stroke.color)?.color ?? DEFAULT_ANNOTATION_COLOR;
}

function createAnchorStroke(point: { x: number; y: number }, strokeColor: string): Stroke {
  return { tool: "pen", color: strokeColor, points: [point] };
}

// A sibling of shared/CanvasOverlay.tsx that takes its logical width/height
// as props instead of measuring them itself via getBoundingClientRect().
// getBoundingClientRect() reflects any CSS transform applied to ancestors
// (or the element itself), so if this canvas is nested inside the zoomable
// frame below and sized from its OWN already-scaled rect, that scaled size
// gets re-applied as the canvas's logical size and then scaled AGAIN by the
// frame's transform on every render -- runaway/double scaling. The caller
// instead measures the frame via useMeasuredSize (ResizeObserver reports the
// pre-transform layout/content-box size, which CSS transforms don't affect)
// and passes that stable logical size down here, so the frame's transform
// scales the canvas exactly once, uniformly, along with the iframe.
// Pointer-position normalization is still rect-based (safe under a
// transform -- it's a ratio of click-offset to element size, so the
// transform's scale factor cancels out of both sides).
function BannerDrawCanvas({
  width,
  height,
  annotating,
  strokes,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  width: number;
  height: number;
  annotating: boolean;
  strokes: Stroke[];
  onPointerDown: (p: { x: number; y: number }) => void;
  onPointerMove: (p: { x: number; y: number }) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStrokes(ctx, strokes, width, height);
    }
  }, [strokes, width, height]);

  const norm = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX - r.left, 0), r.width) / r.width,
      y: Math.min(Math.max(clientY - r.top, 0), r.height) / r.height,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className={cn("absolute inset-0", annotating ? "pointer-events-auto touch-none" : "pointer-events-none")}
      onPointerDown={(e) => {
        if (!annotating) return;
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        onPointerDown(norm(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (!annotating) return;
        e.preventDefault();
        onPointerMove(norm(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerUp();
      }}
      onPointerLeave={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerUp();
      }}
      onPointerCancel={(e) => {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerCancel();
      }}
    />
  );
}

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
};

export type Html5BannerAnnotatorProps = {
  htmlUrl?: string;
  title?: string;
  className?: string;
  annotations?: Annotation[] | unknown[];
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
  // Which edge function edit/delete calls target — defaults to the shared
  // "comment" function used by every existing caller. A share flow with its
  // own isolated comment function can point this elsewhere without changing
  // behavior for anyone else.
  commentEndpoint?: string;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

export default function Html5BannerAnnotatorWithAnnotations({
  htmlUrl,
  title,
  className,
  annotations: annotationsProp,
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
  onCommentsPanelOpenChange,
  commentMutationContext,
  commentEndpoint = "comment",
  profiles = {},
}: Html5BannerAnnotatorProps) {
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, Number((z * 1.2).toFixed(2)))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, Number((z / 1.2).toFixed(2)))), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  const [presetId, setPresetId] = useState("auto");
  const selectedPreset = SIZE_PRESETS.find((p) => p.id === presetId) ?? SIZE_PRESETS[0];

  // Parsed from the raw file text (see detectBannerSize above), not the live
  // iframe -- re-runs whenever the URL changes.
  const [detectedSize, setDetectedSize] = useState<{ width: number; height: number } | null>(null);
  // Raw HTML text, kept only so fill-mode (see below) can build a modified
  // srcDoc copy of it (base tag + height-measurement script) without a
  // second fetch.
  const [rawHtmlText, setRawHtmlText] = useState<string | null>(null);
  useEffect(() => {
    setDetectedSize(null);
    setRawHtmlText(null);
    if (!htmlUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withMediaCorsHint(htmlUrl), { method: "GET", mode: "cors", credentials: "omit" });
        if (!res.ok || cancelled) return;
        const text = await res.text();
        if (cancelled) return;
        setDetectedSize(detectBannerSize(text));
        setRawHtmlText(text);
      } catch (error) {
        console.warn("Failed to auto-detect HTML5 banner size", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [htmlUrl]);

  const isAuto = presetId === "auto";
  const presetWidth = isAuto ? detectedSize?.width ?? null : selectedPreset.width;
  const presetHeight = isAuto ? detectedSize?.height ?? null : selectedPreset.height;
  const isFillMode = presetWidth == null || presetHeight == null;

  // Fill mode means no fixed ad size was ever detected/chosen -- almost
  // always because this .html upload isn't a banner ad at all but a
  // regular document. For that case we'd rather know its real rendered
  // height (via the postMessage bridge in buildMeasuredSrcDoc) and size the
  // frame to match exactly, so the OUTER pane (scrollContainerRef, already
  // overflow-auto) scrolls to reveal it while the iframe itself stays
  // frozen -- keeping pins anchored to actual content instead of viewport
  // position. See the scrolling attribute below for the fallback when this
  // isn't available (fetch/CORS failure, no ResizeObserver, etc).
  const measuredSrcDoc = useMemo(
    () => (isFillMode && rawHtmlText && htmlUrl ? buildMeasuredSrcDoc(rawHtmlText, htmlUrl) : null),
    [isFillMode, rawHtmlText, htmlUrl]
  );
  const [measuredContentHeight, setMeasuredContentHeight] = useState<number | null>(null);
  useEffect(() => {
    setMeasuredContentHeight(null);
  }, [measuredSrcDoc]);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string; height?: unknown } | null;
      if (!data || data.source !== "reloops-html5-banner" || data.type !== "content-height") return;
      const height = Number(data.height);
      if (!Number.isFinite(height) || height <= 0) return;
      setMeasuredContentHeight((prev) => (prev === height ? prev : height));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const contentHeightKnown = isFillMode && measuredSrcDoc != null && measuredContentHeight != null;

  // In fill mode the frame's logical size is whatever the stage actually
  // measures (ResizeObserver's contentRect, unaffected by the frame's own
  // zoom transform -- see BannerDrawCanvas above), unless we already know
  // the document's real height (contentHeightKnown), in which case that
  // takes priority so the frame matches the actual content instead of just
  // the viewport. Outside fill mode (a detected or manually-chosen size)
  // the logical size is that fixed constant.
  const [frameRef, measuredFrameSize] = useMeasuredSize<HTMLDivElement>();
  const frameLogicalWidth = isFillMode ? (measuredFrameSize?.width ?? DEFAULT_FRAME_SIZE.width) : presetWidth!;
  const frameLogicalHeight = isFillMode
    ? (contentHeightKnown ? measuredContentHeight! : (measuredFrameSize?.height ?? DEFAULT_FRAME_SIZE.height))
    : presetHeight!;
  // Real, on-screen pixel size of the frame at the current zoom -- used for
  // drag-delta math (useDraggablePin), which needs actual screen pixels.
  const frameWidthPx = frameLogicalWidth * zoom;
  const frameHeightPx = frameLogicalHeight * zoom;

  // The pane the frame scrolls inside of (className="overflow-auto" below).
  // Used by scrollToNormalizedPoint to reveal a comment's pin when it's
  // selected from the sidebar list.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollToNormalizedPoint = useCallback((point: { x: number; y: number }, behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollContainerRef.current;
    const frame = frameRef.current;
    if (!viewport || !frame) return;
    // getBoundingClientRect() already reflects the frame's actual on-screen
    // box -- post zoom-transform, post-centering, post-current-scroll -- so
    // this works regardless of the CSS transform/centering math above,
    // unlike a purely arithmetic (untransformed) position calculation.
    const frameRect = frame.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const targetX = frameRect.left - viewportRect.left + viewport.scrollLeft + point.x * frameRect.width;
    const targetY = frameRect.top - viewportRect.top + viewport.scrollTop + point.y * frameRect.height;
    viewport.scrollTo({
      left: Math.max(0, targetX - viewport.clientWidth * 0.5),
      top: Math.max(0, targetY - viewport.clientHeight * 0.35),
      behavior,
    });
  }, [frameRef]);

  const panelOpen = commentsPanelOpen ?? true;
  const canCompleteComments = !commentMutationContext?.share_token;

  const {
    setAnnotating,
    tool,
    setTool,
    color,
    setColor,
    draftStrokes,
    activeStroke,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    undoStroke,
    clearStrokes,
    addStroke,
  } = useDrawing();

  const [reviewMode, setReviewMode] = useState<ReviewMode>("view");
  useEffect(() => {
    setAnnotating(reviewMode === "draw");
  }, [reviewMode, setAnnotating]);

  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  useEffect(() => {
    setViewMode("preview");
  }, [htmlUrl]);

  // No coordinate system for pins/drawing over raw source text, same reason
  // image.tsx forces interactionMode back to view when entering 360 mode.
  useEffect(() => {
    if (viewMode === "code") setReviewMode("view");
  }, [viewMode]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && viewMode === "code") {
        setViewMode("preview");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode]);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  const [dockComposerText, setDockComposerText] = useState("");

  const closeInlineComposer = useCallback((clearDraft = false) => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    if (clearDraft) clearStrokes();
  }, [clearStrokes]);

  // Holds only the fields the user has locally changed (delete/complete/
  // edit), keyed by annotation id, and is re-applied on every sync below --
  // see mergeAnnotationOverrides for why: without it, deleting a comment and
  // then adding another one (or any other change that refreshes
  // annotationsProp) before the delete's own server round-trip/realtime
  // echo lands would silently resurrect it, since the next prop sync still
  // carries the pre-delete shape.
  const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    if (!annotationsProp) return;
    setAnnotations(mergeAnnotationOverrides(normalizeAnnotationList(annotationsProp), annotationOverrides));
  }, [annotationsProp, annotationOverrides]);

  const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotationOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const visibleAnnotations = useMemo(() => annotations.filter((a) => !a.isDeleted), [annotations]);

  const { resolveFocus, beginDrag, updateDrag, endDrag, draggingId } = useDraggablePin();

  const annotationTargets = useMemo(() => {
    return visibleAnnotations
      .map((annotation, index) => ({
        annotation,
        accentColor: getAnnotationAccentColor(annotation),
        index,
        focus: getAnnotationFocusPoint(annotation),
      }))
      .filter((entry) => entry.focus);
  }, [visibleAnnotations]);

  const selectedAnnotationTarget = useMemo(
    () => annotationTargets.find((entry) => entry.annotation.id === selectedAnnotationId) ?? null,
    [annotationTargets, selectedAnnotationId]
  );

  // All persisted annotation drawings render together at all times (a shared
  // whiteboard, same as image.tsx) -- selecting a pin only opens its
  // popover, it doesn't change what's drawn.
  const committedStrokes = useMemo<Stroke[]>(
    () => visibleAnnotations.flatMap((a) => a.drawing ?? []),
    [visibleAnnotations]
  );
  const liveStrokes = useMemo<Stroke[]>(
    () => [...draftStrokes, ...(activeStroke ? [activeStroke] : [])],
    [draftStrokes, activeStroke]
  );

  const draftAnchorBounds = useMemo(() => getDrawingBounds(draftStrokes), [draftStrokes]);
  const draftAnchorFocus = useMemo(
    () => draftAnchorBounds
      ? { x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2, y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2 }
      : null,
    [draftAnchorBounds]
  );

  const selectedAnnotationFocus = useMemo(() => {
    if (!selectedAnnotationTarget?.focus) return null;
    return resolveFocus(selectedAnnotationTarget.annotation.id, selectedAnnotationTarget.focus);
  }, [selectedAnnotationTarget, resolveFocus]);
  const resolvedDraftAnchorFocus = useMemo(
    () => (draftAnchorFocus ? resolveFocus(DRAFT_PIN_ID, draftAnchorFocus) : null),
    [draftAnchorFocus, resolveFocus]
  );

  // Edit/delete target the "comment" function by default (unchanged for
  // every existing caller). A share flow with its own isolated comment
  // function passes commentEndpoint to route here instead — that function
  // takes an action-based POST body rather than comment's PATCH-with-status.
  const editOrDeleteComment = useCallback(async (action: "edit" | "delete", fields: { id: string; body?: string }) => {
    if (commentEndpoint === "comment") {
      const body: Record<string, unknown> = { id: fields.id, ...(commentMutationContext ?? {}) };
      if (action === "edit") body.body = fields.body;
      else body.status = "deleted";
      const { error } = await invokeEdgeFunction("comment", { method: "PATCH", body });
      if (error) throw error;
      return;
    }
    const { error } = await invokeEdgeFunction(commentEndpoint, {
      method: "POST",
      body: { action, id: fields.id, body: fields.body, ...(commentMutationContext ?? {}) },
    });
    if (error) throw error;
  }, [commentEndpoint, commentMutationContext]);

  const handleStageClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) / rect.width,
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) / rect.height,
    };
    addStroke(createAnchorStroke(point, color), true);
    setInlineComposerText(dockComposerText);
    setInlineComposerOpen(true);
  }, [addStroke, color, dockComposerText]);

  const panelAsset = asset ? {
    ...asset,
    title: asset.title || title || "Asset",
    created_at: asset.created_at || new Date(0).toISOString(),
    storage_path: asset.storage_path || "",
  } : null;

  const commentItems = useMemo(
    () => visibleAnnotations.map((annotation) => ({
      id: annotation.id,
      author: annotation.author,
      authorId: annotation.authorId,
      text: annotation.text,
      emoji: annotation.emoji,
      hasDrawing: Boolean(annotation.drawing && annotation.drawing.length > 0),
      isCompleted: annotation.isCompleted,
      isDeleted: annotation.isDeleted,
      canManageComment: annotation.canManageComment,
      canDeleteComment: annotation.canDeleteComment,
      createdAt: annotation.createdAt,
    })),
    [visibleAnnotations]
  );

  async function submitAnnotation(drawing: Stroke[], text: string) {
    const user = await getLoggedInUserProfile().catch(() => null);
    const payload: Annotation = {
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      time: Number.NaN,
      text,
      author: user?.full_name,
      authorId: user?.sub,
      isCompleted: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      emoji: {},
      drawing,
    };
    if (!onAddAnnotation) {
      setAnnotations((prev) => (prev.some((a) => a.id === payload.id) ? prev : [...prev, payload]));
    }
    if (onAddAnnotation) await onAddAnnotation(payload);
  }

  // Pins/popover/composer are positioned as percentage anchors within the
  // (possibly zoomed) frame, with an inverse `scale(1/zoom)` on each one so
  // they stay a constant, readable on-screen size regardless of zoom level
  // -- only their ANCHOR point tracks the zoomed content, not their own
  // rendered size. Simpler than computing stage-relative pixel offsets by
  // hand (image.tsx's approach), at the cost of not clamping them to stay
  // fully inside the stage bounds near the frame's edges.
  const pinStyle = (focus: { x: number; y: number }): React.CSSProperties => ({
    position: "absolute",
    left: `${focus.x * 100}%`,
    top: `${focus.y * 100}%`,
    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
  });
  const overlayStyle = (focus: { x: number; y: number }): React.CSSProperties => ({
    position: "absolute",
    left: `${focus.x * 100}%`,
    top: `${focus.y * 100}%`,
    transform: `translate(12px, -12px) scale(${1 / zoom})`,
    transformOrigin: "top left",
  });

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col overflow-hidden lg:flex-row", className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <ReviewModeBar
          mode={reviewMode}
          onModeChange={(mode) => {
            closeInlineComposer(true);
            setReviewMode(mode);
            if (mode === "view" && viewMode === "code") {
              setViewMode("preview");
            }
          }}
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
          hidePreview
          disableAnnotationTabs={viewMode === "code"}
          showCode
          codeActive={viewMode === "code"}
          onCodeClick={() => setViewMode(viewMode === "preview" ? "code" : "preview")}
        />

        <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-auto bg-black">
          {viewMode === "preview" && (
          <div
            className={cn(
              "flex h-full justify-center",
              // `items-center` is fine while the frame fits inside this
              // pane (every banner, and fill mode before/without a real
              // content-height measurement -- see frameLogicalHeight
              // above, where it falls back to the pane's own measured
              // size, i.e. no overflow). Once the frame is sized to the
              // document's real (taller) height, centering it would push
              // its top edge above this flex box's own start edge --
              // overflow that extends *before* a scroll container's start
              // edge can never be scrolled into view in any browser, so
              // the top of the document (and any pins placed there) would
              // simply be unreachable, and the page would visually look
              // like it loaded already scrolled down. `items-start` keeps
              // the document's actual top pinned to the pane's start edge,
              // so scrolling behaves like a normal page.
              contentHeightKnown ? "items-start" : "items-center",
              isFillMode ? "p-0" : "p-10"
            )}
          >
            <div
              ref={frameRef}
              className={cn(
                "relative shadow-2xl",
                isFillMode ? (contentHeightKnown ? "w-full" : "h-full w-full") : "shrink-0",
                reviewMode === "comment" && "cursor-copy",
                reviewMode === "draw" && "cursor-crosshair"
              )}
              style={{
                ...(isFillMode
                  ? (contentHeightKnown ? { height: frameLogicalHeight } : {})
                  : { width: frameLogicalWidth, height: frameLogicalHeight }),
                transform: `scale(${zoom})`,
              }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-sm">
                <iframe
                  {...(measuredSrcDoc ? { srcDoc: measuredSrcDoc } : { src: htmlUrl })}
                  title={title || "HTML5 banner"}
                  className="absolute inset-0 h-full w-full border-0 bg-white"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  // Freezes the banner's own internal viewport so it can
                  // never scroll independently of the frame it's placed in.
                  // Without this, a pin dropped while the banner's content
                  // happened to be scrolled stays anchored to that
                  // now-invisible scroll offset -- the content visibly
                  // shifts under the (unmoving) pin the next time the
                  // banner is scrolled again. We deliberately have no way
                  // to track or compensate for that offset live for a
                  // plain `src` iframe (see the module comment above on why
                  // a sandboxed cross-origin iframe never gets a
                  // postMessage handshake with arbitrary untrusted content
                  // by default), so for a real banner ad -- a creative with
                  // a small, detected/selected size that's meant to be
                  // viewed in full at once -- removing the *ability* to
                  // scroll internally at all is what actually fixes it.
                  //
                  // Fill mode is different: no ad size was ever detected,
                  // which almost always means this .html upload isn't a
                  // banner at all but a regular document (long-form page,
                  // article, etc). There buildMeasuredSrcDoc has already
                  // injected a measurement script that reports the
                  // document's real height back to us over postMessage --
                  // once contentHeightKnown, the frame above is sized to
                  // match that real height exactly, so the OUTER pane
                  // (scrollContainerRef, overflow-auto) does the scrolling
                  // instead. The iframe itself stays frozen either way, so
                  // pins stay anchored to actual content, not a scroll
                  // offset. Gated on contentHeightKnown, not just on having
                  // built measuredSrcDoc: until the postMessage actually
                  // arrives, the frame above is still sized to the
                  // viewport (not the real content), so disabling iframe
                  // scroll at that point would strand the page with no
                  // scroll path at all -- outer pane too small, inner
                  // scroll off. If the measurement never arrives for any
                  // reason (CORS failure, the doc's own CSP blocking our
                  // injected inline script, no </body> to inject before,
                  // etc), we fall back to letting the iframe scroll
                  // internally, trading pin accuracy for the page being
                  // reachable at all.
                  scrolling={isFillMode && !contentHeightKnown ? "yes" : "no"}
                />

                {reviewMode === "comment" ? (
                  <div className="absolute inset-0 z-10" onClick={handleStageClick} />
                ) : null}

                <BannerDrawCanvas
                  width={frameLogicalWidth}
                  height={frameLogicalHeight}
                  annotating={reviewMode === "draw"}
                  strokes={[...committedStrokes, ...liveStrokes]}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={() => {
                    const hadActiveStroke = Boolean(activeStroke);
                    pointerUp();
                    if (!hadActiveStroke) return;
                    setInlineComposerText(dockComposerText);
                    setInlineComposerOpen(true);
                  }}
                  onPointerCancel={pointerCancel}
                />
              </div>

              {annotationTargets.map((entry) => {
                if (!entry.focus) return null;
                const focus = resolveFocus(entry.annotation.id, entry.focus);
                const isSelected = entry.annotation.id === selectedAnnotationId;
                const isHovered = entry.annotation.id === hoveredAnnotationId;
                const isDragging = draggingId === entry.annotation.id;
                return (
                  <div key={entry.annotation.id} style={pinStyle(focus)} className={(isSelected || isHovered) ? "z-30" : "z-20"}>
                    <button
                      type="button"
                      data-review-ui="true"
                      title="Drag to move this pin"
                      className={cn(
                        "group touch-none transition-transform",
                        isDragging ? "cursor-grabbing" : "cursor-grab hover:-translate-y-0.5"
                      )}
                      onPointerDown={(e) => beginDrag(entry.annotation.id, entry.focus!, e)}
                      onPointerMove={(e) => updateDrag(e, frameWidthPx, frameHeightPx)}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        const wasDrag = endDrag(e);
                        if (!wasDrag) setSelectedAnnotationId(entry.annotation.id);
                      }}
                      onMouseEnter={() => setHoveredAnnotationId(entry.annotation.id)}
                      onMouseLeave={() => setHoveredAnnotationId((current) => (current === entry.annotation.id ? null : current))}
                    >
                      <BubblePin
                        initials={getAvatarInitials(entry.annotation.author || "?")}
                        userId={entry.annotation.authorId}
                        userName={entry.annotation.author}
                      />
                      <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/40 bg-slate-900/90 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                        <Move className="h-2.5 w-2.5" />
                      </span>
                    </button>
                  </div>
                );
              })}

              {reviewMode === "comment" && resolvedDraftAnchorFocus ? (
                <div style={pinStyle(resolvedDraftAnchorFocus)} className="z-20">
                  <button
                    type="button"
                    data-review-ui="true"
                    title="Drag to move this pin"
                    className={cn(
                      "group flex h-8 w-8 touch-none items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[11px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20 transition-transform",
                      draggingId === DRAFT_PIN_ID ? "cursor-grabbing" : "cursor-grab"
                    )}
                    onPointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                    onPointerMove={(e) => updateDrag(e, frameWidthPx, frameHeightPx)}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      endDrag(e);
                    }}
                  >
                    +
                    <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/40 bg-slate-900/90 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      <Move className="h-2.5 w-2.5" />
                    </span>
                  </button>
                </div>
              ) : null}

              {selectedAnnotationTarget && selectedAnnotationFocus ? (
                <div style={overlayStyle(selectedAnnotationFocus)} className="z-40" data-review-ui="true">
                  <CommentPopover
                    author={selectedAnnotationTarget.annotation.author || "Unknown"}
                    authorId={selectedAnnotationTarget.annotation.authorId}
                    text={selectedAnnotationTarget.annotation.text || ""}
                    createdAt={selectedAnnotationTarget.annotation.createdAt}
                    isCompleted={selectedAnnotationTarget.annotation.isCompleted}
                    onClose={() => setSelectedAnnotationId(null)}
                    onDelete={!commentMutationContext?.share_token || selectedAnnotationTarget.annotation.canManageComment ? async () => {
                      applyLocalAnnotationUpdate(selectedAnnotationTarget.annotation.id, { isDeleted: true });
                      await editOrDeleteComment("delete", { id: selectedAnnotationTarget.annotation.id });
                      setSelectedAnnotationId(null);
                    } : undefined}
                    onComplete={canCompleteComments ? async () => {
                      const newCompleted = !selectedAnnotationTarget.annotation.isCompleted;
                      applyLocalAnnotationUpdate(selectedAnnotationTarget.annotation.id, { isCompleted: newCompleted });
                      await invokeEdgeFunction("comment", { method: "PATCH", body: { id: selectedAnnotationTarget.annotation.id, status: newCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) } });
                    } : undefined}
                    isDragging={draggingId === selectedAnnotationTarget.annotation.id}
                    onDragHandlePointerDown={(e) => selectedAnnotationTarget.focus && beginDrag(selectedAnnotationTarget.annotation.id, selectedAnnotationTarget.focus, e)}
                    onDragHandlePointerMove={(e) => updateDrag(e, frameWidthPx, frameHeightPx)}
                    onDragHandlePointerUp={(e) => endDrag(e)}
                  />
                </div>
              ) : null}

              {inlineComposerOpen && resolvedDraftAnchorFocus ? (
                <div style={overlayStyle(resolvedDraftAnchorFocus)} className="z-30 w-[280px]" data-review-ui="true">
                  <InlineNoteComposer
                    value={inlineComposerText}
                    onChange={(value) => {
                      setInlineComposerText(value);
                      setDockComposerText(value);
                    }}
                    isDragging={draggingId === DRAFT_PIN_ID}
                    onDragHandlePointerDown={(e) => resolvedDraftAnchorFocus && beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                    onDragHandlePointerMove={(e) => updateDrag(e, frameWidthPx, frameHeightPx)}
                    onDragHandlePointerUp={(e) => endDrag(e)}
                    color={color}
                    label={reviewMode === "comment" ? "Add note here" : "Describe your annotation"}
                    hint={reviewMode === "comment" ? "Pin stays attached" : "Ctrl+Enter to submit"}
                    projectId={projectId}
                    organizationId={organizationId}
                    workspaceId={workspaceId}
                    assetId={assetId}
                    onCancel={() => closeInlineComposer(true)}
                    onSubmit={async () => {
                      const text = inlineComposerText.trim();
                      if (!text) return;
                      try {
                        closeInlineComposer(true);
                        setDockComposerText("");
                        setReviewMode("view");
                        await submitAnnotation([...liveStrokes], text);
                      } catch (err) {
                        console.error("Failed to submit comment:", err);
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          )}

          {viewMode === "code" && (
            <Suspense fallback={null}>
              <Html5BannerCodeView
                htmlUrl={htmlUrl}
                title={title}
                className="absolute inset-0"
                onExit={() => setViewMode("preview")}
              />
            </Suspense>
          )}

          {viewMode === "preview" && (
          <div className="absolute bottom-3 left-3 z-40 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 backdrop-blur-sm">
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger className="h-8 w-[190px] border-white/15 bg-white/5 text-xs text-white hover:bg-white/10 focus:ring-0" data-review-ui="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="text-xs">
                    {preset.id === "auto"
                      ? detectedSize
                        ? `Auto-detected · ${detectedSize.width} × ${detectedSize.height}`
                        : "Auto-detect size"
                      : preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-16 text-center text-[11px] tabular-nums text-white/60">
              {Math.round(frameLogicalWidth)}×{Math.round(frameLogicalHeight)}
            </div>
            <div className="h-4 w-px bg-white/20" />
            <Button variant="ghost" size="sm" onClick={zoomOut} title="Zoom out" aria-label="Zoom out" className="h-8 w-8 p-0 text-white hover:bg-white/10">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <div className="w-12 text-center text-xs font-medium tabular-nums text-white">{Math.round(zoom * 100)}%</div>
            <Button variant="ghost" size="sm" onClick={zoomIn} title="Zoom in" aria-label="Zoom in" className="h-8 w-8 p-0 text-white hover:bg-white/10">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="h-4 w-px bg-white/20" />
            <Button variant="ghost" size="sm" onClick={resetZoom} title="Reset zoom" aria-label="Reset zoom" className="h-8 w-8 p-0 text-white hover:bg-white/10">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          )}
        </div>
      </div>

      {panelOpen ? (
        <div className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none">
          <CommentsPanel
            items={commentItems}
            onItemClick={(id) => {
              setSelectedAnnotationId(id);
              const target = annotationTargets.find((entry) => entry.annotation.id === id);
              if (target?.focus) scrollToNormalizedPoint(target.focus);
            }}
            showCommentDock
            includeTimestamp={false}
            annotating={reviewMode === "draw"}
            onToggleAnnotating={() => setReviewMode(reviewMode === "draw" ? "view" : "draw")}
            reviewMode={reviewMode === "draw" ? "draw" : reviewMode === "comment" ? "comment" : "view"}
            onReviewModeChange={(mode) => {
              closeInlineComposer(true);
              setReviewMode(mode);
            }}
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            canUndo={Boolean(draftStrokes.length || activeStroke)}
            onUndo={undoStroke}
            onClear={clearStrokes}
            onCommentSubmit={async (text: string) => {
              try {
                await submitAnnotation([...liveStrokes], text);
                setReviewMode("view");
                setDockComposerText("");
                clearStrokes();
              } catch (err) {
                console.error("Failed to submit comment:", err);
              }
            }}
            commentValue={dockComposerText}
            onCommentChange={setDockComposerText}
            onEditComment={async (id: string, newText: string) => {
              applyLocalAnnotationUpdate(id, { text: newText });
              await editOrDeleteComment("edit", { id, body: newText });
            }}
            onDeleteComment={async (id: string) => {
              applyLocalAnnotationUpdate(id, { isDeleted: true });
              await editOrDeleteComment("delete", { id });
            }}
            onToggleCompleted={canCompleteComments ? async (id: string) => {
              const target = annotations.find((a) => a.id === id);
              const nextCompleted = !target?.isCompleted;
              applyLocalAnnotationUpdate(id, { isCompleted: nextCompleted });
              await invokeEdgeFunction("comment", { method: "PATCH", body: { id, status: nextCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) } });
            } : undefined}
            projectId={projectId}
            organizationId={organizationId}
            workspaceId={workspaceId}
            assetId={assetId}
            asset={panelAsset}
            onAssetMetadataSave={onAssetMetadataSave}
            onRetagAsset={onRetagAsset}
            retagStatus={retagStatus}
            profiles={profiles}
            onCollapse={onCommentsPanelOpenChange ? () => onCommentsPanelOpenChange(false) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

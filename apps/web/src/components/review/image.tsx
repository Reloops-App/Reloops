import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, downloadFile } from "@/lib/utils";
import { getRawPreviewInfo } from "@/lib/designFiles";
import { resolveAssetDownloadUrl, withMediaCorsHint, withMediaTransform, isRealImageAsset, REVIEW_PREVIEW_TRANSFORM } from "@/lib/mediaDelivery";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ZoomIn, ZoomOut, Maximize2, Download, Move, Orbit } from "lucide-react";

import type { Annotation, Stroke } from "./annotator-utils";
import { drawStrokes, normalizeAnnotationList, mergeAnnotationOverrides, getAnnotationFocusPoint, getDrawingBounds } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import CommentsPanel from "./CommentsPanel";
import { Switch } from "../ui/switch";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { getAvatarInitials } from "@/lib/avatar-utils";
import { BubblePin } from "./shared/PinMarker";
import { CommentPopover } from "./shared/CommentPopover";
import { ReviewModeBar, type ReviewMode } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { previewBackgroundClassAlwaysDark, type PreviewBackground } from "@/lib/imagePreviewBackground";
import { useDraggablePin } from "./shared/useDraggablePin";
import { useMeasuredSize } from "./shared/useMeasuredSize";
import { clampOverlayPosition } from "./shared/overlayPosition";
import { lazyRoute } from "@/lib/lazyRoute";

// Loaded lazily so the ~150-300KB three.js/Photo Sphere Viewer bundle is only
// fetched once someone actually views a panoramic asset in 360 mode, not on
// every image view.
const Panorama360Viewer = lazyRoute(() => import("@/components/review/Panorama360Viewer"));

const DRAFT_PIN_ID = "__draft-anchor__";
const DEFAULT_ANNOTATION_COLOR = "#35c8d6";
const ANNOTATION_STROKE_WIDTH = 6;
const ANNOTATION_ARROW_HEAD_SIZE = 9;
const MIN_ANNOTATION_VISUAL_SCALE = 0.05;

function getAnnotationAccentColor(annotation: Annotation) {
  return annotation.drawing?.find((stroke) => stroke.color)?.color ?? DEFAULT_ANNOTATION_COLOR;
}

function createAnchorStroke(point: { x: number; y: number }, strokeColor: string): Stroke {
  return { tool: "pen", color: strokeColor, points: [point] };
}

export function isReviewUiTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[contenteditable='true']",
        "[role='button']",
        "[role='menuitem']",
        "[data-review-ui='true']",
      ].join(",")
    )
  );
}

/* ----------------------------- Inline CanvasOverlay ----------------------------- */

type OverlayProps = {
  targetRef: React.RefObject<HTMLElement>; // natural-size overlay (transformed with image)
  annotating: boolean;
  strokes: Stroke[];                       // LIVE strokes only (draft + active)
  visualScale: number;
  naturalWidth?: number;
  naturalHeight?: number;
  onPointerDown: (e: { x: number; y: number; original: PointerEvent }) => void;
  onPointerMove: (e: { x: number; y: number; original: PointerEvent }) => void;
  onPointerUp: (e: { x: number; y: number; original: PointerEvent }) => void;
  onPointerCancel: (e: { original: PointerEvent }) => void;
};

// Map screen pointer → NATURAL image pixels using overlay's rect (already transformed)
function eventToImagePx(e: PointerEvent, overlay: HTMLElement, naturalW?: number, naturalH?: number) {
  const rect = overlay.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;   // 0..1
  const ny = (e.clientY - rect.top) / rect.height;
  const w = naturalW ?? rect.width;
  const h = naturalH ?? rect.height;
  return {
    x: Math.max(0, Math.min(w, nx * w)),
    y: Math.max(0, Math.min(h, ny * h)),
  };
}

function CanvasOverlay({
  targetRef,
  annotating,
  strokes,
  visualScale,
  naturalWidth,
  naturalHeight,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: OverlayProps) {
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Size live canvas in NATURAL pixels; CSS transform will scale it with image
  const resizeLiveCanvas = useCallback(() => {
    const canvas = liveCanvasRef.current;
    const overlay = targetRef.current as HTMLElement | null;
    if (!canvas || !overlay) return;
    const w = (naturalWidth ?? overlay.offsetWidth) || 1;
    const h = (naturalHeight ?? overlay.offsetHeight) || 1;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [targetRef, naturalWidth, naturalHeight]);

  useEffect(() => {
    resizeLiveCanvas();
    const overlay = targetRef.current as HTMLElement | null;
    if (!overlay) return;
    const ro = new ResizeObserver(resizeLiveCanvas);
    ro.observe(overlay);
    return () => ro.disconnect();
  }, [resizeLiveCanvas, targetRef]);

  // Minimal live renderer for strokes
  const redrawLive = useCallback(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const inverseScale = 1 / Math.max(visualScale, MIN_ANNOTATION_VISUAL_SCALE);
    ctx.lineWidth = ANNOTATION_STROKE_WIDTH * inverseScale;
    const arrowHeadSize = ANNOTATION_ARROW_HEAD_SIZE * inverseScale;

    const w = (naturalWidth ?? parseFloat(canvas.style.width)) || canvas.width;
    const h = (naturalHeight ?? parseFloat(canvas.style.height)) || canvas.height;
    const toXY = (p: { x: number; y: number }) => {
      const normalized = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      return normalized ? { x: p.x * w, y: p.y * h } : p;
    };
    const head = (x0: number, y0: number, x1: number, y1: number) => {
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const size = arrowHeadSize;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - size * Math.cos(angle - Math.PI / 6), y1 - size * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - size * Math.cos(angle + Math.PI / 6), y1 - size * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    };

    for (const s of strokes) {
      ctx.strokeStyle = s.color || "#ff7a00";
      if (s.tool === "pen") {
        ctx.beginPath();
        s.points.forEach((p, i) => {
          const { x, y } = toXY(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      } else if (s.tool === "line" || s.tool === "arrow") {
        if (s.points.length < 2) continue;
        const a = toXY(s.points[0]);
        const b = toXY(s.points[s.points.length - 1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (s.tool === "arrow") head(a.x, a.y, b.x, b.y);
      } else if (s.tool === "rect") {
        if (s.points.length < 2) continue;
        const a = toXY(s.points[0]);
        const b = toXY(s.points[s.points.length - 1]);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.stroke();
      }
    }
  }, [strokes, visualScale, naturalWidth, naturalHeight]);

  useEffect(() => {
    redrawLive();
  }, [redrawLive, strokes]);

  // Pointer handling (pointer capture; emit NATURAL px)
  useEffect(() => {
    const overlay = targetRef.current as HTMLElement | null;
    if (!overlay) return;

    const down = (ev: PointerEvent) => {
      if (!annotating) return;
      overlay.setPointerCapture(ev.pointerId);
      const { x, y } = eventToImagePx(ev, overlay, naturalWidth, naturalHeight);
      onPointerDown({ x, y, original: ev });
    };
    const move = (ev: PointerEvent) => {
      if (!annotating) return;
      const { x, y } = eventToImagePx(ev, overlay, naturalWidth, naturalHeight);
      onPointerMove({ x, y, original: ev });
    };
    const up = (ev: PointerEvent) => {
      if (!annotating) return;
      const { x, y } = eventToImagePx(ev, overlay, naturalWidth, naturalHeight);
      onPointerUp({ x, y, original: ev });
      try { overlay.releasePointerCapture(ev.pointerId); } catch { return; }
    };
    const cancel = (ev: PointerEvent) => {
      onPointerCancel({ original: ev });
      try { overlay.releasePointerCapture(ev.pointerId); } catch { return; }
    };

    overlay.addEventListener("pointerdown", down);
    overlay.addEventListener("pointermove", move);
    overlay.addEventListener("pointerup", up);
    overlay.addEventListener("pointercancel", cancel);
    overlay.style.touchAction = "none"; // stop native gestures

    return () => {
      overlay.removeEventListener("pointerdown", down);
      overlay.removeEventListener("pointermove", move);
      overlay.removeEventListener("pointerup", up);
      overlay.removeEventListener("pointercancel", cancel);
    };
  }, [targetRef, annotating, naturalWidth, naturalHeight, onPointerDown, onPointerMove, onPointerUp, onPointerCancel]);

  return (
    <div
      className="absolute top-0 left-0"
      style={{
        width: naturalWidth ? `${naturalWidth}px` : undefined,
        height: naturalHeight ? `${naturalHeight}px` : undefined,
        pointerEvents: "none", // 🔴 let events fall through to overlayRef

      }}
    >
      <canvas ref={liveCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
    </div>
  );
}

/* --------------------------- Main Annotator Component --------------------------- */

export type ImageAnnotatorProps = {
  imageUrl?: string;
  title?: string;
  className?: string;
  hideHeader?: boolean;
  annotations?: Annotation[] | unknown[];
  onAddAnnotation?: (a: Annotation) => void | Promise<void>;
  stageHeight?: number; // fixed viewport height (px)

  // Context for enhanced mentions
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;

  // Asset data for Fields tab
  asset?: {
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
    cover_image_url?: string | null;
  } | null;
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
  onMediaError?: () => void;
  fallbackDownloadUrl?: string | null;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

export default function ImageAnnotatorWithAnnotations({
  imageUrl,
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
  commentMutationContext,
  commentEndpoint = "comment",
  onMediaError,
  fallbackDownloadUrl,
  profiles = {},
}: ImageAnnotatorProps) {
  // Any image asset can be switched into 360° view -- no detection/heuristic,
  // the user decides for themselves whether an image is actually a panorama.
  const canShow360 = Boolean(asset?.mime_type?.startsWith("image/"));
  // Always start on the flat viewer; 360° is opt-in via the toolbar button.
  const [viewMode, setViewMode] = useState<"flat" | "360">("flat");

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null); // natural-size hit area
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [resolvedImageUrl, setResolvedImageUrl] = useState(imageUrl);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number } | null>(null);
  // The full original can be tens of megapixels / 25MB+ (see the pan/zoom
  // comment below), so show the asset's existing small thumbnail immediately
  // and swap to the full-res original once it finishes loading, instead of
  // leaving the stage blank while the original downloads.
  const [fullImageReady, setFullImageReady] = useState(false);

  useEffect(() => {
    const initialUrl = imageUrl && isRealImageAsset(asset)
      ? withMediaTransform(imageUrl, REVIEW_PREVIEW_TRANSFORM, asset?.mime_type ?? null)
      : imageUrl;
    setResolvedImageUrl(initialUrl);
    setImageNaturalSize(null);
    setFullImageReady(false);
    if (!imageUrl) return;

    const mimeType = asset?.mime_type ?? null;
    const normalizedUrl = imageUrl.toLowerCase();
    const isSvgAsset = mimeType === "image/svg+xml" || /\.svg($|\?)/i.test(normalizedUrl);
    if (!isSvgAsset) return;

    let active = true;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await fetch(withMediaCorsHint(imageUrl), {
          method: "GET",
          mode: "cors",
          credentials: "omit",
        });
        if (!response.ok) throw new Error(`Failed to fetch SVG: HTTP ${response.status}`);

        const svgMarkup = await response.text();
        if (!svgMarkup.trim()) throw new Error("Empty SVG payload");

        objectUrl = window.URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml" }));
        if (active) setResolvedImageUrl(objectUrl);
      } catch (error) {
        console.error("Failed to prepare SVG for image reviewer", error);
        onMediaError?.();
        if (active) setResolvedImageUrl(imageUrl);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.mime_type, imageUrl, onMediaError]);

  // Drawing
  const {
    annotating,
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

  // Zoom / Pan / BG
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(scale);
  const centerAtScaleRef = useRef<(nextScale: number) => void>(() => {});
  const previousPanelOpenRef = useRef<boolean | null>(null);
  const [minScale, setMinScale] = useState(0.05);
  const [maxScale] = useState(16);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [showAnnotations, setShowAnnotations] = useState(true);
  const zoomPct = Math.round(scale * 100);

  const annotationCanvasOptions = useMemo(() => {
    const inverseScale = 1 / Math.max(scale, MIN_ANNOTATION_VISUAL_SCALE);
    return {
      lineWidth: ANNOTATION_STROKE_WIDTH * inverseScale,
      arrowHeadSize: ANNOTATION_ARROW_HEAD_SIZE * inverseScale,
    };
  }, [scale]);

  const [interactionMode, setInteractionMode] = useState<ReviewMode>("view");
  const isViewMode = interactionMode === "view";
  const isCommentMode = interactionMode === "comment";
  const isDrawMode = interactionMode === "draw";

  // Sync useDrawing annotating state with interactionMode
  useEffect(() => {
    setAnnotating(isDrawMode);
  }, [isDrawMode, setAnnotating]);

  // Reset to flat when navigating to a different asset -- otherwise 360° mode
  // on one asset would carry over onto the next one opened.
  useEffect(() => {
    setViewMode("flat");
  }, [asset?.id]);

  // 360° mode has no coordinate system for pins/drawing on a sphere (see
  // ReviewModeBar's restrictToView), so force interactionMode back to "view"
  // whenever the user switches into it -- covers the case where they were
  // mid-comment/draw on the flat view and then flip to 360.
  useEffect(() => {
    if (viewMode === "360") setInteractionMode("view");
  }, [viewMode]);

  // Bonus quick-exit alongside the toolbar button, in case the panorama
  // viewer is stuck loading/erroring and covering the toolbar's attention.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewMode === "360") setViewMode("flat");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode]);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  // Inline composer for comment mode
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  const [dockComposerText, setDockComposerText] = useState("");
  const inlineComposerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (inlineComposerOpen) inlineComposerRef.current?.focus();
  }, [inlineComposerOpen]);

  const closeInlineComposer = useCallback((clearDraft = false) => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    if (clearDraft) clearStrokes();
  }, [clearStrokes]);

  const handleShowAnnotationsChange = useCallback((next: boolean) => {
    setShowAnnotations(next);
    if (!next) {
      setSelectedAnnotationId(null);
      setHoveredAnnotationId(null);
      closeInlineComposer(true);
      setInteractionMode("view");
    }
  }, [closeInlineComposer]);

  // Annotations (committed)
  // Holds only the fields the user has locally changed (delete/complete/
  // edit), keyed by annotation id, re-applied on every sync below -- see
  // mergeAnnotationOverrides for why: without it, deleting a comment and
  // then adding another one (or anything else that refreshes
  // annotationsProp) before the delete's own server round-trip/realtime
  // echo lands would silently resurrect it, since the next prop sync still
  // carries the pre-delete shape.
  const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>((annotationsProp ?? []) as Annotation[]);
  useEffect(() => {
    if (!annotationsProp) return;
    setAnnotations(mergeAnnotationOverrides(normalizeAnnotationList(annotationsProp), annotationOverrides) as Annotation[]);
  }, [annotationsProp, annotationOverrides]);
  const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotationOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const { resolveFocus, beginDrag, updateDrag, endDrag, draggingId } = useDraggablePin();
  const [popoverMeasureRef, popoverMeasuredSize] = useMeasuredSize<HTMLDivElement>();
  const [composerMeasureRef, composerMeasuredSize] = useMeasuredSize<HTMLDivElement>();

  const annotationTargets = useMemo(() => {
    return annotations
      .filter((a) => !a.isDeleted)
      .map((annotation, index) => {
        const focus = getAnnotationFocusPoint(
          annotation,
          imageNaturalSize?.w,
          imageNaturalSize?.h
        );
        return {
          annotation,
          accentColor: getAnnotationAccentColor(annotation),
          index,
          focus,
        };
      })
      .filter((entry) => entry.focus);
  }, [annotations, imageNaturalSize]);
  const selectedAnnotationTarget = useMemo(
    () => annotationTargets.find((entry) => entry.annotation.id === selectedAnnotationId) ?? null,
    [annotationTargets, selectedAnnotationId]
  );

  // COMMITTED strokes (drawn on backing canvas)
  const committedStrokes = useMemo<Stroke[]>(
    () => annotations.flatMap((a: Annotation) => a.drawing ?? []),
    [annotations]
  );

  // LIVE strokes (drawn by overlay)
  const liveStrokes = useMemo<Stroke[]>(
    () => [...draftStrokes, ...(activeStroke ? [activeStroke] : [])],
    [draftStrokes, activeStroke]
  );

  // Backing canvas sizing/redraw in NATURAL image space
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const draftAnchorBounds = useMemo(
    () => getDrawingBounds(
      draftStrokes,
      imageNaturalSize?.w,
      imageNaturalSize?.h
    ),
    [draftStrokes, imageNaturalSize]
  );
  const draftAnchorFocus = useMemo(
    () => draftAnchorBounds
      ? {
          x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2,
          y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2,
        }
      : null,
    [draftAnchorBounds]
  );
  const getStageOverlayPosition = useCallback((
    focus: { x: number; y: number } | null,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number
  ) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !focus) return null;

    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const anchorX = tx + focus.x * iw * scale;
    const anchorY = ty + focus.y * ih * scale;

    return clampOverlayPosition({
      anchorLeft: anchorX,
      anchorTop: anchorY,
      xOffset,
      yOffset,
      width,
      height,
      stageWidth: stage.clientWidth,
      stageHeight: stage.clientHeight,
    });
  }, [scale, tx, ty]);
  const getStagePointPosition = useCallback((focus: { x: number; y: number } | null) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !focus) return null;

    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;

    return {
      left: tx + focus.x * iw * scale,
      top: ty + focus.y * ih * scale,
    };
  }, [scale, tx, ty]);
  const selectedAnnotationFocus = useMemo(() => {
    if (!selectedAnnotationTarget?.focus) return null;
    return resolveFocus(selectedAnnotationTarget.annotation.id, selectedAnnotationTarget.focus);
  }, [selectedAnnotationTarget, resolveFocus]);
  const resolvedDraftAnchorFocus = useMemo(
    () => (draftAnchorFocus ? resolveFocus(DRAFT_PIN_ID, draftAnchorFocus) : null),
    [draftAnchorFocus, resolveFocus]
  );
  const selectedPopoverPosition = useMemo(
    // 220px default: a rough single-author, short-comment CommentPopover
    // height, used only until popoverMeasureRef reports the real rendered
    // height (see useMeasuredSize) -- comment text length varies a lot, so a
    // fixed guess alone would clip long comments near the stage's bottom edge.
    () => getStageOverlayPosition(selectedAnnotationFocus, 24, -18, 280, popoverMeasuredSize?.height ?? 220),
    [getStageOverlayPosition, selectedAnnotationFocus, popoverMeasuredSize]
  );
  const inlineComposerPosition = useMemo(
    () => getStageOverlayPosition(resolvedDraftAnchorFocus, 18, -12, 280, composerMeasuredSize?.height ?? 200),
    [resolvedDraftAnchorFocus, getStageOverlayPosition, composerMeasuredSize]
  );
  const draftAnchorPosition = useMemo(
    () => getStagePointPosition(resolvedDraftAnchorFocus),
    [resolvedDraftAnchorFocus, getStagePointPosition]
  );

  const recomputeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const w = img?.naturalWidth || overlay.offsetWidth || 1;
    const h = img?.naturalHeight || overlay.offsetHeight || 1;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Only draw strokes if annotations are visible
      if (showAnnotations) {
        drawStrokes(ctx, committedStrokes, w, h, img?.naturalWidth || undefined, img?.naturalHeight || undefined, annotationCanvasOptions);
      }
    }

    setCanvasSize({ w, h });

    // Helpful log
    // console.log("[recomputeCanvas]", {
    //   scale, tx, ty,
    //   natural: { w: img?.naturalWidth, h: img?.naturalHeight },
    //   overlayOffset: { w: overlay?.offsetWidth, h: overlay?.offsetHeight },
    //   canvasCss: { w: canvas.style.width, h: canvas.style.height },
    //   canvasPixels: { w: canvas.width, h: canvas.height },
    //   dpr: window.devicePixelRatio
    // });
  }, [annotationCanvasOptions, committedStrokes, showAnnotations]);

  // Observe overlay intrinsic size
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const resize = () => recomputeCanvas();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeCanvas]);

  // Redraw when committed strokes or canvas pixels change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear the canvas first
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw strokes if annotations are visible
    if (showAnnotations) {
      const img = imgRef.current;
      drawStrokes(ctx, committedStrokes, canvasSize.w, canvasSize.h, img?.naturalWidth || undefined, img?.naturalHeight || undefined, annotationCanvasOptions);
    }
  }, [annotationCanvasOptions, committedStrokes, canvasSize, showAnnotations]);

  // fit helper
  const computeFit = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return 1;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih || !sw || !sh) return 1;
    
    // Contain the whole image within the stage regardless of aspect ratio.
    // A "fit to width" override for tall images used to live here on the
    // assumption a tall image was "likely a web screenshot" -- but real
    // website screenshots are routed to WebScreenshotReview upstream (see
    // isLikelyWebsiteScreenshot in ReviewAsset.tsx), so this component only
    // ever sees regular images now. For those, fitting to width instead of
    // containing meant any tall/portrait image (photos, posters, phone
    // screenshots, etc.) overflowed the stage vertically on load, forcing
    // the user to manually zoom out to see the whole thing.
    const s = Math.min(sw / iw, sh / ih);

    return Math.max(0.05, Math.min(s, 32));
  }, []);

  // Progressive resolution upgrade — lazy, not automatic. The fast preview
  // is capped at REVIEW_PREVIEW_TRANSFORM's width, which is already the same
  // "one well-sized review proxy" approach other review tools use — they
  // don't eagerly re-fetch a heavier file in the background for every asset
  // someone glances at, and neither should we. Fetching the untransformed
  // original automatically on every view was adding an extra multi-MB
  // request nobody asked for. Instead, only start that fetch once the viewer
  // actually zooms in past the fit-to-view level — a clear signal they want
  // more detail than the preview can give — so it's warming by the time
  // they'd notice the preview looking soft, without paying the bandwidth
  // cost on assets nobody looks at that closely.
  const upgradeStateRef = useRef<{ triggered: boolean; cancelled: boolean }>({ triggered: false, cancelled: false });

  useEffect(() => {
    upgradeStateRef.current = { triggered: false, cancelled: false };
    return () => {
      upgradeStateRef.current.cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!fullImageReady) return;
    // Compare against the actual fit-to-view scale, not a hardcoded 1 — for
    // any image smaller than the viewing area, computeFit() itself legitimately
    // returns a scale ABOVE 1 (stretching a small image to fill the viewport)
    // with zero user zoom involved. Comparing against a flat "scale >= 1"
    // meant this fired immediately on load for every such image (not just on
    // deliberate zoom-in), which is exactly what looked like an automatic,
    // uncommanded zoom-in/zoom-out: the swap to the full original changes its
    // natural dimensions, retriggering the fit calculation and visibly
    // reflowing the view. A small epsilon avoids float-noise false triggers
    // right at the fit boundary.
    const fitScale = computeFit();
    if (scale <= fitScale * 1.05) return;
    const state = upgradeStateRef.current;
    if (state.triggered) return;
    if (!imageUrl || !isRealImageAsset(asset)) return;

    const knownWidth = asset?.width ?? null;
    const previewCapWidth = REVIEW_PREVIEW_TRANSFORM.width ?? null;
    if (knownWidth != null && previewCapWidth != null && knownWidth <= previewCapWidth) return;

    state.triggered = true;
    const upgrade = new window.Image();
    if ("fetchPriority" in upgrade) (upgrade as unknown as { fetchPriority: string }).fetchPriority = "low";
    upgrade.src = imageUrl;

    const swapIn = () => {
      if (!state.cancelled) setResolvedImageUrl(imageUrl);
    };
    if (typeof upgrade.decode === "function") {
      // On failure, just stay on the (already working) preview — swapping
      // in a URL that just failed to load/decode would only hand the same
      // failure to the visible <img>, trading a working preview for a
      // broken one instead of leaving well enough alone.
      upgrade.decode().then(swapIn).catch(() => {});
    } else {
      upgrade.onload = swapIn;
    }
  }, [fullImageReady, scale, imageUrl, asset?.mime_type, asset?.width, computeFit]);

  // Zoom helpers
  const clampScale = useCallback((s: number) => Math.max(minScale, Math.min(maxScale, s)), [maxScale, minScale]);

  const centerAtScale = useCallback(
    (nextScale: number) => {
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img) return;

      const s = clampScale(nextScale);
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;

      const rw = iw * s;
      const rh = ih * s;

      setScale(s);
      setTx((sw - rw) / 2);
      // For very tall images, align to top; otherwise center vertically
      if (rh > sh && ih > iw * 1.5) {
        setTy(0);
      } else {
        setTy((sh - rh) / 2);
      }

      requestAnimationFrame(recomputeCanvas);
    },
    [clampScale, recomputeCanvas]
  );

  const zoomAroundPoint = useCallback(
    (nextScale: number, sx: number, sy: number) => {
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img) return;

      const prev = scale;
      const next = clampScale(nextScale);

      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;

      const prevW = iw * prev, prevH = ih * prev;
      const nextW = iw * next, nextH = ih * next;

      const ox = sx - tx;
      const oy = sy - ty;
      const rx = prevW ? ox / prevW : 0.5;
      const ry = prevH ? oy / prevH : 0.5;

      setTx(sx - rx * nextW);
      setTy(sy - ry * nextH);
      setScale(next);

      requestAnimationFrame(recomputeCanvas);
    },
    [scale, tx, ty, clampScale, recomputeCanvas]
  );

  // Pans (without changing scale) to bring a normalized (0..1) image-space
  // point to the center of the stage -- used to reveal a comment's pin when
  // it's selected from the sidebar list.
  const panToNormalizedPoint = useCallback(
    (point: { x: number; y: number }) => {
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img) return;

      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;

      setTx(sw / 2 - point.x * iw * scale);
      setTy(sh / 2 - point.y * ih * scale);

      requestAnimationFrame(recomputeCanvas);
    },
    [scale, recomputeCanvas]
  );

  const zoomAroundCenter = useCallback(
    (nextScale: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const cx = stage.clientWidth / 2;
      const cy = stage.clientHeight / 2;
      zoomAroundPoint(nextScale, cx, cy);
    },
    [zoomAroundPoint]
  );

  // Pan/zoom is a pure CSS transform (translate/scale) on the wrapper — it
  // never changes the image's natural size or devicePixelRatio, so the
  // annotation canvas's backing store never needs to be reallocated for it.
  // A prior effect re-triggered a full canvas resize + stroke redraw on
  // every scale/tx/ty change (i.e. on every pointermove while panning, and
  // every wheel tick while zooming) — for a large image (tens of megapixels,
  // as with a 25MB+ 360 panorama) at 2x/3x DPR that reallocation is a
  // multi-hundred-megapixel operation repeated every animation frame during
  // interaction, blocking the main thread and freezing the whole page's
  // paint (sidebar, comments panel, toolbar included), not just the image.
  // Deliberate zoom/fit actions (centerAtScale, zoomAroundPoint) already
  // request a one-shot recompute themselves; ResizeObserver above covers
  // actual overlay/image size changes.

  // Initial fit & center
  const fitOnLoad = useCallback(() => {
    const s = computeFit();
    setMinScale(Math.min(0.05, s));
    centerAtScale(s);
  }, [computeFit, centerAtScale]);

  // Non-passive wheel zoom (fix preventDefault warning)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // zoom only when Ctrl/⌘ held
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = 1 + -e.deltaY * 0.0015;
      zoomAroundPoint(scale * factor, cx, cy);
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", handleWheel as EventListener);
    };
  }, [scale, zoomAroundPoint]);

  // Pan
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const onPointerDownStage = (e: React.PointerEvent) => {
    if (isReviewUiTarget(e.target)) {
      setPanning(false);
      panStart.current = null;
      return;
    }

    if (isViewMode && e.buttons === 1) {
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
    // Comment mode: drop pin
    if (isCommentMode && e.buttons === 1 && !inlineComposerOpen) {
      const stage = stageRef.current;
      const img = imgRef.current;
      if (!stage || !img) return;
      const iw = img.naturalWidth || img.width || 1;
      const ih = img.naturalHeight || img.height || 1;
      const rect = stage.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Convert screen coords to normalized 0..1
      const nx = Math.max(0, Math.min(1, (sx - tx) / (iw * scale)));
      const ny = Math.max(0, Math.min(1, (sy - ty) / (ih * scale)));
      addStroke(createAnchorStroke({ x: nx, y: ny }, color), true);
      setInlineComposerText(dockComposerText);
      setInlineComposerOpen(true);
    }
  };
  const onPointerMoveStage = (e: React.PointerEvent) => {
    if (!panning || !panStart.current) return;
    if (e.buttons !== 1) {
      setPanning(false);
      panStart.current = null;
      return;
    }
    if (isReviewUiTarget(e.target)) {
      setPanning(false);
      panStart.current = null;
      return;
    }
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTx(panStart.current.tx + dx);
    setTy(panStart.current.ty + dy);
  };
  const onPointerUpStage = () => {
    setPanning(false);
    panStart.current = null;
  };
  const handleOverlayPointerUp = useCallback(() => {
    const hadActiveStroke = !!activeStroke;
    pointerUp();
    if (!hadActiveStroke) return;
    setInlineComposerText(dockComposerText);
    setInlineComposerOpen(true);
  }, [activeStroke, dockComposerText, pointerUp]);

  // Keyboard
  useEffect(() => {
    const onKey = () => {
      // if (e.key === "1") { e.preventDefault(); centerAtScale(1); }
      // if (e.key === "0") { e.preventDefault(); centerAtScale(computeFit()); }
      // if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomAroundCenter(scale * 1.1); }
      // if ((e.metaKey || e.ctrlKey) && e.key === "-") { e.preventDefault(); zoomAroundCenter(scale / 1.1); }
      // if (e.key === "Escape" && annotating) setAnnotating(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotating, centerAtScale, computeFit, zoomAroundCenter, scale, setAnnotating]);

  // Transparency detection
  const detectAlpha = useCallback(async () => {
    try {
      const img = imgRef.current;
      if (!img) {
        setPreviewBackground("dark");
        return;
      }

      const mimeType = asset?.mime_type?.toLowerCase() ?? "";
      const normalizedUrl = (resolvedImageUrl || imageUrl || "").toLowerCase();
      if (mimeType === "image/png" || mimeType === "image/webp" || /\.png($|\?)/i.test(normalizedUrl) || /\.webp($|\?)/i.test(normalizedUrl)) {
        setPreviewBackground("checker");
        return;
      }

      const c = document.createElement("canvas");
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;
      c.width = Math.min(iw, 64); c.height = Math.min(ih, 64);
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let alphaFound = false;

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha < 1) alphaFound = true;
      }

      setPreviewBackground(alphaFound ? "checker" : "dark");
    } catch {
      const ext = (resolvedImageUrl || imageUrl || "").toLowerCase();
      const fallback = ext.endsWith(".png") || ext.endsWith(".webp") || asset?.mime_type === "image/png" || asset?.mime_type === "image/webp"
        ? "checker"
        : "dark";
      setPreviewBackground(fallback);
    }
  }, [asset?.mime_type, imageUrl, resolvedImageUrl]);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img?.naturalWidth && img.naturalHeight) {
      setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
    fitOnLoad();
    detectAlpha();
    setFullImageReady(true);
    requestAnimationFrame(recomputeCanvas);
  }, [fitOnLoad, detectAlpha, recomputeCanvas]);

  const onImgError = useCallback(() => {
    // Cloudflare-resized proxy failed to load: fall back to the small
    // pre-generated cover thumbnail first (fast), and only if that also
    // fails, to the untransformed original — staying fast in the failure
    // case instead of immediately reintroducing the full-original download
    // this transform exists to avoid.
    const transformedUrl = imageUrl && isRealImageAsset(asset)
      ? withMediaTransform(imageUrl, REVIEW_PREVIEW_TRANSFORM, asset?.mime_type ?? null)
      : null;
    const coverUrl = asset?.cover_image_url ?? null;

    if (transformedUrl && transformedUrl !== imageUrl && resolvedImageUrl === transformedUrl) {
      if (coverUrl && coverUrl !== resolvedImageUrl) {
        setResolvedImageUrl(coverUrl);
        return;
      }
      setResolvedImageUrl(imageUrl);
      return;
    }

    if (coverUrl && coverUrl !== imageUrl && resolvedImageUrl === coverUrl) {
      setResolvedImageUrl(imageUrl);
      return;
    }

    // Stop showing the blurred thumbnail placeholder so the error state
    // underneath (handled by the parent via onMediaError) isn't obscured.
    setFullImageReady(true);
    onMediaError?.();
  }, [asset, imageUrl, resolvedImageUrl, onMediaError]);

  // Background
  const stageBg = previewBackgroundClassAlwaysDark(previewBackground);

  // Layout
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

  const filteredAnnotations = useMemo(() => annotations, [annotations]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useLayoutEffect(() => {
    centerAtScaleRef.current = centerAtScale;
  }, [centerAtScale]);

  useLayoutEffect(() => {
    if (previousPanelOpenRef.current === null) {
      previousPanelOpenRef.current = panelOpen;
      return;
    }
    if (previousPanelOpenRef.current === panelOpen) return;
    previousPanelOpenRef.current = panelOpen;
    centerAtScaleRef.current(scaleRef.current);
  }, [panelOpen]);

  return (
    <div className={cn("w-full h-full", className)}>
      <div className="border-0 rounded-none bg-background h-full">
        <CardContent className="p-0 h-full">
          <div className="flex h-full min-h-0 w-full flex-col lg:flex-row">
            <div
              className={cn(
                "relative flex min-h-0 min-w-0 basis-[48%] flex-col lg:basis-auto lg:flex-1 lg:min-h-0 lg:h-full",
                panelOpen ? "lg:w-[calc(100%-360px)]" : "w-full"
              )}
            >
              {/* Shared top mode bar: View | Comment | Draw */}
              <ReviewModeBar
                mode={interactionMode}
                onModeChange={(m) => {
                  closeInlineComposer(true);
                  if (m !== "view") setShowAnnotations(true);
                  setInteractionMode(m);
                }}
                tool={tool}
                onToolChange={setTool}
                color={color}
                onColorChange={setColor}
                hidePreview={true}
                restrictToView={viewMode === "360"}
              />

              {/* Stage: full-height viewport; layer is transformed together */}
              <div
                ref={stageRef}
                className={cn(
                  "relative flex-1 overflow-hidden select-none min-h-0",
                  stageBg,
                  isViewMode && (panning ? "cursor-grabbing" : "cursor-grab"),
                  isCommentMode && "cursor-copy",
                  isDrawMode && "cursor-crosshair"
                )}
                onPointerDown={onPointerDownStage}
                onPointerMove={onPointerMoveStage}
                onPointerUp={onPointerUpStage}
                // Comment mode only needs a plain tap (dropped on
                // pointerdown, no drag involved), unlike view-mode panning
                // or draw-mode stroking -- so it doesn't need to suppress
                // native touch-scroll the way those two drag gestures do.
                style={{ touchAction: isCommentMode ? "auto" : "none" }}
              >
                {viewMode === "flat" && (
                <>
                {asset?.cover_image_url && !fullImageReady ? (
                  <img
                    src={asset.cover_image_url}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    fetchPriority="high"
                    decoding="async"
                    className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-contain p-6 opacity-70 blur-xl"
                  />
                ) : null}

                {/* Layer: natural-size image + overlay + canvases — transformed together.
                    Stays hidden until fitOnLoad has computed the real fit
                    scale/position — scale starts at its default (1, i.e.
                    natural pixel size) and only snaps to the fit value once
                    the image finishes loading, so painting this layer before
                    then flashes the image at full natural size for a frame
                    (visible as a "zoom out" pop right after load). Both the
                    corrected transform and this reveal land in the same
                    batched state update, so there's nothing to see until
                    it's already correctly sized. */}
                <div
                  className="absolute top-0 left-0 will-change-transform transition-opacity duration-150 ease-out"
                  style={{
                    transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                    transformOrigin: "0 0",
                    opacity: fullImageReady ? 1 : 0,
                  }}
                >
                  <img
                    ref={imgRef}
                    src={resolvedImageUrl}
                    alt={title ?? "Image"}
                    className="block select-none"
                    draggable={false}
                    fetchPriority="high"
                    decoding="async"
                    onLoad={onImgLoad}
                    onError={onImgError}
                    style={{ width: "auto", height: "auto", maxWidth: "none", maxHeight: "none" }}
                  />

                  {/* Natural-size overlay element for hit-testing */}
                  <div
                    ref={overlayRef}
                    className="absolute top-0 left-0"
                    style={{
                      width: imgRef.current?.naturalWidth ? `${imgRef.current.naturalWidth}px` : 1,
                      height: imgRef.current?.naturalHeight ? `${imgRef.current.naturalHeight}px` : 1,
                    }}
                  />

                  {/* Backing canvas for COMMITTED strokes */}
                  <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />

                  {/* Inline CanvasOverlay for LIVE strokes */}
                  <CanvasOverlay
                    targetRef={overlayRef as unknown as React.RefObject<HTMLElement>}
                    annotating={annotating}
                    strokes={showAnnotations ? liveStrokes : []}
                    visualScale={scale}
                    naturalWidth={imgRef.current?.naturalWidth}
                    naturalHeight={imgRef.current?.naturalHeight}
                    onPointerDown={(p) => pointerDown(p)}
                    onPointerMove={(p) => pointerMove(p)}
                    onPointerUp={handleOverlayPointerUp}
                    onPointerCancel={() => pointerCancel()}

                  />
                </div>

                {/* Render annotation pins in stage space so they stay usable at any image zoom. */}
                {showAnnotations && annotationTargets.map((entry) => {
                  if (!entry.focus) return null;
                  const focus = entry.focus;
                  const isSelected = entry.annotation.id === selectedAnnotationId;
                  const isHovered = entry.annotation.id === hoveredAnnotationId;
                  const isDragging = draggingId === entry.annotation.id;
                  const position = getStagePointPosition(resolveFocus(entry.annotation.id, focus));
                  if (!position) return null;
                  const imgWidthPx = (imgRef.current?.naturalWidth || 0) * scale;
                  const imgHeightPx = (imgRef.current?.naturalHeight || 0) * scale;
                  return (
                    <button
                      key={entry.annotation.id}
                      type="button"
                      data-review-ui="true"
                      title="Drag to move this pin"
                      className={cn(
                        "group absolute z-20 -translate-x-1/2 -translate-y-1/2 touch-none transition-transform",
                        isDragging ? "cursor-grabbing" : "cursor-grab hover:-translate-y-[55%]",
                        (isSelected || isHovered) ? "z-30" : ""
                      )}
                      style={{
                        left: `${position.left}px`,
                        top: `${position.top}px`,
                      }}
                      onPointerDown={(e) => beginDrag(entry.annotation.id, focus, e)}
                      onPointerMove={(e) => updateDrag(e, imgWidthPx, imgHeightPx)}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        const wasDrag = endDrag(e);
                        if (!wasDrag) setSelectedAnnotationId(entry.annotation.id);
                      }}
                      onMouseEnter={() => setHoveredAnnotationId(entry.annotation.id)}
                      onMouseLeave={() => setHoveredAnnotationId((current) => current === entry.annotation.id ? null : current)}
                    >
                      <BubblePin
                        initials={getAvatarInitials(entry.annotation.author || "?")}
                        userId={entry.annotation.authorId}
                        userName={entry.annotation.author}
                      />
                      {/* Move-affordance badge: only appears on hover, so it signifies
                          draggability without cluttering pins at rest. */}
                      <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/40 bg-slate-900/90 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                        <Move className="h-2.5 w-2.5" />
                      </span>
                    </button>
                  );
                })}

                {/* Draft anchor pin (Comment mode) -- draggable like a placed pin so
                    the user can reposition it before submitting, e.g. to pull it away
                    from other nearby pins. */}
                {showAnnotations && isCommentMode && draftAnchorPosition && resolvedDraftAnchorFocus ? (
                  <button
                    type="button"
                    data-review-ui="true"
                    title="Drag to move this pin"
                    className={cn(
                      "group absolute z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[11px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20 transition-transform",
                      draggingId === DRAFT_PIN_ID ? "cursor-grabbing" : "cursor-grab"
                    )}
                    style={{ left: `${draftAnchorPosition.left}px`, top: `${draftAnchorPosition.top}px` }}
                    onPointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                    onPointerMove={(e) => updateDrag(
                      e,
                      (imgRef.current?.naturalWidth || 0) * scale,
                      (imgRef.current?.naturalHeight || 0) * scale
                    )}
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
                ) : null}

                {showAnnotations && selectedAnnotationTarget && selectedPopoverPosition ? (
                  <div
                    ref={popoverMeasureRef}
                    className="absolute z-40"
                    data-review-ui="true"
                    style={{
                      left: `${selectedPopoverPosition.left}px`,
                      top: `${selectedPopoverPosition.top}px`,
                    }}
                  >
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
                      onDragHandlePointerMove={(e) => updateDrag(
                        e,
                        (imgRef.current?.naturalWidth || 0) * scale,
                        (imgRef.current?.naturalHeight || 0) * scale
                      )}
                      onDragHandlePointerUp={(e) => endDrag(e)}
                    />
                  </div>
                ) : null}

                {/* Inline composer (Comment + Draw modes) */}
                {showAnnotations && inlineComposerOpen && inlineComposerPosition ? (
                  <div
                    ref={composerMeasureRef}
                    className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                    data-review-ui="true"
                    style={{
                      left: `${inlineComposerPosition.left}px`,
                      top: `${inlineComposerPosition.top}px`,
                    }}
                  >
                    <InlineNoteComposer
                      value={inlineComposerText}
                      onChange={(value) => {
                        setInlineComposerText(value);
                        setDockComposerText(value);
                      }}
                      isDragging={draggingId === DRAFT_PIN_ID}
                      onDragHandlePointerDown={(e) => resolvedDraftAnchorFocus && beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                      onDragHandlePointerMove={(e) => updateDrag(
                        e,
                        (imgRef.current?.naturalWidth || 0) * scale,
                        (imgRef.current?.naturalHeight || 0) * scale
                      )}
                      onDragHandlePointerUp={(e) => endDrag(e)}
                      color={color}
                      label={isCommentMode ? "Add note here" : "Describe your annotation"}
                      hint={isCommentMode ? "Pin stays attached" : "Ctrl+Enter to submit"}
                      projectId={projectId}
                      organizationId={organizationId}
                      workspaceId={workspaceId}
                      assetId={assetId}
                      onCancel={() => closeInlineComposer(true)}
                      onSubmit={async () => {
                        const text = inlineComposerText.trim();
                        if (!text) return;
                        try {
                          const payload: Annotation = {
                            id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
                            time: Number.NaN,
                            text,
                            author: await getLoggedInUserProfile().then((u) => u?.full_name),
                            authorId: await getLoggedInUserProfile().then((u) => u?.sub),
                            isCompleted: false,
                            isDeleted: false,
                            createdAt: new Date().toISOString(),
                            emoji: {},
                            drawing: [...liveStrokes],
                          };
                          if (!onAddAnnotation) {
                            setAnnotations((prev) => { if (prev.some(a => a.id === payload.id)) return prev; return [...prev, payload]; });
                          }
                          closeInlineComposer(true);
                          setDockComposerText("");
                          setInteractionMode("view");
                          if (onAddAnnotation) await onAddAnnotation(payload);
                        } catch (err) { console.error("Failed to submit comment:", err); }
                      }}
                    />
                  </div>
                ) : null}
                </>
                )}

                {viewMode === "360" && (
                  <Suspense fallback={null}>
                    <Panorama360Viewer
                      imageUrl={imageUrl}
                      className="absolute inset-0"
                      onExit={() => setViewMode("flat")}
                    />
                  </Suspense>
                )}

                <div data-review-ui="true" className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-5.5rem)] flex-wrap items-center gap-2 rounded-lg bg-black/60 px-3 backdrop-blur-sm opacity-90 transition-opacity hover:opacity-100 sm:bottom-4 sm:left-4 sm:max-w-none">
                  {viewMode === "flat" && (
                  <>
                  {/* Zoom controls */}
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => zoomAroundCenter(scale / 1.1)} title="Zoom out (Ctrl/⌘-)" aria-label="Zoom out" className="text-white hover:bg-white/10 h-8 w-8 p-0">
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <div className="w-12 text-center text-xs tabular-nums text-white font-medium">{zoomPct}%</div>
                    <Button variant="ghost" size="sm" onClick={() => zoomAroundCenter(scale * 1.1)} title="Zoom in (Ctrl/⌘+)" aria-label="Zoom in" className="text-white hover:bg-white/10 h-8 w-8 p-0">
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="h-4 w-px bg-white/20" />

                  {/* Fit controls */}
                  <Button variant="ghost" size="sm" onClick={() => centerAtScale(computeFit())} title="Fit to view (0)" className="text-white hover:bg-white/10 h-8 w-8 p-0">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => centerAtScale(1)} title="100% (1)" className="text-white hover:bg-white/10 text-xs px-2 h-8">
                    1:1
                  </Button>

                  <div className="h-4 w-px bg-white/20" />
                  </>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const storagePath = asset?.storage_path;
                      if (storagePath) {
                        // For camera RAW, imageUrl is the preview JPEG; Download must return the original file.
                        const isRawPreview = getRawPreviewInfo(asset) !== null;
                        const url = isRawPreview ? resolveAssetDownloadUrl(asset) : (imageUrl || resolveAssetDownloadUrl(asset));
                        void downloadFile(url, asset?.title || "image", { fallbackUrl: fallbackDownloadUrl });
                      }
                    }}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>

                  {canShow360 && (
                    <>
                      <div className="h-4 w-px bg-white/20" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode(viewMode === "flat" ? "360" : "flat")}
                        title={viewMode === "flat" ? "View in 360°" : "Exit 360° view"}
                        className="text-white hover:bg-white/10 text-xs px-2 h-8 gap-1.5"
                      >
                        <Orbit className="h-4 w-4" />
                        {viewMode === "flat" ? "360° View" : "Exit 360°"}
                      </Button>
                    </>
                  )}
                </div>

                {/* Floating background toggle - top right corner */}
                {viewMode === "flat" && (
                <div data-review-ui="true" className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm opacity-90 transition-opacity hover:opacity-100 sm:bottom-4 sm:right-4">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center">
                          <Switch
                            checked={showAnnotations}
                            onCheckedChange={handleShowAnnotationsChange}
                          />
                          <label className="text-xs text-white select-none ml-2 cursor-pointer">
                            {showAnnotations ? "Hide annotations" : "Show annotations"}
                          </label>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {showAnnotations ? "Hide annotations" : "Show annotations"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                )}
              </div>


            </div>

            {/* Right panel */}
            {panelOpen ? (
              <div className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none">
                  <div className="h-full min-h-0">
                    <CommentsPanel
                      items={filteredAnnotations.map((a: Annotation) => ({
                        id: a.id,
                        author: a.author,
                        authorId: a.authorId,
                        text: a.text,
                        emoji: a.emoji,
                        hasDrawing: !!(a.drawing && a.drawing.length > 0),
                        isCompleted: a.isCompleted,
                        isDeleted: a.isDeleted,
                        canManageComment: a.canManageComment,
                        canDeleteComment: a.canDeleteComment,
                        createdAt: a.createdAt,
                      }))}
                      onItemClick={(id) => {
                        setSelectedAnnotationId(id);
                        const target = annotationTargets.find((entry) => entry.annotation.id === id);
                        if (target?.focus) panToNormalizedPoint(target.focus);
                      }}

                      // Bottom dock props (no timestamp for images)
                      showCommentDock={true}
                      includeTimestamp={false}
                      // 360° mode has no coordinate system for pins/drawing
                      // on a sphere (see ReviewModeBar's restrictToView) --
                      // hide the Comment/Draw controls here too.
                      showAnnotationControls={viewMode === "flat"}
                      annotating={isDrawMode}
                      onToggleAnnotating={() => setInteractionMode(isDrawMode ? "view" : "draw")}
                      reviewMode={isCommentMode ? "comment" : isDrawMode ? "draw" : "view"}
                      onReviewModeChange={(mode) => {
                        closeInlineComposer(true);
                        if (mode !== "view") setShowAnnotations(true);
                        setInteractionMode(mode);
                      }}
                      tool={tool}
                      onToolChange={setTool}
                      color={color}
                      onColorChange={setColor}
                      canUndo={!!draftStrokes.length || !!activeStroke}
                      onUndo={undoStroke}
                      onClear={clearStrokes}
                      onCommentSubmit={async (text: string) => {
                        // console.log("Submitting comment: -image", text);
                        // console.log("🔍 onAddAnnotation exists?", !!onAddAnnotation);
                        try {
                          // console.log("📝 Step 1: Creating minimal payload...");
                          // Create minimal payload - let ReviewAsset.tsx handle auth with session refresh
                          const payload: Annotation = {
                            id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
                            time: Number.NaN,
                            text,
                            author: await getLoggedInUserProfile().then((user) => user?.full_name), // Will be filled in by handleAddAnnotation
                            authorId: await getLoggedInUserProfile().then((user) => user?.sub), // Will be filled in by handleAddAnnotation
                            isCompleted: false,
                            isDeleted: false,
                            createdAt: new Date().toISOString(),
                            emoji: {},
                            drawing: [...liveStrokes],
                          };
                          // console.log("✅ Step 1 complete: Minimal payload created");

                          // console.log("📝 Step 2: Adding to local state...");
                          // Add to local state immediately for optimistic updates
                          if (!onAddAnnotation) {
                            setAnnotations((prev: Annotation[]) => {
                              const exists = prev.some(a => a.id === payload.id);
                              if (exists) return prev;
                              return [...prev, payload];
                            });
                          }
                          // console.log("✅ Step 2 complete: Added to local state");

                          // console.log("📝 Step 3: Clearing UI state...");
                          // Clear UI state immediately
                          setInteractionMode("view");
                          setDockComposerText("");
                          clearStrokes();
                          // console.log("✅ Step 3 complete: UI state cleared");

                          // Call external handler if provided
                          // console.log("🎯 About to call onAddAnnotation with payload:", payload.text);
                          if (onAddAnnotation) {
                            // console.log("📝 Step 4: Calling onAddAnnotation...");
                            await onAddAnnotation(payload);
                            // console.log("✅ Step 4 complete: onAddAnnotation returned");
                          } else {
                            // console.error("❌ onAddAnnotation is NOT defined!");
                          }
                        } catch (error) {
                          console.error('❌ Failed to submit comment:', error);
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
                        const target = annotations.find((a) => a.id === id);
                        applyLocalAnnotationUpdate(id, { isCompleted: !target?.isCompleted });
                        // TODO: Call API to update completion status in database
                        await invokeEdgeFunction("comment", {
                          method: "PATCH",
                          body: { id, status: "completed", ...(commentMutationContext ?? {}) }
                        });
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
              </div>
            ) : null}
          </div>
        </CardContent>
      </div>
    </div>
  );
}

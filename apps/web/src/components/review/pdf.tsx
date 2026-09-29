import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ZoomIn, ZoomOut, Maximize2, Download, FileText, Rows3, Columns3, Move } from "lucide-react";
import { cn, downloadFile } from "@/lib/utils";
import { resolveAssetDownloadUrl } from "@/lib/mediaDelivery";
import type { Annotation, Stroke } from "./annotator-utils";
import { drawStrokes, getAnnotationFocusPoint, getDrawingBounds, mergeAnnotationOverrides, normalizeAnnotationList } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import CommentsPanel from "./CommentsPanel";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { convertMentionsForDisplay } from "@/lib/mentionUtils";
import { getAvatarInitials } from "@/lib/avatar-utils";
import { ReviewModeBar } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { BubblePin } from "./shared/PinMarker";
import { CommentPopover } from "./shared/CommentPopover";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { useDraggablePin } from "./shared/useDraggablePin";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DRAFT_PIN_ID = "__draft-anchor__";

type ReviewProfile = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

type PdfAnnotatorProps = {
  pdfUrl?: string;
  title?: string;
  className?: string;
  annotations?: Annotation[] | unknown[];
  onAddAnnotation?: (a: Annotation) => void | Promise<void>;
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
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
  profiles?: Record<string, ReviewProfile>;
};

type InteractionMode = "browse" | "comment" | "draw";
type PdfScrollMode = "vertical" | "horizontal";
type PdfPageSize = {
  width: number;
  height: number;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const INLINE_COMPOSER_WIDTH = 280;
const INLINE_COMPOSER_ESTIMATED_HEIGHT = 168;
const INLINE_COMPOSER_MARGIN = 12;
const INLINE_COMPOSER_ANCHOR_GAP = 18;
const PDF_PIN_SIZE = 32;
const PDF_DRAFT_PIN_SIZE = 28;
const COMMENT_POPOVER_WIDTH = 280;
const COMMENT_POPOVER_ESTIMATED_HEIGHT = 320;

function hasPdfPageAnchor(annotation: Annotation) {
  return Boolean(annotation.page && annotation.drawing?.length);
}

function cleanDisplayName(value?: string | null) {
  const trimmed = value?.trim();
  const normalized = trimmed?.toLowerCase();
  if (!trimmed || trimmed === "?" || trimmed === "??" || normalized === "unknown" || normalized === "unknown user") {
    return null;
  }
  return trimmed;
}

function getPdfAnnotationAuthorName(annotation: Annotation, profiles: Record<string, ReviewProfile>) {
  const profileName = annotation.authorId ? profiles[annotation.authorId]?.display_name : null;
  return cleanDisplayName(profileName) ?? cleanDisplayName(annotation.author);
}

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function createAnchorStroke(point: { x: number; y: number }, color: string): Stroke {
  return {
    tool: "pen",
    color,
    points: [point],
  };
}

function getScaledPageOverlayStyle(
  anchor: { x: number; y: number },
  visualScale: number,
  visualPageWidth: number,
  width: number,
  estimatedHeight: number,
  xOffset: number,
  yOffset: number
): CSSProperties {
  const safeScale = Math.max(MIN_ZOOM, visualScale);
  const composerWidth = Math.min(
    width,
    Math.max(180, visualPageWidth - INLINE_COMPOSER_MARGIN * 2)
  );
  const margin = INLINE_COMPOSER_MARGIN / safeScale;
  const xOffsetPx = xOffset / safeScale;
  const yOffsetPx = yOffset / safeScale;
  const maxLeftInset = (composerWidth + INLINE_COMPOSER_MARGIN) / safeScale;
  const maxTopInset = (estimatedHeight + INLINE_COMPOSER_MARGIN) / safeScale;

  return {
    width: `${composerWidth}px`,
    left: `min(max(calc(${anchor.x * 100}% + ${xOffsetPx}px), ${margin}px), max(0px, calc(100% - ${maxLeftInset}px)))`,
    top: `min(max(calc(${anchor.y * 100}% + ${yOffsetPx}px), ${margin}px), max(0px, calc(100% - ${maxTopInset}px)))`,
    transform: `scale(${1 / safeScale})`,
    transformOrigin: "top left",
  };
}

function getScaledInlineComposerStyle(
  anchor: { x: number; y: number },
  visualScale: number,
  visualPageWidth: number
): CSSProperties {
  return getScaledPageOverlayStyle(
    anchor,
    visualScale,
    visualPageWidth,
    INLINE_COMPOSER_WIDTH,
    INLINE_COMPOSER_ESTIMATED_HEIGHT,
    INLINE_COMPOSER_ANCHOR_GAP,
    -INLINE_COMPOSER_MARGIN
  );
}

function getScaledCommentPopoverStyle(
  anchor: { x: number; y: number },
  visualScale: number,
  visualPageWidth: number
): CSSProperties {
  return getScaledPageOverlayStyle(
    anchor,
    visualScale,
    visualPageWidth,
    COMMENT_POPOVER_WIDTH,
    COMMENT_POPOVER_ESTIMATED_HEIGHT,
    24,
    -18
  );
}

function getScaledPagePointStyle(
  anchor: { x: number; y: number },
  visualScale: number,
  size: number
): CSSProperties {
  const safeScale = Math.max(MIN_ZOOM, visualScale);
  const inset = (size / 2) / safeScale;

  return {
    left: `min(max(${anchor.x * 100}%, ${inset}px), calc(100% - ${inset}px))`,
    top: `min(max(${anchor.y * 100}%, ${inset}px), calc(100% - ${inset}px))`,
    transform: `translate(-50%, -50%) scale(${1 / safeScale})`,
    transformOrigin: "center",
  };
}

function PdfPageOverlay({
  pageNumber,
  active,
  interactionMode,
  committedStrokes,
  liveStrokes,
  showAnnotations,
  onActivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  pageNumber: number;
  active: boolean;
  interactionMode: InteractionMode;
  committedStrokes: Stroke[];
  liveStrokes: Stroke[];
  showAnnotations: boolean;
  onActivate: (page: number) => void;
  onPointerDown: (point: { x: number; y: number }) => void;
  onPointerMove: (point: { x: number; y: number }) => void;
  onPointerUp: (point: { x: number; y: number }) => void;
  onPointerCancel: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotating = interactionMode === "draw";

  const resizeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    const overlay = overlayRef.current;
    if (!overlay || !canvas) return;
    const width = overlay.clientWidth || 1;
    const height = overlay.clientHeight || 1;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const redraw = useCallback((canvas: HTMLCanvasElement | null, strokes: Stroke[]) => {
    const overlay = overlayRef.current;
    if (!overlay || !canvas) return;
    resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = overlay.clientWidth || 1;
    const height = overlay.clientHeight || 1;
    ctx.clearRect(0, 0, width, height);
    if (!showAnnotations || !strokes.length) return;
    drawStrokes(ctx, strokes, width, height);
  }, [resizeCanvas, showAnnotations]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    redraw(committedCanvasRef.current, committedStrokes);
    redraw(liveCanvasRef.current, liveStrokes);
    const observer = new ResizeObserver(() => {
      redraw(committedCanvasRef.current, committedStrokes);
      redraw(liveCanvasRef.current, liveStrokes);
    });
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [committedStrokes, liveStrokes, redraw]);

  useEffect(() => {
    redraw(committedCanvasRef.current, committedStrokes);
  }, [committedStrokes, redraw]);

  useEffect(() => {
    redraw(liveCanvasRef.current, liveStrokes);
  }, [liveStrokes, redraw]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const toNormalized = (event: PointerEvent) => {
      const rect = overlay.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      onActivate(pageNumber);
      if (interactionMode === "comment") {
        event.preventDefault();
        overlay.setPointerCapture(event.pointerId);
        onPointerDown(toNormalized(event));
        return;
      }
      if (!annotating) return;
      overlay.setPointerCapture(event.pointerId);
      onPointerDown(toNormalized(event));
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!annotating) return;
      onPointerMove(toNormalized(event));
    };
    const handlePointerUp = (event: PointerEvent) => {
      const point = toNormalized(event);
      if (interactionMode === "comment") {
        onPointerUp(point);
        try {
          overlay.releasePointerCapture(event.pointerId);
        } catch {
          // noop
        }
        return;
      }
      if (!annotating) return;
      onPointerUp(point);
      try {
        overlay.releasePointerCapture(event.pointerId);
      } catch {
        // noop
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      onPointerCancel();
      try {
        overlay.releasePointerCapture(event.pointerId);
      } catch {
        // noop
      }
    };

    overlay.addEventListener("pointerdown", handlePointerDown);
    overlay.addEventListener("pointermove", handlePointerMove);
    overlay.addEventListener("pointerup", handlePointerUp);
    overlay.addEventListener("pointercancel", handlePointerCancel);
    // Only draw mode drags (a stroke); browse and comment modes only need a
    // plain click/tap, so they don't need to suppress native touch-scroll
    // the way an active drag does. This was previously unconditional,
    // blocking touch-scroll of PDF pages in every mode, not just comment.
    overlay.style.touchAction = annotating ? "none" : "auto";
    return () => {
      overlay.removeEventListener("pointerdown", handlePointerDown);
      overlay.removeEventListener("pointermove", handlePointerMove);
      overlay.removeEventListener("pointerup", handlePointerUp);
      overlay.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [annotating, interactionMode, onActivate, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, pageNumber]);

  return (
    <div
      ref={overlayRef}
      className={cn(
        "absolute inset-0",
        interactionMode === "comment" ? "cursor-copy" : annotating ? "cursor-crosshair" : "cursor-default",
        active && "ring-1 ring-primary/35 ring-inset"
      )}
      onClick={() => onActivate(pageNumber)}
    >
      <canvas ref={committedCanvasRef} className="absolute inset-0 pointer-events-none" />
      <canvas ref={liveCanvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
}

export default function PdfAnnotatorWithAnnotations({
  pdfUrl,
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
}: PdfAnnotatorProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const currentPageRef = useRef(1);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [pageSizes, setPageSizes] = useState<Record<number, PdfPageSize>>({});
  const [pageAspectRatios, setPageAspectRatios] = useState<Record<number, number>>({});
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("browse");
  const [scrollMode, setScrollMode] = useState<PdfScrollMode>("vertical");
  const panelOpen = commentsPanelOpen ?? true;
  const canCompleteComments = !commentMutationContext?.share_token;

  // Edit/delete target the "comment" function by default (unchanged for
  // every existing caller). A share flow with its own isolated comment
  // function passes commentEndpoint to route here instead — that function
  // takes an action-based POST body rather than comment's PATCH-with-status.
  const editOrDeleteComment = useCallback(async (action: "edit" | "delete", fields: { id: string; body?: string }) => {
    if (commentEndpoint === "comment") {
      const patchBody: Record<string, unknown> = { id: fields.id, ...(commentMutationContext ?? {}) };
      if (action === "edit") patchBody.body = fields.body;
      else patchBody.status = "deleted";
      return invokeEdgeFunction("comment", { method: "PATCH", body: patchBody });
    }
    return invokeEdgeFunction(commentEndpoint, {
      method: "POST",
      body: { action, id: fields.id, body: fields.body, ...(commentMutationContext ?? {}) },
    });
  }, [commentEndpoint, commentMutationContext]);

  const [scrollMetrics, setScrollMetrics] = useState({
    progress: 0,
    thumbTopPercent: 0,
    thumbHeightPercent: 100,
    scrollable: false,
  });

  useEffect(() => {
    setLoadError(null);
    setNumPages(0);
    setCurrentPage(1);
    setActivePage(1);
    setPageSizes({});
    setPageAspectRatios({});
  }, [pdfUrl]);

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

  const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>(() => normalizeAnnotationList(annotationsProp));
  useEffect(() => {
    if (!annotationsProp) return;
    setAnnotations(mergeAnnotationOverrides(normalizeAnnotationList(annotationsProp), annotationOverrides));
  }, [annotationOverrides, annotationsProp]);

  const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotationOverrides((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
    setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const liveStrokes = useMemo<Stroke[]>(
    () => [...draftStrokes, ...(activeStroke ? [activeStroke] : [])],
    [activeStroke, draftStrokes]
  );
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
  const { resolveFocus, beginDrag, updateDrag, endDrag, draggingId } = useDraggablePin();
  const resolvedDraftAnchorFocus = draftAnchorFocus
    ? resolveFocus(DRAFT_PIN_ID, draftAnchorFocus)
    : null;
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  const [dockComposerText, setDockComposerText] = useState("");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  useEffect(() => {
    setAnnotating(interactionMode === "draw");
  }, [interactionMode, setAnnotating]);

  const closeInlineComposer = useCallback((clearDraft = false) => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    if (clearDraft) {
      clearStrokes();
    }
  }, [clearStrokes]);

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => !annotation.isDeleted),
    [annotations]
  );

  useEffect(() => {
    if (!selectedAnnotationId) return;
    if (!visibleAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, visibleAnnotations]);

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    for (const annotation of visibleAnnotations) {
      if (!hasPdfPageAnchor(annotation)) continue;
      const page = annotation.page ?? 1;
      const bucket = grouped.get(page) ?? [];
      bucket.push(annotation);
      grouped.set(page, bucket);
    }
    return grouped;
  }, [visibleAnnotations]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const updateWidth = () => setViewerWidth(viewer.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  const updateViewerState = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (numPages > 0) {
      const rootRect = viewer.getBoundingClientRect();
      const rootOffset = scrollMode === "horizontal" ? rootRect.left : rootRect.top;
      let bestPage = 1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let page = 1; page <= numPages; page += 1) {
        const node = pageRefs.current[page];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const pageOffset = scrollMode === "horizontal" ? rect.left : rect.top;
        const distance = Math.abs(pageOffset - rootOffset - 24);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = page;
        }
      }
      setCurrentPage(bestPage);
    }

    const scrollSize = scrollMode === "horizontal" ? viewer.scrollWidth : viewer.scrollHeight;
    const viewportSize = scrollMode === "horizontal" ? viewer.clientWidth : viewer.clientHeight;
    const scrollPosition = scrollMode === "horizontal" ? viewer.scrollLeft : viewer.scrollTop;
    const maxScroll = Math.max(0, scrollSize - viewportSize);
    const progress = maxScroll > 0 ? scrollPosition / maxScroll : 0;
    const thumbHeightPercent = scrollSize > 0
      ? Math.min(100, Math.max(12, (viewportSize / scrollSize) * 100))
      : 100;
    const thumbTopPercent = maxScroll > 0 ? progress * (100 - thumbHeightPercent) : 0;

    setScrollMetrics({
      progress,
      thumbTopPercent,
      thumbHeightPercent,
      scrollable: maxScroll > 0,
    });
  }, [numPages, scrollMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    updateViewerState();
    const observer = new ResizeObserver(updateViewerState);
    observer.observe(viewer);
    viewer.addEventListener("scroll", updateViewerState, { passive: true });
    window.addEventListener("resize", updateViewerState);
    return () => {
      observer.disconnect();
      viewer.removeEventListener("scroll", updateViewerState);
      window.removeEventListener("resize", updateViewerState);
    };
  }, [updateViewerState]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || scrollMode !== "horizontal") return;

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (viewer.scrollWidth <= viewer.clientWidth) return;
      if (viewer.scrollHeight > viewer.clientHeight) return;
      event.preventDefault();
      viewer.scrollLeft += event.deltaY;
    };

    viewer.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", handleWheel);
  }, [scrollMode]);

  // The native scrollbar is hidden on `viewerRef` (see its className below),
  // so the custom bar rendered further down is the only way to manually
  // scroll by clicking/dragging -- mutating scrollLeft/scrollTop directly
  // here is picked up by the existing scroll listener (updateViewerState),
  // which re-renders the thumb, so no extra state is needed for the drag.
  const handleScrollbarPointerDown = useCallback(
    (axis: "horizontal" | "vertical") => (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      event.preventDefault();
      const track = event.currentTarget;

      const applyFromClientPosition = (clientPos: number) => {
        const rect = track.getBoundingClientRect();
        const trackSize = axis === "horizontal" ? rect.width : rect.height;
        if (trackSize <= 0) return;
        const offset = axis === "horizontal" ? clientPos - rect.left : clientPos - rect.top;
        const fraction = Math.min(1, Math.max(0, offset / trackSize));
        const maxScroll = Math.max(
          0,
          axis === "horizontal" ? viewer.scrollWidth - viewer.clientWidth : viewer.scrollHeight - viewer.clientHeight,
        );
        if (axis === "horizontal") viewer.scrollLeft = fraction * maxScroll;
        else viewer.scrollTop = fraction * maxScroll;
      };

      applyFromClientPosition(axis === "horizontal" ? event.clientX : event.clientY);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        applyFromClientPosition(axis === "horizontal" ? moveEvent.clientX : moveEvent.clientY);
      };
      const handlePointerUp = () => window.removeEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [],
  );

  const zoomPct = Math.round(scale * 100);
  const baseRenderWidth = viewerWidth > 0 ? Math.max(100, Math.floor(viewerWidth - 32)) : undefined;
  const renderWidth = baseRenderWidth;
  const visualScale = scale;

  const zoomTo = useCallback((getNextScale: (current: number) => number) => {
    const viewer = viewerRef.current;
    const centerX = viewer ? (viewer.scrollLeft + viewer.clientWidth / 2) / Math.max(1, viewer.scrollWidth) : 0.5;
    const centerY = viewer ? (viewer.scrollTop + viewer.clientHeight / 2) / Math.max(1, viewer.scrollHeight) : 0.5;

    setScale((current) => {
      const next = clampZoom(getNextScale(current));
      window.requestAnimationFrame(() => {
        const latestViewer = viewerRef.current;
        if (!latestViewer) return;
        latestViewer.scrollLeft = centerX * latestViewer.scrollWidth - latestViewer.clientWidth / 2;
        latestViewer.scrollTop = centerY * latestViewer.scrollHeight - latestViewer.clientHeight / 2;
        updateViewerState();
      });
      return next;
    });
  }, [updateViewerState]);

  const zoomOut = useCallback(() => {
    zoomTo((value) => value / 1.25);
  }, [zoomTo]);
  const zoomIn = useCallback(() => {
    zoomTo((value) => value * 1.25);
  }, [zoomTo]);
  const setBrowseMode = useCallback(() => {
    closeInlineComposer(true);
    setInteractionMode("browse");
  }, [closeInlineComposer]);
  const setCommentMode = useCallback(() => {
    closeInlineComposer(true);
    clearStrokes();
    setInteractionMode("comment");
    setTool("pen");
  }, [clearStrokes, closeInlineComposer, setTool]);
  const setDrawTool = useCallback((nextTool: Stroke["tool"]) => {
    closeInlineComposer(true);
    setInteractionMode("draw");
    setTool(nextTool);
  }, [closeInlineComposer, setTool]);
  const annotationPinsByPage = useMemo(() => {
    const grouped = new Map<number, Array<{
      id: string;
      x: number;
      y: number;
      color: string;
      text: string;
      displayName: string | null;
      annotation: Annotation;
    }>>();
    visibleAnnotations.forEach((annotation) => {
      if (!hasPdfPageAnchor(annotation)) return;
      const focus = getAnnotationFocusPoint(annotation);
      if (!focus) return;
      const page = annotation.page ?? 1;
      const bucket = grouped.get(page) ?? [];
      const colorValue = annotation.drawing?.[0]?.color || "#ff7a00";
      bucket.push({
        id: annotation.id,
        x: focus.x,
        y: focus.y,
        color: colorValue,
        text: annotation.text,
        displayName: getPdfAnnotationAuthorName(annotation, profiles),
        annotation,
      });
      grouped.set(page, bucket);
    });
    return grouped;
  }, [profiles, visibleAnnotations]);

  const scrollToPage = useCallback((page: number) => {
    const node = pageRefs.current[page];
    if (!node) return;
    node.scrollIntoView({
      behavior: "smooth",
      block: scrollMode === "horizontal" ? "nearest" : "start",
      inline: scrollMode === "horizontal" ? "start" : "nearest",
    });
    setCurrentPage(page);
    setActivePage(page);
  }, [scrollMode]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollToPage(currentPageRef.current);
      updateViewerState();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollMode, scrollToPage, updateViewerState]);

  const handleDocumentLoad = useCallback((doc: PDFDocumentProxy) => {
    setNumPages(doc.numPages);
    setLoadError(null);
    setCurrentPage(1);
    setActivePage(1);
    setPageSizes({});
    setPageAspectRatios({});
    requestAnimationFrame(updateViewerState);

    // Auto-fit to view height on load
    doc.getPage(1).then((page) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const viewport = page.getViewport({ scale: 1 });
      const availableWidth = viewer.clientWidth - 48;
      const availableHeight = viewer.clientHeight - 48;

      if (availableWidth > 0 && availableHeight > 0 && viewport.width > 0 && viewport.height > 0) {
        const aspect = viewport.width / viewport.height;
        const renderedHeightAtScale1 = availableWidth / aspect;

        if (renderedHeightAtScale1 > availableHeight) {
          const idealScale = Math.max(0.1, (availableHeight / renderedHeightAtScale1) * 0.95);
          setScale(Number(idealScale.toFixed(2)));
        } else {
          setScale(1);
        }
      }
    }).catch(console.error);
  }, [updateViewerState]);

  const handlePageMeasured = useCallback((pageNumber: number, page: PdfPageSize) => {
    const width = Math.max(1, page.width);
    const height = Math.max(1, page.height);
    const aspectRatio = height / width;

    setPageSizes((current) => {
      const previous = current[pageNumber];
      if (previous && Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1) {
        return current;
      }
      return { ...current, [pageNumber]: { width, height } };
    });

    setPageAspectRatios((current) => {
      const previous = current[pageNumber];
      if (previous && Math.abs(previous - aspectRatio) < 0.001) {
        return current;
      }
      return { ...current, [pageNumber]: aspectRatio };
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateViewerState);
    return () => window.cancelAnimationFrame(frame);
  }, [pageSizes, scale, updateViewerState]);

  const handleCommentSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const user = await getLoggedInUserProfile();
      const drawing = [...liveStrokes];
      const anchoredPage = drawing.length > 0 ? activePage || currentPage || 1 : undefined;
      const payload: Annotation = {
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        time: Number.NaN,
        page: anchoredPage,
        text: trimmed,
        author: user?.full_name,
        authorId: user?.sub,
        isCompleted: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        emoji: {},
        drawing,
      };

      if (!onAddAnnotation) {
        setAnnotations((prev) => (prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]));
      }
      closeInlineComposer(true);
      setInteractionMode("browse");

      if (onAddAnnotation) {
        await onAddAnnotation(payload);
      }
      setDockComposerText("");
    } catch (error) {
      console.error("Failed to submit PDF comment", error);
    }
  }, [activePage, closeInlineComposer, currentPage, liveStrokes, onAddAnnotation]);

  const handleEditComment = useCallback(async (id: string, newText: string) => {
    const previous = annotations.find((item) => item.id === id);
    applyLocalAnnotationUpdate(id, { text: newText });
    const { error } = await editOrDeleteComment("edit", { id, body: newText });
    if (error) {
      if (previous) applyLocalAnnotationUpdate(id, { text: previous.text });
      console.error("Failed to edit PDF comment", error);
    }
  }, [annotations, applyLocalAnnotationUpdate, editOrDeleteComment]);

  const handleDeleteComment = useCallback(async (id: string) => {
    const previous = annotations.find((item) => item.id === id);
    applyLocalAnnotationUpdate(id, { isDeleted: true });
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
    const { error } = await editOrDeleteComment("delete", { id });
    if (error) {
      if (previous) {
        applyLocalAnnotationUpdate(id, { isDeleted: previous.isDeleted });
        setSelectedAnnotationId(id);
      }
      console.error("Failed to delete PDF comment", error);
    }
  }, [annotations, applyLocalAnnotationUpdate, editOrDeleteComment, selectedAnnotationId]);

  const handleToggleCompleted = useCallback(async (id: string) => {
    const annotation = annotations.find((item) => item.id === id);
    const nextCompleted = !annotation?.isCompleted;
    applyLocalAnnotationUpdate(id, { isCompleted: nextCompleted });
    const { error } = await invokeEdgeFunction("comment", {
      method: "PATCH",
      body: { id, status: nextCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) },
    });
    if (error) {
      applyLocalAnnotationUpdate(id, { isCompleted: annotation?.isCompleted });
      console.error("Failed to update PDF comment status", error);
    }
  }, [annotations, applyLocalAnnotationUpdate, commentMutationContext]);

  const filteredAnnotations = useMemo(() => visibleAnnotations, [visibleAnnotations]);

  return (
    <div className={cn("h-full w-full overflow-hidden", className)}>
      <div className="h-full overflow-hidden rounded-none border-0 bg-background">
        <div className="h-full overflow-hidden p-0">
          <div className="flex h-full min-h-0 w-full overflow-hidden flex-col lg:flex-row">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* Unified top mode bar */}
              <ReviewModeBar
                mode={interactionMode === "browse" ? "view" : interactionMode === "comment" ? "comment" : "draw"}
                onModeChange={(m) => {
                  if (m === "view") setBrowseMode();
                  else if (m === "comment") setCommentMode();
                  else if (m === "draw") setDrawTool(tool || "pen");
                }}
                tool={tool}
                onToolChange={(t) => setDrawTool(t)}
                color={color}
                onColorChange={setColor}
                hidePreview={true}
              />

              {/* Compact zoom + controls strip */}
              <div className="border-b bg-background/95 px-3 py-1.5 backdrop-blur">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="flex items-center gap-2 rounded-md border border-white/6 bg-muted/30 px-2 py-1">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{title ?? "PDF"}</span>
                    <span className="text-muted-foreground">Page {currentPage}/{Math.max(numPages, 1)}</span>
                  </div>

                  <div className="flex items-center gap-1 rounded-md border border-white/6 bg-muted/30 px-1 py-0.5">
                    <Button variant="ghost" size="sm" onClick={zoomOut} className="h-7 w-7 p-0">
                      <ZoomOut className="h-3.5 w-3.5" />
                    </Button>
                    <div className="w-10 text-center text-xs tabular-nums">{zoomPct}%</div>
                    <Button variant="ghost" size="sm" onClick={zoomIn} className="h-7 w-7 p-0">
                      <ZoomIn className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => zoomTo(() => 1)} className="h-7 px-1.5 text-xs">
                      <Maximize2 className="mr-1 h-3 w-3" />Fit
                    </Button>
                  </div>

                  <div className="flex items-center gap-1 rounded-md border border-white/6 bg-muted/30 px-1 py-0.5">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Vertical scroll"
                            onClick={() => setScrollMode("vertical")}
                            className={cn("h-7 w-7 p-0", scrollMode === "vertical" && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
                          >
                            <Rows3 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Vertical scroll</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Horizontal scroll"
                            onClick={() => setScrollMode("horizontal")}
                            className={cn("h-7 w-7 p-0", scrollMode === "horizontal" && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
                          >
                            <Columns3 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Horizontal scroll</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-md border border-white/6 bg-muted/30 px-2 py-1">
                    <Switch checked={showAnnotations} onCheckedChange={setShowAnnotations} />
                    <span className="text-muted-foreground">{showAnnotations ? "Hide" : "Show"}</span>
                  </div>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(event) => {
                          event.stopPropagation();
                          const storagePath = asset?.storage_path;
                          if (!storagePath) return;
                          void downloadFile(pdfUrl || resolveAssetDownloadUrl(asset), asset?.title || "document", { fallbackUrl: fallbackDownloadUrl });
                        }}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download PDF</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/20">
                <div
                  ref={viewerRef}
                  className="absolute inset-0 overflow-auto p-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  {loadError ? (
                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground">
                      {loadError}
                    </div>
                  ) : (
                    <Document
                      file={pdfUrl}
                      loading={<div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">Loading PDF…</div>}
                      onLoadSuccess={handleDocumentLoad}
                      onLoadError={(error) => {
                        console.error("Failed to load PDF", error);
                        if (onMediaError) {
                          onMediaError();
                          return;
                        }
                        setLoadError("Failed to load PDF preview.");
                      }}
                    >
                      <div
                        className={cn(
                          "mx-auto flex w-max min-w-full gap-4",
                          scrollMode === "horizontal"
                            ? "min-h-full flex-row items-start pb-6"
                            : "flex-col items-center"
                        )}
                      >
                        {Array.from({ length: numPages }, (_, index) => {
                          const pageNumber = index + 1;
                          const pageAnnotations = annotationsByPage.get(pageNumber) ?? [];
                          const pageStrokes = pageAnnotations.flatMap((annotation) => annotation.drawing ?? []);
                          const pagePins = annotationPinsByPage.get(pageNumber) ?? [];
                          const selectedPagePin = pagePins.find((pin) => pin.id === selectedAnnotationId);
                          const pageSize = pageSizes[pageNumber];
                          const pageAspectRatio = pageAspectRatios[pageNumber] ?? (pageSize ? pageSize.height / pageSize.width : undefined);
                          const pageRenderWidth = renderWidth ?? pageSize?.width ?? 100;
                          const pageRenderHeight = pageAspectRatio ? pageRenderWidth * pageAspectRatio : pageSize?.height;
                          const pageFrameStyle = pageRenderHeight
                            ? {
                              width: `${pageRenderWidth * visualScale}px`,
                              height: `${pageRenderHeight * visualScale}px`,
                            }
                            : { width: `${pageRenderWidth * visualScale}px` };
                          const pageScaleStyle = {
                            width: `${pageRenderWidth}px`,
                            transform: `scale(${visualScale})`,
                            transformOrigin: "top left",
                          };
                          return (
                            <div
                              key={pageNumber}
                              ref={(node) => {
                                pageRefs.current[pageNumber] = node;
                              }}
                              className="relative"
                              style={pageFrameStyle}
                            >
                              <div className="origin-top-left" style={pageScaleStyle}>
                                <div className="relative w-fit max-w-max overflow-hidden rounded-xl border bg-white shadow-sm">
                                  <Page
                                    pageNumber={pageNumber}
                                    width={pageRenderWidth}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                    onLoadSuccess={(page) => handlePageMeasured(pageNumber, page)}
                                    onRenderSuccess={(page) => handlePageMeasured(pageNumber, page)}
                                    loading={<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading page {pageNumber}…</div>}
                                  />
                                  <PdfPageOverlay
                                    pageNumber={pageNumber}
                                    active={pageNumber === activePage}
                                    interactionMode={interactionMode}
                                    committedStrokes={showAnnotations ? pageStrokes : []}
                                    liveStrokes={showAnnotations && pageNumber === activePage ? liveStrokes : []}
                                    showAnnotations={showAnnotations}
                                    onActivate={setActivePage}
                                    onPointerDown={(point) => {
                                      if (interactionMode === "comment") {
                                        setActivePage(pageNumber);
                                        addStroke(createAnchorStroke(point, color), true);
                                        return;
                                      }
                                      pointerDown(point);
                                    }}
                                    onPointerMove={pointerMove}
                                    onPointerUp={() => {
                                      if (interactionMode === "comment") {
                                        setInlineComposerText(dockComposerText);
                                        setInlineComposerOpen(true);
                                        return;
                                      }

                                      const hadActiveStroke = !!activeStroke;
                                      pointerUp();
                                      if (!hadActiveStroke) return;
                                      setInlineComposerText(dockComposerText);
                                      setInlineComposerOpen(true);
                                    }}
                                    onPointerCancel={pointerCancel}
                                  />
                                  {showAnnotations
                                    ? pagePins.map((pin) => {
                                      const pinFocus = resolveFocus(pin.id, pin);
                                      const isDragging = draggingId === pin.id;
                                      const pageWidthPx = pageRenderWidth * visualScale;
                                      const pageHeightPx = (pageRenderHeight ?? 0) * visualScale;
                                      return (
                                        <button
                                          key={pin.id}
                                          type="button"
                                          data-review-ui="true"
                                          title={pin.text ? `${convertMentionsForDisplay(pin.text)} (drag to move)` : "Drag to move this pin"}
                                          className={cn(
                                            "group absolute z-30 touch-none transition-transform",
                                            isDragging ? "cursor-grabbing" : "cursor-grab",
                                            selectedAnnotationId === pin.id ? "z-40" : "hover:z-40"
                                          )}
                                          style={getScaledPagePointStyle(pinFocus, visualScale, PDF_PIN_SIZE)}
                                          onPointerDown={(e) => beginDrag(pin.id, pin, e)}
                                          onPointerMove={(e) => updateDrag(e, pageWidthPx, pageHeightPx)}
                                          onPointerUp={(e) => {
                                            e.stopPropagation();
                                            const wasDrag = endDrag(e);
                                            if (!wasDrag) {
                                              setActivePage(pageNumber);
                                              setCurrentPage(pageNumber);
                                              setSelectedAnnotationId(pin.id);
                                            }
                                          }}
                                        >
                                          <BubblePin
                                            initials={pin.displayName ? getAvatarInitials(pin.displayName) : ""}
                                            userId={pin.annotation.authorId}
                                            userName={pin.displayName}
                                            className={pin.displayName ? undefined : "animate-pulse"}
                                            size={PDF_PIN_SIZE}
                                          />
                                          <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/40 bg-slate-900/90 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                            <Move className="h-2.5 w-2.5" />
                                          </span>
                                        </button>
                                      );
                                    })
                                    : null}
                                  {showAnnotations && interactionMode === "comment" && pageNumber === activePage && resolvedDraftAnchorFocus ? (
                                    <button
                                      type="button"
                                      data-review-ui="true"
                                      title="Drag to move this pin"
                                      className={cn(
                                        "group absolute flex h-7 w-7 touch-none items-center justify-center rounded-full border-2 border-[#0b1020] text-[11px] font-semibold text-white ring-4 ring-white/20 shadow-[0_6px_18px_rgba(0,0,0,0.3)]",
                                        draggingId === DRAFT_PIN_ID ? "cursor-grabbing" : "cursor-grab"
                                      )}
                                      style={{
                                        ...getScaledPagePointStyle(resolvedDraftAnchorFocus, visualScale, PDF_DRAFT_PIN_SIZE),
                                        backgroundColor: color,
                                      }}
                                      onPointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                                      onPointerMove={(e) => updateDrag(
                                        e,
                                        pageRenderWidth * visualScale,
                                        (pageRenderHeight ?? 0) * visualScale
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
                                  {showAnnotations && selectedPagePin ? (
                                    <div
                                      className="absolute z-50"
                                      data-review-ui="true"
                                      style={getScaledCommentPopoverStyle(
                                        resolveFocus(selectedPagePin.id, selectedPagePin),
                                        visualScale,
                                        pageRenderWidth * visualScale
                                      )}
                                    >
                                      <CommentPopover
                                        author={selectedPagePin.displayName ?? "User"}
                                        authorId={selectedPagePin.annotation.authorId}
                                        text={selectedPagePin.annotation.text || ""}
                                        createdAt={selectedPagePin.annotation.createdAt}
                                        isCompleted={selectedPagePin.annotation.isCompleted}
                                        onClose={() => setSelectedAnnotationId(null)}
                                        onDelete={!commentMutationContext?.share_token || selectedPagePin.annotation.canManageComment ? () => void handleDeleteComment(selectedPagePin.id) : undefined}
                                        onComplete={canCompleteComments ? () => void handleToggleCompleted(selectedPagePin.id) : undefined}
                                        className="max-h-[320px] overflow-y-auto"
                                        isDragging={draggingId === selectedPagePin.id}
                                        onDragHandlePointerDown={(e) => beginDrag(selectedPagePin.id, selectedPagePin, e)}
                                        onDragHandlePointerMove={(e) => updateDrag(
                                          e,
                                          pageRenderWidth * visualScale,
                                          (pageRenderHeight ?? 0) * visualScale
                                        )}
                                        onDragHandlePointerUp={(e) => endDrag(e)}
                                      />
                                    </div>
                                  ) : null}
                                  {inlineComposerOpen && pageNumber === activePage && resolvedDraftAnchorFocus ? (
                                    <div
                                      className="absolute z-50 max-w-[calc(100%-24px)]"
                                      style={getScaledInlineComposerStyle(
                                        resolvedDraftAnchorFocus,
                                        visualScale,
                                        pageRenderWidth * visualScale
                                      )}
                                    >
                                      <InlineNoteComposer
                                        value={inlineComposerText}
                                        onChange={(value) => {
                                          setInlineComposerText(value);
                                          setDockComposerText(value);
                                        }}
                                        color={color}
                                        label={interactionMode === "comment" ? "Add note here" : "Describe your annotation"}
                                        hint={interactionMode === "comment" ? "Pin stays attached to this page" : "Ctrl+Enter to submit"}
                                        projectId={projectId}
                                        organizationId={organizationId}
                                        workspaceId={workspaceId}
                                        assetId={assetId}
                                        onCancel={() => closeInlineComposer(true)}
                                        onSubmit={() => void handleCommentSubmit(inlineComposerText)}
                                        isDragging={draggingId === DRAFT_PIN_ID}
                                        onDragHandlePointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                                        onDragHandlePointerMove={(e) => updateDrag(
                                          e,
                                          pageRenderWidth * visualScale,
                                          (pageRenderHeight ?? 0) * visualScale
                                        )}
                                        onDragHandlePointerUp={(e) => endDrag(e)}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                                    Page {pageNumber}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Document>
                  )}
                </div>

                {scrollMetrics.scrollable ? (
                  <>
                    <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-white/10 bg-[#101629]/92 px-2 py-1 text-[10px] font-medium text-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.28)] z-10">
                      {Math.round(scrollMetrics.progress * 100)}%
                    </div>
                    {scrollMode === "horizontal" ? (
                      <div
                        className="pointer-events-auto absolute bottom-5 left-4 right-16 flex h-3 cursor-pointer items-center z-10"
                        onPointerDown={handleScrollbarPointerDown("horizontal")}
                      >
                        <div className="relative h-full w-full rounded-full border border-white/8 bg-[#101629]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                          <div
                            className="absolute bottom-[2px] top-[2px] rounded-full bg-gradient-to-r from-sky-300 via-cyan-400 to-sky-500 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                            style={{
                              left: `${scrollMetrics.thumbTopPercent}%`,
                              width: `${scrollMetrics.thumbHeightPercent}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div
                        className="pointer-events-auto absolute right-2 top-4 bottom-14 flex w-3 cursor-pointer items-center z-10"
                        onPointerDown={handleScrollbarPointerDown("vertical")}
                      >
                        <div className="relative h-full w-full rounded-full border border-white/8 bg-[#101629]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                          <div
                            className="absolute left-[2px] right-[2px] rounded-full bg-gradient-to-b from-sky-300 via-cyan-400 to-sky-500 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                            style={{
                              top: `${scrollMetrics.thumbTopPercent}%`,
                              height: `${scrollMetrics.thumbHeightPercent}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            {panelOpen ? (
              <div className="flex min-h-0 w-full flex-col overflow-hidden lg:w-[400px] lg:flex-none">
                <div className="h-full min-h-0">
                  <CommentsPanel
                    className="lg:w-full lg:min-w-0 lg:max-w-none"
                    items={filteredAnnotations.map((annotation) => ({
                      id: annotation.id,
                      author: getPdfAnnotationAuthorName(annotation, profiles) ?? "User",
                      authorId: annotation.authorId,
                      text: annotation.text,
                      page: hasPdfPageAnchor(annotation) ? annotation.page : undefined,
                      emoji: annotation.emoji,
                      hasDrawing: !!(annotation.drawing && annotation.drawing.length > 0),
                      isCompleted: annotation.isCompleted,
                      isDeleted: annotation.isDeleted,
                      canManageComment: annotation.canManageComment,
                      canDeleteComment: annotation.canDeleteComment,
                      createdAt: annotation.createdAt,
                    }))}
                    onItemClick={(id) => {
                      const annotation = annotations.find((item) => item.id === id);
                      setSelectedAnnotationId(id);
                      if (!annotation?.page || !hasPdfPageAnchor(annotation)) return;
                      scrollToPage(annotation.page);
                    }}
                    showCommentDock={true}
                    includeTimestamp={false}
                    annotating={interactionMode !== "browse"}
                    onToggleAnnotating={() => setInteractionMode((mode) => (mode === "browse" ? "draw" : "browse"))}
                    reviewMode={interactionMode === "browse" ? "view" : interactionMode}
                    onReviewModeChange={(mode) => {
                      if (mode === "view") setBrowseMode();
                      else if (mode === "comment") setCommentMode();
                      else setDrawTool(tool || "pen");
                    }}
                    tool={tool}
                    onToolChange={setTool}
                    color={color}
                    onColorChange={setColor}
                    canUndo={!!draftStrokes.length || !!activeStroke}
                    onUndo={undoStroke}
                    onClear={clearStrokes}
                    onCommentSubmit={handleCommentSubmit}
                    commentValue={dockComposerText}
                    onCommentChange={setDockComposerText}
                    onEditComment={handleEditComment}
                    onDeleteComment={handleDeleteComment}
                    onToggleCompleted={canCompleteComments ? handleToggleCompleted : undefined}
                    projectId={projectId}
                    organizationId={organizationId}
                    workspaceId={workspaceId}
                    assetId={assetId}
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
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Maximize2, Minus, Plus, Move } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, downloadFile } from "@/lib/utils";
import { resolveAssetDownloadUrl } from "@/lib/mediaDelivery";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { getAvatarInitials } from "@/lib/avatar-utils";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";

import CommentsPanel from "./CommentsPanel";
import { BubblePin } from "./shared/PinMarker";
import { CommentPopover } from "./shared/CommentPopover";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { ReviewModeBar } from "./shared/ReviewModeBar";
import type { Annotation, Stroke } from "./annotator-utils";
import { drawStrokes, getAnnotationFocusPoint, getDrawingBounds, normalizeAnnotationList, mergeAnnotationOverrides } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import { useDraggablePin } from "./shared/useDraggablePin";

const DRAFT_PIN_ID = "__draft-anchor__";
const OVERLAY_MARGIN_PX = 12;
const INLINE_COMPOSER_WIDTH_PX = 280;
const INLINE_COMPOSER_ESTIMATED_HEIGHT_PX = 190;
const COMMENT_POPOVER_WIDTH_PX = 280;
const COMMENT_POPOVER_ESTIMATED_HEIGHT_PX = 260;

// Percentage-anchored overlay clamped on all four sides via pure CSS
// min()/max()/calc() -- this viewer resizes its page frame by width%
// instead of a CSS transform, so (unlike image.tsx/pdf.tsx) no zoom-scale
// compensation is needed on the offsets. Only left/min(right) and
// max(top) were clamped before; a pin or draft anchor near the left edge
// or the bottom of the page could still push the composer/popover past
// the unclamped side and get visually cut off.
function getClampedOverlayStyle(
  anchor: { x: number; y: number },
  xOffsetPx: number,
  yOffsetPx: number,
  width: number,
  estimatedHeight: number
) {
  return {
    left: `min(max(calc(${anchor.x * 100}% + ${xOffsetPx}px), ${OVERLAY_MARGIN_PX}px), calc(100% - ${width + OVERLAY_MARGIN_PX}px))`,
    top: `min(max(calc(${anchor.y * 100}% + ${yOffsetPx}px), ${OVERLAY_MARGIN_PX}px), calc(100% - ${estimatedHeight + OVERLAY_MARGIN_PX}px))`,
  };
}

export type WebScreenshotReviewProps = {
  imageUrl?: string;
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
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

function getHostLabel(title?: string) {
  if (!title) return "Website review";
  if (title.startsWith("Screenshot:")) return title.replace(/^Screenshot:\s*/i, "");
  return title;
}

function eventToNormalized(e: PointerEvent, overlay: HTMLElement) {
  const rect = overlay.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1))),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(rect.height, 1))),
  };
}

type InteractionMode = "pan" | "comment" | "draw" | "zoom";

type SectionJump = {
  id: string;
  label: string;
  start: number;
  end: number;
  jump: number;
};

const DEFAULT_ANNOTATION_COLOR = "#35c8d6";
function createAnchorStroke(point: { x: number; y: number }, strokeColor: string): Stroke {
  return {
    tool: "pen",
    color: strokeColor,
    points: [point],
  };
}

function getAnnotationAccentColor(annotation: Annotation) {
  return annotation.drawing?.find((stroke) => stroke.color)?.color ?? DEFAULT_ANNOTATION_COLOR;
}

function isAnchorOnlyAnnotation(
  annotation: Annotation,
  bounds?: { minX: number; minY: number; maxX: number; maxY: number } | null
) {
  const strokes = annotation.drawing ?? [];
  if (strokes.length === 0 || !bounds) return false;

  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;
  const isTinyMark = boundsWidth <= 0.012 && boundsHeight <= 0.02;

  const hasOnlyPointLikeStrokes = strokes.every((stroke) => {
    if (stroke.tool === "pen") return stroke.points.length <= 1;
    if (stroke.tool === "line") return stroke.points.length <= 2;
    return false;
  });

  return hasOnlyPointLikeStrokes && isTinyMark;
}

function shouldShowBoundsHighlight(annotation: Annotation) {
  const strokes = annotation.drawing ?? [];
  if (strokes.length === 0) return false;
  return strokes.some((stroke) => stroke.tool === "rect");
}

export default function WebScreenshotReview({
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
  onCommentsPanelOpenChange,
  commentMutationContext,
  commentEndpoint = "comment",
  onMediaError,
  fallbackDownloadUrl,
  profiles = {},
}: WebScreenshotReviewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Holds only the fields the user has locally changed (delete/complete/
  // edit), keyed by annotation id, re-applied on every sync below -- see
  // mergeAnnotationOverrides for why: without it, deleting a comment and
  // then adding another one (or anything else that refreshes
  // annotationsProp) before the delete's own server round-trip/realtime
  // echo lands would silently resurrect it, since the next prop sync still
  // carries the pre-delete shape.
  const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>(annotationsProp ?? []);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pan");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [commentsCollapsed, setCommentsCollapsed] = useState(true);
  const commentsOpen = commentsPanelOpen ?? !commentsCollapsed;
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
  const setCommentsOpen = useCallback((open: boolean) => {
    if (onCommentsPanelOpenChange) {
      onCommentsPanelOpenChange(open);
      return;
    }
    setCommentsCollapsed(!open);
  }, [onCommentsPanelOpenChange]);
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  const [dockComposerText, setDockComposerText] = useState("");
  const [pageMetrics, setPageMetrics] = useState({
    naturalWidth: 0,
    naturalHeight: 0,
    renderedWidth: 0,
    renderedHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const pendingFocusRef = useRef<{ x: number; y: number; behavior: ScrollBehavior } | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const commentAnchorRef = useRef<{ x: number; y: number } | null>(null);

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
  } = useDrawing("#ff7a00", "arrow");

  const isCommentMode = interactionMode === "comment";
  const isDrawMode = interactionMode === "draw";
  const isPanMode = interactionMode === "pan";
  const isZoomMode = interactionMode === "zoom";

  useEffect(() => {
    if (!annotationsProp) return;
    setAnnotations(mergeAnnotationOverrides(normalizeAnnotationList(annotationsProp), annotationOverrides));
  }, [annotationsProp, annotationOverrides]);

  const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotationOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const committedStrokes = useMemo<Stroke[]>(
    () => annotations.flatMap((annotation) => annotation.drawing ?? []),
    [annotations]
  );

  const liveStrokes = useMemo<Stroke[]>(
    () => [...draftStrokes, ...(activeStroke ? [activeStroke] : [])],
    [draftStrokes, activeStroke]
  );

  const syncPageMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;

    setPageMetrics({
      naturalWidth: image.naturalWidth || 0,
      naturalHeight: image.naturalHeight || 0,
      renderedWidth: image.clientWidth || 0,
      renderedHeight: image.clientHeight || 0,
      viewportWidth: viewport.clientWidth || 0,
      viewportHeight: viewport.clientHeight || 0,
      scrollLeft: viewport.scrollLeft || 0,
      scrollTop: viewport.scrollTop || 0,
    });
  }, []);

  const redrawCanvas = useCallback((
    canvas: HTMLCanvasElement | null,
    strokes: Stroke[],
    shouldRender: boolean
  ) => {
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const width = overlay.clientWidth || 1;
    const height = overlay.clientHeight || 1;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!shouldRender || strokes.length === 0) return;
    ctx.lineWidth = 4;
    drawStrokes(
      ctx,
      strokes,
      width,
      height,
      pageMetrics.naturalWidth || undefined,
      pageMetrics.naturalHeight || undefined
    );
  }, [pageMetrics.naturalHeight, pageMetrics.naturalWidth]);

  useEffect(() => {
    redrawCanvas(committedCanvasRef.current, committedStrokes, showAnnotations);
  }, [committedStrokes, redrawCanvas, showAnnotations, pageMetrics.renderedHeight, pageMetrics.renderedWidth]);

  useEffect(() => {
    redrawCanvas(liveCanvasRef.current, liveStrokes, showAnnotations);
  }, [liveStrokes, redrawCanvas, showAnnotations, pageMetrics.renderedHeight, pageMetrics.renderedWidth]);

  useEffect(() => {
    syncPageMetrics();
    const page = pageRef.current;
    const viewport = viewportRef.current;
    if (!page || !viewport) return;

    const observer = new ResizeObserver(() => syncPageMetrics());
    observer.observe(page);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncPageMetrics]);

  const handleImageLoad = useCallback(() => {
    syncPageMetrics();
  }, [syncPageMetrics]);

  useEffect(() => {
    setAnnotating(isDrawMode);
  }, [isDrawMode, setAnnotating]);

  const showTransientFeedback = useCallback(() => {}, []);

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setPageMetrics((prev) => ({
      ...prev,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
    }));
  }, []);

  const scrollToNormalizedPoint = useCallback((point: { x: number; y: number }, behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    if (!viewport || !pageMetrics.renderedHeight || !pageMetrics.renderedWidth) return;
    const targetTop = point.y * pageMetrics.renderedHeight - viewport.clientHeight * 0.35;
    const maxScrollTop = Math.max(0, pageMetrics.renderedHeight - viewport.clientHeight);
    const targetLeft = point.x * pageMetrics.renderedWidth - viewport.clientWidth * 0.5;
    const maxScrollLeft = Math.max(0, pageMetrics.renderedWidth - viewport.clientWidth);
    viewport.scrollTo({
      left: Math.max(0, Math.min(maxScrollLeft, targetLeft)),
      top: Math.max(0, Math.min(maxScrollTop, targetTop)),
      behavior,
    });
  }, [pageMetrics.renderedHeight, pageMetrics.renderedWidth]);

  const handleCommentFocus = useCallback((id: string) => {
    setSelectedAnnotationId(id);
    const annotation = annotations.find((item) => item.id === id);
    if (!annotation) return;
    const focus = getAnnotationFocusPoint(
      annotation,
      pageMetrics.naturalWidth || undefined,
      pageMetrics.naturalHeight || undefined
    );
    if (!focus) return;
    scrollToNormalizedPoint(focus);
  }, [annotations, pageMetrics.naturalHeight, pageMetrics.naturalWidth, scrollToNormalizedPoint]);

  const handleMinimapJump = useCallback((clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(rect.height, 1)));
    scrollToNormalizedPoint({ x: 0.5, y });
  }, [scrollToNormalizedPoint]);

  const clampZoom = useCallback((value: number) => Math.max(0.75, Math.min(4, Number(value.toFixed(2)))), []);

  const scheduleZoomFocus = useCallback((nextZoom: number, point?: { x: number; y: number }, behavior: ScrollBehavior = "auto") => {
    const fallbackPoint = pageMetrics.renderedWidth && pageMetrics.renderedHeight
      ? {
          x: (pageMetrics.scrollLeft + pageMetrics.viewportWidth / 2) / Math.max(pageMetrics.renderedWidth, 1),
          y: (pageMetrics.scrollTop + pageMetrics.viewportHeight / 2) / Math.max(pageMetrics.renderedHeight, 1),
        }
      : { x: 0.5, y: 0.1 };

    pendingFocusRef.current = {
      x: Math.max(0, Math.min(1, point?.x ?? fallbackPoint.x)),
      y: Math.max(0, Math.min(1, point?.y ?? fallbackPoint.y)),
      behavior,
    };
    setZoomLevel(clampZoom(nextZoom));
  }, [
    clampZoom,
    pageMetrics.renderedHeight,
    pageMetrics.renderedWidth,
    pageMetrics.scrollLeft,
    pageMetrics.scrollTop,
    pageMetrics.viewportHeight,
    pageMetrics.viewportWidth,
  ]);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus || !viewportRef.current || !pageMetrics.renderedWidth || !pageMetrics.renderedHeight) return;
    scrollToNormalizedPoint({ x: pendingFocus.x, y: pendingFocus.y }, pendingFocus.behavior);
    pendingFocusRef.current = null;
  }, [pageMetrics.renderedHeight, pageMetrics.renderedWidth, scrollToNormalizedPoint, zoomLevel]);

  const visibleAnnotations = useMemo(() => {
    return annotations
      .filter((annotation) => !annotation.isDeleted)
      .slice()
      .sort((left, right) => {
        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return leftTime - rightTime;
      });
  }, [annotations]);

  const hostLabel = useMemo(() => getHostLabel(title || asset?.title), [asset?.title, title]);
  const annotationCount = visibleAnnotations.length;
  const minimapViewportTop = pageMetrics.renderedHeight
    ? (pageMetrics.scrollTop / pageMetrics.renderedHeight) * 100
    : 0;
  const minimapViewportHeight = pageMetrics.renderedHeight
    ? Math.min(100, (pageMetrics.viewportHeight / pageMetrics.renderedHeight) * 100)
    : 0;
  const pageScrollPct = Math.round(
    (pageMetrics.scrollTop / Math.max(pageMetrics.renderedHeight - pageMetrics.viewportHeight, 1)) * 100
  ) || 0;

  const sections = useMemo<SectionJump[]>(() => {
    return [
      { id: "start", label: "Start", start: 0, end: 15, jump: 0.02 },
      { id: "q1", label: "25%", start: 15, end: 38, jump: 0.25 },
      { id: "mid", label: "50%", start: 38, end: 62, jump: 0.5 },
      { id: "q3", label: "75%", start: 62, end: 86, jump: 0.75 },
      { id: "end", label: "End", start: 86, end: 100, jump: 0.96 },
    ];
  }, []);

  const activeSection = useMemo(
    () => sections.find((section) => pageScrollPct >= section.start && pageScrollPct < section.end) ?? sections[sections.length - 1],
    [pageScrollPct, sections]
  );

  const annotationTargets = useMemo(() => {
    return visibleAnnotations
      .map((annotation, index) => {
        const focus = getAnnotationFocusPoint(
          annotation,
          pageMetrics.naturalWidth || undefined,
          pageMetrics.naturalHeight || undefined
        );
        const bounds = getDrawingBounds(
          annotation.drawing ?? [],
          pageMetrics.naturalWidth || undefined,
          pageMetrics.naturalHeight || undefined
        );
        return {
          annotation,
          accentColor: getAnnotationAccentColor(annotation),
          index,
          focus,
          bounds,
        };
      })
      .filter((entry) => entry.focus);
  }, [pageMetrics.naturalHeight, pageMetrics.naturalWidth, visibleAnnotations]);
  const selectedTarget = annotationTargets.find((entry) => entry.annotation.id === selectedAnnotationId) ?? null;
  const selectedTargetIsAnchorOnly = selectedTarget
    ? isAnchorOnlyAnnotation(selectedTarget.annotation, selectedTarget.bounds)
    : false;
  const selectedTargetShowsBounds = selectedTarget
    ? shouldShowBoundsHighlight(selectedTarget.annotation)
    : false;
  const selectedAnnotationNumber = selectedTarget ? selectedTarget.index + 1 : null;
  const draftAnchorBounds = useMemo(
    () => getDrawingBounds(draftStrokes, pageMetrics.naturalWidth || undefined, pageMetrics.naturalHeight || undefined),
    [draftStrokes, pageMetrics.naturalHeight, pageMetrics.naturalWidth]
  );
  const draftAnchorFocus = draftAnchorBounds
    ? { x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2, y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2 }
    : null;
  const { resolveFocus, beginDrag, updateDrag, endDrag, draggingId } = useDraggablePin();
  const resolvedDraftAnchorFocus = draftAnchorFocus ? resolveFocus(DRAFT_PIN_ID, draftAnchorFocus) : null;

  const hoverIndicatorLabel = isCommentMode ? "+ Comment" : isZoomMode ? "Click to zoom" : null;
  const pageScalePercent = Math.round(zoomLevel * 100);
  const overlayCursor = isPanMode
    ? dragStateRef.current ? "cursor-grabbing" : "cursor-grab"
    : isZoomMode
      ? "cursor-zoom-in"
      : isCommentMode
        ? "cursor-copy"
        : "cursor-crosshair";
  const activateMode = useCallback((nextMode: InteractionMode) => {
    setInteractionMode(nextMode);
  }, []);

  const closeInlineComposer = useCallback((clearDraft = false) => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    if (clearDraft) {
      clearStrokes();
    }
  }, [clearStrokes]);

  const handleShowAnnotationsChange = useCallback((next: boolean) => {
    setShowAnnotations(next);
    if (!next) {
      setSelectedAnnotationId(null);
      setHoveredAnnotationId(null);
      closeInlineComposer(true);
      setInteractionMode("pan");
    }
  }, [closeInlineComposer]);

  const submitAnnotation = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const user = await getLoggedInUserProfile();
      const payload: Annotation = {
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        time: Number.NaN,
        text: trimmed,
        author: user?.full_name,
        authorId: user?.sub,
        isCompleted: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        emoji: {},
        drawing: [...liveStrokes],
      };

      if (!onAddAnnotation) {
        setAnnotations((prev) => {
          if (prev.some((annotation) => annotation.id === payload.id)) return prev;
          return [...prev, payload];
        });
        setSelectedAnnotationId(payload.id);
      }
      setInteractionMode("pan");
      closeInlineComposer(true);
      showTransientFeedback(payload.drawing?.length ? "Comment added to page" : "Note added");

      if (onAddAnnotation) {
        await onAddAnnotation(payload);
      }
      setDockComposerText("");
    } catch (error) {
      console.error("Failed to submit screenshot comment:", error);
    }
  }, [closeInlineComposer, liveStrokes, onAddAnnotation, showTransientFeedback]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dragStateRef.current = null;
      setHoverPoint(null);
      setInteractionMode("pan");
      setAnnotating(false);
      closeInlineComposer(true);
      showTransientFeedback("Returned to pan mode");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeInlineComposer, setAnnotating, showTransientFeedback]);

  return (
    <div className={cn("h-full w-full bg-background", className)}>
      <div className="h-full rounded-none border-0 bg-background">
        <div className="h-full p-0">
          <div className="flex h-full min-h-0 w-full flex-col lg:flex-row">
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#070b17]">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <ReviewModeBar
                  mode={isPanMode ? "view" : isCommentMode ? "comment" : isDrawMode ? "draw" : "view"}
                  onModeChange={(m) => {
                    closeInlineComposer(true);
                    if (m === "view") activateMode("pan");
                    else if (m === "comment") {
                      setShowAnnotations(true);
                      activateMode("comment");
                    } else if (m === "draw") {
                      setShowAnnotations(true);
                      activateMode("draw");
                    }
                  }}
                  tool={tool}
                  onToolChange={setTool}
                  color={color}
                  onColorChange={setColor}
                />

                <div className="px-1 pt-1.5 sm:px-2">
                  <div className="mx-auto flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-white/8 bg-[#0f1422] px-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    <div className="mr-1.5 flex shrink-0 items-center gap-2 px-1">
                      <span className="text-sm font-semibold text-foreground">{hostLabel}</span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="text-[11px] text-muted-foreground">{annotationCount} notes</span>
                      {selectedAnnotationNumber ? <span className="text-[11px] text-muted-foreground">#{selectedAnnotationNumber}</span> : null}
                    </div>

                    <span className="mx-0.5 h-5 w-px shrink-0 bg-white/8" />

                    <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-lg px-3 text-xs" onClick={() => scheduleZoomFocus(1, undefined, "smooth")}>
                      <Maximize2 className="mr-2 h-4 w-4" />
                      Fit
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={() => scheduleZoomFocus(zoomLevel - 0.25, undefined, "smooth")}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <div className="flex min-w-[2.5rem] shrink-0 items-center justify-center text-xs font-semibold text-foreground">{pageScalePercent}%</div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={() => scheduleZoomFocus(zoomLevel + 0.25, undefined, "smooth")}>
                      <Plus className="h-4 w-4" />
                    </Button>

                    <span className="mx-1 h-5 w-px shrink-0 bg-white/8" />

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 shrink-0 rounded-lg px-3 text-xs" onClick={() => handleShowAnnotationsChange(!showAnnotations)}>
                            {showAnnotations ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                            <span className="hidden sm:inline">{showAnnotations ? "Hide annotations" : "Show annotations"}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{showAnnotations ? "Hide annotations" : "Show annotations"}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <Button variant="ghost" size="sm" className="h-8 shrink-0 rounded-lg px-3 text-xs" onClick={() => {
                      const storagePath = asset?.storage_path;
                      if (!storagePath) return;
                      void downloadFile(imageUrl || resolveAssetDownloadUrl(asset), asset?.title || "screenshot", { fallbackUrl: fallbackDownloadUrl });
                    }}>
                      <Download className="mr-2 h-4 w-4" />
                      <span className="hidden sm:inline">Download</span>
                    </Button>

                    {commentsPanelOpen == null ? (
                      <Button variant="ghost" size="sm" className="hidden h-8 shrink-0 rounded-lg px-3 text-xs lg:inline-flex" onClick={() => setCommentsOpen(!commentsOpen)}>
                        {commentsOpen ? <ChevronRight className="mr-2 h-4 w-4" /> : <ChevronLeft className="mr-2 h-4 w-4" />}
                        <span>{commentsOpen ? "Hide comments" : "Show comments"}</span>
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="relative flex min-h-0 flex-1 p-1">
                  <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[18px] border border-white/6 bg-[#0b0f1a]">
                    <div className="relative flex min-h-0 min-w-0 flex-1">
                      <div className="pointer-events-none absolute inset-y-[62px] right-1.5 z-20 hidden md:flex items-center">
                        <button
                          type="button"
                          className="pointer-events-auto relative h-[calc(100%-28px)] w-4 rounded-full border border-white/8 bg-[#0f1422]/92"
                          onClick={(event) => handleMinimapJump(event.clientY, event.currentTarget)}
                        >
                          <span className="absolute inset-x-[5px] top-3 bottom-3 rounded-full bg-white/10" />
                          {sections.map((section) => (
                            <span
                              key={`rail-${section.id}`}
                              className={cn(
                                "pointer-events-none absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white/35",
                                activeSection?.id === section.id && "bg-white"
                              )}
                              style={{ top: `${Math.max(6, Math.min(94, section.jump * 100))}%` }}
                            />
                          ))}
                          <span
                            className="pointer-events-none absolute left-1/2 w-3 -translate-x-1/2 rounded-full bg-white"
                            style={{
                              top: `calc(${Math.max(0, Math.min(100 - minimapViewportHeight, minimapViewportTop))}% - 1px)`,
                              height: `${Math.max(minimapViewportHeight, 8)}%`,
                            }}
                          />
                        </button>
                      </div>

                      <div
                        ref={viewportRef}
                        className="relative min-h-0 flex-1 overflow-auto px-0.5 py-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:px-1 sm:py-1"
                        onScroll={handleViewportScroll}
                      >
                        <div
                          ref={pageRef}
                          className="relative mx-auto overflow-hidden rounded-[14px] border border-white/8 bg-card transition-[width,max-width] duration-200"
                          style={{
                            width: `${Math.max(zoomLevel * 100, 75)}%`,
                            maxWidth: "none",
                          }}
                        >
                          <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-black/10 bg-[#161d2e]/98 px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-red-400/70" />
                              <span className="h-2 w-2 rounded-full bg-amber-400/70" />
                              <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
                            </div>
                            <div className="min-w-0 flex-1 rounded-md border border-white/6 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                              <span className="block truncate">{hostLabel}</span>
                            </div>
                            <div className="hidden rounded-md border border-white/6 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex">
                              Full-page capture
                            </div>
                          </div>

                          <div className="relative bg-white">
                            <img
                              ref={imageRef}
                              src={imageUrl}
                              alt={title ?? "Website screenshot"}
                              className="block h-auto w-full select-none"
                              draggable={false}
                              onLoad={handleImageLoad}
                              onError={onMediaError}
                            />

                            {showAnnotations && selectedTarget?.focus && selectedTargetIsAnchorOnly ? (
                              <div
                                className="pointer-events-none absolute z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                                style={{
                                  borderColor: `${selectedTarget.accentColor}bf`,
                                  backgroundColor: `${selectedTarget.accentColor}14`,
                                  boxShadow: `0 0 0 6px ${selectedTarget.accentColor}14`,
                                  left: `${selectedTarget.focus.x * 100}%`,
                                  top: `${selectedTarget.focus.y * 100}%`,
                                }}
                              />
                            ) : null}

                            {showAnnotations && selectedTarget?.bounds && !selectedTargetIsAnchorOnly && selectedTargetShowsBounds ? (
                              <div
                                className="pointer-events-none absolute rounded-[18px] border shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                                style={{
                                  borderColor: `${selectedTarget.accentColor}99`,
                                  backgroundColor: `${selectedTarget.accentColor}18`,
                                  left: `${selectedTarget.bounds.minX * 100}%`,
                                  top: `${selectedTarget.bounds.minY * 100}%`,
                                  width: `${Math.max((selectedTarget.bounds.maxX - selectedTarget.bounds.minX) * 100, 2)}%`,
                                  height: `${Math.max((selectedTarget.bounds.maxY - selectedTarget.bounds.minY) * 100, 2)}%`,
                                }}
                              />
                            ) : null}

                            {showAnnotations && annotationTargets.map((entry) => {
                              if (!entry.focus) return null;
                              const focus = entry.focus;
                              const isSelected = entry.annotation.id === selectedAnnotationId;
                              const isHovered = entry.annotation.id === hoveredAnnotationId;
                              const isDragging = draggingId === entry.annotation.id;
                              const resolved = resolveFocus(entry.annotation.id, focus);
                              return (
                                <button
                                  key={entry.annotation.id}
                                  type="button"
                                  title="Drag to move this pin"
                                  className={cn(
                                    "group absolute z-20 -translate-x-1/2 -translate-y-1/2 touch-none transition",
                                    isDragging ? "cursor-grabbing" : "cursor-grab hover:-translate-y-[55%]",
                                    (isSelected || isHovered) ? "z-30" : ""
                                  )}
                                  style={{
                                    left: `${resolved.x * 100}%`,
                                    top: `${resolved.y * 100}%`,
                                  }}
                                  onPointerDown={(e) => beginDrag(entry.annotation.id, focus, e)}
                                  onPointerMove={(e) => updateDrag(e, pageMetrics.renderedWidth, pageMetrics.renderedHeight)}
                                  onPointerUp={(e) => {
                                    e.stopPropagation();
                                    const wasDrag = endDrag(e);
                                    if (!wasDrag) handleCommentFocus(entry.annotation.id);
                                  }}
                                  onMouseEnter={() => setHoveredAnnotationId(entry.annotation.id)}
                                  onMouseLeave={() => setHoveredAnnotationId((current) => current === entry.annotation.id ? null : current)}
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
                              );
                            })}

                            {showAnnotations && isCommentMode && resolvedDraftAnchorFocus ? (
                              <button
                                type="button"
                                title="Drag to move this pin"
                                className={cn(
                                  "group absolute z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[11px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20 transition",
                                  draggingId === DRAFT_PIN_ID ? "cursor-grabbing" : "cursor-grab"
                                )}
                                style={{
                                  left: `${resolvedDraftAnchorFocus.x * 100}%`,
                                  top: `${resolvedDraftAnchorFocus.y * 100}%`,
                                }}
                                onPointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                                onPointerMove={(e) => updateDrag(e, pageMetrics.renderedWidth, pageMetrics.renderedHeight)}
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

                            {showAnnotations && selectedTarget?.focus && !inlineComposerOpen ? (
                              <div
                                className="absolute z-40"
                                style={getClampedOverlayStyle(
                                  resolveFocus(selectedTarget.annotation.id, selectedTarget.focus),
                                  24,
                                  -18,
                                  COMMENT_POPOVER_WIDTH_PX,
                                  COMMENT_POPOVER_ESTIMATED_HEIGHT_PX
                                )}
                              >
                                <CommentPopover
                                  author={selectedTarget.annotation.author || "Unknown"}
                                  authorId={selectedTarget.annotation.authorId}
                                  text={selectedTarget.annotation.text || ""}
                                  createdAt={selectedTarget.annotation.createdAt}
                                  isCompleted={selectedTarget.annotation.isCompleted}
                                  onClose={() => setSelectedAnnotationId(null)}
                                  onDelete={!commentMutationContext?.share_token || selectedTarget.annotation.canManageComment ? async () => {
                                    applyLocalAnnotationUpdate(selectedTarget.annotation.id, { isDeleted: true });
                                    await editOrDeleteComment("delete", { id: selectedTarget.annotation.id });
                                    setSelectedAnnotationId(null);
                                  } : undefined}
                                  onComplete={canCompleteComments ? async () => {
                                    const newCompleted = !selectedTarget.annotation.isCompleted;
                                    applyLocalAnnotationUpdate(selectedTarget.annotation.id, { isCompleted: newCompleted });
                                    await invokeEdgeFunction("comment", { method: "PATCH", body: { id: selectedTarget.annotation.id, status: newCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) } });
                                  } : undefined}
                                  className="max-h-[320px] overflow-y-auto"
                                  isDragging={draggingId === selectedTarget.annotation.id}
                                  onDragHandlePointerDown={(e) => selectedTarget.focus && beginDrag(selectedTarget.annotation.id, selectedTarget.focus, e)}
                                  onDragHandlePointerMove={(e) => updateDrag(e, pageMetrics.renderedWidth, pageMetrics.renderedHeight)}
                                  onDragHandlePointerUp={(e) => endDrag(e)}
                                />
                              </div>
                            ) : null}

                            <canvas ref={committedCanvasRef} className="pointer-events-none absolute inset-0" />
                            <canvas ref={liveCanvasRef} className="pointer-events-none absolute inset-0" />
                            <div
                              ref={overlayRef}
                              className={cn("absolute inset-0 z-10", overlayCursor)}
                              // Comment/zoom modes only need a plain click
                              // (no drag), unlike pan and draw -- so they
                              // don't need to suppress native touch-scroll
                              // the way those two drag gestures do.
                              style={{ touchAction: (isPanMode || isDrawMode) ? "none" : "auto" }}
                              onPointerDown={(event) => {
                                const overlay = event.currentTarget;
                                const rect = overlay.getBoundingClientRect();
                                const point = eventToNormalized(event.nativeEvent, overlay);
                                setHoverPoint({
                                  x: point.x,
                                  y: point.y,
                                  clientX: event.clientX - rect.left,
                                  clientY: event.clientY - rect.top,
                                });

                                if (isPanMode) {
                                  event.currentTarget.setPointerCapture(event.pointerId);
                                  dragStateRef.current = {
                                    pointerId: event.pointerId,
                                    startX: event.clientX,
                                    startY: event.clientY,
                                    scrollLeft: viewportRef.current?.scrollLeft ?? 0,
                                    scrollTop: viewportRef.current?.scrollTop ?? 0,
                                  };
                                  return;
                                }

                                event.currentTarget.setPointerCapture(event.pointerId);
                                commentAnchorRef.current = point;
                                if (isDrawMode) {
                                  pointerDown(point);
                                }
                              }}
                              onPointerMove={(event) => {
                                const overlay = event.currentTarget;
                                const rect = overlay.getBoundingClientRect();
                                const point = eventToNormalized(event.nativeEvent, overlay);
                                setHoverPoint({
                                  x: point.x,
                                  y: point.y,
                                  clientX: event.clientX - rect.left,
                                  clientY: event.clientY - rect.top,
                                });

                                if (isPanMode && dragStateRef.current && viewportRef.current) {
                                  const dx = event.clientX - dragStateRef.current.startX;
                                  const dy = event.clientY - dragStateRef.current.startY;
                                  viewportRef.current.scrollLeft = dragStateRef.current.scrollLeft - dx;
                                  viewportRef.current.scrollTop = dragStateRef.current.scrollTop - dy;
                                  return;
                                }

                                if (isDrawMode) {
                                  pointerMove(point);
                                }
                              }}
                              onPointerUp={(event) => {
                                const overlay = event.currentTarget;
                                const point = eventToNormalized(event.nativeEvent, overlay);

                                if (isPanMode) {
                                  dragStateRef.current = null;
                                  try {
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                                  } catch {
                                    // Pointer capture may already be released by the browser.
                                  }
                                  return;
                                }

                                if (isDrawMode) {
                                  const hadActiveStroke = !!activeStroke;
                                  pointerUp();
                                  if (hadActiveStroke) {
                                    setInlineComposerText(dockComposerText);
                                    setInlineComposerOpen(true);
                                    showTransientFeedback("Drawing added");
                                  }
                                } else if (isCommentMode) {
                                  const anchorPoint = commentAnchorRef.current ?? point;
                                  addStroke(createAnchorStroke(anchorPoint, color), true);
                                  setInlineComposerText(dockComposerText);
                                  setInlineComposerOpen(true);
                                  showTransientFeedback("Anchor placed. Add your note.");
                                } else if (isZoomMode) {
                                  const nextZoom = clampZoom(zoomLevel + 0.25);
                                  scheduleZoomFocus(nextZoom, point, "smooth");
                                  showTransientFeedback(`Zoom ${Math.round(nextZoom * 100)}%`);
                                }

                                try {
                                  event.currentTarget.releasePointerCapture(event.pointerId);
                                } catch {
                                  // Pointer capture may already be released by the browser.
                                }
                              }}
                              onPointerCancel={(event) => {
                                dragStateRef.current = null;
                                commentAnchorRef.current = null;
                                pointerCancel();
                                try {
                                  event.currentTarget.releasePointerCapture(event.pointerId);
                                } catch {
                                  // Pointer capture may already be released by the browser.
                                }
                              }}
                              onPointerLeave={() => {
                                setHoverPoint(null);
                              }}
                            />

                            {hoverPoint && hoverIndicatorLabel ? (
                              <div
                                className="pointer-events-none absolute z-20 -translate-y-full rounded-full border border-border/70 bg-background/95 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-[0_10px_26px_rgba(15,23,42,0.16)] backdrop-blur-xl"
                                style={{
                                  left: `min(${hoverPoint.clientX + 16}px, calc(100% - 110px))`,
                                  top: `max(${hoverPoint.clientY - 14}px, 22px)`,
                                }}
                              >
                                {hoverIndicatorLabel}
                              </div>
                            ) : null}

                            {showAnnotations && inlineComposerOpen && resolvedDraftAnchorFocus ? (
                              <div
                                className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                                style={getClampedOverlayStyle(
                                  resolvedDraftAnchorFocus,
                                  18,
                                  -12,
                                  INLINE_COMPOSER_WIDTH_PX,
                                  INLINE_COMPOSER_ESTIMATED_HEIGHT_PX
                                )}
                              >
                                <InlineNoteComposer
                                  value={inlineComposerText}
                                  onChange={(value) => {
                                    setInlineComposerText(value);
                                    setDockComposerText(value);
                                  }}
                                  color={color}
                                  label={isDrawMode ? "Add note for this markup" : "Add note here"}
                                  hint={isDrawMode ? "Markup stays attached to this note." : "Pin stays attached to this note."}
                                  projectId={projectId}
                                  organizationId={organizationId}
                                  workspaceId={workspaceId}
                                  assetId={assetId}
                                  onCancel={() => closeInlineComposer(true)}
                                  onSubmit={() => void submitAnnotation(inlineComposerText)}
                                  isDragging={draggingId === DRAFT_PIN_ID}
                                  onDragHandlePointerDown={(e) => beginDrag(DRAFT_PIN_ID, resolvedDraftAnchorFocus, e)}
                                  onDragHandlePointerMove={(e) => updateDrag(e, pageMetrics.renderedWidth, pageMetrics.renderedHeight)}
                                  onDragHandlePointerUp={(e) => endDrag(e)}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="pointer-events-none absolute bottom-3 right-8 z-30 hidden xl:block">
                        <div className="pointer-events-auto w-[126px] rounded-[22px] border border-border/60 bg-background/88 p-2.5 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Page</span>
                            <span className="rounded-full bg-card/70 px-2 py-0.5 text-[10px] font-semibold text-foreground">{pageScrollPct}%</span>
                          </div>
                          <button
                            type="button"
                            className="relative block h-[238px] w-full overflow-hidden rounded-[18px] border border-border/60 bg-muted/40"
                            onClick={(event) => handleMinimapJump(event.clientY, event.currentTarget)}
                          >
                            <img
                              src={imageUrl}
                              alt=""
                              className="pointer-events-none block h-full w-full object-cover object-top"
                              onError={onMediaError}
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/8 via-transparent to-black/12" />
                            {annotationTargets.map((entry) => (
                              <span
                                key={`mini-${entry.annotation.id}`}
                                className={cn(
                                  "pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80",
                                  entry.annotation.id === selectedAnnotationId && "scale-125"
                                )}
                                style={{
                                  backgroundColor: entry.accentColor,
                                  left: `${entry.focus!.x * 100}%`,
                                  top: `${entry.focus!.y * 100}%`,
                                }}
                              />
                            ))}
                            <div
                              className="pointer-events-none absolute left-1.5 right-1.5 rounded-[14px] border-2"
                              style={{
                                borderColor: `${selectedTarget?.accentColor ?? DEFAULT_ANNOTATION_COLOR}bf`,
                                backgroundColor: `${selectedTarget?.accentColor ?? DEFAULT_ANNOTATION_COLOR}20`,
                                boxShadow: `0 0 0 1px ${(selectedTarget?.accentColor ?? DEFAULT_ANNOTATION_COLOR)}20, 0 18px 26px ${(selectedTarget?.accentColor ?? DEFAULT_ANNOTATION_COLOR)}14`,
                                top: `${Math.max(0, Math.min(100 - minimapViewportHeight, minimapViewportTop))}%`,
                                height: `${Math.max(minimapViewportHeight, 6)}%`,
                              }}
                            />
                            <div className="pointer-events-none absolute inset-y-2 right-1.5 flex flex-col justify-between">
                              {sections.map((section) => (
                                <span
                                  key={`label-${section.id}`}
                                  className={cn(
                                    "rounded-full bg-background/88 px-1.5 py-1 text-[9px] font-medium text-foreground shadow-sm backdrop-blur",
                                    activeSection?.id === section.id && "bg-[#35c8d6]/90 text-slate-950"
                                  )}
                                >
                                  {section.label}
                                </span>
                              ))}
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {commentsPanelOpen === false ? null : (
	              <motion.div
	                initial={{ x: 40, opacity: 0 }}
	                animate={{ x: 0, opacity: 1 }}
	                exit={{ x: 40, opacity: 0 }}
	                transition={{ duration: 0.18 }}
	                className={cn(
	                  "flex min-h-0 w-full flex-1 flex-col lg:h-full lg:flex-none",
	                  commentsOpen ? "lg:w-[320px] lg:min-w-[300px] lg:max-w-[320px]" : "lg:w-[56px] lg:min-w-[56px] lg:max-w-[56px]"
	                )}
	              >
	                {!commentsOpen ? (
	                  <div className="hidden h-full min-h-0 flex-col items-center border-l border-white/6 bg-[#0b0f1a] px-1.5 py-2 lg:flex">
	                    <Button
	                      variant="ghost"
	                      size="icon"
	                      className="h-8 w-8 rounded-lg border border-white/8 bg-white/[0.02] text-foreground hover:bg-white/[0.05]"
	                      onClick={() => setCommentsOpen(true)}
	                      aria-label="Show comments"
	                    >
	                      <ChevronLeft className="h-4 w-4" />
	                    </Button>

	                    <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/[0.02] text-xs font-semibold text-foreground">
	                      {annotationCount}
	                    </div>

	                    <div className="mt-2 flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
	                      {annotationTargets.length === 0 ? (
	                        <span className="mt-1 text-[10px] font-medium text-muted-foreground">0</span>
	                      ) : null}
	                      {annotationTargets.slice(0, 10).map((entry, idx) => (
	                        <button
	                          key={`collapsed-${entry.annotation.id}`}
	                          type="button"
	                          className={cn(
	                            "flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg border text-xs font-semibold transition",
	                            entry.annotation.id === selectedAnnotationId
	                              ? "border-white/16 bg-white/[0.10] text-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
	                              : "border-white/8 bg-white/[0.02] text-muted-foreground hover:border-white/12 hover:text-foreground"
	                          )}
	                          aria-label={`Open note ${idx + 1}`}
	                          onClick={() => handleCommentFocus(entry.annotation.id)}
	                        >
	                          {idx + 1}
	                        </button>
	                      ))}
	                    </div>
	                  </div>
	                ) : (
                  <div className="h-full min-h-0">
                    <CommentsPanel
                      className="border-white/6 bg-[#0b0f1a] lg:w-[320px] lg:min-w-[300px] lg:max-w-[320px]"
                      items={annotations.map((annotation) => ({
                        id: annotation.id,
                        author: annotation.author,
                        authorId: annotation.authorId,
                        text: annotation.text,
                        emoji: annotation.emoji,
                        hasDrawing: !!annotation.drawing?.length,
                        isCompleted: annotation.isCompleted,
                        isDeleted: annotation.isDeleted,
                        canManageComment: annotation.canManageComment,
                        canDeleteComment: annotation.canDeleteComment,
                        createdAt: annotation.createdAt,
                      }))}
                      onItemClick={handleCommentFocus}
                      showCommentDock={true}
                      includeTimestamp={false}
                      annotating={isDrawMode}
                      onToggleAnnotating={() => setInteractionMode((mode) => mode === "draw" ? "pan" : "draw")}
                      reviewMode={isPanMode ? "view" : isCommentMode ? "comment" : isDrawMode ? "draw" : "view"}
                      onReviewModeChange={(mode) => {
                        closeInlineComposer(true);
                        if (mode === "view") {
                          activateMode("pan");
                        } else {
                          setShowAnnotations(true);
                          activateMode(mode);
                        }
                      }}
                      tool={tool}
                      onToolChange={setTool}
                      color={color}
                      onColorChange={setColor}
                      canUndo={!!draftStrokes.length || !!activeStroke}
                      onUndo={undoStroke}
                      onClear={clearStrokes}
                      onCommentSubmit={submitAnnotation}
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
                        const target = annotations.find((annotation) => annotation.id === id);
                        applyLocalAnnotationUpdate(id, { isCompleted: !target?.isCompleted });
                        await invokeEdgeFunction("comment", {
                          method: "PATCH",
                          body: { id, status: "completed", ...(commentMutationContext ?? {}) },
                        });
                      } : undefined}
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
	                )}
	              </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

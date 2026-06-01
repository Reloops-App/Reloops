import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ZoomIn, ZoomOut, Maximize2, Download, FileText, MessageSquare, Pencil, Slash, MoveRight, Square, Undo2 } from "lucide-react";
import { cn, downloadFile } from "@/lib/utils";
import type { Annotation, Stroke } from "./annotator-utils";
import { drawStrokes, getAnnotationFocusPoint, getDrawingBounds, normalizeAnnotation } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import CommentsPanel from "./CommentsPanel";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { ReviewModeBar } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

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
    ai_description?: string | null;
    ai_metadata?: Record<string, any> | null;
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
  } | null;
  onAssetMetadataSave?: (patch: { description: string | null; tags: string[] }) => Promise<void> | void;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

type InteractionMode = "browse" | "comment" | "draw";

function createAnchorStroke(point: { x: number; y: number }, color: string): Stroke {
  return {
    tool: "pen",
    color,
    points: [point],
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
    overlay.style.touchAction = "none";
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
  profiles = {},
}: PdfAnnotatorProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("browse");
  const [scrollMetrics, setScrollMetrics] = useState({
    progress: 0,
    thumbTopPercent: 0,
    thumbHeightPercent: 100,
    scrollable: false,
  });

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

  const [annotations, setAnnotations] = useState<Annotation[]>(annotationsProp ?? []);
  useEffect(() => {
    if (!annotationsProp) return;
    try {
      const arr = Array.isArray(annotationsProp) ? annotationsProp : [annotationsProp];
      setAnnotations(arr.map((item) => normalizeAnnotation(item)));
    } catch {
      setAnnotations(annotationsProp as Annotation[]);
    }
  }, [annotationsProp]);

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
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");

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

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    for (const annotation of annotations) {
      const page = annotation.page ?? 1;
      const bucket = grouped.get(page) ?? [];
      bucket.push(annotation);
      grouped.set(page, bucket);
    }
    return grouped;
  }, [annotations]);

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
      const rootTop = viewer.getBoundingClientRect().top;
      let bestPage = 1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let page = 1; page <= numPages; page += 1) {
        const node = pageRefs.current[page];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const distance = Math.abs(rect.top - rootTop - 24);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = page;
        }
      }
      setCurrentPage(bestPage);
    }

    const maxScroll = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
    const progress = maxScroll > 0 ? viewer.scrollTop / maxScroll : 0;
    const thumbHeightPercent = viewer.scrollHeight > 0
      ? Math.min(100, Math.max(12, (viewer.clientHeight / viewer.scrollHeight) * 100))
      : 100;
    const thumbTopPercent = maxScroll > 0 ? progress * (100 - thumbHeightPercent) : 0;

    setScrollMetrics({
      progress,
      thumbTopPercent,
      thumbHeightPercent,
      scrollable: maxScroll > 0,
    });
  }, [numPages]);

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

  const zoomPct = Math.round(scale * 100);
  const renderWidth = viewerWidth > 0 ? Math.max(100, Math.floor((viewerWidth - 32) * scale)) : undefined;
  const zoomOut = useCallback(() => {
    setScale((value) => Math.max(0.1, Number((value / 1.25).toFixed(2))));
  }, []);
  const zoomIn = useCallback(() => {
    setScale((value) => Math.min(3, Number((value * 1.25).toFixed(2))));
  }, []);
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
  const colorChoices = ["#ff7a00", "#22c55e", "#3b82f6", "#eab308", "#ef4444"];

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => !annotation.isDeleted),
    [annotations]
  );

  const annotationPinsByPage = useMemo(() => {
    const grouped = new Map<number, Array<{ id: string; x: number; y: number; index: number; color: string; text: string }>>();
    visibleAnnotations.forEach((annotation, index) => {
      const focus = getAnnotationFocusPoint(annotation);
      if (!focus) return;
      const page = annotation.page ?? 1;
      const bucket = grouped.get(page) ?? [];
      const colorValue = annotation.drawing?.[0]?.color || "#ff7a00";
      bucket.push({ id: annotation.id, x: focus.x, y: focus.y, index: index + 1, color: colorValue, text: annotation.text });
      grouped.set(page, bucket);
    });
    return grouped;
  }, [visibleAnnotations]);

  const scrollToPage = useCallback((page: number) => {
    const node = pageRefs.current[page];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(page);
    setActivePage(page);
  }, []);

  const handleDocumentLoad = useCallback((doc: PDFDocumentProxy) => {
    setNumPages(doc.numPages);
    setLoadError(null);
    setCurrentPage(1);
    setActivePage(1);
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

  const handleCommentSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const payload: Annotation = {
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        time: Number.NaN,
        page: activePage || currentPage || 1,
        text: trimmed,
        author: await getLoggedInUserProfile().then((user) => user?.full_name),
        authorId: await getLoggedInUserProfile().then((user) => user?.sub),
        isCompleted: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        emoji: {},
        drawing: [...liveStrokes],
      };

      setAnnotations((prev) => (prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]));
      closeInlineComposer(true);
      setInteractionMode("browse");

      if (onAddAnnotation) {
        await onAddAnnotation(payload);
      }
    } catch (error) {
      console.error("Failed to submit PDF comment", error);
    }
  }, [activePage, closeInlineComposer, currentPage, liveStrokes, onAddAnnotation]);

  const filteredAnnotations = useMemo(() => annotations, [annotations]);

  return (
    <div className={cn("h-full w-full overflow-hidden", className)}>
      <div className="h-full overflow-hidden rounded-none border-0 bg-background">
        <div className="h-full overflow-hidden p-0">
          <div className="flex h-full min-h-0 w-full overflow-hidden flex-col lg:flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                    <Button variant="ghost" size="sm" onClick={() => setScale(1)} className="h-7 px-1.5 text-xs">
                      <Maximize2 className="mr-1 h-3 w-3" />Fit
                    </Button>
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
                          const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
                          const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
                          const path = storagePath.startsWith("/") ? storagePath : `/${storagePath}`;
                          void downloadFile(`${base}${path}`, asset?.title || "document");
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
                        setLoadError("Failed to load PDF preview.");
                      }}
                    >
                      <div className="mx-auto flex w-max min-w-full flex-col items-center gap-4">
                        {Array.from({ length: numPages }, (_, index) => {
                          const pageNumber = index + 1;
                          const pageAnnotations = annotationsByPage.get(pageNumber) ?? [];
                          const pageStrokes = pageAnnotations.flatMap((annotation) => annotation.drawing ?? []);
                          const pagePins = annotationPinsByPage.get(pageNumber) ?? [];
                          return (
                            <div
                              key={pageNumber}
                              ref={(node) => {
                                pageRefs.current[pageNumber] = node;
                              }}
                              className="relative w-fit max-w-max overflow-hidden rounded-xl border bg-white shadow-sm"
                            >
                              <Page
                                pageNumber={pageNumber}
                                width={renderWidth}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
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
                                    setInlineComposerText("");
                                    setInlineComposerOpen(true);
                                    return;
                                  }

                                  const hadActiveStroke = !!activeStroke;
                                  pointerUp();
                                  if (!hadActiveStroke) return;
                                  setInlineComposerText("");
                                  setInlineComposerOpen(true);
                                }}
                                onPointerCancel={pointerCancel}
                              />
                              {showAnnotations
                                ? pagePins.map((pin) => (
                                  <button
                                    key={pin.id}
                                    type="button"
                                    onClick={() => {
                                      setActivePage(pageNumber);
                                      const annotation = annotations.find((item) => item.id === pin.id);
                                      if (!annotation) return;
                                      scrollToPage(pageNumber);
                                    }}
                                    title={pin.text}
                                    className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#0b1020] text-[11px] font-semibold text-white shadow-[0_6px_18px_rgba(0,0,0,0.3)]"
                                    style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, backgroundColor: pin.color }}
                                  >
                                    {pin.index}
                                  </button>
                                ))
                                : null}
                              {showAnnotations && interactionMode === "comment" && pageNumber === activePage && draftStrokes[0]?.points?.[0] ? (
                                <div
                                  className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#0b1020] text-[11px] font-semibold text-white ring-4 ring-white/20 shadow-[0_6px_18px_rgba(0,0,0,0.3)]"
                                  style={{
                                    left: `${draftStrokes[0].points[0].x * 100}%`,
                                    top: `${draftStrokes[0].points[0].y * 100}%`,
                                    backgroundColor: color,
                                  }}
                                >
                                  +
                                </div>
                              ) : null}
                              {inlineComposerOpen && pageNumber === activePage && draftAnchorFocus ? (
                                <div
                                  className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                                  style={{
                                    left: `min(calc(${draftAnchorFocus.x * 100}% + 18px), calc(100% - 292px))`,
                                    top: `max(calc(${draftAnchorFocus.y * 100}% - 12px), 16px)`,
                                  }}
                                >
                                  <InlineNoteComposer
                                    value={inlineComposerText}
                                    onChange={setInlineComposerText}
                                    color={color}
                                    label={interactionMode === "comment" ? "Add note here" : "Describe your annotation"}
                                    hint={interactionMode === "comment" ? "Pin stays attached to this page" : "Ctrl+Enter to submit"}
                                    onCancel={() => closeInlineComposer(true)}
                                    onSubmit={() => void handleCommentSubmit(inlineComposerText)}
                                  />
                                </div>
                              ) : null}
                              <div className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                                Page {pageNumber}
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
                    <div className="pointer-events-none absolute right-2 top-4 bottom-14 flex w-3 items-center z-10">
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
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 w-full flex-col overflow-hidden lg:w-[400px] lg:flex-none">
              <div className="h-full min-h-0">
                <CommentsPanel
                  className="lg:w-full lg:min-w-0 lg:max-w-none"
                  items={filteredAnnotations.map((annotation) => ({
                    id: annotation.id,
                    author: annotation.author,
                    authorId: annotation.authorId,
                    text: annotation.page ? `Page ${annotation.page} · ${annotation.text}` : annotation.text,
                    emoji: annotation.emoji,
                    hasDrawing: !!(annotation.drawing && annotation.drawing.length > 0),
                    isCompleted: annotation.isCompleted,
                    isDeleted: annotation.isDeleted,
                    createdAt: annotation.createdAt,
                  }))}
                  onItemClick={(id) => {
                    const annotation = annotations.find((item) => item.id === id);
                    if (!annotation?.page) return;
                    scrollToPage(annotation.page);
                  }}
                  showCommentDock={true}
                  includeTimestamp={false}
                  annotating={interactionMode !== "browse"}
                  onToggleAnnotating={() => setInteractionMode((mode) => (mode === "browse" ? "draw" : "browse"))}
                  tool={tool}
                  onToolChange={setTool}
                  color={color}
                  onColorChange={setColor}
                  canUndo={!!draftStrokes.length || !!activeStroke}
                  onUndo={undoStroke}
                  onClear={clearStrokes}
                  onCommentSubmit={handleCommentSubmit}
                  onEditComment={async (id: string, newText: string) => {
                    setAnnotations((prev) => prev.map((item) => (item.id === id ? { ...item, text: newText } : item)));
                    await invokeEdgeFunction("comment", {
                      method: "PATCH",
                      body: { id, body: newText },
                    });
                  }}
                  onDeleteComment={async (id: string) => {
                    setAnnotations((prev) => prev.map((item) => (item.id === id ? { ...item, isDeleted: true } : item)));
                    await invokeEdgeFunction("comment", {
                      method: "PATCH",
                      body: { id, status: "deleted" },
                    });
                  }}
                  onToggleCompleted={async (id: string) => {
                    setAnnotations((prev) =>
                      prev.map((item) => (item.id === id ? { ...item, isCompleted: !item.isCompleted } : item))
                    );
                    await invokeEdgeFunction("comment", {
                      method: "PATCH",
                      body: { id, status: "completed" },
                    });
                  }}
                  projectId={projectId}
                  organizationId={organizationId}
                  workspaceId={workspaceId}
                  assetId={assetId}
                  asset={asset}
                  onAssetMetadataSave={onAssetMetadataSave}
                  profiles={profiles}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

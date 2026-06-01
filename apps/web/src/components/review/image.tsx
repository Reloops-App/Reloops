import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, downloadFile } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ZoomIn, ZoomOut, Maximize2, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import type { Annotation, Stroke } from "./annotator-utils";
import { drawStrokes, normalizeAnnotation, getAnnotationFocusPoint, getDrawingBounds } from "./annotator-utils";
import { useDrawing } from "./shared/useDrawing";
import CommentsPanel from "./CommentsPanel";
import { Switch } from "../ui/switch";
import { getLoggedInUserProfile, supabase } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { getAvatarInitials } from "@/lib/avatar-utils";
import { BubblePin } from "./shared/PinMarker";
import { CommentPopover } from "./shared/CommentPopover";
import { ReviewModeBar, type ReviewMode } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { previewBackgroundClass, type PreviewBackground } from "@/lib/imagePreviewBackground";

const DEFAULT_ANNOTATION_COLOR = "#35c8d6";

function getAnnotationAccentColor(annotation: Annotation) {
  return annotation.drawing?.find((stroke) => stroke.color)?.color ?? DEFAULT_ANNOTATION_COLOR;
}

function createAnchorStroke(point: { x: number; y: number }, strokeColor: string): Stroke {
  return { tool: "pen", color: strokeColor, points: [point] };
}

/* ----------------------------- Inline CanvasOverlay ----------------------------- */

type OverlayProps = {
  targetRef: React.RefObject<HTMLElement>; // natural-size overlay (transformed with image)
  annotating: boolean;
  strokes: Stroke[];                       // LIVE strokes only (draft + active)
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
    ctx.lineWidth = 6;

    const w = (naturalWidth ?? parseFloat(canvas.style.width)) || canvas.width;
    const h = (naturalHeight ?? parseFloat(canvas.style.height)) || canvas.height;
    const toXY = (p: { x: number; y: number }) => {
      const normalized = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      return normalized ? { x: p.x * w, y: p.y * h } : p;
    };
    const head = (x0: number, y0: number, x1: number, y1: number) => {
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const size = 9;
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
  }, [strokes, naturalWidth, naturalHeight]);

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
      try { overlay.releasePointerCapture(ev.pointerId); } catch { }
    };
    const cancel = (ev: PointerEvent) => {
      onPointerCancel({ original: ev });
      try { overlay.releasePointerCapture(ev.pointerId); } catch { }
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
  annotations?: Annotation[] | any[];
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
  profiles = {},
}: ImageAnnotatorProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null); // natural-size hit area
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [resolvedImageUrl, setResolvedImageUrl] = useState(imageUrl);

  useEffect(() => {
    setResolvedImageUrl(imageUrl);
    if (!imageUrl) return;

    const mimeType = asset?.mime_type ?? null;
    const normalizedUrl = imageUrl.toLowerCase();
    const isSvgAsset = mimeType === "image/svg+xml" || /\.svg($|\?)/i.test(normalizedUrl);
    if (!isSvgAsset) return;

    let active = true;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await fetch(imageUrl, {
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
        if (active) setResolvedImageUrl(imageUrl);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.mime_type, imageUrl]);

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
  const [minScale, setMinScale] = useState(0.05);
  const [maxScale] = useState(16);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [showAnnotations, setShowAnnotations] = useState(true);
  const zoomPct = Math.round(scale * 100);

  const [interactionMode, setInteractionMode] = useState<ReviewMode>("view");
  const isViewMode = interactionMode === "view";
  const isCommentMode = interactionMode === "comment";
  const isDrawMode = interactionMode === "draw";

  // Sync useDrawing annotating state with interactionMode
  useEffect(() => {
    setAnnotating(isDrawMode);
  }, [isDrawMode, setAnnotating]);

  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  // Inline composer for comment mode
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  const inlineComposerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (inlineComposerOpen) inlineComposerRef.current?.focus();
  }, [inlineComposerOpen]);

  const closeInlineComposer = useCallback((clearDraft = false) => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    if (clearDraft) clearStrokes();
  }, [clearStrokes]);

  // Annotations (committed)
  const [annotations, setAnnotations] = useState<Annotation[]>(annotationsProp ?? []);
  useEffect(() => {
    if (!annotationsProp) return;
    try {
      const arr = Array.isArray(annotationsProp) ? annotationsProp : [annotationsProp];
      const normalized = arr.map((a: any) => normalizeAnnotation(a));
      setAnnotations(normalized);
    } catch {
      setAnnotations(annotationsProp as Annotation[]);
    }
  }, [annotationsProp]);

  const annotationTargets = useMemo(() => {
    return annotations
      .filter((a) => !a.isDeleted)
      .map((annotation, index) => {
        const focus = getAnnotationFocusPoint(
          annotation,
          imgRef.current?.naturalWidth || undefined,
          imgRef.current?.naturalHeight || undefined
        );
        return {
          annotation,
          accentColor: getAnnotationAccentColor(annotation),
          index,
          focus,
        };
      })
      .filter((entry) => entry.focus);
  }, [annotations]);
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
      imgRef.current?.naturalWidth || undefined,
      imgRef.current?.naturalHeight || undefined
    ),
    [draftStrokes]
  );
  const draftAnchorFocus = draftAnchorBounds
    ? {
        x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2,
        y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2,
      }
    : null;
  const getStageOverlayPosition = useCallback((
    focus: { x: number; y: number } | null,
    xOffset: number,
    yOffset: number,
    width: number
  ) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !focus) return null;

    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const anchorX = tx + focus.x * iw * scale;
    const anchorY = ty + focus.y * ih * scale;
    const maxLeft = Math.max(12, stage.clientWidth - width - 12);

    return {
      left: Math.max(12, Math.min(maxLeft, anchorX + xOffset)),
      top: Math.max(16, anchorY + yOffset),
    };
  }, [scale, tx, ty]);
  const selectedPopoverPosition = useMemo(
    () => getStageOverlayPosition(selectedAnnotationTarget?.focus ?? null, 24, -18, 280),
    [getStageOverlayPosition, selectedAnnotationTarget]
  );
  const inlineComposerPosition = useMemo(
    () => getStageOverlayPosition(draftAnchorFocus, 18, -12, 280),
    [draftAnchorFocus, getStageOverlayPosition]
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
        ctx.lineWidth = 6;
        drawStrokes(ctx, committedStrokes, w, h, img?.naturalWidth || undefined, img?.naturalHeight || undefined);
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
  }, [committedStrokes, scale, tx, ty, showAnnotations]);

  // rAF-throttled recompute
  const rafRef = useRef<number | null>(null);
  const recomputeOnNextFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recomputeCanvas();
    });
  }, [recomputeCanvas]);

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
      ctx.lineWidth = 6;
      drawStrokes(ctx, committedStrokes, canvasSize.w, canvasSize.h, img?.naturalWidth || undefined, img?.naturalHeight || undefined);
    }
  }, [committedStrokes, canvasSize, showAnnotations]);

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
    
    // Default fit: contain whole image
    let s = Math.min(sw / iw, sh / ih);
    
    // If it's a very tall image (likely a web screenshot), fit to width instead
    if (ih > iw * 1.5 && (sw / iw) > s) {
      s = sw / iw;
    }
    
    return Math.max(0.05, Math.min(s, 32));
  }, []);

  // Zoom helpers
  const clampScale = (s: number) => Math.max(minScale, Math.min(maxScale, s));

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

  // Recompute on transform changes
  useEffect(() => {
    recomputeOnNextFrame();
  }, [scale, tx, ty, recomputeOnNextFrame]);

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
      setInlineComposerText("");
      setInlineComposerOpen(true);
    }
  };
  const onPointerMoveStage = (e: React.PointerEvent) => {
    if (!panning || !panStart.current) return;
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
    setInlineComposerText("");
    setInlineComposerOpen(true);
  }, [activeStroke, pointerUp]);

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
  }, [imageUrl, resolvedImageUrl]);

  const onImgLoad = useCallback(() => {
    fitOnLoad();
    detectAlpha();
    requestAnimationFrame(recomputeCanvas);
  }, [fitOnLoad, detectAlpha, recomputeCanvas]);

  useEffect(() => {
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Background
  const stageBg = previewBackgroundClass(previewBackground);

  // Layout
  const panelOpen = true;
  const filteredAnnotations = useMemo(() => annotations, [annotations]);

  return (
    <div className={cn("w-full h-full", className)}>
      <div className="border-0 rounded-none bg-background h-full">
        <CardContent className="p-0 h-full">
          <div className="flex h-full min-h-0 w-full flex-col lg:flex-row">
            <div
              className={cn(
                "flex min-h-0 min-w-0 basis-[48%] flex-col lg:basis-auto lg:flex-1 lg:min-h-0 lg:h-full",
                panelOpen ? "lg:w-[calc(100%-360px)]" : "w-full"
              )}
            >
              {/* Shared top mode bar: View | Comment | Draw */}
              <ReviewModeBar
                mode={interactionMode}
                onModeChange={(m) => {
                  closeInlineComposer(true);
                  setInteractionMode(m);
                }}
                tool={tool}
                onToolChange={setTool}
                color={color}
                onColorChange={setColor}
                hidePreview={true}
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
                style={{ touchAction: "none" }}
              >
                {/* Layer: natural-size image + overlay + canvases — transformed together */}
                <div
                  className="absolute top-0 left-0 will-change-transform"
                  style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}
                >
                  <img
                    ref={imgRef}
                    src={resolvedImageUrl}
                    alt={title ?? "Image"}
                    className="block select-none"
                    draggable={false}
                    onLoad={onImgLoad}
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
                    naturalWidth={imgRef.current?.naturalWidth}
                    naturalHeight={imgRef.current?.naturalHeight}
                    onPointerDown={(p) => pointerDown(p as any)}
                    onPointerMove={(p) => pointerMove(p as any)}
                    onPointerUp={handleOverlayPointerUp}
                    onPointerCancel={() => pointerCancel()}

                  />

                  {/* Render Pins & Popovers */}
                  {showAnnotations && annotationTargets.map((entry) => {
                    const isSelected = entry.annotation.id === selectedAnnotationId;
                    const isHovered = entry.annotation.id === hoveredAnnotationId;
                    if (!entry.focus) return null;
                    return (
                      <button
                        key={entry.annotation.id}
                        type="button"
                        className={cn(
                          "absolute z-20 -translate-x-1/2 -translate-y-1/2 transition hover:-translate-y-[55%]",
                          (isSelected || isHovered) ? "z-30" : ""
                        )}
                        style={{
                          left: `${entry.focus.x * 100}%`,
                          top: `${entry.focus.y * 100}%`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAnnotationId(entry.annotation.id);
                        }}
                        onMouseEnter={() => setHoveredAnnotationId(entry.annotation.id)}
                        onMouseLeave={() => setHoveredAnnotationId((current) => current === entry.annotation.id ? null : current)}
                      >
                        <BubblePin 
                          initials={getAvatarInitials(entry.annotation.author || "?")}
                          color={entry.accentColor}
                          userId={entry.annotation.authorId}
                          userName={entry.annotation.author}
                        />
                      </button>
                    );
                  })}

                  {/* Draft anchor pin (Comment mode) */}
                  {isCommentMode && draftAnchorFocus ? (
                    <div
                      className="pointer-events-none absolute z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[11px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20"
                      style={{ left: `${draftAnchorFocus.x * 100}%`, top: `${draftAnchorFocus.y * 100}%` }}
                    >
                      +
                    </div>
                  ) : null}
                </div>

                {showAnnotations && selectedAnnotationTarget && selectedPopoverPosition ? (
                  <div
                    className="absolute z-40"
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
                      onDelete={async () => {
                        setAnnotations((prev) => prev.map((a) => a.id === selectedAnnotationTarget.annotation.id ? { ...a, isDeleted: true } : a));
                        await invokeEdgeFunction("comment", { method: "PATCH", body: { id: selectedAnnotationTarget.annotation.id, status: "deleted" } });
                        setSelectedAnnotationId(null);
                      }}
                      onComplete={async () => {
                        const newCompleted = !selectedAnnotationTarget.annotation.isCompleted;
                        setAnnotations((prev) => prev.map((a) => a.id === selectedAnnotationTarget.annotation.id ? { ...a, isCompleted: newCompleted } : a));
                        await invokeEdgeFunction("comment", { method: "PATCH", body: { id: selectedAnnotationTarget.annotation.id, status: newCompleted ? "completed" : "active" } });
                      }}
                    />
                  </div>
                ) : null}

                {/* Inline composer (Comment + Draw modes) */}
                {inlineComposerOpen && inlineComposerPosition ? (
                  <div
                    className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                    style={{
                      left: `${inlineComposerPosition.left}px`,
                      top: `${inlineComposerPosition.top}px`,
                    }}
                  >
                    <InlineNoteComposer
                      value={inlineComposerText}
                      onChange={setInlineComposerText}
                      color={color}
                      label={isCommentMode ? "Add note here" : "Describe your annotation"}
                      hint={isCommentMode ? "Pin stays attached" : "Ctrl+Enter to submit"}
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
                          setAnnotations((prev) => { if (prev.some(a => a.id === payload.id)) return prev; return [...prev, payload]; });
                          closeInlineComposer(true);
                          setInteractionMode("view");
                          if (onAddAnnotation) await onAddAnnotation(payload);
                        } catch (err) { console.error("Failed to submit comment:", err); }
                      }}
                    />
                  </div>
                ) : null}

                <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-5.5rem)] flex-wrap items-center gap-2 rounded-lg bg-black/60 px-3 backdrop-blur-sm opacity-90 transition-opacity hover:opacity-100 sm:bottom-4 sm:left-4 sm:max-w-none">
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

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const storagePath = asset?.storage_path;
                      if (storagePath) {
                        const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
                        const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
                        const path = storagePath.startsWith("/") ? storagePath : `/${storagePath}`;
                        const url = `${base}${path}`;
                        void downloadFile(url, asset?.title || "image");
                      }
                    }}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>

                {/* Floating background toggle - top right corner */}
                <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm opacity-90 transition-opacity hover:opacity-100 sm:bottom-4 sm:right-4">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center">
                          <Switch
                            checked={showAnnotations}
                            onCheckedChange={setShowAnnotations}
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
              </div>


            </div>

            {/* Right panel */}
            <AnimatePresence>
              {true && (
                <motion.div
                  initial={{ x: 40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 40, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none"
                >
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
                        createdAt: a.createdAt,
                      }))}
                      onItemClick={(id) => setSelectedAnnotationId(id)}

                      // Bottom dock props (no timestamp for images)
                      showCommentDock={true}
                      includeTimestamp={false}
                      annotating={isDrawMode}
                      onToggleAnnotating={() => setInteractionMode(isDrawMode ? "view" : "draw")}
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
                          setAnnotations((prev: Annotation[]) => {
                            const exists = prev.some(a => a.id === payload.id);
                            if (exists) return prev;
                            return [...prev, payload];
                          });
                          // console.log("✅ Step 2 complete: Added to local state");

                          // console.log("📝 Step 3: Clearing UI state...");
                          // Clear UI state immediately
                          setInteractionMode("view");
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

                      // Comment actions
                      onEditComment={async (id: string, newText: string) => {
                        setAnnotations((prev: Annotation[]) =>
                          prev.map(a => a.id === id ? { ...a, text: newText } : a)
                        );
                        // TODO: Call API to update comment in database
                        await invokeEdgeFunction("comment", {
                          method: "PATCH",
                          body: { id, body: newText }
                        });
                      }}
                      onDeleteComment={async (id: string) => {
                        setAnnotations((prev: Annotation[]) =>
                          prev.map(a => a.id === id ? { ...a, isDeleted: true } : a)
                        );
                        // TODO: Call API to soft delete comment in database
                        await invokeEdgeFunction("comment", {
                          method: "PATCH",
                          body: { id, status: "deleted" }
                        });
                      }}
                      onToggleCompleted={async (id: string) => {
                        setAnnotations((prev: Annotation[]) =>
                          prev.map(a => a.id === id ? { ...a, isCompleted: !a.isCompleted } : a)
                        );
                        // TODO: Call API to update completion status in database
                        await invokeEdgeFunction("comment", {
                          method: "PATCH",
                          body: { id, status: "completed" }
                        });
                      }}

                      // Context for enhanced mentions
                      projectId={projectId}
                      organizationId={organizationId}
                      workspaceId={workspaceId}
                      assetId={assetId}

                      // Asset data for Fields tab
                      asset={asset}
                      onAssetMetadataSave={onAssetMetadataSave}
                      profiles={profiles}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </div>
    </div>
  );
}

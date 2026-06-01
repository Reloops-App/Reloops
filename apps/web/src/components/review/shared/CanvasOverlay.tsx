import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { drawStrokes, type Stroke } from "../annotator-utils";

type Props = {
  targetRef: React.RefObject<HTMLElement>;
  annotating: boolean;
  strokes: Stroke[];
  className?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  onPointerDown?: (p: { x: number; y: number }) => void;
  onPointerMove?: (p: { x: number; y: number }) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
};

export default function CanvasOverlay({
  targetRef,
  annotating,
  strokes,
  className,
  naturalWidth,
  naturalHeight,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawStrokes(ctx, strokes, size.w, size.h, naturalWidth, naturalHeight);
  };

  useEffect(() => {
    const el = targetRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      setSize({ w, h });

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStrokes(ctx, strokes, w, h, naturalWidth, naturalHeight);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [targetRef, strokes, naturalWidth, naturalHeight]);

  useEffect(() => {
    draw();
  }, [strokes, size, naturalWidth, naturalHeight]);

  const norm = (clientX: number, clientY: number) => {
    const el = targetRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width) / r.width;
    const y = Math.min(Math.max(clientY - r.top, 0), r.height) / r.height;
    return { x, y };
  };

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "absolute inset-0",
        annotating ? "pointer-events-auto touch-none" : "pointer-events-none",
        className
      )}
      onPointerDown={(e) => {
        if (!annotating) return;
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        onPointerDown?.(norm(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (!annotating) return;
        e.preventDefault();
        onPointerMove?.(norm(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerUp?.();
      }}
      onPointerLeave={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerUp?.();
      }}
      onPointerCancel={(e) => {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        onPointerCancel?.();
      }}
    />
  );
}

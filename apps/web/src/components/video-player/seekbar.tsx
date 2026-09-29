import { useRef, useState, useCallback, useEffect } from "react";
import { Annotation } from "../review/video";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { cn, fmtHMSF } from "@/lib/utils";
import { MentionDisplayText } from "../ui/mention-display";
import type { WaveformPeaks } from "../review/shared/useWaveformPeaks";

export function SeekBar({
    current,
    duration,
    annotations,
    onSeek,
    waveform,
    waveformLoading,
    height,
    hideMarkers,
}: {
    current: number;
    duration: number;
    annotations: Annotation[];
    onSeek: (t: number) => void;
    // Optional waveform rendering — when omitted, behavior/appearance is
    // unchanged from the plain flat seek bar used by video.tsx.
    waveform?: WaveformPeaks | null;
    waveformLoading?: boolean;
    height?: number;
    // Caller renders its own richer markers (e.g. avatar pins) over the bar.
    hideMarkers?: boolean;
}) {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    const [hoverX, setHoverX] = useState<number | null>(null);
    const pct = duration > 0 ? current / duration : 0;
    const hasWaveform = !!waveform;
    // No explicit height => fill whatever height the caller's container
    // resolves to (e.g. a flex-1 hero panel), instead of a fixed px value.
    const barHeight = height;
    const hoverTime = hoverX != null && duration > 0 ? hoverX * duration : null;

    const timeFromClientX = useCallback((clientX: number) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || !(duration > 0)) return 0;
        const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
        const p = rect.width > 0 ? x / rect.width : 0;
        return p * duration;
    }, [duration]);

    const onPointerMove = useCallback((e: PointerEvent) => {
        if (!dragging) return;
        onSeek(timeFromClientX(e.clientX));
    }, [dragging, onSeek, timeFromClientX]);

    const stopDragging = useCallback(() => {
        if (!dragging) return;
        setDragging(false);
        window.removeEventListener("pointermove", onPointerMove as any);
        window.removeEventListener("pointerup", stopDragging as any);
    }, [dragging, onPointerMove]);

    const startDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        setDragging(true);
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        onSeek(timeFromClientX(e.clientX));
        window.addEventListener("pointermove", onPointerMove as any);
        window.addEventListener("pointerup", stopDragging as any);
    }, [onSeek, onPointerMove, stopDragging, timeFromClientX]);

    useEffect(() => {
        return () => {
            window.removeEventListener("pointermove", onPointerMove as any);
            window.removeEventListener("pointerup", stopDragging as any);
        };
    }, [onPointerMove, stopDragging]);

    if (hasWaveform) {
        return (
            <div
                ref={barRef}
                className={cn(
                    "relative w-full cursor-pointer group touch-none select-none overflow-hidden rounded-md",
                    !barHeight && "h-full"
                )}
                style={barHeight ? { height: barHeight } : undefined}
                onPointerDown={startDragging}
                onPointerMove={(e) => {
                    const rect = barRef.current?.getBoundingClientRect();
                    if (!rect || rect.width <= 0) return;
                    setHoverX(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1));
                }}
                onPointerLeave={() => setHoverX(null)}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={current}
                tabIndex={0}
                onKeyDown={(e) => {
                    if (!(duration > 0)) return;
                    const step = e.shiftKey ? 10 : 5;
                    if (e.key === "ArrowLeft") onSeek(Math.max(0, current - step));
                    if (e.key === "ArrowRight") onSeek(Math.min(duration, current + step));
                    if (/^[0-9]$/.test(e.key)) onSeek((Number(e.key) / 10) * duration);
                }}
            >
                {waveformLoading ? (
                    <div className="absolute inset-0 flex items-end gap-px overflow-hidden px-1 pb-1 opacity-40">
                        {Array.from({ length: 48 }).map((_, i) => (
                            <div
                                key={i}
                                className="animate-pulse flex-1 rounded-sm bg-white/40"
                                style={{
                                    height: `${18 + Math.abs(Math.sin(i * 0.9)) * 70}%`,
                                    animationDelay: `${(i % 12) * 80}ms`,
                                }}
                            />
                        ))}
                    </div>
                ) : (
                    <WaveformCanvas barRef={barRef} waveform={waveform!} progress={pct} />
                )}

                {/* hover scrub preview */}
                {hoverTime != null && !waveformLoading ? (
                    <>
                        <div
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/40"
                            style={{ left: `${hoverX! * 100}%` }}
                        />
                        <div
                            className="pointer-events-none absolute top-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white shadow-sm"
                            style={{ left: `${hoverX! * 100}%` }}
                        >
                            {fmtHMSF(hoverTime)}
                        </div>
                    </>
                ) : null}

                {/* playhead */}
                <div
                    className="pointer-events-none absolute inset-y-0 w-px bg-white"
                    style={{ left: `${Math.max(0, Math.min(1, pct)) * 100}%` }}
                />

                {/* markers */}
                {!hideMarkers ? <Markers duration={duration} annotations={annotations} onSeek={onSeek} /> : null}
            </div>
        );
    }

    return (
        <div
            ref={barRef}
            className="relative h-5 w-full cursor-pointer group flex items-center touch-none select-none"
            onPointerDown={startDragging}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={current}
            tabIndex={0}
            onKeyDown={(e) => {
                if (!(duration > 0)) return;
                const step = e.shiftKey ? 10 : 5;
                if (e.key === "ArrowLeft") onSeek(Math.max(0, current - step));
                if (e.key === "ArrowRight") onSeek(Math.min(duration, current + step));
                if (/^[0-9]$/.test(e.key)) onSeek((Number(e.key) / 10) * duration);
            }}
        >
            {/* track */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-zinc-700 transition-transform duration-200 group-hover:scale-y-125 origin-center" />

            {/* progress */}
            <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary transition-transform duration-200 group-hover:scale-y-125 origin-center"
                style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%` }}
            >
                {/* Thumb Handle - No scale on transform to avoid distortion, handle scaling separately */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-sm scale-0 transition-transform duration-200 group-hover:scale-100" />
            </div>

            {/* markers */}
            <Markers duration={duration} annotations={annotations} onSeek={onSeek} />
        </div>
    );
}

const WAVEFORM_UNPLAYED_COLOR = "rgba(255,255,255,0.28)";
const WAVEFORM_PLAYED_COLOR = "#35c8d6";

function WaveformCanvas({
    barRef,
    waveform,
    progress,
}: {
    barRef: React.RefObject<HTMLDivElement | null>;
    waveform: WaveformPeaks;
    progress: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sizeRef = useRef({ w: 0, h: 0 });
    const progressRef = useRef(progress);
    progressRef.current = progress;

    const draw = useCallback((w: number, h: number, prog: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);

        const { left, right } = waveform;
        const hasRight = !!right && right.length > 0;
        const barWidth = Math.max(1, w / left.length);
        const playedCount = Math.floor(left.length * Math.max(0, Math.min(1, prog)));

        const drawLane = (peaks: number[], laneTop: number, laneHeight: number) => {
            const mid = laneTop + laneHeight / 2;
            for (let i = 0; i < peaks.length; i++) {
                const amp = Math.max(0.02, Math.min(1, peaks[i]));
                const barHeight = amp * laneHeight;
                const x = (i / peaks.length) * w;
                ctx.fillStyle = i < playedCount ? WAVEFORM_PLAYED_COLOR : WAVEFORM_UNPLAYED_COLOR;
                ctx.fillRect(x, mid - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
            }
        };

        if (hasRight) {
            drawLane(left, 0, h / 2);
            drawLane(right!, h / 2, h / 2);
        } else {
            drawLane(left, 0, h);
        }
    }, [waveform]);

    // Resize handling — rare; establishes canvas backing size and does the initial draw.
    useEffect(() => {
        const el = barRef.current;
        const canvas = canvasRef.current;
        if (!el || !canvas) return;

        const resize = () => {
            const rect = el.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width));
            const h = Math.max(1, Math.floor(rect.height));
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            const ctx = canvas.getContext("2d");
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            sizeRef.current = { w, h };
            draw(w, h, progressRef.current);
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        return () => ro.disconnect();
    }, [barRef, draw]);

    // Cheap repaint on every playback progress tick — no resize/observer churn.
    useEffect(() => {
        const { w, h } = sizeRef.current;
        if (w && h) draw(w, h, progress);
    }, [progress, draw]);

    return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}


export function Markers({
    duration,
    annotations,
    onSeek,
}: {
    duration: number;
    annotations: Annotation[];
    onSeek: (t: number) => void;
}) {
    if (!(duration > 0)) return null;
    return (
        <TooltipProvider>
            {annotations.map((a) => (
                <Tooltip key={a.id}>
                    <TooltipTrigger asChild>
                        <button
                            className="absolute h-3 w-[2px] bg-yellow-400 top-1/2 -translate-y-1/2 z-10"
                            style={{ left: `${(a.time / duration) * 100}%` }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSeek(a.time);
                            }}
                            aria-label={`Jump to ${fmtHMSF(a.time)}`}
                        />

                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                        <div className="flex items-center gap-2">
                            <Badge className="bg-yellow-300 text-black">
                                {fmtHMSF(a.time)}
                            </Badge>
                            <MentionDisplayText className="font-medium" text={a.text} />
                        </div>
                    </TooltipContent>
                </Tooltip>
            ))}
        </TooltipProvider>
    );
}
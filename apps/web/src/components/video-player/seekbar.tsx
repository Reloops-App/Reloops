import { useRef, useState, useCallback, useEffect } from "react";
import { Annotation } from "../review/video";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { fmtHMSF } from "@/lib/utils";
import { MentionDisplayText } from "../ui/mention-display";
export function SeekBar({
    current,
    duration,
    annotations,
    onSeek,
}: {
    current: number;
    duration: number;
    annotations: Annotation[];
    onSeek: (t: number) => void;
}) {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    const pct = duration > 0 ? current / duration : 0;

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
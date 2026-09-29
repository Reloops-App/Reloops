import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Orbit, RotateCcw, Scan, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { lazyRoute } from "@/lib/lazyRoute";
import { drawStrokes, getAnnotationFocusPoint } from "@/components/review/annotator-utils";
import { getFallbackPreviewBackground, previewBackgroundClassAlwaysDark } from "@/lib/imagePreviewBackground";
import type { Annotation } from "@/components/review/video";
import { BubblePin } from "@/components/review/shared/PinMarker";
import { getAvatarInitials } from "@/lib/avatar-utils";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Panorama360Viewer = lazyRoute(() => import("@/components/review/Panorama360Viewer"));

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;

export type MobileImageStageHandle = {
    /** Pan/zoom so the pin at the given normalized point sits centre-stage. */
    focusPin: (point: { x: number; y: number }) => void;
};

type Props = {
    src: string | null | undefined;
    mimeType?: string | null;
    annotations: Annotation[];
    /** True while the shell is waiting for the guest to tap a spot to comment. */
    placing: boolean;
    onPlacePin: (x: number, y: number) => void;
    /** Tapping a pin opens the comments sheet on that comment. */
    onPinClick: (annotation: Annotation) => void;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/**
 * The mobile image viewer: the picture maximised between header and action bar
 * on a transparency checkerboard (matching desktop), with touch-first
 * pinch-zoom / drag-pan / double-tap-zoom (none of which desktop `image.tsx`
 * offers). All view controls live behind one small `⋮` button in the corner so
 * they never sit over the artwork; existing comment pins are drawn on the
 * image. In placement mode a tap drops a pin at the normalized point.
 */
const MobileImageStage = forwardRef<MobileImageStageHandle, Props>(function MobileImageStage(
    { src, mimeType, annotations, placing, onPlacePin, onPinClick },
    ref,
) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const naturalRef = useRef({ w: 0, h: 0 });

    const [scale, setScale] = useState(1);
    const [tx, setTx] = useState(0);
    const [ty, setTy] = useState(0);
    const [showAnnotations, setShowAnnotations] = useState(true);
    const [is360, setIs360] = useState(false);
    // The image's displayed content rect (pre-transform), for aligning pins.
    const [imgRect, setImgRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

    const canShow360 = Boolean(mimeType?.startsWith("image/"));
    const bgClass = previewBackgroundClassAlwaysDark(getFallbackPreviewBackground({ mime_type: mimeType }));

    const measureImg = useCallback(() => {
        const img = imgRef.current;
        const box = containerRef.current;
        if (!img || !box) return;
        if (img.naturalWidth) naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight };
        // offset* is the layout size/position of the <img> inside the (untransformed)
        // container; object-contain shrinks the element to the fitted box.
        setImgRect({ left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight });
    }, []);

    // Paint committed annotation drawings (arrows / boxes / freehand made on
    // desktop) onto a canvas that overlays — and scales with — the image.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imgRect.width) return;
        const nat = naturalRef.current;
        const w = Math.min(2400, nat.w || Math.round(imgRect.width * 2));
        const h = nat.h ? Math.round((w / nat.w) * nat.h) : Math.round(imgRect.height * (w / imgRect.width));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const strokes = showAnnotations
            ? annotations.flatMap((a) => a.drawing ?? []).filter((s) => s.points.length >= 2)
            : [];
        drawStrokes(ctx, strokes, w, h);
    }, [annotations, showAnnotations, imgRect.width, imgRect.height]);

    useEffect(() => {
        const img = imgRef.current;
        if (!img) return;
        measureImg();
        const ro = new ResizeObserver(measureImg);
        ro.observe(img);
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, [measureImg]);

    const clampPan = useCallback((nextScale: number, x: number, y: number) => {
        const maxX = Math.max(0, (imgRect.width * nextScale - imgRect.width) / 2);
        const maxY = Math.max(0, (imgRect.height * nextScale - imgRect.height) / 2);
        return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    }, [imgRect.width, imgRect.height]);

    const applyScale = useCallback((next: number, panX = tx, panY = ty) => {
        const s = clamp(next, MIN_SCALE, MAX_SCALE);
        const panned = clampPan(s, s === 1 ? 0 : panX, s === 1 ? 0 : panY);
        setScale(s);
        setTx(panned.x);
        setTy(panned.y);
    }, [tx, ty, clampPan]);

    useImperativeHandle(ref, () => ({
        focusPin: (point) => {
            const s = Math.max(scale, 2);
            const panX = (0.5 - point.x) * imgRect.width * s;
            const panY = (0.5 - point.y) * imgRect.height * s;
            applyScale(s, panX, panY);
        },
    }), [scale, imgRect.width, imgRect.height, applyScale]);

    // reset when the image changes
    useEffect(() => { setScale(1); setTx(0); setTy(0); setIs360(false); }, [src]);

    // ----- gestures -----
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef({
        startDist: 0, startScale: 1, startTx: 0, startTy: 0,
        panId: null as number | null, panStartX: 0, panStartY: 0, moved: false, downTime: 0,
    });
    const lastTap = useRef({ t: 0, x: 0, y: 0 });

    const onPointerDown = (e: React.PointerEvent) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (pointers.current.size === 1) {
            Object.assign(g, { panId: e.pointerId, panStartX: e.clientX, panStartY: e.clientY, startTx: tx, startTy: ty, moved: false, downTime: Date.now() });
        } else if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            Object.assign(g, { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startScale: scale, startTx: tx, startTy: ty, moved: true });
        }
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            applyScale(g.startScale * (dist / g.startDist), g.startTx, g.startTy);
            return;
        }
        if (g.panId === e.pointerId) {
            const dx = e.clientX - g.panStartX;
            const dy = e.clientY - g.panStartY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) g.moved = true;
            if (scale > 1) {
                const panned = clampPan(scale, g.startTx + dx, g.startTy + dy);
                setTx(panned.x);
                setTy(panned.y);
            }
        }
    };

    const endPointer = (e: React.PointerEvent) => {
        const g = gesture.current;
        const wasSingle = pointers.current.size === 1;
        pointers.current.delete(e.pointerId);
        if (!wasSingle || g.panId !== e.pointerId) { g.panId = null; return; }
        g.panId = null;
        if (g.moved || Date.now() - g.downTime > 250) return;

        const img = imgRef.current?.getBoundingClientRect();
        if (placing && img) {
            onPlacePin(clamp((e.clientX - img.left) / img.width, 0, 1), clamp((e.clientY - img.top) / img.height, 0, 1));
            return;
        }
        const now = Date.now();
        const prev = lastTap.current;
        if (now - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
            applyScale(scale > 1 ? 1 : DOUBLE_TAP_SCALE);
            lastTap.current = { t: 0, x: 0, y: 0 };
        } else {
            lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        }
    };

    const pins = showAnnotations
        ? annotations
              .map((a) => ({ a, focus: getAnnotationFocusPoint(a) }))
              .filter((p): p is { a: Annotation; focus: { x: number; y: number } } => Boolean(p.focus))
        : [];

    if (is360) {
        return (
            <div className="relative h-full w-full bg-black">
                <Panorama360Viewer imageUrl={src ?? undefined} className="absolute inset-0" onExit={() => setIs360(false)} />
                <button
                    type="button"
                    onClick={() => setIs360(false)}
                    className="absolute right-3 top-3 z-20 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
                >
                    Exit 360°
                </button>
            </div>
        );
    }

    const transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

    return (
        <div
            ref={containerRef}
            className={cn("relative h-full w-full touch-none overflow-hidden", bgClass)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
        >
            <img
                ref={imgRef}
                src={src ?? undefined}
                alt=""
                draggable={false}
                onLoad={measureImg}
                style={{ transform, transformOrigin: "center" }}
                className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
            />

            {/* drawing + pin layer — overlays the image's content rect, same transform */}
            {imgRect.width > 0 && (
                <div
                    className="absolute"
                    style={{
                        left: imgRect.left,
                        top: imgRect.top,
                        width: imgRect.width,
                        height: imgRect.height,
                        transform,
                        transformOrigin: "center",
                    }}
                >
                    <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                    {pins.map(({ a, focus }) => (
                        <button
                            key={a.id}
                            type="button"
                            aria-label={`Comment by ${a.author || "Guest"}`}
                            onClick={(e) => { e.stopPropagation(); onPinClick(a); }}
                            className="absolute -translate-x-1/2 -translate-y-1/2 active:scale-95"
                            style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
                        >
                            <BubblePin
                                initials={getAvatarInitials(a.author || "?")}
                                userId={a.authorId}
                                userName={a.author}
                                size={26}
                            />
                        </button>
                    ))}
                </div>
            )}

            {placing && <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary/60" />}

            {/* one small, out-of-the-way view-options button */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label="View options"
                        className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
                    >
                        <SlidersHorizontal className="size-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => applyScale(1)}>
                        <Scan className="size-4" /> Fit to screen
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyScale(scale > 1 ? 1 : DOUBLE_TAP_SCALE)}>
                        <RotateCcw className="size-4" /> {scale > 1 ? "Reset zoom" : "Zoom in"}
                    </DropdownMenuItem>
                    {canShow360 && (
                        <DropdownMenuItem onSelect={() => setIs360(true)}>
                            <Orbit className="size-4" /> View in 360°
                        </DropdownMenuItem>
                    )}
                    {pins.length > 0 || !showAnnotations ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem checked={showAnnotations} onCheckedChange={setShowAnnotations}>
                                Show comment pins
                            </DropdownMenuCheckboxItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
});

export default MobileImageStage;

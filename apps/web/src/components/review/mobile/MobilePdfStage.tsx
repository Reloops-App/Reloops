import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Minus, Plus, Scan, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { drawStrokes, getAnnotationFocusPoint } from "@/components/review/annotator-utils";
import type { Annotation, Stroke } from "@/components/review/video";
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

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export type MobilePdfStageHandle = {
    scrollToPage: (page: number) => void;
};

type Props = {
    src: string | null | undefined;
    annotations: Annotation[];
    /** True while the shell is waiting for the guest to tap a spot to comment. */
    placing: boolean;
    onPlacePin: (page: number, x: number, y: number) => void;
    /** Tapping a pin opens the comments sheet on that comment. */
    onPinClick: (annotation: Annotation) => void;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/**
 * The mobile PDF viewer: a thin non-overlapping `‹ Page N / M ›` bar (the
 * desktop viewer has no discrete page control at all), then every page in a
 * native vertical scroll. All view controls live behind one small `⋮` button
 * so nothing sits over the document. Per-page comment pins; tap-to-place-pin in
 * placement mode.
 */
const MobilePdfStage = forwardRef<MobilePdfStageHandle, Props>(function MobilePdfStage(
    { src, annotations, placing, onPlacePin, onPinClick },
    ref,
) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pageEls = useRef(new Map<number, HTMLDivElement>());
    const canvasEls = useRef(new Map<number, HTMLCanvasElement>());
    const [pageSizes, setPageSizes] = useState(new Map<number, { w: number; h: number }>());

    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [containerWidth, setContainerWidth] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [showAnnotations, setShowAnnotations] = useState(true);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => setContainerWidth(el.clientWidth);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const pageWidth = Math.max(1, Math.round((containerWidth - 16) * zoom));

    const scrollToPage = useCallback((page: number) => {
        const target = pageEls.current.get(clamp(page, 1, Math.max(1, numPages)));
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [numPages]);

    useImperativeHandle(ref, () => ({ scrollToPage }), [scrollToPage]);

    useEffect(() => {
        const root = scrollRef.current;
        if (!root || !numPages) return;
        const ratios = new Map<number, number>();
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    ratios.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio);
                }
                let best = currentPage;
                let bestRatio = -1;
                for (const [page, ratio] of ratios) {
                    if (ratio > bestRatio) { bestRatio = ratio; best = page; }
                }
                if (best !== currentPage) setCurrentPage(best);
            },
            { root, threshold: [0.1, 0.25, 0.5, 0.75] },
        );
        for (const el of pageEls.current.values()) io.observe(el);
        return () => io.disconnect();
    }, [numPages, currentPage]);

    const pinsByPage = useMemo(() => {
        const map = new Map<number, Array<{ a: Annotation; focus: { x: number; y: number } }>>();
        if (!showAnnotations) return map;
        for (const a of annotations) {
            if (!a.page || !a.drawing?.length) continue;
            const focus = getAnnotationFocusPoint(a);
            if (!focus) continue;
            const list = map.get(a.page) ?? [];
            list.push({ a, focus });
            map.set(a.page, list);
        }
        return map;
    }, [annotations, showAnnotations]);

    const hasPins = useMemo(() => annotations.some((a) => a.page && a.drawing?.length), [annotations]);

    const strokesByPage = useMemo(() => {
        const map = new Map<number, Stroke[]>();
        for (const a of annotations) {
            if (!a.page || !a.drawing?.length) continue;
            const list = map.get(a.page) ?? [];
            list.push(...a.drawing.filter((s) => s.points.length >= 2));
            map.set(a.page, list);
        }
        return map;
    }, [annotations]);

    const registerPage = useCallback((page: number, el: HTMLDivElement | null) => {
        if (el) pageEls.current.set(page, el);
        else pageEls.current.delete(page);
    }, []);

    // Paint committed annotation drawings onto each page's overlay canvas.
    useEffect(() => {
        for (const [page, size] of pageSizes) {
            const canvas = canvasEls.current.get(page);
            if (!canvas || !size.w) continue;
            canvas.width = size.w;
            canvas.height = size.h;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            drawStrokes(ctx, showAnnotations ? (strokesByPage.get(page) ?? []) : [], size.w, size.h);
        }
    }, [strokesByPage, showAnnotations, pageSizes]);

    const handlePageTap = (page: number) => (e: React.MouseEvent<HTMLDivElement>) => {
        if (!placing) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onPlacePin(
            page,
            clamp((e.clientX - rect.left) / rect.width, 0, 1),
            clamp((e.clientY - rect.top) / rect.height, 0, 1),
        );
    };

    return (
        <div className="flex h-full w-full flex-col bg-neutral-800">
            {/* page navigator — a real bar, not an overlay */}
            <div className="relative flex h-10 shrink-0 items-center justify-center gap-2 border-b border-white/10 bg-neutral-900 text-xs font-medium text-white">
                <button
                    type="button"
                    aria-label="Previous page"
                    disabled={currentPage <= 1}
                    onClick={() => scrollToPage(currentPage - 1)}
                    className="flex size-7 items-center justify-center rounded disabled:opacity-40"
                >
                    <ChevronLeft className="size-4" />
                </button>
                <span className="tabular-nums">Page {currentPage} / {Math.max(1, numPages)}</span>
                <button
                    type="button"
                    aria-label="Next page"
                    disabled={currentPage >= numPages}
                    onClick={() => scrollToPage(currentPage + 1)}
                    className="flex size-7 items-center justify-center rounded disabled:opacity-40"
                >
                    <ChevronRight className="size-4" />
                </button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="View options" className="absolute right-2 flex size-7 items-center justify-center rounded">
                            <SlidersHorizontal className="size-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => setZoom((z) => clamp(z * 1.25, MIN_ZOOM, MAX_ZOOM))}>
                            <Plus className="size-4" /> Zoom in
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setZoom((z) => clamp(z / 1.25, MIN_ZOOM, MAX_ZOOM))}>
                            <Minus className="size-4" /> Zoom out
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setZoom(1)}>
                            <Scan className="size-4" /> Fit width
                        </DropdownMenuItem>
                        {hasPins && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuCheckboxItem checked={showAnnotations} onCheckedChange={setShowAnnotations}>
                                    Show comment pins
                                </DropdownMenuCheckboxItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
                <Document
                    file={src ?? undefined}
                    onLoadSuccess={(doc) => setNumPages(doc.numPages)}
                    loading={<div className="flex h-40 items-center justify-center text-sm text-white/70">Loading PDF…</div>}
                    error={<div className="flex h-40 items-center justify-center text-sm text-white/70">Couldn’t load this PDF.</div>}
                    className="flex flex-col items-center gap-3 py-3"
                >
                    {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
                        <div
                            key={page}
                            data-page={page}
                            ref={(el) => registerPage(page, el)}
                            onClick={handlePageTap(page)}
                            className={cn("relative bg-white shadow-lg", placing && "cursor-crosshair")}
                            style={{ width: pageWidth }}
                        >
                            <Page
                                pageNumber={page}
                                width={pageWidth}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                onRenderSuccess={() => {
                                    const el = pageEls.current.get(page);
                                    if (el) setPageSizes((prev) => new Map(prev).set(page, { w: el.clientWidth, h: el.clientHeight }));
                                }}
                            />
                            <canvas
                                ref={(el) => { if (el) canvasEls.current.set(page, el); else canvasEls.current.delete(page); }}
                                className="pointer-events-none absolute inset-0 h-full w-full"
                            />
                            {(pinsByPage.get(page) ?? []).map(({ a, focus }) => (
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
                                        size={24}
                                    />
                                </button>
                            ))}
                        </div>
                    ))}
                </Document>
            </div>
        </div>
    );
});

export default MobilePdfStage;

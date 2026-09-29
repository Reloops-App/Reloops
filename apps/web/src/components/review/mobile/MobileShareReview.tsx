import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { uid } from "@/components/file-upload-utils";
import { downloadAsset } from "@/lib/utils";
import { lazyRoute } from "@/lib/lazyRoute";
import { createAnchorStroke, getAnnotationFocusPoint } from "@/components/review/annotator-utils";
import type { Annotation } from "@/components/review/video";
import type { ReviewStatus } from "@/components/review/shared/ReviewStatusActions";
import type { ShareIdentity } from "@/lib/shareGuestIdentity";
import { AssetNavArrows } from "@/components/review/shared/AssetNavArrows";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import MobileHeader from "./MobileHeader";
import MobileVideoStage from "./MobileVideoStage";
import MobileActionBar from "./MobileActionBar";
import MobileCommentsSheet from "./MobileCommentsSheet";
import MobileCommentComposerSheet from "./MobileCommentComposerSheet";
import MobileStatusSheet from "./MobileStatusSheet";
import type { MobileImageStageHandle } from "./MobileImageStage";
import type { MobilePdfStageHandle } from "./MobilePdfStage";

const MobileImageStage = lazyRoute(() => import("./MobileImageStage"));
const MobilePdfStage = lazyRoute(() => import("./MobilePdfStage"));

/** Where a not-yet-posted comment is anchored. */
export type PendingAnchor =
    | { kind: "time"; seconds: number }
    | { kind: "point"; x: number; y: number }
    | { kind: "pagePoint"; page: number; x: number; y: number };

export type MobileShareReviewSibling = {
    currentIndex: number;
    total: number;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
};

type Props = {
    kind: "video" | "image" | "pdf";
    title: string;
    mediaUrl: string | null | undefined;
    poster?: string | null;
    mimeType?: string | null;
    annotations: Annotation[];
    identity: ShareIdentity | null;
    status?: string | null;
    allowComments: boolean;
    allowDownload: boolean;
    downloadUrl: string | null;
    downloadFallbackUrl?: string | null;
    /** = the page's `handleAddAnnotation` — identity gating + optimistic POST + per-page comment endpoint unchanged. */
    onAddComment: (annotation: Annotation) => void;
    /** = the page's `handleStatusChange`. Omitted on `ShareCollectionAsset` (no review status). */
    onChangeStatus?: (status: ReviewStatus) => void;
    /** = () => setIdentityPromptOpen(true) — opens <ShareAuthDialog context="comment">. */
    onRequestIdentify: () => void;
    /** Clear the stored guest identity and re-prompt. */
    onChangeIdentity?: () => void;
    /** Prev/next sibling asset (folder or collection). Absent on the single-asset share. */
    sibling?: MobileShareReviewSibling;
};

function formatClock(totalSeconds: number) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The dedicated mobile shell for a single-asset review — video, image or PDF
 * (`≤ 767px`; `ShareAsset` / `ShareProjectAsset` / `ShareCollectionAsset`).
 * Presentation and interaction orchestration are mobile-specific; every piece
 * of data and every action (`annotations`, `identity`, `onAddComment`,
 * `onChangeStatus`, ...) is passed straight through from the page, so the APIs,
 * guest identity, review status, positional annotation model and permissions
 * stay shared with desktop.
 *
 * Layout is a fixed column — header / stage / action bar — with comments,
 * composer and status as bottom sheets over the (paused) media.
 */
export default function MobileShareReview({
    kind,
    title,
    mediaUrl,
    poster,
    mimeType,
    annotations,
    identity,
    status,
    allowComments,
    allowDownload,
    downloadUrl,
    downloadFallbackUrl,
    onAddComment,
    onChangeStatus,
    onRequestIdentify,
    onChangeIdentity,
    sibling,
}: Props) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const imageStageRef = useRef<MobileImageStageHandle | null>(null);
    const pdfStageRef = useRef<MobilePdfStageHandle | null>(null);

    const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
    const [commentPending, setCommentPending] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [composerOpen, setComposerOpen] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
    const [statusOpen, setStatusOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);

    const openCommentThread = useCallback((annotation: Annotation) => {
        setHighlightCommentId(annotation.id);
        setCommentsOpen(true);
    }, []);

    // Gate: open the composer now, or prompt for identity and resume later.
    const proceedToComposer = useCallback(() => {
        setCommentPending(true);
        if (!identity) onRequestIdentify();
        else setComposerOpen(true);
    }, [identity, onRequestIdentify]);

    // beginComment() — from the action bar's "+ Comment".
    // Video: capture the playhead + pause, then straight to the composer.
    // Image/PDF: enter placement mode so the guest taps the spot first.
    const beginComment = useCallback(() => {
        if (kind === "video") {
            const seconds = videoRef.current?.currentTime ?? 0;
            videoRef.current?.pause();
            setPendingAnchor({ kind: "time", seconds });
            proceedToComposer();
            return;
        }
        setPlacing(true);
    }, [kind, proceedToComposer]);

    const handlePlacePin = useCallback((anchor: PendingAnchor) => {
        setPendingAnchor(anchor);
        setPlacing(false);
        proceedToComposer();
    }, [proceedToComposer]);

    // Once the guest identifies (via <ShareAuthDialog context="comment">), pick
    // the flow back up where beginComment()/handlePlacePin() left off.
    useEffect(() => {
        if (identity && commentPending && !composerOpen && !placing) {
            setComposerOpen(true);
        }
    }, [identity, commentPending, composerOpen, placing]);

    const closeComposer = useCallback((open: boolean) => {
        setComposerOpen(open);
        if (!open) {
            setPendingAnchor(null);
            setCommentPending(false);
        }
    }, []);

    const handleComposerSubmit = useCallback((text: string) => {
        const anchor = pendingAnchor;
        const positioned = anchor?.kind === "point" || anchor?.kind === "pagePoint";
        const annotation: Annotation = {
            id: uid(),
            time: anchor?.kind === "time" ? anchor.seconds : Number.NaN,
            page: anchor?.kind === "pagePoint" ? anchor.page : undefined,
            text,
            author: identity?.name ?? undefined,
            authorId: identity?.type === "user" ? identity.userId : undefined,
            createdAt: new Date().toISOString(),
            drawing: positioned ? [createAnchorStroke({ x: anchor.x, y: anchor.y })] : [],
        };
        onAddComment(annotation);
        setPendingAnchor(null);
        setCommentPending(false);
    }, [pendingAnchor, identity, onAddComment]);

    const anchorLabel =
        pendingAnchor?.kind === "time" ? `At ${formatClock(pendingAnchor.seconds)}`
        : pendingAnchor?.kind === "pagePoint" ? `Page ${pendingAnchor.page}`
        : pendingAnchor?.kind === "point" ? "Pinned"
        : null;

    const focusAnnotation = useCallback((annotation: Annotation) => {
        if (kind === "video") {
            const video = videoRef.current;
            if (video && Number.isFinite(annotation.time)) {
                video.currentTime = annotation.time;
                void video.play().catch(() => {});
            }
            return;
        }
        if (kind === "image") {
            const focus = getAnnotationFocusPoint(annotation);
            if (focus) imageStageRef.current?.focusPin(focus);
            return;
        }
        pdfStageRef.current?.scrollToPage(annotation.page ?? 1);
    }, [kind]);

    const handleDownload = useCallback(() => {
        if (!downloadUrl) return;
        downloadAsset(downloadUrl, title || "asset", { fallbackUrl: downloadFallbackUrl ?? undefined });
    }, [downloadUrl, downloadFallbackUrl, title]);

    return (
        <div className="flex flex-col overflow-hidden bg-background [height:100dvh]">
            <MobileHeader
                title={title}
                status={status}
                identityName={identity?.name ?? null}
                allowDownload={allowDownload && Boolean(downloadUrl)}
                onOpenStatus={() => setStatusOpen(true)}
                onDownload={handleDownload}
                onShowInfo={() => setInfoOpen(true)}
                onChangeIdentity={onChangeIdentity}
            />

            {sibling && sibling.total > 1 && (
                <div className="flex h-9 shrink-0 items-center justify-center border-b bg-background">
                    <AssetNavArrows
                        currentIndex={sibling.currentIndex}
                        total={sibling.total}
                        hasPrev={sibling.hasPrev}
                        hasNext={sibling.hasNext}
                        onPrev={sibling.onPrev}
                        onNext={sibling.onNext}
                    />
                </div>
            )}

            <div className="relative min-h-0 flex-1">
                {kind === "video" ? (
                    <MobileVideoStage
                        videoRef={videoRef}
                        src={mediaUrl}
                        poster={poster}
                        markers={annotations.map((a) => a.time).filter((t): t is number => Number.isFinite(t))}
                    />
                ) : kind === "image" ? (
                    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
                        <MobileImageStage
                            ref={imageStageRef}
                            src={mediaUrl}
                            mimeType={mimeType}
                            annotations={annotations}
                            placing={placing}
                            onPlacePin={(x, y) => handlePlacePin({ kind: "point", x, y })}
                            onPinClick={openCommentThread}
                        />
                    </Suspense>
                ) : (
                    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
                        <MobilePdfStage
                            ref={pdfStageRef}
                            src={mediaUrl}
                            annotations={annotations}
                            placing={placing}
                            onPlacePin={(page, x, y) => handlePlacePin({ kind: "pagePoint", page, x, y })}
                            onPinClick={openCommentThread}
                        />
                    </Suspense>
                )}

                {placing && (
                    <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground">
                        <span>Tap {kind === "pdf" ? "the page" : "the image"} to comment</span>
                        <button type="button" aria-label="Cancel" onClick={() => setPlacing(false)}>
                            <X className="size-4" />
                        </button>
                    </div>
                )}
            </div>

            <MobileActionBar
                commentCount={annotations.length}
                allowComments={allowComments}
                onAddComment={beginComment}
                onOpenComments={() => setCommentsOpen(true)}
            />

            {onChangeStatus && (
                <MobileStatusSheet
                    open={statusOpen}
                    onOpenChange={setStatusOpen}
                    status={status}
                    onChange={onChangeStatus}
                />
            )}

            <MobileCommentsSheet
                open={commentsOpen}
                onOpenChange={(open) => { setCommentsOpen(open); if (!open) setHighlightCommentId(null); }}
                annotations={annotations}
                onFocusAnnotation={focusAnnotation}
                highlightId={highlightCommentId}
            />

            <MobileCommentComposerSheet
                open={composerOpen}
                onOpenChange={closeComposer}
                anchorLabel={anchorLabel}
                onClearAnchor={() => setPendingAnchor(null)}
                onSubmit={handleComposerSubmit}
                threadAnnotations={annotations}
            />

            <Drawer open={infoOpen} onOpenChange={setInfoOpen}>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle>Asset info</DrawerTitle>
                        <DrawerDescription className="sr-only">Details about this asset</DrawerDescription>
                    </DrawerHeader>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-sm">
                        <dt className="text-muted-foreground">Name</dt>
                        <dd className="break-words font-medium">{title}</dd>
                        <dt className="text-muted-foreground">Type</dt>
                        <dd className="font-medium">{mimeType || kind}</dd>
                        <dt className="text-muted-foreground">Comments</dt>
                        <dd className="font-medium">{annotations.length}</dd>
                    </dl>
                </DrawerContent>
            </Drawer>
        </div>
    );
}

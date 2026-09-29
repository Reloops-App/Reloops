import { useEffect, useRef, type ReactNode } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { Annotation } from "@/components/review/video";

const MENTION_RE = /@\[([^:]+):([^\]]+)\]/g;

/**
 * Render a comment body with `@[id:Name]` mention tokens shown as inline pills
 * (a slim mobile version of `CommentsPanel`'s `renderCommentText` — no
 * tooltip/avatar/role, just legibility).
 */
function renderCommentBody(text: string): ReactNode {
    const nodes: ReactNode[] = [];
    let last = 0;
    let key = 0;
    let match: RegExpExecArray | null;
    MENTION_RE.lastIndex = 0;
    while ((match = MENTION_RE.exec(text))) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        nodes.push(
            <span key={`m${key++}`} className="mx-0.5 rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">
                @{match[2]}
            </span>,
        );
        last = match.index + match[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes.length ? nodes : text;
}

function formatClock(totalSeconds: number) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Where the comment is anchored, for the row chip. */
function anchorChip(annotation: Annotation): string | null {
    if (Number.isFinite(annotation.time)) return formatClock(annotation.time);
    if (annotation.page) return `Page ${annotation.page}`;
    if (annotation.drawing?.length) return "Pin";
    return null;
}

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    annotations: Annotation[];
    /**
     * Reveal a comment's anchor and close the sheet — video seeks to its
     * timestamp, image pans to its pin, pdf scrolls to its page.
     */
    onFocusAnnotation: (annotation: Annotation) => void;
    /** A comment to scroll to + flash — set when a guest taps its pin on the media. */
    highlightId?: string | null;
};

/**
 * The existing comments, in a draggable bottom sheet (priority 4). Reuses the
 * shared annotation data verbatim — only the presentation is mobile-specific.
 * Mentions are rendered as `@Name` (not the raw `@[id:Name]` token).
 */
export default function MobileCommentsSheet({ open, onOpenChange, annotations, onFocusAnnotation, highlightId }: Props) {
    const rowRefs = useRef(new Map<string, HTMLLIElement>());
    const ordered = [...annotations].sort((a, b) => {
        const at = Number.isFinite(a.time) ? a.time : Number.POSITIVE_INFINITY;
        const bt = Number.isFinite(b.time) ? b.time : Number.POSITIVE_INFINITY;
        if (at !== bt) return at - bt;
        return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

    useEffect(() => {
        if (!open || !highlightId) return;
        const id = setTimeout(() => {
            rowRefs.current.get(highlightId)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);
        return () => clearTimeout(id);
    }, [open, highlightId]);

    return (
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent className="max-h-[85vh]">
                <DrawerHeader>
                    <DrawerTitle>Comments</DrawerTitle>
                    <DrawerDescription className="sr-only">Feedback left on this asset</DrawerDescription>
                </DrawerHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {ordered.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            No comments yet — be the first.
                        </p>
                    ) : (
                        <ul className="divide-y">
                            {ordered.map((annotation) => {
                                const chip = anchorChip(annotation);
                                const highlighted = annotation.id === highlightId;
                                return (
                                    <li
                                        key={annotation.id}
                                        ref={(el) => { if (el) rowRefs.current.set(annotation.id, el); else rowRefs.current.delete(annotation.id); }}
                                        className={cn("-mx-2 rounded-md px-2 transition-colors", highlighted && "bg-primary/10")}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => { onFocusAnnotation(annotation); onOpenChange(false); }}
                                            className="flex w-full flex-col items-start gap-1 py-3 text-left"
                                        >
                                            <span className="flex items-center gap-2 text-sm font-medium">
                                                {annotation.author || "Guest"}
                                                {chip && (
                                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
                                                        {chip}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="whitespace-pre-wrap text-sm text-foreground/90">
                                                {renderCommentBody(annotation.text)}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </DrawerContent>
        </Drawer>
    );
}

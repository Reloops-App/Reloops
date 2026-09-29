import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { SimpleMentionTextareaFinal } from "@/components/ui/simple-mention-textarea-final";
import type { MentionableUser } from "@/hooks/useMentionableUsers";
import type { Annotation } from "@/components/review/video";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Human label for where the comment is anchored, built by the shell:
     * `"0:42"` (video timestamp), `"Page 3"` (pdf), `"Pinned"` (image), or
     * `null` for an un-anchored comment.
     */
    anchorLabel: string | null;
    /** Drop the anchor — posts the comment un-pinned / at 0:00. */
    onClearAnchor: () => void;
    /** Post the comment text (internal `@[id:Name]` mention format); the shell builds the `Annotation`. */
    onSubmit: (text: string) => void;
    /** Existing comments — the pool for `@`-mention autocomplete (people already in this thread). */
    threadAnnotations: Annotation[];
};

/**
 * The comment composer, in a keyboard-aware bottom sheet (priority 3). Shows
 * the captured anchor as a removable chip, a focused mention-aware textarea,
 * and "Post comment". `@`-autocomplete is populated from the people already in
 * the thread (guests have no session to fetch the workspace member list).
 */
export default function MobileCommentComposerSheet({
    open,
    onOpenChange,
    anchorLabel,
    onClearAnchor,
    onSubmit,
    threadAnnotations,
}: Props) {
    const [text, setText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const mentionUsers = useMemo<MentionableUser[]>(() => {
        const seen = new Map<string, MentionableUser>();
        for (const a of threadAnnotations) {
            if (!a.authorId || seen.has(a.authorId)) continue;
            seen.set(a.authorId, {
                id: a.authorId,
                display_name: a.author ?? null,
                avatar_url: null,
                category: "recent_collaborator",
                categoryLabel: "In this thread",
            });
        }
        return [...seen.values()];
    }, [threadAnnotations]);

    useEffect(() => {
        if (open) {
            setText("");
            const id = setTimeout(() => textareaRef.current?.focus(), 80);
            return () => clearTimeout(id);
        }
    }, [open]);

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        onOpenChange(false);
    };

    return (
        <Drawer open={open} onOpenChange={onOpenChange} repositionInputs>
            <DrawerContent className="max-h-[80vh]">
                <DrawerHeader>
                    <DrawerTitle>Add a comment</DrawerTitle>
                    <DrawerDescription className="sr-only">Leave feedback on this asset</DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {anchorLabel != null && (
                        <button
                            type="button"
                            onClick={onClearAnchor}
                            className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground"
                        >
                            {anchorLabel}
                            <X className="size-3.5" />
                        </button>
                    )}
                    <SimpleMentionTextareaFinal
                        ref={textareaRef}
                        value={text}
                        onChange={setText}
                        usersOverride={mentionUsers}
                        placeholder="Add a comment... use @ to mention"
                        placement="top"
                        maxHeight={160}
                        className="w-full rounded-md border bg-background p-3 text-base"
                    />
                    <Button className="h-11 text-base" onClick={submit} disabled={!text.trim()}>
                        Post comment
                    </Button>
                </div>
            </DrawerContent>
        </Drawer>
    );
}

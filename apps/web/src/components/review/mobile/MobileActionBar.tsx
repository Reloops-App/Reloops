import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
    commentCount: number;
    allowComments: boolean;
    onAddComment: () => void;
    onOpenComments: () => void;
};

/**
 * The persistent bottom action bar (~60px, safe-area padded). `+ Comment` is
 * the visually dominant primary action (calls the shell's `beginComment()`);
 * `Comments N` is the secondary action that opens the comments sheet. This is
 * priority 3 + 4 of the mobile info hierarchy, always reachable without
 * scrolling.
 */
export default function MobileActionBar({ commentCount, allowComments, onAddComment, onOpenComments }: Props) {
    return (
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {allowComments && (
                <Button className="h-11 flex-1 gap-2 text-base" onClick={onAddComment}>
                    <MessageSquarePlus className="size-5" />
                    Comment
                </Button>
            )}
            <Button
                variant="outline"
                className="h-11 gap-2"
                onClick={onOpenComments}
                aria-label={`Comments ${commentCount}`}
            >
                <MessageSquareText className="size-5" />
                <span>{commentCount}</span>
            </Button>
        </div>
    );
}

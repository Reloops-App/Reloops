import { Badge } from "lucide-react";

export function EmojiPill({ emoji, count }: { emoji: string; count: number }) {
    return (
        <Badge variant="outline" className="h-6 px-2 gap-1 rounded-full border-white/10">
            <span className="text-base leading-none">{emoji}</span>
            <span className="text-xs tabular-nums leading-none">{count}</span>
        </Badge>
    );
}

export function DotSep() {
    return <span className="mx-1 text-white/20">•</span>;
}
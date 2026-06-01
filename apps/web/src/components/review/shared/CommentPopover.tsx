import { formatRelativeTime } from "../CommentsPanel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MoreVertical, X, ArrowRight, Edit2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS, getUserAvatarColor } from "@/lib/avatar-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type CommentPopoverProps = {
  author: string;
  authorId?: string;
  text: string;
  createdAt?: string;
  onClose: () => void;
  onComplete?: () => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isCompleted?: boolean;
  className?: string;
};

export function CommentPopover({
  author,
  authorId,
  text,
  createdAt,
  onClose,
  onComplete,
  onReply,
  onEdit,
  onDelete,
  isCompleted,
  className
}: CommentPopoverProps) {
  return (
    <div 
      className={cn(
        "z-50 w-[280px] rounded-[20px] border border-white/10 bg-white p-4 shadow-[0_20px_50px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-200 animate-in fade-in zoom-in-95 dark:bg-slate-900/98",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-6 w-6">
            <AvatarFallback 
              className={cn("text-[10px]", AVATAR_FALLBACK_CLASS)}
              style={{ backgroundColor: getUserAvatarColor(authorId, author) }}
            >
              {getAvatarInitials(author)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-sm font-bold text-foreground leading-none">
              {author}
            </span>
            <span className="text-[10px] text-muted-foreground/60 mt-0.5">
              {formatRelativeTime(createdAt)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 -mt-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 rounded-full",
              isCompleted ? "text-green-500 bg-green-500/10" : "text-muted-foreground hover:text-green-500 hover:bg-green-500/10"
            )}
            onClick={onComplete}
          >
            <CheckCircle2 className={cn("h-4 w-4", isCompleted && "fill-current")} />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 rounded-xl border-white/10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/95">
              <DropdownMenuItem 
                onClick={onEdit}
                className="flex items-center gap-2 text-xs font-medium focus:bg-sidebar-accent"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={onDelete}
                className="flex items-center gap-2 text-xs font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 text-[13px] leading-relaxed text-foreground/90 break-words font-medium">
        {text}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 dark:border-white/5">
        <button 
          onClick={onReply}
          className="group flex items-center gap-1 text-[11px] font-bold text-foreground hover:opacity-70 transition-opacity uppercase tracking-wider"
        >
          Reply <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}


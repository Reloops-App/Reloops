import { useRef, useEffect, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { SimpleMentionTextareaFinal } from "@/components/ui/simple-mention-textarea-final";

type InlineNoteComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  color?: string;
  label?: string;
  hint?: string;
  autoFocus?: boolean;
  // Optional drag-handle wiring so the composer -- not just its pin -- can be
  // grabbed to reposition. Omitted by callers that don't support dragging.
  onDragHandlePointerDown?: (e: ReactPointerEvent) => void;
  onDragHandlePointerMove?: (e: ReactPointerEvent) => void;
  onDragHandlePointerUp?: (e: ReactPointerEvent) => void;
  isDragging?: boolean;
  // Threaded through to SimpleMentionTextareaFinal so "@" mentions work here
  // too, not just in the always-visible BottomCommentDock.
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
};

export function InlineNoteComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  color = "#ff7a00",
  label = "Add note",
  hint = "Ctrl+Enter to submit",
  autoFocus = true,
  onDragHandlePointerDown,
  onDragHandlePointerMove,
  onDragHandlePointerUp,
  isDragging,
  projectId,
  organizationId,
  workspaceId,
  assetId,
}: InlineNoteComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) {
      // Small delay to let the DOM settle after positioning
      const timer = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  return (
    <div className="rounded-2xl border border-border dark:border-white/10 bg-popover/96 dark:bg-[#0f1422]/96 p-2.5 shadow-[0_18px_44px_rgba(15,23,42,0.28)] backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {onDragHandlePointerDown ? (
            <button
              type="button"
              className={cn(
                "-ml-1 flex h-5 w-4 shrink-0 touch-none items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-accent hover:text-muted-foreground",
                isDragging ? "cursor-grabbing" : "cursor-grab"
              )}
              title="Drag to move"
              onPointerDown={onDragHandlePointerDown}
              onPointerMove={onDragHandlePointerMove}
              onPointerUp={onDragHandlePointerUp}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[11px] font-medium text-foreground">{label}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <SimpleMentionTextareaFinal
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Type feedback here..."
        projectId={projectId}
        organizationId={organizationId}
        workspaceId={workspaceId}
        assetId={assetId}
        className="min-h-[72px] w-full resize-none rounded-xl border border-border dark:border-white/10 bg-muted/40 dark:bg-black/10 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring dark:focus:border-white/20 focus:ring-2 focus:ring-ring/20 dark:focus:ring-white/10 placeholder:text-muted-foreground/70"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{hint}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-md px-2 text-xs"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            disabled={!value.trim()}
            onClick={onSubmit}
          >
            <Send className="mr-1.5 h-3 w-3" />
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}

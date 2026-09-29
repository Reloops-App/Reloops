import { Button } from "@/components/ui/button";
import { SimpleMentionTextareaFinal } from '../../ui/simple-mention-textarea-final';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Loader2, Send, Undo2, Pen, Minus, X, MessageSquare } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Tool } from "../annotator-utils";

export type CommentDockMode = "view" | "comment" | "draw";

type BottomCommentDockProps = {
  // Timestamp
  currentTime?: number; // seconds for video, undefined for images
  includeTimestamp: boolean;
  onToggleTimestamp: () => void;
  formatTime?: (seconds: number) => string;

  // Annotation state
  annotating: boolean;
  onToggleAnnotating: () => void;
  reviewMode?: CommentDockMode;
  onReviewModeChange?: (mode: CommentDockMode) => void;

  // Drawing tools
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  color: string;
  onColorChange: (color: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;

  // Comment submission
  onSubmit: (text: string) => void | Promise<void>;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  showAnnotationControls?: boolean;

  // Optional mentions
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
};

const COLORS = ["#ffd400", "#ff55cc", "#8dfd00", "#ff7a00", "#ff0000"]; // Yellow, Pink, Green, Orange, Red

const defaultFormatTime = (seconds: number): string => {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const f = Math.floor((seconds * 30) % 30); // Assume 30fps for frame
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};

export default function BottomCommentDock({
  currentTime,
  includeTimestamp,
  onToggleTimestamp,
  formatTime = defaultFormatTime,
  annotating,
  onToggleAnnotating,
  reviewMode,
  onReviewModeChange,
  tool,
  onToolChange,
  color,
  onColorChange,
  canUndo,
  onUndo,
  onClear,
  onSubmit,
  value,
  onChange,
  showAnnotationControls = true,
  projectId,
  organizationId,
  workspaceId,
  assetId,
}: BottomCommentDockProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uncontrolledTextValue, setUncontrolledTextValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textValue = value ?? uncontrolledTextValue;
  const setTextValue = useCallback((nextValue: string) => {
    if (value === undefined) {
      setUncontrolledTextValue(nextValue);
    }
    onChange?.(nextValue);
  }, [onChange, value]);

  const timeDisplay = currentTime !== undefined ? formatTime(currentTime) : null;
  const activeReviewMode = reviewMode ?? (annotating ? "draw" : "view");
  const annotationMode = showAnnotationControls && (activeReviewMode === "comment" || activeReviewMode === "draw");
  const canChangeReviewMode = showAnnotationControls && Boolean(onReviewModeChange);
  const showAnnotationTools = showAnnotationControls && (canChangeReviewMode ? annotationMode : annotating);

  const exitAnnotationMode = () => {
    if (onReviewModeChange) {
      onReviewModeChange("view");
      return;
    }
    onToggleAnnotating();
  };

  const enterCommentMode = () => {
    if (onReviewModeChange) {
      onReviewModeChange("comment");
      return;
    }
    onToggleAnnotating();
  };

  const enterDrawMode = (nextTool?: Tool) => {
    if (onReviewModeChange) {
      onReviewModeChange("draw");
    } else if (!annotating) {
      onToggleAnnotating();
    }

    if (nextTool) {
      onToolChange(nextTool);
    }
  };

  const handleSubmit = async () => {
    const text = textValue.trim();
    if (!text || isSubmitting) return;

    const previousText = textValue;
    setIsSubmitting(true);
    setTextValue("");

    try {
      await onSubmit(text);
    } catch (error) {
      setTextValue(previousText);
      textareaRef.current?.focus();
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };


  // Shared textarea component with rich text overlay
  const textareaElement = (
    <div className="flex-1 relative min-w-0 max-w-full overflow-hidden">
      {/* Mention-aware textarea */}
      <SimpleMentionTextareaFinal
        ref={textareaRef}
        value={textValue}
        onChange={setTextValue}
        onKeyDown={handleKeyDown}
        placeholder={showAnnotationTools ? "Add a comment..." : "Add a comment..."}
        disabled={isSubmitting}
        projectId={projectId}
        organizationId={organizationId}
        workspaceId={workspaceId}
        assetId={assetId}
        placement="top"
        className={cn(
          "relative z-20 w-full min-h-[2rem] resize-none overflow-hidden placeholder:text-sidebar-foreground/50 transition-all focus:ring-1",
          "text-sidebar-foreground bg-sidebar-accent/30 border-sidebar-border/50 focus:border-sidebar-ring focus:ring-sidebar-ring/20",
          isSubmitting && "opacity-70",
          showAnnotationTools ? "text-sm" : ""
        )}
        style={{
          minHeight: '2.25rem',
          lineHeight: '1.5',
          wordWrap: 'break-word',
          overflowWrap: 'break-word'
        }}
      />

      {/* Status indicators in top-right */}
      <div className="absolute top-1 right-1 flex items-center gap-1">
        {showAnnotationTools && (
          <div className="flex items-center gap-1 bg-primary/20 text-primary-foreground/80 px-1.5 py-0.5 rounded text-xs">
            <Pen className="h-3 w-3" />
          </div>
        )}
      </div>
    </div>
  );

  const sendButton = (
    <Button
      size="icon"
      className={cn(
        "h-8 w-8 shrink-0 bg-primary text-primary-foreground transition-all hover:bg-primary/90",
        textValue.trim() && !isSubmitting && "shadow-[0_0_0_3px_rgba(255,255,255,0.08)]",
      )}
      onClick={() => void handleSubmit()}
      disabled={!textValue.trim() || isSubmitting}
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Send className="h-4 w-4" />
      )}
    </Button>
  );

  return (
    <div className="w-full max-w-full flex-shrink-0 overflow-hidden border-t border-sidebar-border bg-sidebar/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-sidebar/75">
      {showAnnotationTools ? (
        // Annotation Mode - Match the reference image exactly
        <div className="space-y-2">
          {/* Top row - timestamp + input + send */}
          <div className="flex items-end gap-2">
            {textareaElement}
            {sendButton}
          </div>

          {/* Bottom row - back arrow + tools */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Back arrow */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              onClick={exitAnnotationMode}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </Button>

            {canChangeReviewMode && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7",
                        activeReviewMode === "comment"
                          ? "bg-primary text-primary-foreground"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50"
                      )}
                      onClick={enterCommentMode}
                    >
                      <MessageSquare className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Place comment</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Undo/Redo */}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", canUndo ? "text-sidebar-foreground/80 hover:bg-sidebar-accent/50" : "text-sidebar-foreground/30")}
              onClick={onUndo}
              disabled={!canUndo}
            >
              <Undo2 className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", canUndo ? "text-sidebar-foreground/80 hover:bg-sidebar-accent/50" : "text-sidebar-foreground/30")}
              onClick={onClear}
              disabled={!canUndo}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6H19Z" />
              </svg>
            </Button>

            {/* Tools */}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", activeReviewMode === "draw" && tool === "pen" ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50")}
              onClick={() => enterDrawMode("pen")}
            >
              <Pen className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", activeReviewMode === "draw" && tool === "line" ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50")}
              onClick={() => enterDrawMode("line")}
            >
              <Minus className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", activeReviewMode === "draw" && tool === "arrow" ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50")}
              onClick={() => enterDrawMode("arrow")}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 19L19 5M19 5v8M19 5h-8" />
              </svg>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", activeReviewMode === "draw" && tool === "rect" ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50")}
              onClick={() => enterDrawMode("rect")}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              </svg>
            </Button>

            {/* Colors */}
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    "h-5 w-5 shrink-0 rounded-full border transition-all",
                    color === c ? "border-sidebar-foreground border-2 ring-1 ring-sidebar-foreground/20" : "border-sidebar-border hover:border-sidebar-foreground/60"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => onColorChange(c)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        // Comment Mode - Simple single row
        <div className="space-y-2">
          {/* Timestamp Tag - Outside the editor */}
          {includeTimestamp && timeDisplay && (
            <div className="flex items-center">
              <div className="flex items-center gap-1 bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded-full text-xs font-medium border border-yellow-400/30">
                <Clock className="h-3 w-3" />
                <span>{timeDisplay}</span>
                <button
                  onClick={onToggleTimestamp}
                  className="ml-1 hover:bg-yellow-400/20 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Top row - comment input only */}
          <div className="flex items-end gap-2">
            {textareaElement}
          </div>

          {/* Bottom row - timestamp + annotate button + send button */}
          <div className="flex items-center gap-1">
            {/* Timestamp */}
            {timeDisplay && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                    className={cn(
                        "h-7 shrink-0 px-2 text-xs font-mono transition-colors",
                        includeTimestamp
                          ? "text-yellow-400 hover:bg-sidebar-accent/50"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
                      )}
                      onClick={onToggleTimestamp}
                    >
                      <Clock className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {includeTimestamp ? "Remove timestamp" : "Include timestamp"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {canChangeReviewMode ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      onClick={enterCommentMode}
                    >
                      <MessageSquare className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Place comment</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      onClick={() => enterDrawMode(tool)}
                    >
                      <Pen className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Draw annotation</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : showAnnotationControls ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      onClick={onToggleAnnotating}
                    >
                      <Pen className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Annotate</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}

            {/* Spacer to push send button to the right */}
            <div className="flex-1" />

            {/* Send button on the right */}
            {sendButton}
          </div>
        </div>
      )}
    </div>
  );
}

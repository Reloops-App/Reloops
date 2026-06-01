import { cn } from "@/lib/utils";
import { Eye, MessageSquare, PenSquare, Smartphone } from "lucide-react";
import type { Tool } from "../annotator-utils";

export type ReviewMode = "view" | "comment" | "draw" | "preview";

const ANNOTATION_COLORS = ["#ff7a00", "#ffd400", "#ff55cc", "#8dfd00", "#ff0000"];
const DRAW_TOOL_OPTIONS: Array<{ id: Tool; label: string }> = [
  { id: "pen", label: "Pen" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
  { id: "rect", label: "Box" },
];

type ReviewModeBarProps = {
  mode: ReviewMode;
  onModeChange: (mode: ReviewMode) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  color: string;
  onColorChange: (color: string) => void;
  hidePreview?: boolean;
};

export function ReviewModeBar({
  mode,
  onModeChange,
  tool,
  onToolChange,
  color,
  onColorChange,
  hidePreview,
}: ReviewModeBarProps) {
  return (
    <div className="relative z-10 hidden shrink-0 border-b border-white/6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:block">
      {/* 3-col grid: left spacer | centered tabs | right tools — tabs never move */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3 py-1.5">
        {/* Left spacer — shows hint in comment mode */}
        <div className="flex items-center justify-start">
          {mode === "comment" && (
            <span className="text-[11px] text-muted-foreground animate-in fade-in duration-150">
              Click to place a pin
            </span>
          )}
        </div>

        {/* Center: mode tabs — always centered */}
        <div className="bg-muted/50 p-0.5 rounded-md flex items-center border border-white/6">
          <button
            onClick={() => onModeChange("view")}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
              mode === "view"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Eye className="h-3 w-3" />
            View
          </button>
          {!hidePreview && (
            <button
              onClick={() => onModeChange("preview")}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
                mode === "preview"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Smartphone className="h-3 w-3" />
              Preview
            </button>
          )}
          <button
            onClick={() => onModeChange("comment")}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
              mode === "comment"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare className="h-3 w-3" />
            Comment
          </button>
          <button
            onClick={() => onModeChange("draw")}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
              mode === "draw"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <PenSquare className="h-3 w-3" />
            Draw
          </button>
        </div>

        {/* Right: draw tools + colors — only in draw mode */}
        <div className="flex items-center justify-end gap-2">
          {mode === "draw" && (
            <>
              <div className="flex items-center gap-0.5 rounded-md border border-white/6 bg-muted/30 px-0.5 py-0.5 animate-in fade-in duration-150">
                {DRAW_TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-medium transition",
                      tool === option.id
                        ? "bg-white/[0.12] text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => onToolChange(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 animate-in fade-in duration-150">
                {ANNOTATION_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={cn(
                      "h-3.5 w-3.5 rounded-full border transition",
                      color === swatch
                        ? "scale-110 border-white ring-1 ring-white/30"
                        : "border-white/25 hover:border-white/60"
                    )}
                    style={{ backgroundColor: swatch }}
                    onClick={() => onColorChange(swatch)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Tool } from "../annotator-utils";

type Props = {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  color: string;
  onColorChange: (c: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
  onExit: () => void;
};

export default function DrawingToolbelt({
  tool,
  onToolChange,
  color,
  onColorChange,
  canUndo,
  onUndo,
  onClear,
  onExit,
}: Props) {
  const COLORS = ["#ff55cc", "#ffd400", "#8dfd00", "#ff7a00"];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", tool === "pen" && "bg-white/10")}
                onClick={() => onToolChange("pen")}
                aria-label="Pen (P)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 20l9-9-3-3-9 9-3 6z" fill="currentColor" /></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Pen · P</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", tool === "line" && "bg-white/10")}
                onClick={() => onToolChange("line")}
                aria-label="Line (L)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 20L20 4" stroke="currentColor" strokeWidth="2" /></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Line · L</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", tool === "arrow" && "bg-white/10")}
                onClick={() => onToolChange("arrow")}
                aria-label="Arrow (A)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 19L19 5M19 5v8M19 5h-8" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Arrow · A</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", tool === "rect" && "bg-white/10")}
                onClick={() => onToolChange("rect")}
                aria-label="Rectangle (R)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Rect · R</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            className={cn(
              "h-5 w-5 rounded-full ring-2 transition",
              color === c ? "ring-foreground" : "ring-transparent hover:ring-white/40"
            )}
            style={{ background: c }}
            onClick={() => onColorChange(c)}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onUndo} disabled={!canUndo}>
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={onClear}
          disabled={!canUndo}
        >
          Clear
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onExit} aria-label="Exit annotate (Esc)">
          Exit
        </Button>
      </div>
    </div>
  );
}

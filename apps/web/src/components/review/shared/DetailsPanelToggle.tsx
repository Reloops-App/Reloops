import { MessageSquareText, PanelRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onToggle: () => void;
  className?: string;
};

/**
 * The comments / details panel toggle in a review header.
 *
 * Desktop (`lg+`): the icon-only sidebar-panel button, unchanged — the tooltip
 * plus the side-by-side layout make it obvious.
 *
 * Mobile (`< lg`): the layout is a vertical stack, so a bare "flip a panel"
 * square communicates nothing. Show a labelled "Show / Hide comments" button
 * with a speech-bubble icon instead.
 */
export function DetailsPanelToggle({ open, onToggle, className }: Props) {
  const label = open ? "Hide comments" : "Show comments";

  return (
    <>
      {/* Mobile: labelled, styled to match the other header controls */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("shrink-0 gap-1.5 lg:hidden", open && "border-primary/30 bg-primary/10 text-primary", className)}
        onClick={onToggle}
        aria-label={label}
        aria-pressed={open}
      >
        <MessageSquareText className="h-4 w-4" />
        {label}
      </Button>

      {/* Desktop: icon-only, unchanged */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "hidden size-9 shrink-0 border border-transparent transition-colors lg:inline-flex",
          open
            ? "text-muted-foreground hover:bg-accent hover:text-foreground"
            : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
          className,
        )}
        onClick={onToggle}
        aria-label={label}
        aria-pressed={open}
        title={label}
      >
        <PanelRightIcon
          className={cn("h-4 w-4 transition-transform duration-150", !open && "-scale-x-100")}
        />
        <span className="sr-only">{label}</span>
      </Button>
    </>
  );
}

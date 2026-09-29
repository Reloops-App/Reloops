import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isReviewUiTarget } from "@/components/review/image";

export type AssetNavArrowsProps = {
  /** 0-based index of the current asset within the sibling list, -1 if unknown. */
  currentIndex: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** True while a navigation is in flight, to prevent double-fires. */
  disabled?: boolean;
  className?: string;
};

/**
 * Frame.io-style "‹ 8 of 12 ›" cluster for stepping between sibling assets
 * (same folder or same collection) without leaving the review view. Renders
 * nothing when there's no meaningful list to step through, rather than a
 * misleading "? of N" counter.
 */
export function AssetNavArrows({
  currentIndex,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  disabled = false,
  className,
}: AssetNavArrowsProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (disabled) return;
      if (isReviewUiTarget(event.target)) return;
      if (event.key === "ArrowLeft" && hasPrev) {
        event.preventDefault();
        onPrev();
      } else if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, hasPrev, hasNext, onPrev, onNext]);

  if (total <= 1 || currentIndex < 0) return null;

  return (
    <div
      className={cn("flex shrink-0 items-center gap-0.5", className)}
      data-review-ui="true"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        disabled={disabled || !hasPrev}
        onClick={onPrev}
        aria-label="Previous asset"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="min-w-[3.25rem] select-none text-center text-[11px] tabular-nums text-muted-foreground">
        {currentIndex + 1} of {total}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        disabled={disabled || !hasNext}
        onClick={onNext}
        aria-label="Next asset"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

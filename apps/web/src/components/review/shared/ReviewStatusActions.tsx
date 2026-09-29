import { CheckCircle2, ChevronDown, Circle, PickaxeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ReviewStatus = "needs_review" | "in_review" | "approved";

export const REVIEW_STATUS_ACTIONS: Array<{ status: ReviewStatus; label: string; icon: typeof Circle }> = [
  { status: "needs_review", label: "Needs review", icon: Circle },
  { status: "in_review", label: "Request changes", icon: PickaxeIcon },
  { status: "approved", label: "Approve", icon: CheckCircle2 },
];

type Props = {
  status: string | null | undefined;
  onChange: (status: ReviewStatus) => void;
  className?: string;
};

/**
 * The review status control. Desktop (`sm+`) keeps the familiar row of three
 * labelled buttons, byte-for-byte as it was inline in the share pages. On a
 * phone (`< sm`), where the icon-only buttons ("Needs review" / a pickaxe /
 * a check) were unreadable, it collapses to a single "Set status" dropdown.
 */
export function ReviewStatusActions({ status, onChange, className }: Props) {
  const current = REVIEW_STATUS_ACTIONS.find((action) => action.status === status) ?? null;

  return (
    <>
      {/* Desktop: the original three buttons, unchanged */}
      <div className={cn("hidden items-center gap-1 sm:flex", className)}>
        {REVIEW_STATUS_ACTIONS.map(({ status: value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={status === value ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => onChange(value)}
            title={label}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}
      </div>

      {/* Mobile: one compact dropdown */}
      <div className={cn("sm:hidden", className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={current ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              aria-label="Set review status"
            >
              {current ? <current.icon className="h-4 w-4" /> : null}
              <span>{current ? current.label : "Set status"}</span>
              <ChevronDown className="h-4 w-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {REVIEW_STATUS_ACTIONS.map(({ status: value, label, icon: Icon }) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => onChange(value)}
                className={cn("gap-2", status === value && "font-medium text-foreground")}
              >
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

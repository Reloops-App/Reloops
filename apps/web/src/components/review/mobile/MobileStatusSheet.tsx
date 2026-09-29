import { Check } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { REVIEW_STATUS_ACTIONS, type ReviewStatus } from "@/components/review/shared/ReviewStatusActions";
import { cn } from "@/lib/utils";

/** State colour for the leading dot — the only place review state gets a hue. */
export const MOBILE_STATUS_TONE: Record<ReviewStatus, string> = {
    needs_review: "text-amber-500",
    in_review: "text-orange-500",
    approved: "text-emerald-500",
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    status?: string | null;
    onChange: (status: ReviewStatus) => void;
};

/**
 * The review status control (priority 5). A dedicated bottom sheet rather than a
 * buried `•••` submenu: the three states are full-width rows with the current
 * one checked, so "what is it now / what can I set it to" is answerable in one
 * tap from the header pill.
 */
export default function MobileStatusSheet({ open, onOpenChange, status, onChange }: Props) {
    return (
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>Review status</DrawerTitle>
                    <DrawerDescription className="sr-only">Set the review status for this asset</DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {REVIEW_STATUS_ACTIONS.map(({ status: value, label, icon: Icon }) => {
                        const active = status === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                onClick={() => { onChange(value); onOpenChange(false); }}
                                className={cn(
                                    "flex h-12 items-center gap-3 rounded-md px-3 text-left text-[15px]",
                                    active ? "font-medium" : "text-foreground/90",
                                )}
                            >
                                <Icon className={cn("size-5 shrink-0", MOBILE_STATUS_TONE[value])} />
                                <span className="flex-1">{label}</span>
                                {active && <Check className="size-5 shrink-0 text-primary" />}
                            </button>
                        );
                    })}
                </div>
            </DrawerContent>
        </Drawer>
    );
}

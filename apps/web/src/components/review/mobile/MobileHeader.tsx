import { ChevronDown, Download, Info, MoreVertical, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REVIEW_STATUS_ACTIONS } from "@/components/review/shared/ReviewStatusActions";
import { MOBILE_STATUS_TONE } from "./MobileStatusSheet";
import { cn } from "@/lib/utils";

type Props = {
    title: string;
    status?: string | null;
    identityName?: string | null;
    allowDownload: boolean;
    /** Open the dedicated review-status sheet. */
    onOpenStatus: () => void;
    onDownload: () => void;
    onShowInfo: () => void;
    onChangeIdentity?: () => void;
};

/**
 * The mobile review header (~54px): the asset title (truncated), a single
 * tappable review-status pill (priority 5 — always visible so the current
 * state is obvious, opens {@link MobileStatusSheet}), and a `•••` menu for the
 * lower-priority "settings" bucket (download, asset info, identity). The status
 * pill is the *only* review-state control in the header.
 */
export default function MobileHeader({
    title,
    status,
    identityName,
    allowDownload,
    onOpenStatus,
    onDownload,
    onShowInfo,
    onChangeIdentity,
}: Props) {
    const current = REVIEW_STATUS_ACTIONS.find((action) => action.status === status) ?? null;
    const StatusIcon = current?.icon;

    return (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>

            <button
                type="button"
                onClick={onOpenStatus}
                aria-label={current ? `Review status: ${current.label}` : "Set review status"}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-muted/60 pl-2.5 pr-1.5 text-xs font-medium"
            >
                {StatusIcon && current ? (
                    <StatusIcon className={cn("size-3.5", MOBILE_STATUS_TONE[current.status])} />
                ) : (
                    <span className="size-2 rounded-full bg-muted-foreground/50" />
                )}
                <span className="max-w-[8rem] truncate">{current ? current.label : "Set status"}</span>
                <ChevronDown className="size-3.5 opacity-60" />
            </button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="More options">
                        <MoreVertical className="size-5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    {allowDownload && (
                        <DropdownMenuItem onSelect={onDownload}>
                            <Download className="size-4" />
                            <span>Download</span>
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuItem onSelect={onShowInfo}>
                        <Info className="size-4" />
                        <span>Asset info</span>
                    </DropdownMenuItem>

                    {identityName && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
                                <UserRound className="size-4" />
                                <span className="truncate">Viewing as {identityName}</span>
                            </DropdownMenuLabel>
                            {onChangeIdentity && (
                                <DropdownMenuItem onSelect={onChangeIdentity}>Change identity</DropdownMenuItem>
                            )}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}

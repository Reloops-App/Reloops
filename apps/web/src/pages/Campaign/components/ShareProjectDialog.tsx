"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
    Copy,
    Check,
    Globe,
    Lock,
    Upload,
    Download,
    Loader2,
    Trash2,
    CalendarIcon,
    ExternalLink,
    Sparkles,
    Folder,
    File as FileIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";

type ExpirationOption = "never" | "7days" | "30days" | "custom";

// Caps the selection preview grid so the dialog stays a fixed size no matter
// how many folders/files are selected -- extras collapse into a "+N more" tile.
const MAX_SELECTION_PREVIEW_TILES = 8;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectName?: string;
    targetKind?: "project" | "folder" | "selection";
    selectionItems?: {
        folders: { id: string; name: string }[];
        files: { id: string; name: string; coverUrl: string | null; type: string }[];
    };
    onCreateLink?: (options: { expiresAt: Date | null; allowUpload: boolean; allowDownload: boolean; password: string | null }) => Promise<string>;
    onRevokeLink?: () => Promise<void>;
    existingShareUrl?: string | null;
};

function maskToken(url: string): string {
    const parts = url.split('/');
    const token = parts[parts.length - 1];
    if (token && token.length > 4) {
        const masked = token.substring(0, 4) + '••••';
        parts[parts.length - 1] = masked;
        return parts.join('/');
    }
    return url;
}

export function ShareProjectDialog({
    open,
    onOpenChange,
    projectName,
    targetKind = "project",
    selectionItems,
    onCreateLink,
    onRevokeLink,
    existingShareUrl,
}: Props) {
    const [copied, setCopied] = useState(false);

    // Form state — expiration, upload permission, download permission
    const [expiration, setExpiration] = useState<ExpirationOption>("never");
    const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
    const [allowUpload, setAllowUpload] = useState(false);
    const [allowDownload, setAllowDownload] = useState(true);
    const [requirePassword, setRequirePassword] = useState(false);
    const [password, setPassword] = useState("");
    const [datePickerOpen, setDatePickerOpen] = useState(false);

    // Creation state
    const [isCreating, setIsCreating] = useState(false);
    const [createdUrl, setCreatedUrl] = useState<string | null>(null);
    const [isRevoking, setIsRevoking] = useState(false);

    // Determine if we're showing existing (masked) vs freshly created URL
    const [showMasked, setShowMasked] = useState(false);

    useEffect(() => {
        if (open) {
            if (existingShareUrl && !createdUrl) {
                setShowMasked(true);
            }
        } else {
            setCreatedUrl(null);
            setShowMasked(false);
        }
    }, [open, existingShareUrl, createdUrl]);

    const displayUrl = createdUrl || existingShareUrl;
    const hasLink = !!displayUrl;

    // Shows exactly which folders/files are in a mixed selection share --
    // real thumbnails where available, a folder icon otherwise, with the
    // name visible as a caption (not just a hover tooltip). Capped at a
    // fixed tile count (with a "+N more" tile) so the dialog stays a fixed
    // size no matter how large the selection is -- an uncapped grid grew the
    // dialog taller/wider with every extra item selected.
    const selectionPreviewItems = selectionItems ? [
        ...selectionItems.folders.map((folder) => ({ kind: "folder" as const, id: folder.id, name: folder.name, coverUrl: null as string | null })),
        ...selectionItems.files.map((file) => ({ kind: "file" as const, id: file.id, name: file.name, coverUrl: file.coverUrl })),
    ] : [];
    const selectionPreviewVisible = selectionPreviewItems.slice(0, MAX_SELECTION_PREVIEW_TILES);
    const selectionPreviewOverflow = selectionPreviewItems.length - selectionPreviewVisible.length;

    const selectionPreview = targetKind === "selection" && selectionPreviewItems.length > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
            {selectionPreviewVisible.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="flex w-16 flex-col items-center gap-1">
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
                        {item.kind === "file" && item.coverUrl ? (
                            <img src={item.coverUrl} alt="" className="h-full w-full object-cover" />
                        ) : item.kind === "folder" ? (
                            <Folder className="h-6 w-6 text-muted-foreground" />
                        ) : (
                            <FileIcon className="h-6 w-6 text-muted-foreground" />
                        )}
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground" title={item.name}>
                        {item.name}
                    </span>
                </div>
            ))}
            {selectionPreviewOverflow > 0 ? (
                <div className="flex w-16 flex-col items-center gap-1">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted/40 text-sm font-medium text-muted-foreground">
                        +{selectionPreviewOverflow}
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">more</span>
                </div>
            ) : null}
        </div>
    ) : null;

    const handleCopy = async () => {
        if (!displayUrl) return;
        try {
            await navigator.clipboard.writeText(displayUrl);
            setCopied(true);
            toast.success("Link copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            toast.error("Failed to copy link");
        }
    };

    const getExpirationDate = (): Date | null => {
        switch (expiration) {
            case "never":
                return null;
            case "7days":
                return addDays(new Date(), 7);
            case "30days":
                return addDays(new Date(), 30);
            case "custom":
                return customDate || null;
            default:
                return null;
        }
    };

    const handleCreate = async () => {
        if (!onCreateLink) return;

        setIsCreating(true);
        try {
            const url = await onCreateLink({
                expiresAt: getExpirationDate(),
                allowUpload,
                allowDownload,
                password: requirePassword && password.trim() ? password.trim() : null,
            });
            setCreatedUrl(url);
            setShowMasked(false);
            toast.success("Share link created!");
        } catch (e) {
            console.error(e);
            toast.error("Failed to create share link");
        } finally {
            setIsCreating(false);
        }
    };

    const handleRevoke = async () => {
        if (!onRevokeLink) return;

        setIsRevoking(true);
        try {
            await onRevokeLink();
            setCreatedUrl(null);
            toast.success("Share link revoked");
        } catch (e) {
            console.error(e);
            toast.error("Failed to revoke share link");
        } finally {
            setIsRevoking(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[440px] w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] p-0 gap-0 overflow-hidden">
                <div className="relative min-w-0 px-6 pt-6 pb-4">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-xl font-semibold">
                            {hasLink ? "Share Link Ready" : (targetKind === "selection" ? "Share Selection" : targetKind === "folder" ? "Share Folder" : "Share Project")}
                        </DialogTitle>
                        {projectName && (
                            <DialogDescription className="truncate text-sm">
                                {projectName}
                            </DialogDescription>
                        )}
                    </DialogHeader>
                </div>

                <div className="px-6 pb-6 min-w-0 overflow-hidden">
                    {hasLink ? (
                        <div className="space-y-5 min-w-0">
                            {selectionPreview}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20">
                                    <Check className="w-5 h-5 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-600 dark:text-emerald-400">Link created</p>
                                    <p className="text-xs text-muted-foreground">Ready to share</p>
                                </div>
                            </div>

                            <div className="rounded-xl border bg-muted/40 p-1 overflow-hidden">
                                <div className="flex items-center gap-2 p-3 pr-2 min-w-0">
                                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
                                        <Globe className="w-4 h-4 text-primary" />
                                    </div>
                                    <code className="flex-1 text-xs font-mono truncate text-foreground/80 min-w-0">
                                        {showMasked && existingShareUrl
                                            ? maskToken(existingShareUrl)
                                            : displayUrl}
                                    </code>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCopy}
                                            className="h-8 px-3 gap-1.5 text-xs"
                                        >
                                            {copied ? (
                                                <>
                                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                                    <span className="text-emerald-500">Copied</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-3.5 h-3.5" />
                                                    <span>Copy</span>
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            asChild
                                        >
                                            <a href={displayUrl || "#"} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <Button
                                variant="outline"
                                className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                onClick={handleRevoke}
                                disabled={isRevoking}
                            >
                                {isRevoking ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Revoking…
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        Revoke link
                                    </>
                                )}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-5 min-w-0">
                            {selectionPreview}
                            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/50 to-muted/20 p-4">
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/20">
                                            <Globe className="w-4 h-4 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">Anyone with the link can view</p>
                                            <p className="text-xs text-muted-foreground">No login required</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                            <Lock className="w-4 h-4 text-amber-500" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">
                                                {targetKind === "selection" ? "Only these items are visible" : targetKind === "folder" ? "Only this folder is visible" : "Only this project is visible"}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {targetKind === "selection"
                                                    ? "Guests never see the rest of the project"
                                                    : targetKind === "folder"
                                                        ? "Guests never see the rest of the project, or other projects"
                                                        : "Guests never see other projects or workspaces"}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Link expiration</Label>
                                    <Select
                                        value={expiration}
                                        onValueChange={(v) => {
                                            setExpiration(v as ExpirationOption);
                                            if (v === "custom") {
                                                setDatePickerOpen(true);
                                            }
                                        }}
                                    >
                                        <SelectTrigger className="w-full h-11 bg-muted/40">
                                            <SelectValue placeholder="Select expiration" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="never">
                                                <span className="flex items-center gap-2">
                                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                                    Never expires
                                                </span>
                                            </SelectItem>
                                            <SelectItem value="7days">7 days</SelectItem>
                                            <SelectItem value="30days">30 days</SelectItem>
                                            <SelectItem value="custom">
                                                <span className="flex items-center gap-2">
                                                    <CalendarIcon className="w-3.5 h-3.5" />
                                                    Custom date
                                                </span>
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>

                                    {expiration === "custom" && (
                                        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    className={cn(
                                                        "w-full justify-start text-left font-normal h-11 bg-muted/40",
                                                        !customDate && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {customDate ? format(customDate, "PPP") : "Pick expiration date"}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={customDate}
                                                    onSelect={(date) => {
                                                        setCustomDate(date);
                                                        setDatePickerOpen(false);
                                                    }}
                                                    disabled={(date) => date < new Date()}
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                </div>

                                {targetKind !== "selection" ? (
                                    <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10">
                                                <Upload className="w-4 h-4 text-blue-500" />
                                            </div>
                                            <div>
                                                <Label htmlFor="allow-upload" className="font-medium cursor-pointer">
                                                    Allow guest uploads
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
                                                    {targetKind === "folder" ? "Guests can add new files to this folder" : "Guests can add new files to this project"}
                                                </p>
                                            </div>
                                        </div>
                                        <Switch
                                            id="allow-upload"
                                            checked={allowUpload}
                                            onCheckedChange={setAllowUpload}
                                        />
                                    </div>
                                ) : null}

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10">
                                            <Download className="w-4 h-4 text-emerald-500" />
                                        </div>
                                        <div>
                                            <Label htmlFor="allow-download" className="font-medium cursor-pointer">
                                                Allow downloads
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Guests can download the original files
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        id="allow-download"
                                        checked={allowDownload}
                                        onCheckedChange={setAllowDownload}
                                    />
                                </div>

                                <div className="space-y-2 p-4 rounded-xl border bg-muted/30">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10">
                                                <Lock className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <div>
                                                <Label htmlFor="require-password" className="font-medium cursor-pointer">
                                                    Require a password
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
                                                    Guests must enter this password to view {targetKind === "selection" ? "these items" : targetKind === "folder" ? "the folder" : "the project"}
                                                </p>
                                            </div>
                                        </div>
                                        <Switch
                                            id="require-password"
                                            checked={requirePassword}
                                            onCheckedChange={(checked) => {
                                                setRequirePassword(checked);
                                                if (!checked) setPassword("");
                                            }}
                                        />
                                    </div>
                                    {requirePassword && (
                                        <Input
                                            type="text"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Enter a password"
                                            className="h-10 bg-background"
                                            autoComplete="off"
                                        />
                                    )}
                                </div>
                            </div>

                            <Button
                                onClick={handleCreate}
                                disabled={isCreating || (expiration === "custom" && !customDate) || (requirePassword && !password.trim())}
                                className="w-full h-12 text-base font-medium gap-2 shadow-lg shadow-primary/20"
                                size="lg"
                            >
                                {isCreating ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creating…
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        Create share link
                                    </>
                                )}
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

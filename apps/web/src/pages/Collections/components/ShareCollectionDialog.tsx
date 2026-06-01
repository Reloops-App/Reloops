"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
    Download,
    Loader2,
    Trash2,
    CalendarIcon,
    ExternalLink,
    Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";

type ExpirationOption = "never" | "7days" | "30days" | "custom";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    collectionName?: string;
    onCreateLink?: (options: { expiresAt: Date | null; allowDownload: boolean; allowComments: boolean }) => Promise<string>;
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

export function ShareCollectionDialog({
    open,
    onOpenChange,
    collectionName,
    onCreateLink,
    onRevokeLink,
    existingShareUrl
}: Props) {
    const [copied, setCopied] = useState(false);

    // Form state
    const [expiration, setExpiration] = useState<ExpirationOption>("never");
    const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
    const [allowDownload, setAllowDownload] = useState(true);
    const [allowComments, setAllowComments] = useState(true);
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
        if (!onCreateLink) {
            setIsCreating(true);
            await new Promise(r => setTimeout(r, 1000));
            setCreatedUrl(`https://app.example.com/share/abc123xyz789`);
            setIsCreating(false);
            toast.success("Share link created!");
            return;
        }

        setIsCreating(true);
        try {
            const url = await onCreateLink({
                expiresAt: getExpirationDate(),
                allowDownload,
                allowComments
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
        if (!onRevokeLink) {
            setIsRevoking(true);
            await new Promise(r => setTimeout(r, 500));
            setCreatedUrl(null);
            setIsRevoking(false);
            toast.success("Share link revoked");
            return;
        }

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
            <DialogContent className="sm:max-w-[440px] w-[calc(100%-2rem)] p-0 gap-0 overflow-hidden">
                {/* Header with gradient accent */}
                <div className="relative px-6 pt-6 pb-4">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-xl font-semibold">
                            {hasLink ? "Share Link Ready" : "Create Share Link"}
                        </DialogTitle>
                        {collectionName && (
                            <DialogDescription className="truncate text-sm">
                                {collectionName}
                            </DialogDescription>
                        )}
                    </DialogHeader>
                </div>

                {/* Content */}
                <div className="px-6 pb-6 min-w-0 overflow-hidden">
                    {/* Link Created State */}
                    {hasLink ? (
                        <div className="space-y-5 min-w-0">
                            {/* Success Banner */}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20">
                                    <Check className="w-5 h-5 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-600 dark:text-emerald-400">Link created</p>
                                    <p className="text-xs text-muted-foreground">Ready to share</p>
                                </div>
                            </div>

                            {/* URL Display Card */}
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

                            {/* Revoke Link */}
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
                        /* Link Creation Form */
                        <div className="space-y-5 min-w-0">
                            {/* Info Card */}
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
                                            <p className="text-sm font-medium">Locked to current items</p>
                                            <p className="text-xs text-muted-foreground">Changes may reflect based on collection filters</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Settings Section */}
                            <div className="space-y-4">
                                {/* Expiration */}
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

                                {/* Permissions */}
                                <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10">
                                            <Download className="w-4 h-4 text-blue-500" />
                                        </div>
                                        <div>
                                            <Label htmlFor="allow-download" className="font-medium cursor-pointer">
                                                Allow download
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Viewers can download the file
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        id="allow-download"
                                        checked={allowDownload}
                                        onCheckedChange={setAllowDownload}
                                    />
                                </div>
                                <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-500/10">
                                            <Globe className="w-4 h-4 text-green-500" />
                                        </div>
                                        <div>
                                            <Label htmlFor="allow-comments" className="font-medium cursor-pointer">
                                                Allow comments
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Viewers can add comments
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        id="allow-comments"
                                        checked={allowComments}
                                        onCheckedChange={setAllowComments}
                                    />
                                </div>
                            </div>

                            {/* Create Button */}
                            <Button
                                onClick={handleCreate}
                                disabled={isCreating || (expiration === "custom" && !customDate)}
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

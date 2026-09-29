import React from "react";
import {
    X,
    CheckCircle,
    AlertCircle,
    FileVideo,
    Image as ImageIcon,
    Loader2,
    FileText,
    UploadCloud,
    MoreHorizontal,
} from "lucide-react";
import { formatBytes, formatDuration, formatTransferRate, UploadItem } from "../file-upload-utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { getFileTypeVisual } from "@/lib/designFiles";
import { FILE_TYPE_KIND_COLOR_CLASS, FILE_TYPE_KIND_ICONS } from "@/lib/fileTypeVisuals";

function uploadStatusLabel(item: UploadItem) {
    if (item.status === "error") return "Upload failed";
    if (item.status === "canceled") return "Canceled";
    if (item.status === "completed") return "Upload complete";
    if (item.phase === "prepare") return "Preparing...";
    if (item.phase === "finalize" || item.phase === "processing") return "Processing...";
    if (item.phase === "thumbnail") return "Generating thumbnail...";
    return "Uploading...";
}

function UploadFileIcon({ item }: { item: UploadItem }) {
    if (item.status === "error") return <AlertCircle className="h-4 w-4 text-red-400" />;
    if (item.status === "completed") return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    if (item.phase === "thumbnail" || item.phase === "prepare" || item.phase === "finalize" || item.phase === "processing") {
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    }
    if (item.type.startsWith("video/")) return <FileVideo className="h-4 w-4 text-primary" />;
    if (item.type.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-primary" />;
    const fileTypeVisual = getFileTypeVisual({ type: item.type, name: item.name });
    if (fileTypeVisual) {
        const FileTypeIcon = FILE_TYPE_KIND_ICONS[fileTypeVisual.kind];
        return <FileTypeIcon className={cn("h-4 w-4", FILE_TYPE_KIND_COLOR_CLASS[fileTypeVisual.kind])} />;
    }
    return <FileText className="h-4 w-4 text-primary" />;
}

export const UploadProgressCard = React.memo(({
    item,
    onCancel,
    entranceDelay = 0,
}: {
    item: UploadItem;
    onCancel: (id: string) => void;
    entranceDelay?: number;
}) => {
    const isError = item.status === "error";
    const isCanceled = item.status === "canceled";
    const isDone = item.status === "completed";
    const isActive = !isDone && !isError && !isCanceled;
    const relativeSegments = (item.relativePath ?? "").split("/").filter(Boolean);
    const folderPath = relativeSegments.length > 1 ? relativeSegments.slice(0, -1).join(" / ") : null;
    const statusLabel = uploadStatusLabel(item);
    const [now, setNow] = React.useState(() => Date.now());
    const progressValue = Math.max(0, Math.min(item.progress || 0, 100));
    const uploadedBytes = Math.max(0, Math.min(
        item.size,
        item.uploadedBytes ?? Math.floor((item.size * progressValue) / 100)
    ));
    const elapsedMs = item.uploadStartedAt ? Math.max(0, (item.uploadFinishedAt ?? now) - item.uploadStartedAt) : 0;
    const transferRate = elapsedMs > 0 && uploadedBytes > 0 ? uploadedBytes / (elapsedMs / 1000) : 0;
    const showUploadStats = Boolean(item.uploadStartedAt || uploadedBytes > 0 || isActive);

    React.useEffect(() => {
        if (!isActive || !item.uploadStartedAt) return;
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, [isActive, item.uploadStartedAt]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ duration: 0.22, ease: "easeOut", delay: entranceDelay }}
            className={cn(
                "group relative m-0 flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-0 shadow-sm transition-[border-color,box-shadow,background-color] duration-200",
                isError ? "border-red-500/45 bg-red-950/10 shadow-red-500/10" : "border-border/70",
                isDone && "border-emerald-500/45 shadow-emerald-500/10",
                isActive && "border-primary/25 shadow-primary/5",
            )}
        >
            <div className="relative h-[156px] shrink-0 overflow-hidden rounded-b-none rounded-t-xl bg-muted/30">
                {item.coverUrl ? (
                    <motion.img
                        src={item.coverUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.22 }}
                    />
                ) : (
                    <div className="h-full w-full overflow-hidden bg-muted dark:bg-[#252b3f]">
                        <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.07)_42%,transparent_72%)] animate-[slide-right-scan_1.65s_ease-in-out_infinite]" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(124,94,255,0.16),transparent_32%)]" />
                    </div>
                )}

                <div className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/35 p-1.5 text-white/45 backdrop-blur-sm">
                    <span className="block h-3.5 w-3.5 rounded-sm border border-current" />
                </div>

                <div className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/35 p-1.5 text-white/45 backdrop-blur-sm">
                    <MoreHorizontal className="h-4 w-4" />
                </div>

                {isActive ? (
                    <div className="absolute inset-x-3 bottom-3 overflow-hidden rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-sm">
                        <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                            <motion.div
                                className="absolute inset-y-0 left-0 rounded-full bg-primary/85"
                                initial={false}
                                animate={{ width: `${progressValue}%` }}
                                transition={{ duration: 0.18, ease: "easeOut" }}
                            />
                        </div>
                    </div>
                ) : null}

                {isDone ? (
                    <motion.div
                        className="absolute inset-0 border-2 border-emerald-400/35"
                        initial={{ opacity: 0.85 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.65, ease: "easeOut" }}
                    />
                ) : null}
            </div>

            <div className="flex min-h-[112px] flex-col gap-3 p-3">
                <div className="min-w-0">
                    <p className={cn("truncate text-sm font-semibold leading-tight text-foreground", isError && "text-red-700 dark:text-red-300")}>
                        {item.name}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <UploadFileIcon item={item} />
                        <span className={cn("truncate", isError && "text-red-700 dark:text-red-300", isDone && "text-emerald-700 dark:text-emerald-300")}>
                            {statusLabel}
                        </span>
                    </div>
                    {folderPath ? (
                        <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground/75">
                            <UploadCloud className="h-3 w-3 shrink-0" />
                            <span className="truncate">{folderPath}</span>
                        </p>
                    ) : null}
                </div>

                <div className={cn(
                    "mt-auto rounded-lg border border-border/55 bg-muted/25 px-2.5 py-2 text-xs text-muted-foreground",
                    !isDone && !isError && !isCanceled && "pr-9"
                )}>
                    {showUploadStats ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate tabular-nums">
                                    {formatBytes(uploadedBytes)} / {formatBytes(item.size)}
                                </span>
                                <span className="shrink-0 tabular-nums">{progressValue}%</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate">Time spent</span>
                                <span className="shrink-0 tabular-nums">{formatDuration(elapsedMs)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate">Rate</span>
                                <span className="shrink-0 tabular-nums">{formatTransferRate(transferRate)}</span>
                            </div>
                        </div>
                    ) : (
                        <span className="block truncate">{formatBytes(item.size)}</span>
                    )}
                    {!isDone && !isError && !isCanceled ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-2 right-2 h-6 w-6 shrink-0 rounded-full bg-background/80 text-muted-foreground shadow-sm hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300"
                            onClick={() => onCancel(item.id)}
                            title="Cancel upload"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    ) : null}
                </div>

                {item.errorMessage ? (
                    <motion.p
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-[11px] font-medium leading-snug text-red-700 dark:text-red-300"
                    >
                        {item.errorMessage}
                    </motion.p>
                ) : null}
            </div>
        </motion.div>
    );
});

UploadProgressCard.displayName = "UploadProgressCard";

import React, { useState, useEffect } from "react";
import { X, CheckCircle, AlertCircle, FileVideo, Image as ImageIcon, Loader2, FileText, UploadCloud } from "lucide-react";
import { formatBytes, UploadItem } from "../file-upload-utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export const UploadProgressCard = React.memo(({
    item,
    onCancel,
}: {
    item: UploadItem;
    onCancel: (id: string) => void;
}) => {
    const isError = item.status === "error";
    const isCanceled = item.status === "canceled";
    const isDone = item.status === "completed";
    const isPreparing = item.phase === "prepare";
    const isThumbnailing = item.phase === "thumbnail";
    const isProcessing = item.phase === "processing" || item.phase === "finalize";
    const relativeSegments = (item.relativePath ?? "").split("/").filter(Boolean);
    const folderPath = relativeSegments.length > 1 ? relativeSegments.slice(0, -1).join(" / ") : null;
    const isFolderUpload = Boolean(folderPath);

    const isVid = item.type.startsWith("video/");
    const isImg = item.type.startsWith("image/");

    const showCircularProgress = isThumbnailing;

    const [speed, setSpeed] = useState<string>("");
    const [timeLeft, setTimeLeft] = useState<string>("");
    const [lastProgress, setLastProgress] = useState<{ time: number, bytes: number } | null>(null);

    useEffect(() => {
        if (item.status !== "uploading") {
            setSpeed("");
            setTimeLeft("");
            return;
        }

        const now = Date.now();
        const uploadedBytes = (item.progress / 100) * item.size;

        if (lastProgress && now - lastProgress.time > 2000) {
            const deltaBytes = uploadedBytes - lastProgress.bytes;
            const deltaTime = (now - lastProgress.time) / 1000;
            if (deltaTime > 0) {
                const bps = deltaBytes / deltaTime;
                setSpeed(`${formatBytes(bps)}/s`);

                const remaining = item.size - uploadedBytes;
                const secondsLeft = remaining / bps;
                if (secondsLeft < 60) setTimeLeft(`${Math.ceil(secondsLeft)}s left`);
                else setTimeLeft(`${Math.ceil(secondsLeft / 60)}m left`);
            }
            setLastProgress({ time: now, bytes: uploadedBytes });
        } else if (!lastProgress) {
            setLastProgress({ time: now, bytes: uploadedBytes });
        }
    }, [item.progress, item.status, item.size, lastProgress]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.9, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={cn(
                "group relative flex flex-col w-full aspect-[4/3] sm:aspect-auto sm:h-[180px] rounded-[1.25rem] border bg-card/90 backdrop-blur-xl shadow-lg overflow-hidden transition-all duration-500",
                isError ? "border-red-500/40 shadow-red-500/10" : "border-border/40",
                isDone ? "border-green-500/40 shadow-green-500/10" : "",
                !isDone && !isError && !isCanceled && "border-primary/30 shadow-[0_8px_30px_rgba(var(--primary),0.12)] hover:shadow-[0_8px_40px_rgba(var(--primary),0.2)]"
            )}
        >
            {/* Glowing active state */}
            {!isDone && !isError && !isCanceled && (
                <div className="absolute inset-0 z-0 pointer-events-none rounded-[1.25rem] ring-1 ring-inset ring-primary/20 animate-pulse" />
            )}

            {/* Background Image / Gradient */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                {item.coverUrl ? (
                    <>
                        <img src={item.coverUrl} className="w-full h-full object-cover opacity-50 transition-transform duration-700 group-hover:scale-110" alt="" />
                        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/70 to-background/20" />
                    </>
                ) : (
                    <div className="w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background/50 to-background opacity-90" />
                )}
            </div>

            {/* Content Container */}
            <div className="relative z-10 flex flex-col h-full p-4">
                {/* Header */}
                <div className="flex justify-between items-start mb-auto">
                    <div className={cn(
                        "p-2.5 rounded-xl bg-background/60 backdrop-blur-md border border-white/5 shadow-sm",
                        showCircularProgress && "p-3 rounded-2xl"
                    )}>
                        {isError ? <AlertCircle className="size-5 text-red-500" /> :
                         isDone ? <CheckCircle className="size-5 text-green-500" /> :
                         showCircularProgress ? (
                           <div className="relative flex size-11 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_12px_24px_rgba(251,191,36,0.12)]">
                             <div className="absolute inset-0 rounded-full border-[3px] border-amber-500/15" />
                             <Loader2 className="size-5 animate-spin text-amber-500" />
                           </div>
                         ) :
                         isPreparing || isProcessing ? <Loader2 className="size-5 text-amber-500 animate-spin" /> :
                         isVid ? <FileVideo className="size-5 text-primary" /> : 
                         isImg ? <ImageIcon className="size-5 text-primary" /> : 
                         <FileText className="size-5 text-primary" />}
                    </div>
                    
                    {!isDone && !isError && !isCanceled && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-background/40 hover:bg-red-500/20 hover:text-red-500 backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                            onClick={() => onCancel(item.id)}
                            title="Cancel upload"
                        >
                            <X className="size-4" />
                        </Button>
                    )}
                </div>

                {/* Info & Progress */}
                <div className="mt-4 space-y-3.5">
                    <div>
                        <p className={cn("text-sm font-semibold leading-tight truncate text-foreground shadow-sm", isError && "text-red-500")}>
                            {item.name}
                        </p>
                        {isFolderUpload && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                                <UploadCloud className="size-3" /> {folderPath}
                            </p>
                        )}
                        <div className="flex justify-between items-center mt-1.5">
                            <p className="text-[11px] text-muted-foreground/80 font-medium tracking-wide">
                                {formatBytes(item.size)} {speed && `• ${speed}`}
                            </p>
                            {/* Phase/Time Text */}
                            <AnimatePresence mode="wait">
                                {(isPreparing || isProcessing || isThumbnailing || item.status === "uploading") && (
                                    <motion.p 
                                        key={item.phase}
                                        initial={{ opacity: 0, y: 5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="text-[11px] font-bold text-primary tracking-wide"
                                    >
                                        {item.phase === "prepare" ? "PREPARING..." :
                                         item.phase === "upload" ? (timeLeft ? timeLeft.toUpperCase() : "UPLOADING...") :
                                         item.phase === "finalize" ? "FINALIZING..." :
                                         item.phase === "thumbnail" ? "PROCESSING THUMBNAIL..." : "PROCESSING..."}
                                    </motion.p>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    {showCircularProgress ? (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-5 text-center">
                            <div className="relative flex size-16 items-center justify-center rounded-full border border-amber-500/20 bg-background/70 shadow-[0_0_0_1px_rgba(251,191,36,0.08),0_12px_30px_rgba(251,191,36,0.12)]">
                                <div className="absolute inset-0 rounded-full border-[4px] border-amber-500/12" />
                                <Loader2 className="size-7 animate-spin text-amber-500" />
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-500">
                                    Processing thumbnail
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                    Finalizing preview for this file
                                </p>
                            </div>
                        </div>
                    ) : !isCanceled && !isDone && !isError && (
                        <div className="relative h-2 w-full bg-muted/40 rounded-full overflow-hidden backdrop-blur-md border border-white/5 shadow-inner">
                            <motion.div
                                className={cn(
                                    "absolute top-0 left-0 h-full rounded-full relative overflow-hidden",
                                    isPreparing ? "bg-sky-500" :
                                    isProcessing ? "bg-amber-500" : "bg-primary"
                                )}
                                initial={{ width: "0%" }}
                                animate={{ width: isPreparing || isProcessing ? "100%" : `${item.progress}%` }}
                                transition={{ type: "spring", stiffness: 60, damping: 15 }}
                            >
                                <motion.div
                                    className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-20deg]"
                                    animate={{ x: ["-100%", "200%"] }}
                                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                />
                            </motion.div>
                        </div>
                    )}

                    {/* Error Message */}
                    {item.errorMessage && (
                        <motion.p 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="text-[11px] text-red-500 font-medium leading-tight line-clamp-2 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"
                        >
                            {item.errorMessage}
                        </motion.p>
                    )}
                </div>
            </div>
        </motion.div>
    );
});

UploadProgressCard.displayName = "UploadProgressCard";

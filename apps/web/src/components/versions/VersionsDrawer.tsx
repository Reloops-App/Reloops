'use client';

import { Asset } from "@/pages/Campaign/CampaignTypes";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../ui/drawer";
import { formatTimetoDayMonth } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";

function VersionDrawerCard({ v, onOpenVersion, onDeleteVersion }: {
    v: Asset;
    onOpenVersion: (assetId: string) => void;
    onDeleteVersion?: (assetId: string) => void;
}) {
    const previewBackground = useImagePreviewBackground({ src: v.coverUrl ?? undefined, mime_type: v.type });

    return (
        <div className="relative overflow-hidden rounded-xl border">
            <div className={previewBackgroundClass(previewBackground) + " aspect-video w-full"}>
                {v.coverUrl ? (
                    <img src={v.coverUrl} alt={v.name} className="aspect-video w-full object-cover" />
                ) : (
                    <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No preview</div>
                )}
            </div>
            <div className="p-3 text-sm">
                <div className="font-medium">v{v.version_no ?? '?'}</div>
                <div className="text-muted-foreground">{v.createdAt ? formatTimetoDayMonth(v.createdAt) : ''}</div>
            </div>
            <div className="flex gap-2 p-3 pt-0">
                <Button size="sm" variant="secondary" onClick={() => onOpenVersion(v.id)}>Open</Button>
                {onDeleteVersion && (
                    <Button size="sm" variant="outline" onClick={() => onDeleteVersion(v.id)}>Delete</Button>
                )}
            </div>
        </div>
    );
}

export function VersionDrawer({
    open,
    onOpenChange,
    stack,
    onOpenVersion,
    onDeleteVersion,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    stack: Asset[]; // newest first
    onOpenVersion: (assetId: string) => void;
    onDeleteVersion?: (assetId: string) => void;
}) {
    const top = stack[0];
    return (
        <Drawer open={open} onOpenChange={onOpenChange}>
            <DrawerContent className="max-h-[85vh]">
                <DrawerHeader>
                    <DrawerTitle className="text-left">{top?.name} — Versions</DrawerTitle>
                </DrawerHeader>
                <ScrollArea className="px-6 pb-6">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        {stack.map((v) => (
                            <VersionDrawerCard
                                key={v.id}
                                v={v}
                                onOpenVersion={onOpenVersion}
                                onDeleteVersion={onDeleteVersion}
                            />
                        ))}
                    </div>
                </ScrollArea>
            </DrawerContent>
        </Drawer>
    );
}

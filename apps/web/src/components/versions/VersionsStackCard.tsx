// --- VersionStackCard.tsx (template with quick wins applied) ---
"use client";

import React, { useMemo, useState, useEffect } from "react";
import { AssetCard as BaseAssetCard } from "@/pages/Campaign/components/AssetCard";
import { Asset } from "@/pages/Campaign/CampaignTypes";
import { getDesignAssetLabel, isDesignPreviewUnavailableAsset } from "@/lib/designFiles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  GripVertical,
  X,
  RotateCcw,
  Image as ImageIcon,
  Film,
  FileAudio2,
  FileText as FileTextIcon,
  FileType2,
  Palette,
} from "lucide-react";

import {
  DndContext,
  useSensors,
  useSensor,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "../ui/card";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";

/* ---------------- helpers ---------------- */
function move<T>(arr: T[], from: number, to: number) {
  const clone = arr.slice();
  const [val] = clone.splice(from, 1);
  clone.splice(to, 0, val);
  return clone;
}

function kindFromMime(mime?: string | null): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

function kindBadge(kind: ReturnType<typeof kindFromMime>) {
  switch (kind) {
    case "image":
      return { Icon: ImageIcon, label: "Image" };
    case "video":
      return { Icon: Film, label: "Video" };
    case "audio":
      return { Icon: FileAudio2, label: "Audio" };
    case "pdf":
      return { Icon: FileTextIcon, label: "PDF" };
    case "text":
      return { Icon: FileTextIcon, label: "Doc" };
    default:
      return { Icon: FileType2, label: "File" };
  }
}

function transparentOriginalPreviewUrl(asset: Asset) {
  if (!["image/png", "image/webp", "image/svg+xml"].includes(asset.type)) return null;
  const source = asset.url?.trim();
  if (!source) return null;
  if (/^(https?:|blob:|data:)/i.test(source)) return source;
  const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
  if (!proxy) return null;
  return `${proxy.replace(/\/$/, "")}/${source.replace(/^\//, "")}`;
}

/* A small thumbnail box: 16:9-ish rectangle with cover image if available */
function ThumbnailBox({
  asset,
  getThumbnailUrl,
}: {
  asset: Asset;
  getThumbnailUrl?: (a: Asset) => string | undefined;
}) {
  const kind = kindFromMime(asset.type);
  const { Icon } = kindBadge(kind);
  const isDesignFile = isDesignPreviewUnavailableAsset(asset);
  const designLabel = getDesignAssetLabel(asset);
  const originalTransparentPreview = transparentOriginalPreviewUrl(asset) ?? undefined;
  const url =
    originalTransparentPreview ||
    (typeof getThumbnailUrl === "function" ? getThumbnailUrl(asset) : undefined) ||
    (asset as any).coverUrl ||
    (asset as any).cover_image_url ||
    undefined;
  const previewBackground = useImagePreviewBackground({
    src: url,
    mime_type: asset.type,
  });

  return (
    <div className={previewBackgroundClass(previewBackground) + " relative h-16 w-28 shrink-0 overflow-hidden rounded-md border"}>
      {isDesignFile ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-white">
          <Palette className="h-4 w-4 text-sky-200" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-200">
            {designLabel}
          </span>
        </div>
      ) : url ? (
        <img
          src={url}
          alt={asset.name ?? "thumbnail"}
          className={kind === "image"
            ? "h-full w-full object-contain p-1.5 pointer-events-none select-none"
            : "h-full w-full object-cover pointer-events-none select-none"}
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

/* ---------------- component ---------------- */
type VersionStackCardProps = {
  stack: Asset[];
  onClick?: () => void;
  onDelete?: (assetId: string) => void;
  onStatusChange?: (id: string, status: any) => void;

  /** Optional: provide a URL to a thumbnail for each asset */
  getThumbnailUrl?: (asset: Asset) => string | undefined;

  /** Single save callback: triggered only when user presses Save */
  onSave?: (payload: { orderedIds: string[]; removedIds: string[] }) => void;
  onCompare?: (asset: Asset) => void;
  onDownload?: (asset: Asset) => void;
  onMoveToFolder?: (asset: Asset) => void;
  deleteLabel?: string;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectionAriaLabel?: string;
};

export function VersionStackCard({
  stack,
  onClick,
  onDelete,
  onStatusChange,
  getThumbnailUrl,
  onSave,
  onCompare,
  onDownload,
  onMoveToFolder,
  deleteLabel,
  selectionMode = false,
  selected = false,
  onSelectedChange,
  selectionAriaLabel,
}: VersionStackCardProps) {
  const top = stack[0];
  const [open, setOpen] = useState(false);

  // Local working order inside the dialog
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Soft-removed items (id -> {asset, prevIndex})
  const [removed, setRemoved] = useState<Map<string, { asset: Asset; prevIndex: number }>>(
    () => new Map()
  );

  // Initialize when dialog opens
  useEffect(() => {
    if (open) {
      setLocalOrder(stack.map((s) => s.id));
      setRemoved(new Map());
      setDirty(false);
    }
  }, [open, stack]);

  useEffect(() => {
    if (!open) setLocalOrder(stack.map((s) => s.id));
  }, [stack, open]);

  // Live version numbers from local order (top = newest)
  const versionNumbers = useMemo(() => {
    const map = new Map<string, number>();
    const L = localOrder.length;
    localOrder.forEach((id, idx) => map.set(id, L - idx));
    return map;
  }, [localOrder]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragStart(e: DragStartEvent) {
    const rawActive = String(e.active?.id ?? "");
    if (rawActive.startsWith("vs:")) setIsDragging(true);
  }

  function onDragOver(e: DragOverEvent) {
    const rawActive = String(e.active?.id ?? "");
    const rawOver = e.over?.id ? String(e.over.id) : "";
    if (!rawActive.startsWith("vs:") || !rawOver.startsWith("vs:")) return;

    const src = rawActive.replace(/^vs:/, "");
    const over = rawOver.replace(/^vs:/, "");
    if (!src || !over || src === over) return;

    const from = localOrder.indexOf(src);
    const to = localOrder.indexOf(over);
    if (from === -1 || to === -1 || from === to) return;

    setLocalOrder((curr) => move(curr, from, to));
    setDirty(true);
  }

  function onDragEnd(e: DragEndEvent) {
    setIsDragging(false);
    const rawActive = String(e.active?.id ?? "");
    const rawOver = e.over?.id ? String(e.over.id) : "";
    if (!rawActive.startsWith("vs:") || !rawOver.startsWith("vs:")) return;

    const src = rawActive.replace(/^vs:/, "");
    const over = rawOver.replace(/^vs:/, "");
    if (!src || !over || src === over) return;

    const from = localOrder.indexOf(src);
    const to = localOrder.indexOf(over);
    if (from === -1 || to === -1 || from === to) return;

    setLocalOrder((curr) => move(curr, from, to));
    setDirty(true);
  }

  const orderedStack: Asset[] = useMemo(
    () => localOrder.map((id) => stack.find((s) => s.id === id)!).filter(Boolean),
    [localOrder, stack]
  );

  function handleSoftRemove(id: string) {
    const idx = localOrder.indexOf(id);
    if (idx === -1) return;
    const asset = stack.find((a) => a.id === id);
    if (!asset) return;

    setRemoved((map) => {
      const next = new Map(map);
      next.set(id, { asset, prevIndex: idx });
      return next;
    });
    setLocalOrder((curr) => curr.filter((x) => x !== id));
    setDirty(true);
  }

  function handleUndoRemove(id: string) {
    const entry = removed.get(id);
    if (!entry) return;

    setRemoved((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    setLocalOrder((curr) => {
      const insertAt = Math.min(Math.max(entry.prevIndex, 0), curr.length);
      const clone = curr.slice();
      clone.splice(insertAt, 0, id);
      return clone;
    });
    setDirty(true);
  }

  const removedList = useMemo(() => Array.from(removed.values()), [removed]);
  const removedIds = useMemo(() => removedList.map(({ asset }) => asset.id), [removedList]);

  const handleSave = () => {
    setOpen(false);
    if (!dirty) return;
    onSave?.({ orderedIds: localOrder, removedIds });
  };

  function SortableVersionItem({
    v,
    displayVersionNo,
  }: {
    v: Asset;
    displayVersionNo: number;
  }) {
    const sid = `vs:${v.id}`;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging: itemDragging } =
      useSortable({ id: sid });

    const style: React.CSSProperties = {
      transform: transform ? CSS.Translate.toString(transform) : undefined,
      opacity: itemDragging ? 0.6 : undefined,
      transition,
      touchAction: "none",
    };

    return (
      <div
        key={sid}
        ref={setNodeRef}
        id={sid}
        {...attributes}
        style={style}
        className="relative flex items-center gap-3 rounded-md border p-3 bg-card"
      >
        {/* Drag handle */}
        <div className="cursor-grab" {...listeners}>
          <GripVertical className="w-5 h-5 text-muted-foreground" />
        </div>

        {/* Thumbnail */}
        <ThumbnailBox asset={v} getThumbnailUrl={getThumbnailUrl} />

        {/* Title + version */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{v.name}</div>
          <div className="text-xs text-muted-foreground">v{displayVersionNo}</div>
        </div>

        {/* Timestamp */}
        <div className="hidden sm:block text-xs text-muted-foreground">
          {v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}
        </div>

        {/* Soft-remove */}
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleSoftRemove(v.id);
          }}
          title="Remove from version stack"
          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative group isolate">
      {/* 
         Enhanced stack visuals:
         Each 'layer' is now a card-like div.
         We rely on translation + scale to show depth.
         We add a subtle hover effect that 'fans' them out lightly.
      */}
      {/* Deepest card (3rd) - Centered vertical stack */}

      {/* Middle card (2nd) - Centered vertical stack */}
      <div
        aria-hidden
        className="absolute inset-0 z-[-1] rounded-xl border border-border/40 bg-muted/90 shadow-sm transition-all duration-300 ease-out translate-y-1 scale-x-[0.95] group-hover:translate-y-1.5"
      />

      {/* Top card (Main) */}
      <div className="relative z-0 transition-transform duration-300 ease-out group-hover:-translate-y-0.5">
        <BaseAssetCard
          asset={top}
          stackCount={stack.length}
          onStatusChange={(id, status) => onStatusChange?.(id, status)}
          onClick={() => onClick?.()}
          onManageVersions={() => setOpen(true)}
          onDelete={(a: Asset) => onDelete?.(a.id)}
          onCompare={onCompare}
          onDownload={onDownload}
          onMoveToFolder={onMoveToFolder}
          deleteLabel={deleteLabel}
          selectable
          selectionMode={selectionMode}
          selected={selected}
          onSelectedChange={onSelectedChange}
          selectionAriaLabel={selectionAriaLabel}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle className="text-left">Manage version stack</DialogTitle>
          </DialogHeader>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => setIsDragging(false)}
          >
            <div className="space-y-2 max-h-[60vh] overflow-auto py-2">
              <SortableContext
                items={localOrder.map((id) => `vs:${id}`)}
                strategy={verticalListSortingStrategy}
              >
                {orderedStack.map((v) => {
                  const sid = `vs:${v.id}`;
                  const displayVersionNo = versionNumbers.get(v.id) ?? (v as any).version_no ?? 1;
                  return <SortableVersionItem key={sid} v={v} displayVersionNo={displayVersionNo} />;
                })}
              </SortableContext>

              {/* Removed tray */}
              {removedList.length > 0 && (
                <div className="mt-4 rounded-md border bg-muted/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Removed (not saved)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {removedList.map(({ asset }) => (
                      <div
                        key={`rm:${asset.id}`}
                        className="inline-flex items-center gap-2 rounded-full border bg-background px-2 py-1 text-xs"
                      >
                        <span className="truncate max-w-[12rem]">{asset.name}</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => handleUndoRemove(asset.id)}
                          title="Undo remove"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DndContext>

          <DialogFooter>
            <div className="flex items-center gap-3 ml-auto">
              {dirty && (
                <span className="text-xs text-muted-foreground">
                  {removedIds.length > 0 ? `${removedIds.length} removed · ` : ""}
                  {localOrder.length} in stack
                </span>
              )}
              <Button variant="ghost" onClick={() => setOpen(false)} size="sm">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

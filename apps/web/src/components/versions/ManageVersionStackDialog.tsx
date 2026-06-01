import React, { useMemo, useState, useEffect } from "react";
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
  Layers,
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
import { formatTimetoDayMonth } from "@/lib/utils";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";

/* ---------------- helpers ---------------- */
function move<T>(arr: T[], from: number, to: number) {
  const clone = arr.slice();
  const [removed] = clone.splice(from, 1);
  clone.splice(to, 0, removed);
  return clone;
}

function kindFromMime(mime?: string | null) {
  if (!mime) return "unknown";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("text") || mime.includes("json")) return "text";
  return "unknown";
}

function kindBadge(kind: ReturnType<typeof kindFromMime>) {
  switch (kind) {
    case "image":
      return { Icon: ImageIcon, label: "Image" };
    case "video":
      return { Icon: Film, label: "Video" };
    case "audio":
      return { Icon: FileAudio2, label: "Audio" };
    case "text":
      return { Icon: FileTextIcon, label: "Text" };
    default:
      return { Icon: FileType2, label: "File" };
  }
}

/* ---------------- types ---------------- */
export type AssetVersion = {
  id: string;
  title: string;
  cover_image_url?: string | null;
  created_at: string;
  version_no?: number | null;
  mime_type?: string | null;
};

interface ManageVersionStackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  versions: AssetVersion[];
  currentAssetId?: string;
  onSave: (payload: { orderedIds: string[]; removedIds: string[] }) => Promise<void>;
}

/* ---------------- component ---------------- */
export function ManageVersionStackDialog({
  isOpen,
  onClose,
  versions,
  currentAssetId,
  onSave,
}: ManageVersionStackDialogProps) {
  // Local working order inside the dialog
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Soft-removed items (id -> {asset, prevIndex})
  const [removed, setRemoved] = useState<Map<string, { asset: AssetVersion; prevIndex: number }>>(
    () => new Map()
  );

  // Initialize when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLocalOrder(versions.map((v) => v.id));
      setRemoved(new Map());
      setDirty(false);
    }
  }, [isOpen, versions]);

  useEffect(() => {
    if (!isOpen) setLocalOrder(versions.map((v) => v.id));
  }, [versions, isOpen]);

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

  const orderedVersions: AssetVersion[] = useMemo(
    () => localOrder.map((id) => versions.find((v) => v.id === id)!).filter(Boolean),
    [localOrder, versions]
  );

  function handleSoftRemove(id: string) {
    const idx = localOrder.indexOf(id);
    if (idx === -1) return;
    const asset = versions.find((v) => v.id === id);
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

  const handleSave = async () => {
    if (!dirty) {
      onClose();
      return;
    }

    // Warn if the current asset is being removed
    if (currentAssetId && removedIds.includes(currentAssetId)) {
      const confirmed = confirm(
        "You are removing the version you're currently viewing. This will make it independent and you may need to navigate to a different version. Continue?"
      );
      if (!confirmed) {
        return;
      }
    }

    console.log("Saving version changes:", { orderedIds: localOrder, removedIds });
    setSaving(true);
    try {
      await onSave({ orderedIds: localOrder, removedIds });
      onClose();
    } catch (error) {
      console.error("Failed to save version changes:", error);
      alert("Failed to save changes. Please try again.");
      // Keep dialog open so user can try again
    } finally {
      setSaving(false);
    }
  };

  function SortableVersionItem({
    v,
    displayVersionNo,
  }: {
    v: AssetVersion;
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

    const kind = kindFromMime(v.mime_type);
    const { Icon } = kindBadge(kind);
    const isDesignFile = isDesignPreviewUnavailableAsset({
      mime_type: v.mime_type,
      title: v.title,
    });
    const designLabel = getDesignAssetLabel({
      mime_type: v.mime_type,
      title: v.title,
    });
    const previewBackground = useImagePreviewBackground({ src: v.cover_image_url ?? undefined, mime_type: v.mime_type });

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
        <div className={previewBackgroundClass(previewBackground) + " relative h-16 w-28 shrink-0 overflow-hidden rounded-md border"}>
          {isDesignFile ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-white">
              <Palette className="h-4 w-4 text-sky-200" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-200">
                {designLabel}
              </span>
            </div>
          ) : v.cover_image_url ? (
            <img
              src={v.cover_image_url}
              alt={v.title}
              className="h-full w-full object-cover pointer-events-none select-none"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Title + version */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{v.title}</div>
          <div className="text-xs text-muted-foreground">v{displayVersionNo}</div>
        </div>

        {/* Timestamp */}
        <div className="hidden sm:block text-xs text-muted-foreground">
          {v.created_at ? formatTimetoDayMonth(v.created_at) : ""}
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
          title="Remove from stack (makes it independent)"
          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="text-left flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Manage version stack
          </DialogTitle>
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
              {orderedVersions.map((v) => {
                const sid = `vs:${v.id}`;
                const displayVersionNo = versionNumbers.get(v.id) ?? v.version_no ?? 1;
                return <SortableVersionItem key={sid} v={v} displayVersionNo={displayVersionNo} />;
              })}
            </SortableContext>

            {/* Removed tray */}
            {removedList.length > 0 && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Will be removed from version stack
                </div>
                <div className="flex flex-wrap gap-2">
                  {removedList.map(({ asset }) => (
                    <div
                      key={`rm:${asset.id}`}
                      className="inline-flex items-center gap-2 rounded-full border bg-background px-2 py-1 text-xs"
                    >
                      <span className="truncate max-w-[12rem]">{asset.title}</span>
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
                {removedIds.length > 0 ? `${removedIds.length} to detach · ` : ""}
                {localOrder.length} in stack
              </span>
            )}
            <Button 
              variant="ghost" 
              onClick={onClose} 
              size="sm"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? "Saving..." : (removedIds.length > 0 ? `Remove ${removedIds.length}` : "Save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

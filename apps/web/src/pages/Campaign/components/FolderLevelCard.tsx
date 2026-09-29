import type React from "react";
import { FolderClosed } from "lucide-react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AssetImageFrame } from "@/components/media/AssetImageFrame";
import type { FolderRow } from "../CampaignDetailsSearch";

/** A dnd-kit grid "move" drag — an asset card or (in selection mode) a folder
 *  card. Distinct from this card's *native* folder→folder reparent drag. */
function isGridMoveDrag(value: unknown): boolean {
  const type = (value as { type?: string } | null | undefined)?.type;
  return type === "asset" || type === "folder-drag";
}

export default function FolderLevelCard({
  folder,
  itemCount,
  previewImages,
  onOpen,
  onToggleSelected,
  footerActions,
  nameContent,
  subtitle,
  subtitleContent,
  matchReason,
  draggable = false,
  isDragTarget = false,
  isDragging = false,
  selectionMode = false,
  selected = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: FolderRow;
  itemCount: number;
  previewImages: string[];
  onOpen: () => void;
  onToggleSelected?: (selected: boolean) => void;
  footerActions?: React.ReactNode;
  nameContent?: React.ReactNode;
  subtitle?: string;
  subtitleContent?: React.ReactNode;
  matchReason?: string | null;
  draggable?: boolean;
  isDragTarget?: boolean;
  isDragging?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>;
  onDragOver?: React.DragEventHandler<HTMLButtonElement>;
  onDragLeave?: React.DragEventHandler<HTMLButtonElement>;
  onDrop?: React.DragEventHandler<HTMLButtonElement>;
}) {
  const visiblePreviews = previewImages.slice(0, 3);
  const showSelectionControl = selected || selectionMode;

  // A second, independent drop-target registration (dnd-kit, pointer-based) —
  // separate from this card's own native `draggable` (folder→folder reparent,
  // HTML5 DnD). Lets an asset/folder card dragged from the grid be dropped
  // here to move it into this folder; the actual move is handled by an
  // ancestor's dnd-kit onDragEnd, this component only owns the drop visuals.
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-drop-${folder.id}`,
    data: { type: "folder", folderId: folder.id, folderName: folder.name },
  });
  const { active } = useDndContext();

  // In selection mode the folder card itself becomes a dnd-kit drag source
  // (so it can travel with a mixed file+folder selection). Out of selection
  // mode the native `draggable` below handles folder→folder reparenting, and
  // this stays disabled — the two never fight over the same gesture.
  const {
    setNodeRef: setDragNodeRef,
    listeners: dragListeners,
    attributes: dragAttributes,
    isDragging: isDndDragging,
  } = useDraggable({
    id: `folder-drag-${folder.id}`,
    data: { type: "folder-drag", folderId: folder.id, folderName: folder.name },
    disabled: !selectionMode,
  });

  const activeData = active?.data.current as { type?: string; folderId?: string } | undefined;
  const isGridDragActive = isGridMoveDrag(activeData);
  // Don't invite a drop onto the folder that's currently being dragged.
  const isBeingDragged = activeData?.type === "folder-drag" && activeData.folderId === folder.id;
  const isGridDropTarget = isOver && isGridDragActive && !isBeingDragged;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative mt-2 h-[198px] w-[204px] shrink-0 text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary/60",
        (isDragging || isDndDragging) && "cursor-grabbing opacity-60",
        (isDragTarget || isGridDropTarget) && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
        selected && "rounded-xl bg-primary/[0.08] shadow-[0_0_0_1px_rgba(124,58,237,0.28),0_10px_32px_rgba(124,58,237,0.10)]",
      )}
    >
      {isGridDropTarget ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
          <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-md">
            Move here
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "absolute left-2.5 top-3 z-20 transition-[opacity,transform] duration-150",
          showSelectionControl
            ? "pointer-events-auto opacity-100"
            : "pointer-events-auto opacity-100 sm:pointer-events-none sm:-translate-y-0.5 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:translate-y-0 [@media(pointer:coarse)]:opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelected?.(!selected);
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.16] bg-black/50 text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[background-color,border-color,box-shadow]",
            "hover:border-white/35 hover:bg-black/65",
            selected && "border-[#a78bfa]/80 bg-black/65 shadow-[0_8px_28px_rgba(124,58,237,0.28)]",
          )}
        >
          <Checkbox
            checked={selected}
            aria-label={`Select folder ${folder.name}`}
            className="size-[18px] border-white/55 bg-white/5 text-white shadow-none transition-[background-color,border-color,color] data-[state=checked]:!border-[#a78bfa] data-[state=checked]:!bg-[#7c3aed] data-[state=checked]:!text-white dark:data-[state=checked]:!border-[#a78bfa] dark:data-[state=checked]:!bg-[#7c3aed] dark:data-[state=checked]:!text-white focus-visible:ring-[#a78bfa]/60"
            style={selected ? { backgroundColor: "#7c3aed", borderColor: "#a78bfa", color: "#fff" } : undefined}
            onCheckedChange={(checked) => onToggleSelected?.(checked === true)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
      </div>
      <button
        type="button"
        ref={setDragNodeRef}
        draggable={selectionMode ? false : draggable}
        {...(selectionMode ? dragListeners : {})}
        {...(selectionMode ? dragAttributes : {})}
        onClick={(event) => {
          if (selectionMode && event.detail > 1) return;
          if (selectionMode && onToggleSelected) {
            onToggleSelected(!selected);
            return;
          }
          onOpen();
        }}
        onDoubleClick={() => {
          if (!selectionMode) return;
          onOpen();
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="block h-full w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <div className={cn(
          "absolute left-0 top-0 h-7 w-[78px] rounded-tl-lg rounded-tr-2xl border border-b-0 border-border dark:border-white/[0.06] bg-card dark:bg-[#202334] shadow-[0_-2px_16px_rgba(0,0,0,0.20)] transition-colors group-hover:bg-accent dark:group-hover:bg-[#25293a]",
          selected && "border-primary/55 bg-primary/25",
        )} />

        <div className={cn(
          "absolute inset-x-0 bottom-0 top-2 overflow-hidden rounded-lg border border-border dark:border-white/[0.06] bg-card dark:bg-[#202334] shadow-[0_4px_8px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.22)] transition-colors group-hover:bg-accent dark:group-hover:bg-[#25293a]",
          selected && "border-primary/80 bg-primary/20 dark:bg-[#262d45]",
        )}>
          <div className="h-[130px] p-1.5">
            {visiblePreviews.length > 0 ? (
              <div className="grid h-full grid-cols-[1fr_58px] gap-1 overflow-hidden rounded-md bg-muted/60 dark:bg-black/35">
                <AssetImageFrame
                  src={visiblePreviews[0]}
                  alt=""
                  draggable={false}
                  className="h-full w-full bg-muted dark:bg-[#111522] object-contain p-1 transition-transform duration-200 group-hover:scale-[1.01]"
                  fallback={<div className="h-full w-full bg-muted dark:bg-[#111522]" />}
                />
                {visiblePreviews.length > 1 && (
                  <div className={`grid gap-1 ${visiblePreviews.length > 2 ? "grid-rows-2" : "grid-rows-1"}`}>
                    {visiblePreviews.slice(1).map((src, index) => (
                      <AssetImageFrame
                        key={`${src}-${index}`}
                        src={src}
                        alt=""
                        draggable={false}
                        className="h-full w-full bg-muted dark:bg-[#111522] object-contain p-1 transition-transform duration-200 group-hover:scale-[1.01]"
                        fallback={<div className="h-full w-full bg-muted dark:bg-[#111522]" />}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-muted dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-muted-foreground">
                <FolderClosed className="h-8 w-8 opacity-70" />
              </div>
            )}
          </div>
          <div className="relative min-h-[60px] border-t border-border dark:border-white/[0.04] px-3 pb-3 pt-2">
            <div className="truncate pr-10 text-sm font-semibold leading-tight text-foreground" title={folder.name}>
              {nameContent ?? folder.name}
            </div>
            {(subtitleContent ?? subtitle) ? (
              <div className="mt-1 truncate pr-10 text-[11px] text-muted-foreground">
                {subtitleContent ?? subtitle}
              </div>
            ) : null}
            <div className="mt-1 truncate pr-10 text-xs text-muted-foreground">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </div>
            {matchReason ? (
              <div className="mt-1 inline-flex rounded-full bg-muted dark:bg-white/10 px-2 py-0.5 text-[10px] font-medium text-foreground">
                {matchReason}
              </div>
            ) : null}
          </div>
        </div>
      </button>
      {footerActions ? (
        <div
          className="absolute bottom-3 right-3 z-10"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {footerActions}
        </div>
      ) : null}
    </div>
  );
}

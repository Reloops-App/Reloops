// React import not required with the automatic JSX runtime
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import { Droppable, Draggable } from "@/components/dnd/DndWrappers";
import AssetCard from "./AssetCard";
import { VersionStackCard } from "@/components/versions/VersionsStackCard";
import type { Asset as CampaignAsset, AssetStatus } from "../CampaignTypes";
import { rootIdOf } from "@/lib/assetUtils";

type UserProfile = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

import { Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";

type VersionStacksGridProps = {
  stacks: CampaignAsset[][];
  sensors: any;
  onDragEnd: (event: DragEndEvent) => void;
  handleStatusChange: (id: string, status: any) => void;
  requestDeleteAssetById: (assetId: string) => void;
  workspaceId: string;
  project: { id: string };
  onSaveStack: (payload: { orderedIds: string[]; removedIds?: string[] }) => void;
  sortKey?: string;
  userProfiles?: UserProfile[];
  onEditAsset?: (asset: CampaignAsset) => void;
  onAssetClick?: (asset: CampaignAsset) => void;
  onCompareClick?: (asset: CampaignAsset) => void;
  onDownloadClick?: (asset: CampaignAsset) => void;
  onMoveToFolder?: (asset: CampaignAsset) => void;
  deleteLabel?: string;
  onTriggerUpload?: () => void;
  selectedRootIds?: string[];
  onToggleSelection?: (rootId: string, selected: boolean) => void;
  selectionMode?: boolean;
};

export default function VersionStacksGrid({
  stacks,
  sensors,
  onDragEnd,
  handleStatusChange,
  requestDeleteAssetById,
  workspaceId,
  project,
  onSaveStack,
  sortKey,
  userProfiles = [],
  onEditAsset,
  onAssetClick,
  onCompareClick,
  onDownloadClick,
  onMoveToFolder,
  deleteLabel,
  onTriggerUpload, // Destructure
  selectedRootIds = [],
  onToggleSelection,
  selectionMode = false,
}: VersionStacksGridProps) {
  const navigate = useNavigate();

  const defaultHandleCompare = (asset: any) => {
    // Navigate to compare page
    // If asset is part of a stack, we use its parent_asset_id or its own id if it is the parent
    const parentId = asset.parent_asset_id || asset.id;
    navigate(`/workspace/${workspaceId}/projects/${project.id}/assets/${parentId}/compare`);
  };

  const defaultHandleClick = (asset: any) => {
    navigate(`/workspace/${workspaceId}/projects/${project.id}/assets/${asset.id}`, {
      state: { asset },
    });
  }

  const handleCompare = onCompareClick || defaultHandleCompare;
  const handleClick = onAssetClick || defaultHandleClick;
  const handleDownload = onDownloadClick;

  const gridContent = (
    <div className="grid items-start gap-5 grid-cols-[repeat(auto-fill,minmax(204px,1fr))] sm:grid-cols-[repeat(auto-fill,204px)]">
      {stacks.map((stack) => {
        const top = stack[0];
        const key = top.id;
        const rootId = rootIdOf(top);
        const isSelected = selectedRootIds.includes(rootId);

        if (stack.length === 1) {
          const card = (
            <AssetCard
              asset={top as any}
              onStatusChange={handleStatusChange}
              onClick={() => handleClick(top)}
              onDelete={(a: any) => requestDeleteAssetById(a.id)}
              sortKey={sortKey}
              userProfiles={userProfiles}
              onEdit={(a) => onEditAsset?.(a as unknown as CampaignAsset)}
              onCompare={(a) => handleCompare(a as unknown as CampaignAsset)}
              onDownload={handleDownload}
              onMoveToFolder={(a) => onMoveToFolder?.(a as unknown as CampaignAsset)}
              deleteLabel={deleteLabel}
              selectable
              selectionMode={selectionMode}
              selected={isSelected}
              onSelectedChange={(selected) => onToggleSelection?.(rootId, selected)}
              selectionAriaLabel={`Select ${top.name}`}
            />
          );

          if (selectionMode) {
            return <div key={key}>{card}</div>;
          }

          return (
            <Droppable key={key} id={key}>
              <Draggable id={key}>
                {card}
              </Draggable>
            </Droppable>
          );
        }

        const card = (
          <VersionStackCard
            stack={stack}
            getThumbnailUrl={(a: CampaignAsset) => a.coverUrl || a.url || ""}
            onClick={() => handleClick(top)}
            onStatusChange={handleStatusChange}
            onDelete={(assetId: string) => requestDeleteAssetById(assetId)}
            onSave={onSaveStack}
            onCompare={handleCompare}
            onDownload={handleDownload}
            onMoveToFolder={(a) => onMoveToFolder?.(a as unknown as CampaignAsset)}
            deleteLabel={deleteLabel}
            selectionMode={selectionMode}
            selected={isSelected}
            onSelectedChange={(selected) => onToggleSelection?.(rootId, selected)}
            selectionAriaLabel={`Select ${top.name}`}
          />
        );

        if (selectionMode) {
          return <div key={key}>{card}</div>;
        }

        return (
          <Droppable key={key} id={key}>
            <Draggable id={key}>
              {card}
            </Draggable>
          </Droppable>
        );
      })}

      {stacks.length > 0 && !selectionMode && (
        <button
          type="button"
          onClick={onTriggerUpload}
          className="group relative flex min-h-[228px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border/55 bg-muted/10 px-4 text-center transition-colors duration-200 hover:border-primary/35 hover:bg-muted/15"
          title="Upload new file"
        >
          <div className="rounded-full bg-muted/35 p-3 transition-colors duration-200 group-hover:bg-primary/10">
            <Upload className="size-6 text-muted-foreground transition-colors duration-200 group-hover:text-primary" />
          </div>
          <div className="mt-3 space-y-1">
            <span className="block text-sm font-semibold text-foreground">Add files</span>
            <span className="block text-xs text-muted-foreground">
              Drag and drop or browse
            </span>
          </div>
        </button>
      )}

      {stacks.length === 0 && !selectionMode && (
        <div className="col-span-full flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/15 bg-muted/5 p-12 text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="mb-4 rounded-full bg-muted/30 p-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-8 text-muted-foreground"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-semibold text-foreground">No files yet</h3>
          <p className="max-w-sm text-balance text-sm text-muted-foreground">
            Drag and drop files anywhere on the screen to upload, or use the upload button above.
          </p>
        </div>
      )}
    </div>
  );

  return selectionMode ? (
    gridContent
  ) : (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      {gridContent}
    </DndContext>
  );
}

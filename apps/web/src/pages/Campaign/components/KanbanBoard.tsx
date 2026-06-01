"use client";

import React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  useDroppable,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Asset, AssetStatus, ColumnKey, toColumnKey, fromColumnKey } from "../CampaignTypes";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { formatTimetoDayMonth } from "@/lib/utils";
import { toast } from "sonner";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { AVATAR_FALLBACK_CLASS, getAvatarInitials } from "@/lib/avatar-utils";
import {
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  ChevronDown,
  Eye,
  Download,
  File,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  MoreHorizontal,
  Pencil,
  ArrowUpDown,
  SquareCheckBig,
  UserRoundPlus,
  Video,
  X,
} from "lucide-react";

type UserProfile = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

const KANBAN_COLUMN_META: Record<
  ColumnKey,
  {
    title: string;
    description: string;
    accent: string;
    accentSoft: string;
    badgeClassName: string;
    icon: React.ElementType;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction?: string;
  }
> = {
  none: {
    title: "No status",
    description: "Unassigned assets",
    accent: "bg-slate-400/80",
    accentSoft: "bg-slate-500/8",
    badgeClassName: "border-slate-500/20 bg-slate-500/10 text-slate-200",
    icon: SquareCheckBig,
    emptyTitle: "No assets yet",
    emptyDescription: "Assets without a review state will appear here.",
  },
  needs_review: {
    title: "Needs review",
    description: "Marked for review",
    accent: "bg-sky-400/80",
    accentSoft: "bg-sky-500/8",
    badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-200",
    icon: CircleAlert,
    emptyTitle: "No assets yet",
    emptyDescription: "Drag assets here when they need review.",
    emptyAction: "Show unassigned",
  },
  in_review: {
    title: "In Review",
    description: "Assets being reviewed",
    accent: "bg-amber-400/85",
    accentSoft: "bg-amber-500/8",
    badgeClassName: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    icon: MessageSquareMore,
    emptyTitle: "No assets currently being reviewed",
    emptyDescription: "Assets moved here are currently being reviewed.",
    emptyAction: "Show needs review",
  },
  approved: {
    title: "Approved",
    description: "Completed review",
    accent: "bg-emerald-400/80",
    accentSoft: "bg-emerald-500/8",
    badgeClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle2,
    emptyTitle: "No approved assets yet",
    emptyDescription: "Approved assets will appear here.",
  },
};

type ColumnSort = "updated_desc" | "updated_asc" | "name_asc" | "assignee" | "comments_desc";
type ReviewQuickFilter = "all" | "unassigned" | "has_comments" | "approved" | "needs_review" | "recently_updated";

function assetTypeIcon(mime?: string | null) {
  if (!mime) return File;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Video;
  return File;
}

function assetUpdatedLabel(asset: Asset) {
  if (asset.updated_at) return `Updated ${formatTimetoDayMonth(asset.updated_at)}`;
  if (asset.createdAt) return `Created ${formatTimetoDayMonth(asset.createdAt)}`;
  return "Recently added";
}

function getAssignedProfile(asset: Asset, profiles: UserProfile[]) {
  return asset.assigned_to ? profiles.find((profile) => profile.id === asset.assigned_to) ?? null : null;
}

function reviewerLabel(asset: Asset, profiles: UserProfile[]) {
  const profile = getAssignedProfile(asset, profiles);
  if (!asset.assigned_to) return "Unassigned";
  return profile?.display_name || asset.assigned_to.slice(0, 8);
}

function ReviewerAvatar({ asset, profiles }: { asset: Asset; profiles: UserProfile[] }) {
  const profile = getAssignedProfile(asset, profiles);
  const label = reviewerLabel(asset, profiles);

  if (!asset.assigned_to) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-muted-foreground"
        title="Unassigned"
      >
        <UserRoundPlus className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <Avatar className="h-6 w-6 shrink-0" title={label}>
      <AvatarImage src={profile?.avatar_url || undefined} alt={label} />
      <AvatarFallback className={`text-[10px] ${AVATAR_FALLBACK_CLASS}`}>
        {getAvatarInitials(label)}
      </AvatarFallback>
    </Avatar>
  );
}

function commentMeta(asset: Asset) {
  const raw = (asset as any).__raw ?? {};
  const total = asset.comments_count ?? raw.comment_count ?? raw.comments ?? 0;
  return { total: Number(total) || 0 };
}

function sortAssetsForColumn(items: Asset[], sort: ColumnSort, profiles: UserProfile[]) {
  const timeValue = (asset: Asset) => new Date(asset.updated_at ?? asset.createdAt ?? 0).getTime() || 0;
  return [...items].sort((left, right) => {
    if (sort === "updated_asc") return timeValue(left) - timeValue(right);
    if (sort === "name_asc") return left.name.localeCompare(right.name);
    if (sort === "assignee") return reviewerLabel(left, profiles).localeCompare(reviewerLabel(right, profiles));
    if (sort === "comments_desc") return commentMeta(right).total - commentMeta(left).total;
    return timeValue(right) - timeValue(left);
  });
}

export default function KanbanBoard({
  assets,
  onStatusChange,
  workspaceId,
  projectId,
  userProfiles = [],
  onEditAsset,
  onAssetClick,
  onDownloadClick,
  onAssignReviewer,
  onDownloadAssets,
}: {
  assets: Asset[];
  onStatusChange: (id: string, status: AssetStatus | null) => void;
  workspaceId: string;
  projectId: string;
  userProfiles?: UserProfile[];
  onEditAsset?: (asset: Asset) => void;
  onAssetClick?: (asset: Asset) => void;
  onDownloadClick?: (asset: Asset) => void;
  onAssignReviewer?: (assetId: string, reviewerId: string | null) => void | Promise<void>;
  onDownloadAssets?: (assets: Asset[], label: string) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const columns: ColumnKey[] = ["none", "needs_review", "in_review", "approved"];
  const [collapsedColumns, setCollapsedColumns] = React.useState<ColumnKey[]>([]);
  const [columnSorts, setColumnSorts] = React.useState<Record<ColumnKey, ColumnSort>>({
    none: "updated_desc",
    needs_review: "updated_desc",
    in_review: "updated_desc",
    approved: "updated_desc",
  });
  const [selectedAssetIds, setSelectedAssetIds] = React.useState<string[]>([]);
  const [quickFilter, setQuickFilter] = React.useState<ReviewQuickFilter>("all");
  const [bulkActionLabel, setBulkActionLabel] = React.useState<string | null>(null);
  const [bulkPulseIds, setBulkPulseIds] = React.useState<string[]>([]);

  const boardAssets = React.useMemo(() => {
    if (quickFilter === "all") return assets;
    return assets.filter((asset) => {
      const comments = commentMeta(asset);
      const status = toColumnKey(asset.status);
      if (quickFilter === "unassigned") return !asset.assigned_to;
      if (quickFilter === "has_comments") return comments.total > 0;
      if (quickFilter === "approved") return status === "approved";
      if (quickFilter === "needs_review") return status === "needs_review";
      if (quickFilter === "recently_updated") {
        const updatedAt = new Date(asset.updated_at ?? asset.createdAt ?? 0).getTime();
        return updatedAt > Date.now() - 7 * 86400000;
      }
      return true;
    });
  }, [assets, quickFilter]);

  const grouped = React.useMemo(() => {
    const map: Record<ColumnKey, Asset[]> = {
      none: [],
      needs_review: [],
      in_review: [],
      approved: [],
    };
    for (const a of boardAssets) {
      map[toColumnKey(a.status as string | null)].push(a);
    }
    return map;
  }, [boardAssets]);

  const sortedGrouped = React.useMemo(() => {
    return columns.reduce((next, column) => {
      next[column] = sortAssetsForColumn(grouped[column], columnSorts[column], userProfiles);
      return next;
    }, {} as Record<ColumnKey, Asset[]>);
  }, [columns, columnSorts, grouped, userProfiles]);

  const selectedAssetSet = React.useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const selectedAssets = React.useMemo(
    () => boardAssets.filter((asset) => selectedAssetSet.has(asset.id)),
    [boardAssets, selectedAssetSet],
  );
  const approvedCount = assets.filter((asset) => toColumnKey(asset.status) === "approved").length;
  const completion = assets.length > 0 ? Math.round((approvedCount / assets.length) * 100) : 0;

  const clearSelection = React.useCallback(() => setSelectedAssetIds([]), []);
  const selectVisibleAssets = React.useCallback(() => {
    setSelectedAssetIds((current) => Array.from(new Set([...current, ...boardAssets.map((asset) => asset.id)])));
  }, [boardAssets]);
  const selectAllAssets = React.useCallback(() => {
    setSelectedAssetIds((current) => Array.from(new Set([...current, ...assets.map((asset) => asset.id)])));
  }, [assets]);
  const toggleColumnSelection = React.useCallback((items: Asset[]) => {
    setSelectedAssetIds((current) => {
      const ids = items.map((asset) => asset.id);
      const currentSet = new Set(current);
      const allSelected = ids.length > 0 && ids.every((id) => currentSet.has(id));
      if (allSelected) return current.filter((id) => !ids.includes(id));
      return Array.from(new Set([...current, ...ids]));
    });
  }, []);
  const toggleAssetSelected = React.useCallback((assetId: string, selected: boolean) => {
    setSelectedAssetIds((current) => {
      if (selected) return current.includes(assetId) ? current : [...current, assetId];
      return current.filter((id) => id !== assetId);
    });
  }, []);

  const runBulkAction = React.useCallback(async (rows: Asset[], label: string, action: () => Promise<void>) => {
    setBulkPulseIds(rows.map((asset) => asset.id));
    setBulkActionLabel(label);
    try {
      await action();
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    } finally {
      setBulkActionLabel(null);
      setBulkPulseIds([]);
    }
  }, []);

  const applyStatusToAssets = React.useCallback(async (rows: Asset[], status: AssetStatus | null, label?: string) => {
    if (rows.length === 0) return;
    await runBulkAction(rows, label ?? "Updating status", async () => {
      await Promise.all(rows.map((asset) => onStatusChange(asset.id, status)));
    });
  }, [onStatusChange, runBulkAction]);

  const assignAssets = React.useCallback(async (rows: Asset[], reviewerId: string | null) => {
    if (!onAssignReviewer) return;
    if (rows.length === 0) return;
    await runBulkAction(rows, "Assigning reviewer", async () => {
      await Promise.all(rows.map((asset) => onAssignReviewer(asset.id, reviewerId)));
    });
  }, [onAssignReviewer, runBulkAction]);

  const toggleColumnCollapsed = React.useCallback((column: ColumnKey) => {
    setCollapsedColumns((current) => current.includes(column) ? current.filter((entry) => entry !== column) : [...current, column]);
  }, []);

  const [activeCard, setActiveCard] = React.useState<Asset | null>(null);
  const [overColumn, setOverColumn] = React.useState<ColumnKey | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const a = assets.find((x) => x.id === id) || null;
    setActiveCard(a);
  }

  function handleDragOver(e: DragOverEvent) {
    const over = e.over;
    if (!over) {
      setOverColumn(null);
      return;
    }

    const overType = over.data?.current?.type as "column" | "card" | undefined;
    if (overType === "column" || overType === "card") {
      setOverColumn(over.data?.current?.column as ColumnKey);
      return;
    }

    const overId = String(over.id);
    if ((["none", "needs_review", "in_review", "approved"] as ColumnKey[]).includes(overId as ColumnKey)) {
      setOverColumn(overId as ColumnKey);
      return;
    }

    const overAsset = assets.find((a) => a.id === overId);
    setOverColumn(overAsset ? toColumnKey(overAsset.status as string | null) : null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveCard(null);
    setOverColumn(null);
    if (!over) return;

    const activeId = String(active.id);
    const activeAsset = assets.find((x) => x.id === activeId);
    const currentColumn = toColumnKey(activeAsset?.status as string | null);

    const overType = over.data?.current?.type as "column" | "card" | undefined;

    let targetCol: ColumnKey | null = null;
    if (overType === "column") {
      targetCol = over.data!.current!.column as ColumnKey;
    } else if (overType === "card") {
      targetCol = over.data!.current!.column as ColumnKey;
    } else {
      const overId = String(over.id);
      targetCol = (["none", "needs_review", "in_review", "approved"] as ColumnKey[]).includes(
        overId as ColumnKey
      )
        ? (overId as ColumnKey)
        : toColumnKey(assets.find((a) => a.id === overId)?.status as string | null);
    }

    if (!targetCol) return;
    if (targetCol === currentColumn) return;

    const newStatus = fromColumnKey(targetCol);
    await onStatusChange(activeId, newStatus);
    toast.success(`Moved to ${KANBAN_COLUMN_META[targetCol].title}`);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveCard(null);
        setOverColumn(null);
      }}
    >
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-foreground">
                {assets.length} assets · {approvedCount} approved · {completion}% complete
              </div>
              <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${completion}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={selectVisibleAssets} disabled={boardAssets.length === 0 || Boolean(bulkActionLabel)}>
                <SquareCheckBig className="mr-2 h-4 w-4" />
                Select visible
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={selectAllAssets} disabled={assets.length === 0 || Boolean(bulkActionLabel)}>
                <CheckCheck className="mr-2 h-4 w-4" />
                Select all
              </Button>
              {selectedAssets.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearSelection} disabled={Boolean(bulkActionLabel)}>
                  <X className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {([
              ["all", "All"],
              ["unassigned", "Unassigned"],
              ["needs_review", "Needs review"],
              ["has_comments", "Has comments"],
              ["approved", "Approved"],
              ["recently_updated", "Recently updated"],
            ] as Array<[ReviewQuickFilter, string]>).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={quickFilter === value ? "secondary" : "ghost"}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setQuickFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          {selectedAssets.length > 0 ? (
            <div className={cn(
              "relative flex flex-wrap items-center gap-2 border-t border-border/60 pt-3",
              bulkActionLabel && "rounded-xl border-primary/20 bg-primary/5 px-2 pb-2 pt-3"
            )}>
              {bulkActionLabel ? (
                <div className="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-pulse" />
              ) : null}
              <span className="text-sm font-medium text-foreground">{selectedAssets.length} selected</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8"
                disabled={Boolean(bulkActionLabel)}
                onClick={() => void applyStatusToAssets(selectedAssets, "needs_review", "Setting Needs review")}
              >
                <CircleAlert className="mr-2 h-4 w-4" />
                Set Needs review
              </Button>
              <ReviewerMenu
                label="Assign"
                reviewers={userProfiles}
                onSelect={(reviewerId) => void assignAssets(selectedAssets, reviewerId)}
                disabled={Boolean(bulkActionLabel)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={Boolean(bulkActionLabel)}
                onClick={() => void applyStatusToAssets(selectedAssets, "in_review", "Setting In review")}
              >
                <MessageSquareMore className="mr-2 h-4 w-4" />
                Set In review
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={Boolean(bulkActionLabel)}
                onClick={() => void applyStatusToAssets(selectedAssets, "approved", "Approving selected assets")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
              {onDownloadAssets ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={Boolean(bulkActionLabel)}
                  onClick={() => void runBulkAction(selectedAssets, "Preparing download", async () => {
                    await onDownloadAssets(selectedAssets, "selected kanban assets");
                  })}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              ) : null}
              {bulkActionLabel ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-background/70 px-2.5 py-1 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {bulkActionLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-4">
        {columns.map((col) => {
          const items = sortedGrouped[col];
          const meta = KANBAN_COLUMN_META[col];
          const Icon = meta.icon;
          const collapsed = collapsedColumns.includes(col);
          const selectedCount = items.filter((asset) => selectedAssetSet.has(asset.id)).length;
          const allSelected = items.length > 0 && selectedCount === items.length;
          const someSelected = selectedCount > 0 && !allSelected;
          return (
            <DroppableColumn
              key={col}
              id={col}
              isHighlighted={overColumn === col}
              className={cn(
                "overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-sm transition-colors",
                overColumn === col && meta.accentSoft,
                bulkActionLabel && "border-primary/20"
              )}
            >
              <div className={cn("h-1 w-full", meta.accent)} />
              <div className="border-b border-border/50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      disabled={items.length === 0 || Boolean(bulkActionLabel)}
                      onCheckedChange={() => toggleColumnSelection(items)}
                      aria-label={allSelected ? `Deselect all in ${meta.title}` : `Select all in ${meta.title}`}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{meta.title}</span>
                        <Badge variant="outline" className={meta.badgeClassName}>
                          {items.length}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ColumnMenu
                      column={col}
                      assets={items}
                      sort={columnSorts[col]}
                      onSortChange={(sort) => setColumnSorts((current) => ({ ...current, [col]: sort }))}
                      onToggleSelectAll={() => toggleColumnSelection(items)}
                      allSelected={allSelected}
                      onAssign={(reviewerId) => void assignAssets(items, reviewerId)}
                      onMove={(status) => void applyStatusToAssets(items, status, status ? `Moving ${meta.title.toLowerCase()} items` : `Clearing ${meta.title.toLowerCase()} status`)}
                      onDownload={onDownloadAssets ? () => void runBulkAction(items, `Downloading ${meta.title.toLowerCase()} column`, async () => {
                        await onDownloadAssets(items, `${meta.title.toLowerCase()} column assets`);
                      }) : undefined}
                      onCollapse={() => toggleColumnCollapsed(col)}
                      reviewers={userProfiles}
                      busy={bulkActionLabel !== null}
                    />
                  </div>
                </div>
              </div>

              <SortableContext items={items.map((a) => a.id)}>
                <div
                  className={cn(
                    "space-y-3 p-3",
                    collapsed ? "hidden" : items.length > 0 ? "min-h-[240px]" : "min-h-[240px]"
                  )}
                >
                  {items.length === 0 ? (
                    <div className="flex h-full min-h-[212px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 text-center">
                      <div className="max-w-[220px] space-y-2">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/35">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="text-sm font-medium text-foreground">{meta.emptyTitle}</div>
                        <div className="text-xs leading-5 text-muted-foreground">
                          {meta.emptyDescription}
                        </div>
                        {meta.emptyAction ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              if (col === "needs_review") setQuickFilter("unassigned");
                              if (col === "in_review") setQuickFilter("needs_review");
                            }}
                          >
                            {meta.emptyAction}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    items.map((asset) => (
                      <DraggableAssetCard
                        key={asset.id}
                        asset={asset}
                        column={col}
                        onStatusChange={onStatusChange}
                        onCardClick={() => {
                          if (onAssetClick) {
                            onAssetClick(asset);
                          } else {
                            navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${asset.id}`);
                          }
                        }}
                        userProfiles={userProfiles}
                        onEditAsset={onEditAsset}
                        onAssetClick={onAssetClick}
                        onDownloadClick={onDownloadClick}
                        onAssignReviewer={onAssignReviewer}
                        selected={selectedAssetSet.has(asset.id)}
                        onSelectedChange={(selected) => toggleAssetSelected(asset.id, selected)}
                        bulkHighlighted={bulkPulseIds.includes(asset.id)}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DroppableColumn>
          );
        })}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="w-[280px] opacity-90 rotate-2">
            <KanbanCompactCard
              asset={activeCard}
              onClick={() => {}}
              onEditAsset={onEditAsset}
              onDownloadClick={onDownloadClick}
              onStatusChange={onStatusChange}
              userProfiles={userProfiles}
              onAssignReviewer={onAssignReviewer}
              selected={false}
              onSelectedChange={() => undefined}
              bulkHighlighted={activeCard ? bulkPulseIds.includes(activeCard.id) : false}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({
  id,
  isHighlighted = false,
  className,
  children,
}: {
  id: ColumnKey;
  isHighlighted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "column", column: id },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        (isOver || isHighlighted) && "ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
      )}
    >
      {children}
    </div>
  );
}

function DraggableAssetCard({
  asset,
  column,
  onStatusChange,
  onCardClick,
  userProfiles,
  onEditAsset,
  onDownloadClick,
  onAssignReviewer,
  selected,
  onSelectedChange,
  bulkHighlighted = false,
}: {
  asset: Asset;
  column: ColumnKey;
  onStatusChange: (id: string, status: AssetStatus | null) => void;
  onCardClick: () => void;
  userProfiles: UserProfile[];
  onEditAsset?: (asset: Asset) => void;
  onAssetClick?: (asset: Asset) => void;
  onDownloadClick?: (asset: Asset) => void;
  onAssignReviewer?: (assetId: string, reviewerId: string | null) => void | Promise<void>;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  bulkHighlighted?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: asset.id,
      data: { type: "card", assetId: asset.id, column },
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="touch-none">
      <KanbanCompactCard
        asset={asset}
        onClick={onCardClick}
        onEditAsset={onEditAsset}
        onDownloadClick={onDownloadClick}
        onStatusChange={onStatusChange}
        userProfiles={userProfiles}
        onAssignReviewer={onAssignReviewer}
        selected={selected}
        onSelectedChange={onSelectedChange}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        bulkHighlighted={bulkHighlighted}
      />
    </div>
  );
}

function KanbanCompactCard({
  asset,
  onClick,
  onEditAsset,
  onDownloadClick,
  onStatusChange,
  userProfiles,
  onAssignReviewer,
  selected,
  onSelectedChange,
  dragHandleProps,
  isDragging = false,
  isOverlay = false,
  bulkHighlighted = false,
}: {
  asset: Asset;
  onClick: () => void;
  onEditAsset?: (asset: Asset) => void;
  onDownloadClick?: (asset: Asset) => void;
  onStatusChange: (id: string, status: AssetStatus | null) => void;
  userProfiles: UserProfile[];
  onAssignReviewer?: (assetId: string, reviewerId: string | null) => void | Promise<void>;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isOverlay?: boolean;
  bulkHighlighted?: boolean;
}) {
  const Icon = assetTypeIcon(asset.type);
  const versionNo = asset.version_no ?? 1;
  const comments = commentMeta(asset);
  const previewBackground = useImagePreviewBackground({
    src: asset.coverUrl ?? asset.url ?? undefined,
    mime_type: asset.type,
  });

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card p-2.5 shadow-sm transition-all duration-150 cursor-grab active:cursor-grabbing",
        !isOverlay && "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        isDragging && "cursor-grabbing border-primary/30 shadow-md",
        bulkHighlighted && "border-primary/30 shadow-md"
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, [role='menuitem'], [data-card-control='true']")) return;
        onClick();
      }}
      {...(dragHandleProps ?? {})}
    >
      {bulkHighlighted ? (
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary/20 animate-pulse" />
      ) : null}
      <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
        <div className={cn("relative h-[84px] overflow-hidden rounded-md border border-border/60", previewBackgroundClass(previewBackground))}>
          {asset.coverUrl ? (
            <img
              src={asset.coverUrl}
              alt={asset.name}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="line-clamp-1 text-[13px] font-medium leading-tight text-foreground" title={asset.name}>
                {asset.name}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Open menu"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-40"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onSelectedChange(!selected);
                  }}
                >
                  {selected ? <CheckCheck className="mr-2 h-4 w-4" /> : <SquareCheckBig className="mr-2 h-4 w-4" />}
                  {selected ? "Deselect" : "Select"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onClick();
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onClick();
                  }}
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Comment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onStatusChange(asset.id, "needs_review");
                  }}
                >
                  <CircleAlert className="mr-2 h-4 w-4" />
                  Set Needs review
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onStatusChange(asset.id, "in_review");
                  }}
                >
                  <MessageSquareMore className="mr-2 h-4 w-4" />
                  Set In review
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onStatusChange(asset.id, "approved");
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </DropdownMenuItem>
                {onEditAsset ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onEditAsset(asset);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {onDownloadClick ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onDownloadClick(asset);
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Icon className="h-3.5 w-3.5" />
              {asset.type?.startsWith("image/")
                ? "Image"
                : asset.type?.startsWith("video/")
                  ? "Video"
                  : "File"}
            </span>
            <span>v{versionNo}</span>
            <span>{comments.total} comment{comments.total === 1 ? "" : "s"}</span>
            <span className="ml-auto inline-flex items-center gap-1">
              <ReviewerAvatar asset={asset} profiles={userProfiles} />
            </span>
          </div>
          {!isOverlay ? <div className="h-1" /> : null}
        </div>
      </div>
    </div>
  );
}

function ReviewerMenu({
  label,
  reviewers,
  onSelect,
  compact = false,
  disabled = false,
}: {
  label: string;
  reviewers: UserProfile[];
  onSelect: (reviewerId: string | null) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant={compact ? "secondary" : "outline"} className={cn("h-8 gap-2", compact && "h-7 px-2 text-xs")} disabled={disabled}>
          <UserRoundPlus className="h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onSelect(null); }}>
          Remove reviewer
        </DropdownMenuItem>
        {reviewers.length === 0 ? (
          <DropdownMenuItem disabled>No reviewers available</DropdownMenuItem>
        ) : reviewers.map((reviewer) => (
          <DropdownMenuItem
            key={reviewer.id}
            onSelect={(event) => {
              event.preventDefault();
              onSelect(reviewer.id);
            }}
          >
            {reviewer.display_name || reviewer.id}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnMenu({
  column,
  assets,
  sort,
  reviewers,
  onSortChange,
  onToggleSelectAll,
  allSelected,
  onAssign,
  onMove,
  onDownload,
  onCollapse,
  busy = false,
}: {
  column: ColumnKey;
  assets: Asset[];
  sort: ColumnSort;
  reviewers: UserProfile[];
  onSortChange: (sort: ColumnSort) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onAssign: (reviewerId: string | null) => void;
  onMove: (status: AssetStatus | null) => void;
  onDownload?: () => void;
  onCollapse: () => void;
  busy?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`${KANBAN_COLUMN_META[column].title} actions`} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={assets.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onToggleSelectAll(); }}>
          {allSelected ? <CheckCheck className="mr-2 h-4 w-4" /> : <SquareCheckBig className="mr-2 h-4 w-4" />}
          {allSelected ? "Deselect all in column" : "Select all in column"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={assets.length === 0 || reviewers.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onAssign(reviewers[0]?.id ?? null); }}>
          <UserRoundPlus className="mr-2 h-4 w-4" />
          Assign to all
        </DropdownMenuItem>
        <DropdownMenuItem disabled={assets.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onMove("in_review"); }}>
          <MessageSquareMore className="mr-2 h-4 w-4" />
          Set In review
        </DropdownMenuItem>
        <DropdownMenuItem disabled={assets.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onMove("approved"); }}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Approve all
        </DropdownMenuItem>
        <DropdownMenuItem disabled={assets.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onMove(null); }}>
          <X className="mr-2 h-4 w-4" />
          Clear status
        </DropdownMenuItem>
        {onDownload ? (
          <DropdownMenuItem disabled={assets.length === 0 || busy} onSelect={(event) => { event.preventDefault(); onDownload(); }}>
            <Download className="mr-2 h-4 w-4" />
            Download column assets
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onCollapse(); }}>
          <ChevronDown className="mr-2 h-4 w-4" />
          Collapse column
        </DropdownMenuItem>
        <DropdownMenuItem disabled>Sort: {sortLabel(sort)}</DropdownMenuItem>
        {(["updated_desc", "updated_asc", "name_asc", "assignee", "comments_desc"] as ColumnSort[]).map((option) => (
          <DropdownMenuItem key={option} onSelect={(event) => { event.preventDefault(); onSortChange(option); }}>
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {sortLabel(option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sortLabel(sort: ColumnSort) {
  switch (sort) {
    case "updated_asc":
      return "Oldest updated";
    case "name_asc":
      return "Name A-Z";
    case "assignee":
      return "Assignee";
    case "comments_desc":
      return "Most comments";
    default:
      return "Recently updated";
  }
}

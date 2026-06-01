import type { ReactNode } from "react";
import { cn, formatTimetoDayMonth } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MoreHorizontal,
  Download,
  Trash2,
  Layers,
  Clock5,
  Image as ImageIcon,
  Video,
  CheckCircle2,
  Circle,
  PickaxeIcon,
  MessageCircleIcon,
  Pencil,
  Palette,
  File,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { getDesignAssetLabel, isDesignPreviewUnavailableAsset } from "@/lib/designFiles";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";

type AssetStatus = "approved" | "in_review" | "needs_review" | "deleted" | null;

type Asset = {
  id: string;
  name: string;
  type: string;
  createdAt?: string | null;
  coverUrl?: string | null;
  // optional fields commonly present
  version_no?: number | null;
  parent_asset_id?: string | null;
  uploaded_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  assigned_to?: string | null;
  comments_count?: number;
  url?: string | null;
  status?: AssetStatus | string | null;
};

type UserProfile = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

const STATUS_STYLES: Record<
  string,
  { label: string; className: string; icon: React.ComponentType<any> }
> = {
  approved: { label: "Approved", className: "bg-emerald-600 text-white", icon: CheckCircle2 },
  in_review: { label: "In review", className: "bg-amber-600 text-white", icon: PickaxeIcon },
  needs_review: { label: "Needs review", className: "bg-slate-700 text-white", icon: Circle },
};

function transparentOriginalPreviewUrl(asset: Asset) {
  if (!["image/png", "image/webp", "image/svg+xml"].includes(asset.type)) return null;
  const source = asset.url?.trim();
  if (!source) return null;
  if (/^(https?:|blob:|data:)/i.test(source)) return source;
  const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
  if (!proxy) return null;
  return `${proxy.replace(/\/$/, "")}/${source.replace(/^\//, "")}`;
}

export function AssetCard({
  asset,
  onStatusChange,
  onClick,
  onDownload,
  onDelete,
  onEdit,
  onManageVersions,
  onCompare,
  stackCount,
  sortKey,
  userProfiles = [],
  onMoveToFolder,
  deleteLabel = "Delete",
  subtitle,
  titleContent,
  subtitleContent,
  matchReason,
  selectable = false,
  selectionMode = false,
  selected = false,
  onSelectedChange,
  selectionAriaLabel,
}: {
  asset: Asset;
  onStatusChange: (id: string, status: any) => void;
  onClick: () => void;
  onDownload?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  onEdit?: (asset: Asset) => void;
  onManageVersions?: (asset: Asset) => void;
  onCompare?: (asset: Asset) => void;
  stackCount?: number;
  sortKey?: string;
  userProfiles?: UserProfile[];
  onMoveToFolder?: (asset: Asset) => void;
  deleteLabel?: string;
  subtitle?: string;
  titleContent?: ReactNode;
  subtitleContent?: ReactNode;
  matchReason?: string | null;
  selectable?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectionAriaLabel?: string;
}) {
  const isVideo = (asset.type || "").startsWith("video/");
  const isImage = (asset.type || "").startsWith("image/");
  const isDesignFile = isDesignPreviewUnavailableAsset(asset);
  const designLabel = getDesignAssetLabel(asset);
  const previewSrc = transparentOriginalPreviewUrl(asset) ?? asset.coverUrl;
  const previewBackground = useImagePreviewBackground({
    src: previewSrc ?? asset.url ?? undefined,
    mime_type: asset.type,
  });
  const status = (asset as any).status as string | undefined | null;
  const statusCfg = status ? STATUS_STYLES[status] : undefined;
  const versionNo = (asset as any).version_no as number | undefined;
  const isStack = Boolean(stackCount && stackCount > 1);

  // Find assigned user profile
  const assignedUser = asset.assigned_to
    ? userProfiles.find(profile => profile.id === asset.assigned_to)
    : null;

  const onApprove = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onStatusChange(asset.id, "approved");
  };
  const onRequestChanges = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onStatusChange(asset.id, "in_review");
  };
  function onNeedsReview(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    event.preventDefault();
    onStatusChange(asset.id, "needs_review");
  }

  return (
    <Card
      className={cn(
        "relative group flex min-w-0 flex-col gap-0 overflow-hidden border-border/70 bg-card p-0 m-0 shadow-sm transition-[border-color,box-shadow,transform] duration-200 motion-safe:hover:-translate-y-0.5 hover:border-border hover:shadow-md",
        selected && "border-primary/70 bg-primary/[0.07] ring-2 ring-primary/35 shadow-primary/10",
      )}
      onClick={(e) => {
        // Don't navigate if clicking an interactive element (buttons, dropdown items, etc)
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="menuitem"], .pointer-events-auto')) {
          return;
        }
        if (selectionMode && onSelectedChange) {
          onSelectedChange(!selected);
          return;
        }
        onClick();
      }}
      onDoubleClick={(event) => {
        if (!selectionMode) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, [role="menuitem"], .pointer-events-auto')) {
          return;
        }
        onClick();
      }}
    >
      {/* Thumbnail */}
      <div className={cn("relative h-[156px] shrink-0 overflow-hidden rounded-b-none rounded-t-xl", previewBackgroundClass(previewBackground))}>
        {selectable ? (
          <div
            className={cn(
              "absolute left-2 top-2 z-30 pointer-events-auto transition-opacity",
              selectionMode || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <div className="rounded-full border border-white/15 bg-black/45 p-1.5 text-white backdrop-blur-sm">
              <Checkbox
                checked={selected}
                aria-label={selectionAriaLabel ?? `Select ${asset.name}`}
                className="border-white/45 bg-white/10 text-white data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-black"
                onCheckedChange={(checked) => onSelectedChange?.(checked === true)}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        ) : null}

        {previewSrc ? (
          <img
            src={previewSrc}
            alt={asset.name}
            className="h-full w-full object-contain p-2"
            draggable={false}
          />
        ) : isDesignFile ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-white">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <Palette className="h-6 w-6 text-sky-200" />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-200">
              {designLabel}
            </div>
          </div>
        ) : isImage ? (
            <div className="grid h-full w-full place-items-center">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
        ) : isVideo ? (
          <div className="grid h-full w-full place-items-center">
            <Video className="h-6 w-6 text-muted-foreground" />
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center">
            <File className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        <div className={cn(
          "absolute right-2 top-2 z-30 pointer-events-auto transition-opacity",
          selectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 rounded-full border border-white/10 bg-black/35 text-white/80 backdrop-blur-sm hover:bg-black/55 hover:text-white"
                title="More"
                onClick={(e) => e.stopPropagation()}
                aria-label="Open menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className="w-44"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(stackCount && stackCount > 1) || asset.parent_asset_id ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onCompare?.(asset);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Layers className="mr-2 h-4 w-4" />
                  <span>Compare</span>
                </DropdownMenuItem>
              ) : null}

              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onEdit?.(asset);
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>

              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onDownload?.(asset);
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>

              {stackCount && stackCount > 1 && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onManageVersions?.(asset);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Layers className="mr-2 h-4 w-4" />
                  Manage versions
                </DropdownMenuItem>
              )}

              {onMoveToFolder && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onMoveToFolder(asset);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Layers className="mr-2 h-4 w-4" />
                  Move to folder
                </DropdownMenuItem>
              )}

              {onDelete && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onDelete(asset);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                  {deleteLabel}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Unified header bar: Type • Version/Stack • Status */}
        <div className="absolute inset-x-0 bottom-0 z-20 px-2 py-2 pointer-events-none">
          <div className="flex items-center justify-between">
            {/* Left group: only the chip area gets the translucent background */}
            <div className="inline-flex items-center gap-2 rounded-md bg-black/50 px-2 py-1 backdrop-blur-sm pointer-events-auto">
              {/* left chip: show stack or version */}
              {isStack ? (
                <span
                  className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 text-[11px]"
                  title={versionNo ? `Version ${versionNo} of ${stackCount}` : `${stackCount} versions`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  v{versionNo ?? stackCount}
                </span>
              ) : typeof versionNo !== "undefined" ? (
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">v{versionNo}</span>
              ) : null}

              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5">
                {isVideo ? (
                  <Video className="h-3.5 w-3.5" />
                ) : isImage ? (
                  <ImageIcon className="h-3.5 w-3.5" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                  </svg>
                )}
              </span>
            </div>

            {/* Right: status chip only (no full-width bar) */}
            {status && statusCfg && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium pointer-events-auto",
                  statusCfg.className
                )}
                title={statusCfg.label}
              >
                <statusCfg.icon className="h-3.5 w-3.5" />
                {statusCfg.label}
              </span>
            )}
          </div>
        </div>

        {/* Hover actions */}
        {!selectionMode ? (
          <div
            className={cn(
              "absolute inset-0 grid place-items-center bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity",
              "group-hover:opacity-100",
              "pointer-events-none"
            )}
          >
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-black/45 p-1 backdrop-blur-sm">
              <Button size="icon" variant="secondary" className="h-7 w-7" onClick={onNeedsReview} title="Needs review" aria-label="Set needs review">
                <Circle className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" className="h-7 w-7" onClick={onRequestChanges} title="In review" aria-label="Set in review">
                <PickaxeIcon className="h-4 w-4" />
              </Button>

              <Button size="icon" variant="secondary" className="h-7 w-7" onClick={onApprove} title="Approve" aria-label="Approve">
                <CheckCircle2 className="h-4 w-4" />
              </Button>

              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onDownload?.(asset);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                title="Download asset"
                aria-label="Download asset"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {/* Title + Meta */}
      <CardHeader className="space-y-1 px-2.5 pb-2 pt-2">
        <CardTitle
          className="min-w-0 text-[13px] font-medium leading-[1.05rem] line-clamp-2"
          title={asset.name}
        >
          {titleContent ?? asset.name}
        </CardTitle>
        {(subtitleContent ?? subtitle) ? (
          <div className="truncate text-[11px] text-muted-foreground" title={subtitle}>
            {subtitleContent ?? subtitle}
          </div>
        ) : null}
        {matchReason ? (
          <div className="inline-flex max-w-full truncate rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground" title={matchReason}>
            {matchReason}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex shrink-0 items-center gap-1">
              <MessageCircleIcon className="h-4 w-4 text-muted-foreground/90" />
              <span>
                {(() => {
                  const c = (asset as any).comments_count ?? (asset as any).comment_count ?? (asset as any).comments ?? 0;
                  return `${c}`;
                })()}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1 truncate">
              <Clock5 className="h-4 w-4 text-muted-foreground/90" />
              <span className="truncate">
                {(() => {
                  const updatedAt = asset.updated_at ? new Date(asset.updated_at) : null;
                  const createdAt = asset.createdAt ? new Date(asset.createdAt) : null;

                  // Show only specific date type when sorting by date
                  if (sortKey === "createdAt") {
                    return createdAt && asset.createdAt ? `Created ${formatTimetoDayMonth(asset.createdAt as string)}` : "";
                  }

                  if (sortKey === "updatedAt") {
                    return updatedAt && asset.updated_at ? `Updated ${formatTimetoDayMonth(asset.updated_at)}` :
                      createdAt && asset.createdAt ? `Created ${formatTimetoDayMonth(asset.createdAt as string)}` : "";
                  }

                  // Default behavior when no date filter is selected
                  if (updatedAt && createdAt && updatedAt > createdAt && asset.updated_at) {
                    return `Updated ${formatTimetoDayMonth(asset.updated_at)}`;
                  }

                  return createdAt && asset.createdAt ? `Created ${formatTimetoDayMonth(asset.createdAt as string)}` : "";
                })()}
              </span>
            </div>
          </div>
          {assignedUser && (
            <Avatar className="h-5 w-5 shrink-0" title={`Assigned to ${assignedUser.display_name || assignedUser.id}`}>
              <AvatarImage
                src={assignedUser.avatar_url || undefined}
                alt={assignedUser.display_name || assignedUser.id}
              />
              <AvatarFallback className={`text-[10px] ${AVATAR_FALLBACK_CLASS}`}>
                {getAvatarInitials(assignedUser.display_name || assignedUser.id)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}

export default AssetCard;

import { isValidElement, memo, useRef, type ReactNode } from "react";
import { cn, formatTimetoDayMonth } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MoreHorizontal,
  Download,
  Trash2,
  Unlink,
  Layers,
  Clock5,
  Image as ImageIcon,
  Play,
  Video,
  CheckCircle2,
  Circle,
  PickaxeIcon,
  MessageCircleIcon,
  Pencil,
  File,
  Music,
  Code2,
  Lock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { getFileTypeVisual } from "@/lib/designFiles";
import { PendingCover } from "@/components/media/PendingCover";
import { expectsServerCover } from "@/lib/assetCoverWait";
import { FILE_TYPE_KIND_COLOR_CLASS, FILE_TYPE_KIND_ICONS } from "@/lib/fileTypeVisuals";
import { isHtml5BannerAsset } from "@/lib/html5Banner";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { resolveMediaUrl, resolveGridPreviewUrl, GRID_THUMBNAIL_TRANSFORM } from "@/lib/mediaDelivery";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";
import { AssetImageFrame } from "@/components/media/AssetImageFrame";
import { useResolvedAssetFileUrl } from "@/lib/assetFileUrl";

// How long after upload a tile without a picture is treated as "still being made" rather than as having none.
const FRESH_UPLOAD_WINDOW_MS = 2 * 60 * 1000;

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
  return resolveMediaUrl(source);
}

function compactAssetCardTime(isoString: string) {
  return formatTimetoDayMonth(isoString)
    .replace(/\bminutes?\b/g, "min")
    .replace(/\bhours?\b/g, "hr")
    .replace(/\bseconds?\b/g, "sec");
}

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

function AssetCard({
  asset,
  onStatusChange,
  onClick,
  onDownload,
  onDelete,
  onPermanentDelete,
  onEdit,
  onManageVersions,
  onCompare,
  stackCount,
  sortKey,
  userProfiles = [],
  onMoveToFolder,
  deleteLabel = "Delete",
  permanentDeleteLabel = "Delete asset",
  subtitle,
  titleContent,
  subtitleContent,
  matchReason,
  matchReasonTitle,
  selectable = false,
  selectionMode = false,
  selected = false,
  onSelectedChange,
  selectionAriaLabel,
  selectionLocked = false,
  selectionLockedHint = "Only files you added through this share link can be moved",
}: {
  asset: Asset;
  onStatusChange: (id: string, status: any) => void;
  onClick: () => void;
  onDownload?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  onPermanentDelete?: (asset: Asset) => void;
  onEdit?: (asset: Asset) => void;
  onManageVersions?: (asset: Asset) => void;
  onCompare?: (asset: Asset) => void;
  stackCount?: number;
  sortKey?: string;
  userProfiles?: UserProfile[];
  onMoveToFolder?: (asset: Asset) => void;
  deleteLabel?: string;
  permanentDeleteLabel?: string;
  subtitle?: string;
  titleContent?: ReactNode;
  subtitleContent?: ReactNode;
  matchReason?: ReactNode | null;
  matchReasonTitle?: string | null;
  selectable?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectionAriaLabel?: string;
  selectionLocked?: boolean;
  selectionLockedHint?: string;
}) {
  const isVideo = (asset.type || "").startsWith("video/");
  const isImage = (asset.type || "").startsWith("image/");
  const isAudio = (asset.type || "").startsWith("audio/");
  // A tile uploaded moments ago whose picture the server is still making shows a breathing circle, so it reads as "working"
  // and not as a broken black tile; the picture then scales and fades in over it.
  const awaitingCover = !asset.coverUrl && expectsServerCover(asset) && Boolean(asset.createdAt) && Date.now() - Date.parse(String(asset.createdAt)) < FRESH_UPLOAD_WINDOW_MS;
  // Remembered so that only a tile that actually waited gets the reveal; every other thumbnail loads exactly as before.
  const wasAwaitingRef = useRef(false);
  if (awaitingCover) wasAwaitingRef.current = true;
  const fileTypeVisual = getFileTypeVisual(asset);
  const FileTypeIcon = fileTypeVisual ? FILE_TYPE_KIND_ICONS[fileTypeVisual.kind] : null;
  const isHtml5Banner = isHtml5BannerAsset(asset);
  // Thumbnails already preserve transparency (PNG output) for PNG/WebP/SVG
  // sources, both from client-side upload generation and the backfill
  // thumbnail-worker. Only fall back to the full original when no thumbnail
  // has been generated yet, instead of always loading full-res in the grid.
  // OSS: the assets bucket is private, so the original's URL must be signed before it can load.
  const transparentOriginalPreview = useResolvedAssetFileUrl(transparentOriginalPreviewUrl(asset));
  const legacyPreviewSrc = asset.coverUrl ?? transparentOriginalPreview;
  // Prefer a Cloudflare-resized version of the original for real image
  // assets (behind VITE_ENABLE_IMAGE_TRANSFORMS) — null when not applicable
  // (flag off, non-image type), in which case legacyPreviewSrc is used as-is.
  const cloudflarePreviewSrc = resolveGridPreviewUrl(asset, GRID_THUMBNAIL_TRANSFORM);
  const previewSrc = cloudflarePreviewSrc ?? legacyPreviewSrc;
  const previewFallbackSrc = cloudflarePreviewSrc ? (asset.coverUrl ?? undefined) : undefined;
  const previewBackground = useImagePreviewBackground({
    src: previewSrc ?? asset.url ?? undefined,
    mime_type: asset.type,
    analyze: false,
  });
  const status = (asset as any).status as string | undefined | null;
  const statusCfg = status ? STATUS_STYLES[status] : undefined;
  const versionNo = (asset as any).version_no as number | undefined;
  const isStack = Boolean(stackCount && stackCount > 1);
  const showSelectionControl = selected || selectionMode || selectionLocked;

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
        "relative group flex min-w-0 flex-col gap-0 overflow-hidden border-border/70 bg-card p-0 m-0 shadow-sm outline-none transform-gpu transition-[border-color,box-shadow,transform,background-color] duration-200 motion-safe:hover:-translate-y-0.5 hover:z-10 hover:border-border hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/55",
        selectionMode && !selectionLocked && "cursor-pointer hover:border-primary/45",
        selectionLocked && "opacity-55 cursor-default",
        selected && "border-primary/80 bg-primary/[0.08] shadow-[0_0_0_1px_rgba(124,58,237,0.28),0_10px_32px_rgba(124,58,237,0.10)]",
      )}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (selectionLocked) return;
        // Don't navigate if clicking an interactive element (buttons, dropdown items, etc)
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="menuitem"], [data-card-control="true"]')) {
          return;
        }
        if (selectionMode && e.detail > 1) return;
        if (selectionMode && onSelectedChange) {
          onSelectedChange(!selected);
          return;
        }
        onClick();
      }}
      onKeyDown={(e) => {
        if (selectionLocked) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="menuitem"], [data-card-control="true"]')) {
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (selectionMode && onSelectedChange) {
          onSelectedChange(!selected);
          return;
        }
        onClick();
      }}
      onDoubleClick={(event) => {
        if (selectionLocked) return;
        if (!selectionMode) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, [role="menuitem"], [data-card-control="true"]')) {
          return;
        }
        onClick();
      }}
    >
      {/* Thumbnail */}
      <div className={cn("relative h-[156px] shrink-0 overflow-hidden rounded-b-none rounded-t-xl", previewBackgroundClass(previewBackground))}>
        {selectable ? (
          <div
            data-card-control="true"
            className={cn(
              "absolute left-2.5 top-2.5 z-30 transition-[opacity,transform] duration-150",
              showSelectionControl
                ? "pointer-events-auto opacity-100"
                : "pointer-events-auto opacity-100 sm:pointer-events-none sm:-translate-y-0.5 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:translate-y-0 [@media(pointer:coarse)]:opacity-100",
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (selectionLocked) return;
              onSelectedChange?.(!selected);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {selectionLocked ? (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.16] bg-black/50 text-white/75 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md"
                title={selectionLockedHint}
                aria-label={selectionLockedHint}
              >
                <Lock className="h-4 w-4" />
              </div>
            ) : (
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.16] bg-black/50 text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[background-color,border-color,box-shadow]",
                  "hover:border-white/35 hover:bg-black/65",
                  selected && "border-[#a78bfa]/80 bg-black/65 shadow-[0_8px_28px_rgba(124,58,237,0.28)]",
                )}
              >
                <Checkbox
                  checked={selected}
                  aria-label={selectionAriaLabel ?? `Select ${asset.name}`}
                  className="size-[18px] border-white/55 bg-white/5 text-white shadow-none transition-[background-color,border-color,color] data-[state=checked]:!border-[#a78bfa] data-[state=checked]:!bg-[#7c3aed] data-[state=checked]:!text-white dark:data-[state=checked]:!border-[#a78bfa] dark:data-[state=checked]:!bg-[#7c3aed] dark:data-[state=checked]:!text-white focus-visible:ring-[#a78bfa]/60"
                  style={selected ? { backgroundColor: "#7c3aed", borderColor: "#a78bfa", color: "#fff" } : undefined}
                  onCheckedChange={(checked) => onSelectedChange?.(checked === true)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                />
              </div>
            )}
          </div>
        ) : null}

        {previewSrc ? (
          <AssetImageFrame
            src={previewSrc}
            fallbackSrc={previewFallbackSrc}
            alt={asset.name}
            className="h-full w-full object-contain p-2"
            fallback={
              <div className="grid h-full w-full place-items-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
            }
            draggable={false}
            reveal={wasAwaitingRef.current}
          />
        ) : awaitingCover ? (
          <PendingCover icon={FileTypeIcon ?? (isVideo ? Video : isAudio ? Music : ImageIcon)} />
        ) : fileTypeVisual && FileTypeIcon ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-muted-foreground dark:text-white">
            <div className="rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-white/10 p-3">
              <FileTypeIcon className={cn("h-6 w-6", FILE_TYPE_KIND_COLOR_CLASS[fileTypeVisual.kind])} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground dark:text-slate-200">
              {fileTypeVisual.label}
            </div>
          </div>
        ) : isHtml5Banner ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-muted-foreground dark:text-white">
            <div className="rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-white/10 p-3">
              <Code2 className="h-6 w-6 text-sky-700 dark:text-sky-200" />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground dark:text-slate-200">
              HTML5
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
        ) : isAudio ? (
          <div className="grid h-full w-full place-items-center">
            <Music className="h-7 w-7 text-muted-foreground" />
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center">
            <File className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        {isVideo && !awaitingCover ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center transition-opacity duration-150 group-hover:opacity-70">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/10">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </div>
          </div>
        ) : null}

        <div className={cn(
          "absolute right-2 top-2 z-30 pointer-events-auto transition-opacity",
          selectionMode ? "pointer-events-none opacity-0" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        )} data-card-control="true">
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
                  {onPermanentDelete ? (
                    <Unlink className="mr-2 h-4 w-4" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                  )}
                  {deleteLabel}
                </DropdownMenuItem>
              )}

              {onDelete && onPermanentDelete ? <DropdownMenuSeparator /> : null}

              {onPermanentDelete && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    onPermanentDelete(asset);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {permanentDeleteLabel}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Unified header bar: Type • Version/Stack • Status */}
        <div className="absolute inset-x-0 bottom-0 z-20 px-2 py-2 pointer-events-none">
          <div className="flex items-center justify-between">
            {/* Left group: only the chip area gets the translucent background */}
            <div className="inline-flex items-center gap-2 rounded-md bg-black/50 px-2 py-1 backdrop-blur-sm">
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
                ) : isAudio ? (
                  <Music className="h-3.5 w-3.5" />
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
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
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
              "absolute inset-0 z-20 grid place-items-center bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity",
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
          <div
            className={cn(
              "max-w-full rounded-md bg-muted/70 px-2 py-1 text-[10px] leading-snug text-foreground",
              typeof matchReason === "string" && "inline-flex truncate rounded-full py-0.5 font-medium",
            )}
            title={matchReasonTitle ?? (typeof matchReason === "string" ? matchReason : undefined)}
          >
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
                    return createdAt && asset.createdAt ? compactAssetCardTime(asset.createdAt as string) : "";
                  }

                  if (sortKey === "updatedAt") {
                    return updatedAt && asset.updated_at ? compactAssetCardTime(asset.updated_at) :
                      createdAt && asset.createdAt ? compactAssetCardTime(asset.createdAt as string) : "";
                  }

                  // Default behavior when no date filter is selected
                  if (updatedAt && createdAt && updatedAt > createdAt && asset.updated_at) {
                    return compactAssetCardTime(asset.updated_at);
                  }

                  return createdAt && asset.createdAt ? compactAssetCardTime(asset.createdAt as string) : "";
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

const MemoizedAssetCard = memo(AssetCard, (prev, next) => {
  return (
    prev.asset === next.asset &&
    prev.stackCount === next.stackCount &&
    prev.sortKey === next.sortKey &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected &&
    prev.selectable === next.selectable &&
    prev.selectionLocked === next.selectionLocked &&
    prev.selectionLockedHint === next.selectionLockedHint &&
    prev.deleteLabel === next.deleteLabel &&
    prev.permanentDeleteLabel === next.permanentDeleteLabel &&
    prev.selectionAriaLabel === next.selectionAriaLabel &&
    prev.subtitle === next.subtitle &&
    prev.matchReasonTitle === next.matchReasonTitle &&
    nodeText(prev.titleContent) === nodeText(next.titleContent) &&
    nodeText(prev.subtitleContent) === nodeText(next.subtitleContent) &&
    nodeText(prev.matchReason) === nodeText(next.matchReason)
  );
});

export { MemoizedAssetCard as AssetCard };
export default MemoizedAssetCard;

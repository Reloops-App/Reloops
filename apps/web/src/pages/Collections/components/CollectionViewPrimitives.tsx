import * as React from "react";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  File,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Layers3,
  MessageSquare,
  PickaxeIcon,
  UserRound,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COLLECTION_VISIBLE_FIELD_OPTIONS,
  formatBytes,
  formatCollectionFieldValue,
  getFolderPath,
  humanizeCollectionKey,
  type CollectionAppearanceDefinition,
  type CollectionAssetRow,
  type CollectionFolderRow,
  type CollectionProjectSummary,
  type CollectionVisibleField,
} from "@/lib/collections";
import { cn } from "@/lib/utils";
import { getDesignAssetLabel, isDesignPreviewUnavailableAsset } from "@/lib/designFiles";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";
import { Palette } from "lucide-react";

const STATUS_STYLES: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20", icon: CheckCircle2 },
  in_review: { label: "In review", className: "bg-amber-500/15 text-amber-300 border-amber-500/20", icon: PickaxeIcon },
  needs_review: { label: "Needs review", className: "bg-sky-500/15 text-sky-300 border-sky-500/20", icon: Circle },
  none: { label: "No status", className: "bg-muted/40 text-muted-foreground border-border/80", icon: Circle },
};

const VISIBLE_FIELD_ICONS: Record<string, React.ElementType> = {
  status: BadgeCheck,
  file_extension: File,
  mime_kind: ImageIcon,
  mime_type: FileText,
  size_bytes: HardDrive,
  duration_ms: Clock3,
  dimensions: ImageIcon,
  project: FolderOpen,
  folder: FolderOpen,
  uploaded_at: CalendarDays,
  updated_at: CalendarDays,
  assigned_to: UserRound,
  comments_count: MessageSquare,
  version_count: Layers3,
};

export const GRID_CARD_SIZE_CONFIG: Record<
  "small" | "medium" | "large",
  {
    minWidth: number;
    cardClassName: string;
    bodyClassName: string;
    titleClassName: string;
    metaClassName: string;
    fieldGapClassName: string;
    badgeClassName: string;
  }
> = {
  small: {
    minWidth: 160,
    cardClassName: "rounded-[18px]",
    bodyClassName: "gap-2 px-2.5 pb-2.5 pt-2",
    titleClassName: "text-[13px] leading-[1.2rem]",
    metaClassName: "text-[11px]",
    fieldGapClassName: "space-y-2",
    badgeClassName: "px-1.5 py-0 text-[10px]",
  },
  medium: {
    minWidth: 220,
    cardClassName: "rounded-[20px]",
    bodyClassName: "gap-2.5 px-3 pb-3 pt-2.5",
    titleClassName: "text-sm leading-5",
    metaClassName: "text-xs",
    fieldGapClassName: "space-y-2.5",
    badgeClassName: "px-2 py-0.5 text-[10px]",
  },
  large: {
    minWidth: 300,
    cardClassName: "rounded-[22px]",
    bodyClassName: "gap-3 px-3.5 pb-3.5 pt-3",
    titleClassName: "text-[15px] leading-[1.35rem]",
    metaClassName: "text-xs",
    fieldGapClassName: "space-y-3",
    badgeClassName: "px-2 py-0.5 text-[11px]",
  },
};

const THUMBNAIL_ASPECT_RATIO: Record<"square" | "portrait" | "landscape", string> = {
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "16 / 9",
};

export const DEFAULT_COLLECTION_APPEARANCE_SETTINGS: CollectionAppearanceDefinition = {
  mode: "grid",
  card_size: "large",
  aspect_ratio: "square",
  thumbnail_scale: "fill",
  show_card_info: true,
  title_display: "one_line",
};

export type CollectionFolderSection = {
  id: string;
  folderId: string | null;
  label: string;
  pathLabel: string | null;
  rows: CollectionAssetRow[];
  totalSize: number;
  sortKey: string;
};

function pathStartsWith(path: string[], prefix: string[]) {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => path[index] === segment);
}

export function buildCollectionFolderSection(
  folderId: string | null,
  sourceType: string | null,
  sourceProjectId: string | null,
  sourceFolderId: string | null,
  foldersById: Map<string, CollectionFolderRow>,
  projectsById: Map<string, CollectionProjectSummary>,
): Omit<CollectionFolderSection, "rows" | "totalSize"> {
  const projectName = sourceProjectId ? projectsById.get(sourceProjectId)?.name ?? "Project" : null;

  if (!folderId) {
    if (sourceType === "project_root") {
      return {
        id: "folder:root",
        folderId: null,
        label: "Project Root",
        pathLabel: projectName,
        sortKey: "",
      };
    }

    if (sourceType === "workspace_root") {
      return {
        id: "folder:root",
        folderId: null,
        label: "Workspace Root",
        pathLabel: "Workspace Library",
        sortKey: "",
      };
    }

    return {
      id: "folder:root",
      folderId: null,
      label: "Root",
      pathLabel: null,
      sortKey: "",
    };
  }

  const folder = foldersById.get(folderId);
  const fullPath = getFolderPath(folderId, foldersById);
  const resolvedPath = fullPath.length > 0 ? fullPath : [folder?.name ?? "Unknown Folder"];
  const selectedSourcePath = sourceFolderId ? getFolderPath(sourceFolderId, foldersById) : [];
  const relativePath = sourceFolderId && pathStartsWith(resolvedPath, selectedSourcePath)
    ? resolvedPath.slice(selectedSourcePath.length)
    : resolvedPath;

  if (sourceFolderId && folderId === sourceFolderId) {
    const fullLabel = resolvedPath.join(" / ");
    return {
      id: `folder:${folderId}`,
      folderId,
      label: folder?.name ?? resolvedPath[resolvedPath.length - 1] ?? "Selected Folder",
      pathLabel: sourceType === "project_folder"
        ? `${projectName ?? "Project"} / ${fullLabel}`
        : `Workspace Library / ${fullLabel}`,
      sortKey: "",
    };
  }

  const labelPath = sourceFolderId ? relativePath : resolvedPath;
  const label = labelPath.join(" / ") || folder?.name || "Folder";
  const fullLabel = resolvedPath.join(" / ");

  return {
    id: `folder:${folderId}`,
    folderId,
    label,
    pathLabel: sourceType === "project_root" || sourceType === "project_folder"
      ? `${projectName ?? "Project"} / ${fullLabel}`
      : `Workspace Library / ${fullLabel}`,
    sortKey: (sourceFolderId ? relativePath : resolvedPath).join("/").toLowerCase(),
  };
}

export function CollectionStatusBadge({ status }: { status: string | null | undefined }) {
  const key = status && STATUS_STYLES[status] ? status : "none";
  const config = STATUS_STYLES[key];
  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium", config.className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

function CollectionAssetThumbnail({
  row,
  aspectRatio,
  thumbnailScale,
  showMetaOverlays,
}: {
  row: CollectionAssetRow;
  aspectRatio: CollectionAppearanceDefinition["aspect_ratio"];
  thumbnailScale: CollectionAppearanceDefinition["thumbnail_scale"];
  showMetaOverlays: boolean;
}) {
  const asset = row.asset;
  const isVideo = (asset.type || "").startsWith("video/");
  const isImage = (asset.type || "").startsWith("image/");
  const isDesignFile = isDesignPreviewUnavailableAsset(asset);
  const designLabel = getDesignAssetLabel(asset);
  const commentCount = asset.comments_count ?? 0;
  const durationMs = typeof (asset as any).duration_ms === "number" ? (asset as any).duration_ms : null;
  const durationLabel = durationMs != null ? formatCollectionFieldValue(row, "duration_ms", new Map(), new Map()) : null;
  const previewBackground = useImagePreviewBackground({ src: asset.coverUrl ?? asset.url ?? undefined, mime_type: asset.type });

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[inherit] border-b border-border/70",
        previewBackgroundClass(previewBackground),
      )}
      style={{ aspectRatio: THUMBNAIL_ASPECT_RATIO[aspectRatio] }}
    >
      {isDesignFile ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-white">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
            <Palette className="h-6 w-6 text-sky-200" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-200">
            {designLabel}
          </span>
        </div>
      ) : asset.coverUrl ? (
        <img
          src={asset.coverUrl}
          alt={asset.name}
          className={cn(
            "h-full w-full transition-transform duration-300 ease-out group-hover:scale-[1.025]",
            thumbnailScale === "fit" ? "object-contain p-2" : "object-cover",
          )}
          draggable={false}
        />
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
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
      )}

      {row.versionCount > 1 ? (
        <div className="absolute right-2 top-2 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
          {row.versionCount} versions
        </div>
      ) : null}

      {showMetaOverlays && (commentCount > 0 || durationLabel) ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            {commentCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/62 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <MessageSquare className="h-3.5 w-3.5" />
                {commentCount}
              </span>
            ) : (
              <span />
            )}
            {durationLabel ? (
              <span className="inline-flex items-center rounded-md bg-black/62 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                {durationLabel}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CollectionListThumbnail({ row }: { row: CollectionAssetRow }) {
  const asset = row.asset;
  const isVideo = (asset.type || "").startsWith("video/");
  const isImage = (asset.type || "").startsWith("image/");
  const isDesignFile = isDesignPreviewUnavailableAsset(asset);
  const designLabel = getDesignAssetLabel(asset);
  const previewBackground = useImagePreviewBackground({ src: asset.coverUrl ?? asset.url ?? undefined, mime_type: asset.type });

  return (
    <div className={cn("h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-border/60", previewBackgroundClass(previewBackground))}>
      {isDesignFile ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-white">
          <div className="rounded-xl border border-white/10 bg-white/10 p-2">
            <Palette className="h-4 w-4 text-sky-200" />
          </div>
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-200">
            {designLabel}
          </span>
        </div>
      ) : asset.coverUrl ? (
        <img
          src={asset.coverUrl}
          alt={asset.name}
          className="h-full w-full object-cover"
        />
      ) : isImage ? (
        <div className="grid h-full w-full place-items-center">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      ) : isVideo ? (
        <div className="grid h-full w-full place-items-center">
          <Video className="h-4 w-4 text-muted-foreground" />
        </div>
      ) : (
        <div className="grid h-full w-full place-items-center">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function getCollectionVisibleFieldLabel(field: CollectionVisibleField) {
  return COLLECTION_VISIBLE_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? humanizeCollectionKey(field);
}

function CollectionGridFieldRow({
  row,
  field,
  projectsById,
  foldersById,
  peopleById,
}: {
  row: CollectionAssetRow;
  field: CollectionVisibleField;
  projectsById: Map<string, CollectionProjectSummary>;
  foldersById: Map<string, CollectionFolderRow>;
  peopleById: Map<string, string>;
}) {
  const Icon = VISIBLE_FIELD_ICONS[field] ?? FileText;
  const isStatus = field === "status";
  const value = isStatus
    ? STATUS_STYLES[row.asset.status ?? "none"]?.label ?? "No status"
    : formatCollectionFieldValue(row, field, projectsById, foldersById, peopleById);
  const isEmptyValue = !isStatus && (value === "—" || value === "");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{getCollectionVisibleFieldLabel(field)}</span>
      </div>
      <div className="min-h-9 rounded-xl border border-border/60 bg-background/45 px-3 py-2">
        {isStatus ? (
          <CollectionStatusBadge status={row.asset.status} />
        ) : (
          <div
            className={cn(
              "line-clamp-2 text-sm leading-5 text-foreground",
              isEmptyValue && "text-muted-foreground",
            )}
            title={value}
          >
            {isEmptyValue ? "Not set" : value}
          </div>
        )}
      </div>
    </div>
  );
}

export function CollectionGridCard({
  row,
  visibleFields,
  appearance,
  projectsById,
  foldersById,
  peopleById,
  onClick,
}: {
  row: CollectionAssetRow;
  visibleFields: CollectionVisibleField[];
  appearance: CollectionAppearanceDefinition;
  projectsById: Map<string, CollectionProjectSummary>;
  foldersById: Map<string, CollectionFolderRow>;
  peopleById: Map<string, string>;
  onClick: () => void;
}) {
  const cardSize = GRID_CARD_SIZE_CONFIG[appearance.card_size];
  const showCardInfo = appearance.show_card_info;
  const titleLineClass = appearance.title_display === "two_line" ? "line-clamp-2 min-h-[2.5rem]" : "line-clamp-1 min-h-[1.25rem]";
  const extensionValue = React.useMemo(() => {
    const fromField = visibleFields.includes("file_extension")
      ? formatCollectionFieldValue(row, "file_extension", projectsById, foldersById)
      : null;

    if (fromField && fromField !== "—") return String(fromField).toUpperCase();

    const rawType = row.asset.type || "";
    const rawExt = rawType.includes("/") ? rawType.split("/")[1] : rawType;
    return rawExt ? rawExt.toUpperCase() : null;
  }, [foldersById, projectsById, row, visibleFields]);

  const metaLine = React.useMemo(() => {
    const parts = [
      row.asset.sizeBytes ? formatBytes(row.asset.sizeBytes) : null,
      formatCollectionFieldValue(row, "mime_kind", projectsById, foldersById),
    ].filter(Boolean);
    return parts.join(" • ");
  }, [foldersById, projectsById, row]);

  const detailFields = React.useMemo(
    () => (showCardInfo ? visibleFields.filter((field) => field !== "file_extension" && field !== "mime_kind") : []),
    [showCardInfo, visibleFields],
  );

  return (
    <button
      type="button"
      className={cn(
        "group flex h-full flex-col overflow-hidden border border-border/60 bg-card/90 p-0 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/25 hover:bg-card hover:shadow-[0_18px_44px_-22px_rgba(15,23,42,0.55)] focus-visible:-translate-y-1 focus-visible:border-primary/30 focus-visible:shadow-[0_18px_44px_-22px_rgba(15,23,42,0.55)]",
        cardSize.cardClassName,
      )}
      onClick={onClick}
    >
      <CollectionAssetThumbnail
        row={row}
        aspectRatio={appearance.aspect_ratio}
        thumbnailScale={appearance.thumbnail_scale}
        showMetaOverlays={showCardInfo}
      />
      {showCardInfo || detailFields.length > 0 ? (
        <div className={cn("flex flex-1 flex-col", cardSize.bodyClassName)}>
          {showCardInfo ? (
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div
                    className={cn("font-semibold text-foreground transition-colors duration-200 group-hover:text-primary", cardSize.titleClassName, titleLineClass)}
                    title={row.asset.name || "Untitled asset"}
                  >
                    {row.asset.name || "Untitled asset"}
                  </div>
                </div>
                {extensionValue ? (
                  <Badge variant="secondary" className={cn("shrink-0 rounded-md font-semibold uppercase tracking-[0.04em]", cardSize.badgeClassName)}>
                    {extensionValue}
                  </Badge>
                ) : null}
              </div>
              {metaLine ? (
                <div className={cn("text-muted-foreground", cardSize.metaClassName)}>
                  {metaLine}
                </div>
              ) : null}
            </div>
          ) : null}

          {detailFields.length > 0 ? (
            <div className={cardSize.fieldGapClassName}>
              {detailFields.map((field) => (
                <CollectionGridFieldRow
                  key={field}
                  row={row}
                  field={field}
                  projectsById={projectsById}
                  foldersById={foldersById}
                  peopleById={peopleById}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

export function CollectionFolderSectionHeader({
  label,
  pathLabel,
  assetCount,
  totalSize,
}: {
  label: string;
  pathLabel: string | null;
  assetCount: number;
  totalSize: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </div>
        {pathLabel ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">{pathLabel}</div>
        ) : null}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">
        {assetCount} assets • {formatBytes(totalSize)}
      </div>
    </div>
  );
}

export function CollectionListTable({
  sections,
  showSectionHeaders,
  visibleFields,
  appearance,
  projectsById,
  foldersById,
  peopleById,
  onRowClick,
}: {
  sections: CollectionFolderSection[];
  showSectionHeaders: boolean;
  visibleFields: CollectionVisibleField[];
  appearance: CollectionAppearanceDefinition;
  projectsById: Map<string, CollectionProjectSummary>;
  foldersById: Map<string, CollectionFolderRow>;
  peopleById: Map<string, string>;
  onRowClick: (row: CollectionAssetRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
      <Table>
        <TableHeader className="bg-muted/20">
          <TableRow>
            <TableHead className="w-[360px] text-muted-foreground">Asset</TableHead>
            {visibleFields.map((field) => (
              <TableHead key={field} className="text-muted-foreground">
                {getCollectionVisibleFieldLabel(field)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => (
            <React.Fragment key={section.id}>
              {showSectionHeaders ? (
                <TableRow className="bg-transparent hover:bg-transparent">
                  <TableCell colSpan={visibleFields.length + 1} className="border-b border-border/60">
                    <CollectionFolderSectionHeader
                      label={section.label}
                      pathLabel={section.pathLabel}
                      assetCount={section.rows.length}
                      totalSize={section.totalSize}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
              {section.rows.map((row) => (
                <TableRow
                  key={row.rootId}
                  className="cursor-pointer border-border/60 hover:bg-muted/20"
                  onClick={() => onRowClick(row)}
                >
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <CollectionListThumbnail row={row} />
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "font-medium text-foreground",
                            appearance.title_display === "two_line" ? "line-clamp-2 leading-5" : "truncate",
                          )}
                        >
                          {row.asset.name || "Untitled asset"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.asset.type || "Unknown type"}</div>
                      </div>
                    </div>
                  </TableCell>
                  {visibleFields.map((field) => (
                    <TableCell key={field}>
                      {field === "status" ? (
                        <CollectionStatusBadge status={row.asset.status} />
                      ) : (
                        <span className="text-sm text-foreground">
                          {formatCollectionFieldValue(row, field, projectsById, foldersById, peopleById)}
                        </span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

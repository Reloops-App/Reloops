import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, File, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_COLLECTION_VISIBLE_FIELDS,
  filterRowsBySearch,
  normalizeCollectionRecord,
  normalizeVisibleFields,
  type CollectionAssetRow,
  type CollectionFolderRow,
  type CollectionProjectSummary,
  type CollectionRecord,
} from "@/lib/collections";
import { ensureFreshSupabaseSession, getSupabaseSessionFromStorage } from "@/lib/supabaseAuthApi";
import { downloadCollectionZip } from "@/lib/zip";
import { cn } from "@/lib/utils";
import {
  CollectionBrandHeader,
  type CollectionCreatorProfile,
  type CollectionHeaderBackgroundAssetOption,
} from "../Collections/components/CollectionBrandHeader";
import {
  buildCollectionFolderSection,
  CollectionFolderSectionHeader,
  CollectionGridCard,
  CollectionListTable,
  DEFAULT_COLLECTION_APPEARANCE_SETTINGS,
  GRID_CARD_SIZE_CONFIG,
  type CollectionFolderSection,
} from "../Collections/components/CollectionViewPrimitives";

type CollectionShareLink = {
  id: string;
  allow_download: boolean;
  allow_comments: boolean;
  collections: CollectionRecord;
  creator_profile?: CollectionCreatorProfile;
  rows: CollectionAssetRow[];
  folders: CollectionFolderRow[];
  is_member?: boolean;
};

function buildEdgeHeaders(accessToken?: string | null) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken ?? anonKey}`,
  };
}

export default function ShareCollection() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<CollectionShareLink | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let mounted = true;

    (async () => {
      try {
        await ensureFreshSupabaseSession();
        const session = getSupabaseSessionFromStorage();
        const accessToken = session?.access_token ?? null;
        const { data, error: shareError } = await invokeEdgeFunction("share", {
          headers: buildEdgeHeaders(accessToken),
          body: {
            action: "get-collection-share-link",
            token,
          },
        });

        if (shareError) throw new Error(shareError.message || "Failed to load collection share");
        const payload = data?.data as CollectionShareLink | undefined;
        if (!payload?.collections) throw new Error("Collection share not found");

        const normalizedCollection = normalizeCollectionRecord(payload.collections as any);
        const normalizedShare = {
          ...payload,
          collections: normalizedCollection,
          rows: Array.isArray(payload.rows) ? payload.rows : [],
          folders: Array.isArray(payload.folders) ? payload.folders : [],
        } as CollectionShareLink;

        if (normalizedShare.is_member && normalizedCollection.workspace_id) {
          navigate(`/workspace/${normalizedCollection.workspace_id}/collections/${normalizedCollection.id}`, { replace: true });
          return;
        }

        if (mounted) {
          setShare(normalizedShare);
          setError(null);
        }
      } catch (nextError) {
        console.error("Failed to load shared collection", nextError);
        if (mounted) {
          setShare(null);
          setError(nextError instanceof Error ? nextError.message : "Failed to load shared collection");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigate, token]);

  const collection = share?.collections ?? null;
  const filteredRows = useMemo(
    () => filterRowsBySearch(share?.rows ?? [], search),
    [search, share?.rows],
  );
  const totalSize = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (row.asset.sizeBytes ?? 0), 0),
    [filteredRows],
  );
  const foldersById = useMemo(
    () => new Map((share?.folders ?? []).map((folder) => [folder.id, folder])),
    [share?.folders],
  );
  const projectsById = useMemo<Map<string, CollectionProjectSummary>>(() => new Map(), []);
  const peopleById = useMemo<Map<string, string>>(() => new Map(), []);
  const visibleFields = useMemo(
    () => normalizeVisibleFields(collection?.visible_fields ?? DEFAULT_COLLECTION_VISIBLE_FIELDS),
    [collection?.visible_fields],
  );
  const appearanceSettings = collection?.definition.appearance ?? DEFAULT_COLLECTION_APPEARANCE_SETTINGS;
  const groupMode = collection?.group_mode ?? collection?.definition.grouping.mode ?? "folder";
  const headerBackgroundAssets = useMemo<CollectionHeaderBackgroundAssetOption[]>(
    () =>
      (share?.rows ?? [])
        .map((row) => ({
          rootId: row.rootId,
          assetId: row.asset.id,
          label: row.asset.name || "Untitled asset",
          imageUrl: row.asset.coverUrl || row.asset.url || "",
          mimeType: row.asset.type || null,
        }))
        .filter((asset) => asset.imageUrl),
    [share?.rows],
  );
  const folderSections = useMemo<CollectionFolderSection[]>(() => {
    if (!collection) return [];

    const groupedRows = new Map<string, CollectionAssetRow[]>();
    for (const row of filteredRows) {
      const groupKey = row.asset.folder_id ?? "__root__";
      const existing = groupedRows.get(groupKey);
      if (existing) {
        existing.push(row);
      } else {
        groupedRows.set(groupKey, [row]);
      }
    }

    return Array.from(groupedRows.entries())
      .map(([folderKey, grouped]) => {
        const folderId = folderKey === "__root__" ? null : folderKey;
        const section = buildCollectionFolderSection(
          folderId,
          collection.source_type ?? null,
          collection.source_project_id ?? null,
          collection.source_folder_id ?? null,
          foldersById,
          projectsById,
        );

        return {
          ...section,
          rows: grouped,
          totalSize: grouped.reduce((sum, entry) => sum + (entry.asset.sizeBytes ?? 0), 0),
        };
      })
      .sort((left, right) => {
        if (left.sortKey === right.sortKey) return left.label.localeCompare(right.label);
        if (!left.sortKey) return -1;
        if (!right.sortKey) return 1;
        return left.sortKey.localeCompare(right.sortKey);
      });
  }, [
    collection,
    filteredRows,
    foldersById,
    projectsById,
  ]);
  const showFolderSections = useMemo(() => {
    const hasNamedFolderSection = folderSections.some((section) => section.folderId !== null);
    const isRootSource = collection?.source_type === "workspace_root" || collection?.source_type === "project_root";
    return folderSections.length > 1 || (isRootSource && hasNamedFolderSection);
  }, [collection?.source_type, folderSections]);
  const renderSections = useMemo(
    () => (groupMode === "folder" && showFolderSections
      ? folderSections
      : [{ id: "all-assets", rows: filteredRows, label: "", pathLabel: null, totalSize, folderId: null, sortKey: "" }]),
    [filteredRows, folderSections, groupMode, showFolderSections, totalSize],
  );
  const showSectionHeaders = groupMode === "folder" && showFolderSections;
  const isSearchExpanded = searchOpen || search.trim().length > 0;
  const toolbarButtonClass =
    "h-9 gap-2 rounded-lg border border-white/10 bg-black/18 px-3.5 text-white/88 shadow-none backdrop-blur-md hover:bg-black/28 hover:text-white";

  function handleOpenAsset(row: CollectionAssetRow) {
    navigate(`/share/collection/${token}/asset/${row.asset.id}`);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading collection
        </div>
      </div>
    );
  }

  if (error || !share || !collection) {
    return (
      <div className="min-h-screen space-y-6 bg-background p-6 text-foreground">
        <Empty className="border border-dashed border-border/70 bg-background/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <File />
            </EmptyMedia>
            <EmptyTitle>Collection unavailable</EmptyTitle>
            <EmptyDescription>{error || "This collection could not be loaded."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-5 text-foreground">
      <div className="relative">
        <div className="absolute right-2 top-2 z-30 inline-flex items-center rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-xs font-medium text-white/78 backdrop-blur-md">
          Shared Collection
        </div>

        <CollectionBrandHeader
          editable={false}
          workspaceId={collection.workspace_id ?? ""}
          collection={collection}
          titleDraft={collection.name}
          onTitleChange={() => {}}
          onTitleCommit={async () => {}}
          creatorProfile={share.creator_profile ?? null}
          assetCount={share.rows.length}
          backgroundAssets={headerBackgroundAssets}
          onPatchHeader={() => {}}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-end justify-between gap-3 px-5 sm:px-7 lg:px-9">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            {share.allow_download ? (
              <Button
                variant="ghost"
                size="sm"
                className={toolbarButtonClass}
                onClick={() => {
                  if (filteredRows.length === 0) return toast.info("No assets to download");
                  toast.promise(downloadCollectionZip(filteredRows, collection.name || "Collection"), {
                    loading: "Preparing ZIP...",
                    success: "Download started!",
                    error: "Failed to create ZIP",
                  });
                }}
              >
                <Download className="h-4 w-4" />
                Download All
              </Button>
            ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <div
              className={cn(
                "flex h-9 items-center overflow-hidden rounded-lg border border-white/10 bg-black/18 backdrop-blur-md transition-all duration-200",
                isSearchExpanded
                  ? "w-[min(19rem,calc(100vw-4rem))] border-white/14 bg-black/30"
                  : "w-9",
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 rounded-none border-0 bg-transparent text-white/70 shadow-none hover:bg-transparent hover:text-white",
                  isSearchExpanded && "text-white",
                )}
                onClick={() => setSearchOpen(true)}
                aria-label="Search assets"
              >
                <Search className="h-4 w-4" />
              </Button>

              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center transition-all duration-200",
                  isSearchExpanded ? "opacity-100" : "pointer-events-none w-0 opacity-0",
                )}
              >
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onBlur={() => {
                    if (search.trim()) return;
                    setSearchOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (search.trim()) {
                        setSearch("");
                      } else {
                        setSearchOpen(false);
                      }
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder="Search assets"
                  className="h-9 min-w-0 border-0 bg-transparent px-0 text-sm text-white placeholder:text-white/50 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>

              {isSearchExpanded ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-none border-0 bg-transparent text-white/55 shadow-none hover:bg-transparent hover:text-white"
                  onClick={() => {
                    if (search.trim()) {
                      setSearch("");
                      searchInputRef.current?.focus();
                      return;
                    }
                    setSearchOpen(false);
                  }}
                  aria-label={search.trim() ? "Clear search" : "Collapse search"}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex min-h-[62vh] items-center justify-center pt-6">
          <Empty className="border border-dashed border-border/70 bg-background/60 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <File />
              </EmptyMedia>
              <EmptyTitle>No assets match this collection</EmptyTitle>
              <EmptyDescription>
                {search.trim() ? "Adjust the search query to widen the view." : "This shared collection does not contain any visible assets."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="pt-6">
          {appearanceSettings.mode === "grid" ? (
            <div className="space-y-6">
              {renderSections.map((section) => (
                <section key={section.id} className="space-y-3">
                  {showSectionHeaders ? (
                    <CollectionFolderSectionHeader
                      label={section.label}
                      pathLabel={section.pathLabel}
                      assetCount={section.rows.length}
                      totalSize={section.totalSize}
                    />
                  ) : null}
                  <div
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_CARD_SIZE_CONFIG[appearanceSettings.card_size].minWidth}px, 1fr))`,
                    }}
                  >
                    {section.rows.map((row) => (
                      <CollectionGridCard
                        key={row.rootId}
                        row={row}
                        visibleFields={visibleFields}
                        appearance={appearanceSettings}
                        projectsById={projectsById}
                        foldersById={foldersById}
                        peopleById={peopleById}
                        onClick={() => handleOpenAsset(row)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <CollectionListTable
              sections={renderSections}
              showSectionHeaders={showSectionHeaders}
              visibleFields={visibleFields}
              appearance={appearanceSettings}
              projectsById={projectsById}
              foldersById={foldersById}
              peopleById={peopleById}
              onRowClick={handleOpenAsset}
            />
          )}
        </div>
      )}
    </div>
  );
}

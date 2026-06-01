"use client";

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import { supabase } from "@/lib/supabaseClient";
import {
  formatDate,
  getCollectionHeaderBackgroundPreset,
  getCollectionSourceLabel,
  normalizeCollectionRecord,
  type CollectionFolderRow,
  type CollectionProjectSummary,
  type CollectionRecord,
} from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

type CollectionCardMeta = {
  coverStyle: React.CSSProperties;
  iconNode: React.ReactNode;
};

function collectionMeta(collection: CollectionRecord): CollectionCardMeta {
  const header = collection.header;
  const resolvedCover = header.background.image_url ?? null;
  const preset = getCollectionHeaderBackgroundPreset(header.background.preset_id);
  const coverStyle: React.CSSProperties =
    header.background.mode === "upload" || header.background.mode === "asset"
      ? {
          backgroundImage: resolvedCover ? `url("${resolvedCover}")` : preset.backgroundImage,
          backgroundPosition: `${header.background.position_x}% ${header.background.position_y}%`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
        }
      : {
          backgroundImage: preset.backgroundImage,
          backgroundPosition: `${header.background.position_x}% ${header.background.position_y}%`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
        };

  const iconNode =
    header.icon.mode === "image" && header.icon.image_url ? (
      <img src={header.icon.image_url} alt={collection.name} className="h-full w-full object-cover" />
    ) : header.icon.mode === "emoji" ? (
      <span className="text-2xl">{header.icon.emoji || "✨"}</span>
    ) : (
      <span className="text-lg font-semibold" style={{ color: header.icon.color }}>
        {collection.name.trim().slice(0, 2).toUpperCase() || "CO"}
      </span>
    );

  return { coverStyle, iconNode };
}

export default function CollectionsIndexPage() {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const [workspaceName, setWorkspaceName] = React.useState<string>("Workspace");
  const [collections, setCollections] = React.useState<CollectionRecord[]>([]);
  const [projects, setProjects] = React.useState<CollectionProjectSummary[]>([]);
  const [folders, setFolders] = React.useState<CollectionFolderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<CollectionRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!workspaceId) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const [{ data: workspace }, { data: projectRows }, { data: folderRows }, { data: collectionRows, error: collectionsError }] = await Promise.all([
          supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
          supabase
            .from("projects")
            .select("id, name")
            .eq("workspace_id", workspaceId)
            .neq("status", "deleted")
            .order("created_at", { ascending: false }),
          invokeEdgeFunction<{ data?: CollectionFolderRow[] }>("asset", {
            body: { action: "list_folders", workspace_id: workspaceId },
          }),
          invokeEdgeFunction<{ data?: any[] }>("collections", {
            body: { action: "list", workspace_id: workspaceId },
          }),
        ]);

        if (!mounted) return;
        if (collectionsError) throw new Error(collectionsError.message);

        setWorkspaceName(workspace?.name ?? "Workspace");
        setProjects(Array.isArray(projectRows) ? projectRows : []);
        setFolders(Array.isArray(folderRows?.data) ? folderRows.data : []);
        setCollections(Array.isArray(collectionRows?.data) ? collectionRows.data.map(normalizeCollectionRecord) : []);
      } catch (error) {
        console.error("Failed to load collections", error);
        if (mounted) toast.error("Failed to load collections");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    const onCollectionsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (detail?.workspaceId && String(detail.workspaceId) !== String(workspaceId)) return;
      void load();
    };

    window.addEventListener("collections:changed", onCollectionsChanged);
    return () => {
      mounted = false;
      window.removeEventListener("collections:changed", onCollectionsChanged);
    };
  }, [workspaceId]);

  const projectsById = React.useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const foldersById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  const filteredCollections = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((collection) => {
      const sourceLabel = getCollectionSourceLabel(
        collection.source_type,
        collection.source_project_id,
        collection.source_folder_id,
        projectsById,
        foldersById,
      ).toLowerCase();
      return [
        collection.name,
        collection.appearance,
        sourceLabel,
        collection.header.description,
        collection.sort_key,
        collection.filters.length ? `${collection.filters.length} filters` : "",
      ].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [collections, foldersById, projectsById, query]);

  async function handleCreateCollection() {
    if (!workspaceId) return;
    setCreating(true);
    const { data, error } = await invokeEdgeFunction<{ data?: any }>("collections", {
      body: {
        action: "create",
        workspace_id: workspaceId,
        name: "Untitled Collection",
      },
    });
    setCreating(false);

    if (error || !data?.data) {
      toast.error(error?.message || "Failed to create collection");
      return;
    }

    const collection = normalizeCollectionRecord(data.data);
    window.dispatchEvent(new CustomEvent("collections:changed", { detail: { workspaceId } }));
    navigate(`/workspace/${workspaceId}/collections/${collection.id}`);
  }

  async function handleDeleteCollection(collection: CollectionRecord) {
    setDeleting(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: { id?: string } }>("collections", {
        body: {
          action: "delete",
          collection_id: collection.id,
        },
      });

      if (error || !data?.data?.id) throw new Error(error?.message || "Failed to delete collection");
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent("collections:changed", { detail: { workspaceId } }));
      toast.success(`Deleted ${collection.name}`);
      if (window.location.pathname.includes(`/collections/${collection.id}`)) {
        navigate(`/workspace/${workspaceId}/collections`);
      }
    } catch (error) {
      console.error("Failed to delete collection", error);
      toast.error("Failed to delete collection");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex h-16 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{workspaceName}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbPage>Collections</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <section className="rounded-2xl border border-border/70 bg-background/60 px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Collections</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Saved views with cover, icon, source, and only the details needed to scan fast.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search collections"
                className="h-10 rounded-xl border-border/70 bg-background pl-9"
              />
            </div>
            <Button onClick={() => void handleCreateCollection()} disabled={creating} className="gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              New Collection
            </Button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/10 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading collections
        </div>
      ) : filteredCollections.length === 0 ? (
        <Empty className="border border-dashed border-border/70 bg-muted/10 py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>{query.trim() ? "No matching collections" : "No collections yet"}</EmptyTitle>
            <EmptyDescription>
              {query.trim()
                ? "Try a different name, source, or filter term."
                : "Create a collection to save a source folder plus the fields and filters your team needs."}
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => void handleCreateCollection()} disabled={creating}>
            Create Collection
          </Button>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredCollections.map((collection) => {
            const meta = collectionMeta(collection);
            const sourceLabel = getCollectionSourceLabel(
              collection.source_type,
              collection.source_project_id,
              collection.source_folder_id,
              projectsById,
              foldersById,
            );

            return (
              <article
                key={collection.id}
                className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
              >
                <div className="absolute right-2 top-2 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-background/80 shadow-sm backdrop-blur-md" aria-label={`Actions for ${collection.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          navigate(`/workspace/${workspaceId}/collections/${collection.id}`);
                        }}
                      >
                        Open collection
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => {
                          event.preventDefault();
                          setDeleteTarget(collection);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete collection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <button
                  type="button"
                  className="flex w-full items-stretch gap-3 p-3 text-left"
                  onClick={() => navigate(`/workspace/${workspaceId}/collections/${collection.id}`)}
                >
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-muted/30" style={meta.coverStyle}>
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.26)_100%)]" />
                    <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-background/92 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.95)]">
                      {meta.iconNode}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium leading-5 text-foreground">{collection.name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{sourceLabel}</div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        <span>Open</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Updated {formatDate(collection.updated_at ?? collection.created_at ?? null)}</span>
                      {collection.definition_version > 1 ? <span>v{collection.definition_version}</span> : null}
                      {collection.filters.length > 0 ? <span>{collection.filters.length} filter{collection.filters.length === 1 ? "" : "s"}</span> : null}
                    </div>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-medium text-foreground">{deleteTarget?.name}</span> from the workspace list. The source assets are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                void handleDeleteCollection(deleteTarget);
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete collection"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

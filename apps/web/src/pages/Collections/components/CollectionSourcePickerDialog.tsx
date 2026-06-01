import * as React from "react";
import { Check, ChevronRight, Folder, FolderOpen, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  type CollectionFolderRow,
  type CollectionProjectSummary,
  type CollectionSourceType,
  getCollectionSourceLabel,
  getFolderPath,
} from "@/lib/collections";

type SourceSelection = {
  sourceType: CollectionSourceType | null;
  sourceProjectId: string | null;
  sourceFolderId: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: CollectionProjectSummary[];
  folders: CollectionFolderRow[];
  value: SourceSelection;
  onApply: (value: SourceSelection) => void;
  trigger: React.ReactNode;
};

export function CollectionSourcePickerDialog({
  open,
  onOpenChange,
  projects,
  folders,
  value,
  onApply,
  trigger,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<SourceSelection>(value);
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Set<string>>(() => new Set());
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setDraft(value);

    const nextProjects = new Set<string>();
    const nextFolders = new Set<string>();
    if (value.sourceProjectId) nextProjects.add(value.sourceProjectId);

    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
    let cursor = value.sourceFolderId;
    while (cursor) {
      nextFolders.add(cursor);
      const folder = foldersById.get(cursor);
      cursor = folder?.parent_folder_id ?? null;
    }

    setExpandedProjectIds(nextProjects);
    setExpandedFolderIds(nextFolders);
  }, [folders, open, value]);

  const foldersById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const normalizedQuery = query.trim().toLowerCase();

  const folderChildrenByParent = React.useMemo(() => {
    const next = new Map<string | null, CollectionFolderRow[]>();
    for (const folder of folders) {
      const key = folder.parent_folder_id ?? null;
      next.set(key, [...(next.get(key) ?? []), folder]);
    }
    for (const [key, rows] of next.entries()) {
      next.set(
        key,
        [...rows].sort((left, right) => {
          const sortDelta = (left.sort_order ?? 0) - (right.sort_order ?? 0);
          if (sortDelta !== 0) return sortDelta;
          return left.name.localeCompare(right.name);
        }),
      );
    }
    return next;
  }, [folders]);

  const libraryRootFolders = React.useMemo(
    () =>
      (folderChildrenByParent.get(null) ?? [])
        .filter((folder) => (folder.project_id ?? null) === null),
    [folderChildrenByParent],
  );

  const projectFoldersByProjectId = React.useMemo(() => {
    const next = new Map<string, CollectionFolderRow[]>();
    for (const project of projects) {
      next.set(
        project.id,
        folders
          .filter((folder) => folder.project_id === project.id)
          .sort((left, right) => {
            const sortDelta = (left.sort_order ?? 0) - (right.sort_order ?? 0);
            if (sortDelta !== 0) return sortDelta;
            return left.name.localeCompare(right.name);
          }),
      );
    }
    return next;
  }, [folders, projects]);

  const projectsById = React.useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const matchesFolder = React.useCallback((folder: CollectionFolderRow) => {
    if (!normalizedQuery) return true;
    const path = getFolderPath(folder.id, foldersById).join(" / ").toLowerCase();
    return folder.name.toLowerCase().includes(normalizedQuery) || path.includes(normalizedQuery);
  }, [foldersById, normalizedQuery]);

  const folderBranchMatches = React.useCallback((folderId: string) => {
    const folder = foldersById.get(folderId);
    if (!folder) return false;
    if (matchesFolder(folder)) return true;
    return (folderChildrenByParent.get(folderId) ?? []).some((child) => folderBranchMatches(child.id));
  }, [folderChildrenByParent, foldersById, matchesFolder]);

  const visibleProjects = React.useMemo(
    () => projects.filter((project) => {
      if (!normalizedQuery) return true;
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        (projectFoldersByProjectId.get(project.id) ?? []).some((folder) => folderBranchMatches(folder.id))
      );
    }),
    [folderBranchMatches, normalizedQuery, projectFoldersByProjectId, projects],
  );

  const selectedSourceLabel = React.useMemo(
    () => getCollectionSourceLabel(draft.sourceType, draft.sourceProjectId, draft.sourceFolderId, projectsById, foldersById),
    [draft.sourceFolderId, draft.sourceProjectId, draft.sourceType, foldersById, projectsById],
  );

  const selectedSourceSummary = draft.sourceFolderId
    ? "This collection will keep pulling assets from the selected subtree."
    : draft.sourceType
      ? "This collection will keep pulling from the selected root and its nested folders."
      : "Choose a project root or folder to define what this collection auto-imports.";

  const toggleProject = React.useCallback((projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleFolder = React.useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  function selectSource(sourceType: CollectionSourceType | null, sourceProjectId: string | null, sourceFolderId: string | null) {
    setDraft({ sourceType, sourceProjectId, sourceFolderId });
  }

  function renderFolderTree(folder: CollectionFolderRow, depth: number, scopeProjectId: string | null): React.ReactNode {
    const children = (folderChildrenByParent.get(folder.id) ?? []).filter((child) => (child.project_id ?? null) === scopeProjectId);
    const expanded = normalizedQuery ? true : expandedFolderIds.has(folder.id);
    const branchMatches = normalizedQuery ? folderBranchMatches(folder.id) : true;

    if (!branchMatches) return null;

    const selected =
      draft.sourceFolderId === folder.id &&
      draft.sourceProjectId === scopeProjectId &&
      draft.sourceType === (scopeProjectId ? "project_folder" : "workspace_folder");

    return (
      <div key={folder.id}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
            selected
              ? "bg-accent text-accent-foreground"
              : "text-foreground/80 hover:bg-accent/50 hover:text-accent-foreground",
          )}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => selectSource(scopeProjectId ? "project_folder" : "workspace_folder", scopeProjectId, folder.id)}
        >
          <span
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground",
              children.length === 0 && "opacity-40",
            )}
            onClick={(event) => {
              if (children.length === 0 || normalizedQuery) return;
              event.preventDefault();
              event.stopPropagation();
              toggleFolder(folder.id);
            }}
          >
            {children.length > 0 ? (
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
            ) : (
              <span className="h-3.5 w-3.5" />
            )}
          </span>
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
          {selected ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
        </button>

        {expanded && children.length > 0 ? (
          <div>{children.map((child) => renderFolderTree(child, depth + 1, scopeProjectId))}</div>
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={12}
        avoidCollisions={false}
        collisionPadding={0}
        sticky="always"
        className="w-[340px] border-border/70 p-0"
      >
        <div className="border-b border-border px-3 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Auto-Import Source</div>
            <Badge variant="secondary">Live</Badge>
          </div>
          <div className="mb-3 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{selectedSourceLabel}</span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search folders and projects"
              className="h-9 border-border/70 bg-background/60 pl-9"
            />
          </div>
          <div className="mt-2 text-[11px] leading-5 text-muted-foreground">{selectedSourceSummary}</div>
        </div>

        <ScrollArea className="h-[316px] px-2.5 py-2">
          <div className="space-y-3 pb-3">
            <div className="px-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Workspace Library
            </div>
            <button
              type="button"
              className={cn(
                "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                draft.sourceType === "workspace_root"
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent/50 hover:text-accent-foreground",
              )}
              onClick={() => selectSource("workspace_root", null, null)}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Workspace Library</span>
              {draft.sourceType === "workspace_root" ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
            </button>
            {libraryRootFolders.map((folder) => renderFolderTree(folder, 1, null))}

            <div className="px-2 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Projects
            </div>

            {visibleProjects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No folders or projects matched your search.
              </div>
            ) : (
              visibleProjects.map((project) => {
                const rootFolders = (projectFoldersByProjectId.get(project.id) ?? []).filter(
                  (folder) => (folder.parent_folder_id ?? null) === null,
                );
                const expanded = normalizedQuery ? true : expandedProjectIds.has(project.id);
                const selected = draft.sourceType === "project_root" && draft.sourceProjectId === project.id;

                return (
                  <div key={project.id} className="rounded-lg border border-border/60 bg-muted/20">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground/80 hover:bg-accent/50 hover:text-accent-foreground",
                      )}
                      onClick={() => selectSource("project_root", project.id, null)}
                    >
                      <span
                        className={cn(
                          "inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground",
                          rootFolders.length === 0 && "opacity-40",
                        )}
                        onClick={(event) => {
                          if (rootFolders.length === 0 || normalizedQuery) return;
                          event.preventDefault();
                          event.stopPropagation();
                          toggleProject(project.id);
                        }}
                      >
                        {rootFolders.length > 0 ? (
                          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
                        ) : (
                          <span className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{project.name}</span>
                      {selected ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
                    </button>

                    {expanded && rootFolders.length > 0 ? (
                      <div className="pb-2">{rootFolders.map((folder) => renderFolderTree(folder, 1, project.id))}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => selectSource(null, null, null)}
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
            >
              Set Source Folder
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

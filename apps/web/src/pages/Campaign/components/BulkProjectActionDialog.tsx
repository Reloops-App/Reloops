/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  Check,
  ChevronRight,
  CopyPlus,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { folderPathParts } from "../CampaignDetailsSearch";

export default function BulkProjectActionDialog({
  bulkProjectActionOpen,
  setBulkProjectActionOpen,
  setSelectedDestinationProjectId,
  setSelectedDestinationFolderId,
  bulkProjectActionMode,
  selectionLabel,
  project,
  currentSelectionLocationLabel,
  destinationSearchInputRef,
  destinationSearch,
  setDestinationSearch,
  selectedDestinationProjectId,
  selectedDestinationFolderId,
  canUseDestinationProjectFolders,
  canCreateDestinationFolder,
  creatingDestinationFolder,
  loadingDestinationFolders,
  startDestinationFolderCreate,
  destinationScrollAreaRef,
  loadingWorkspaceProjects,
  visibleDestinationProjects,
  destinationSearchQuery,
  destinationChildFoldersByProject,
  expandedDestinationProjectIds,
  expandedDestinationFolderIds,
  destinationVisibilityByProject,
  destinationFolderDraftTarget,
  destinationFolderInputRef,
  destinationFolderDraftName,
  setDestinationFolderDraftName,
  handleCreateDestinationFolder,
  setDestinationFolderDraftTarget,
  selectDestinationLocation,
  toggleDestinationProjectExpanded,
  toggleDestinationFolderExpanded,
  isBlockedCurrentProjectDestination,
  destinationProjects,
  destinationFoldersById,
  destinationSummaryPathLabel,
  destinationActionDisabledReason,
  runningBulkProjectAction,
  creatingDestinationFolderDisabled,
  handleBulkProjectAction,
  bulkProjectActionDisabled,
  primaryBulkProjectActionLabel,
  // Guests (project share links) can't create folders -- hide every
  // create-folder affordance when false. Defaults true so the authenticated
  // callers are unchanged.
  allowCreateFolder = true,
  // The folder the selected items currently live in: a folder id, `null` for
  // the current project's root, or `undefined` when the selection spans
  // several folders (no "currently here" marker then). The caller has already
  // expanded/scrolled the tree to it -- this just paints the marker.
  currentLocationFolderId = undefined,
}: any) {
  const currentLocationIsRoot = currentLocationFolderId === null;
  const hasCurrentLocation = currentLocationFolderId !== undefined;
  const currentLocationPill = (
    <span className="ml-1 shrink-0 rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Currently here
    </span>
  );
  const renderDestinationFolderComposer = (
    projectId: string,
    parentFolderId: string | null,
    depth: number,
  ) => {
    if (!allowCreateFolder) return null;
    const isActive = destinationFolderDraftTarget?.projectId === projectId
      && destinationFolderDraftTarget?.parentFolderId === parentFolderId;
    if (!isActive) return null;

    return (
      <div className="pt-2" style={{ paddingLeft: `${depth * 24}px` }}>
        <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.06] p-2.5 shadow-sm">
          <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
          <Input
            ref={destinationFolderInputRef}
            value={destinationFolderDraftName}
            onChange={(event) => setDestinationFolderDraftName(event.target.value)}
            placeholder="New folder"
            className="h-9 border-0 bg-background/85 shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCreateDestinationFolder();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDestinationFolderDraftTarget(null);
                setDestinationFolderDraftName("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void handleCreateDestinationFolder()}
            disabled={creatingDestinationFolder || !destinationFolderDraftName.trim()}
          >
            {creatingDestinationFolder ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setDestinationFolderDraftTarget(null);
              setDestinationFolderDraftName("");
            }}
            disabled={creatingDestinationFolder}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderDestinationFolderNodes = (
    projectId: string,
    parentFolderId: string | null,
    depth: number,
  ) => {
    if (!canUseDestinationProjectFolders(projectId)) return null;
    const childrenByParent = destinationChildFoldersByProject.get(projectId) ?? new Map<string | null, any[]>();
    const visibleFolderIds = destinationVisibilityByProject.get(projectId)?.visibleFolderIds ?? new Set<string>();
    const folderRows = (childrenByParent.get(parentFolderId) ?? []).filter((folder: any) => (
      (!destinationSearchQuery || visibleFolderIds.has(folder.id))
      && (String(projectId) !== String(project.id) || !isBlockedCurrentProjectDestination(folder.id))
    ));

    return folderRows.map((folder: any) => {
      const hasChildren = (childrenByParent.get(folder.id) ?? []).length > 0;
      const isExpanded = destinationSearchQuery.length > 0 || expandedDestinationFolderIds.includes(folder.id);
      const isSelected = String(selectedDestinationProjectId) === projectId
        && String(selectedDestinationFolderId) === String(folder.id);
      const isCurrentLocation = hasCurrentLocation
        && !currentLocationIsRoot
        && String(projectId) === String(project.id)
        && String(folder.id) === String(currentLocationFolderId);
      const isComposerParent = destinationFolderDraftTarget?.projectId === projectId
        && destinationFolderDraftTarget?.parentFolderId === folder.id;

      return (
        <div key={folder.id} className="space-y-1">
          <div className="relative" style={{ paddingLeft: `${depth * 24}px` }}>
            {depth > 0 ? (
              <span
                aria-hidden
                className="absolute bottom-1 top-1 w-px bg-border/55"
                style={{ left: `${depth * 24 - 10}px` }}
              />
            ) : null}
            <div
              data-destination-folder-row={folder.id}
              role={bulkProjectActionMode === "copy" ? "radio" : "button"}
              aria-checked={bulkProjectActionMode === "copy" ? isSelected : undefined}
              tabIndex={0}
              onClick={() => selectDestinationLocation(projectId, folder.id)}
              onDoubleClick={() => {
                if (hasChildren) toggleDestinationFolderExpanded(folder.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectDestinationLocation(projectId, folder.id);
                }
              }}
              className={cn(
                "group flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                isSelected
                  ? "border-primary/30 bg-primary/[0.08] text-foreground shadow-sm"
                  : isCurrentLocation
                    ? "border-border/70 bg-muted/30"
                    : "border-transparent hover:border-border/70 hover:bg-muted/45",
              )}
            >
              <button
                type="button"
                aria-label={hasChildren ? (isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`) : `${folder.name} has no folders`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (hasChildren) toggleDestinationFolderExpanded(folder.id);
                }}
              >
                {hasChildren ? (
                  <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
                ) : (
                  <span className="h-4 w-4" />
                )}
              </button>
              {isExpanded || isSelected ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-sm font-medium">{folder.name}</span>
                  {isCurrentLocation ? currentLocationPill : null}
                </span>
                {destinationSearchQuery ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[destinationProjects.find((entry: any) => String(entry.id) === projectId)?.name ?? "Project", ...folderPathParts(folder.id, destinationFoldersById)].join(" / ")}
                  </span>
                ) : null}
              </span>
              {allowCreateFolder ? (
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/90 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startDestinationFolderCreate(projectId, folder.id);
                  }}
                  aria-label={`Create folder inside ${folder.name}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
              {bulkProjectActionMode === "copy" ? (
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isSelected ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {isSelected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                </span>
              ) : isSelected ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          </div>
          {renderDestinationFolderComposer(projectId, folder.id, depth + 1)}
          {hasChildren && (isExpanded || isComposerParent) ? (
            <div className="space-y-1" data-destination-folder-children={folder.id}>
              {renderDestinationFolderNodes(projectId, folder.id, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  };

  return (
    <Dialog
      open={bulkProjectActionOpen}
      onOpenChange={(open) => {
        setBulkProjectActionOpen(open);
        if (!open) {
          setSelectedDestinationProjectId(null);
          setSelectedDestinationFolderId(null);
        }
      }}
    >
      <DialogContent className={cn(
        "flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-h-[760px] sm:max-w-2xl",
      )}>
        <div className="shrink-0 border-b border-border/60 bg-muted/20 px-6 py-5">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="flex items-center gap-2">
              {bulkProjectActionMode === "move" ? (
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              ) : (
                <CopyPlus className="h-5 w-5 text-primary" />
              )}
              {bulkProjectActionMode === "move" ? "Move to..." : "Copy to..."}
            </DialogTitle>
            <DialogDescription className="max-w-xl text-sm leading-6">
              {bulkProjectActionMode === "move"
                ? destinationProjects.length > 1
                  ? `Move ${selectionLabel} to a folder in ${project.name} or into another project.`
                  : `Move ${selectionLabel} to a folder in ${project.name}.`
                : `Copy ${selectionLabel} to another project or one of its folders.`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
              Current location: {currentSelectionLocationLabel}
            </Badge>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={destinationSearchInputRef}
                value={destinationSearch}
                onChange={(event) => setDestinationSearch(event.target.value)}
                placeholder="Search projects and folders"
                className="h-11 rounded-xl border-border/70 pl-10"
              />
            </div>
            {allowCreateFolder && selectedDestinationProjectId && canUseDestinationProjectFolders(selectedDestinationProjectId) ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 rounded-xl"
                disabled={!canCreateDestinationFolder || creatingDestinationFolder || loadingDestinationFolders || creatingDestinationFolderDisabled}
                onClick={() => {
                  if (!selectedDestinationProjectId) return;
                  startDestinationFolderCreate(selectedDestinationProjectId, selectedDestinationFolderId);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New folder
              </Button>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border/70 bg-background shadow-sm">
            <div className="shrink-0 border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Destination
            </div>
            <div ref={destinationScrollAreaRef} className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full overflow-hidden">
                <div
                  className="space-y-2 px-3 py-3"
                  role={bulkProjectActionMode === "copy" ? "radiogroup" : undefined}
                  aria-label={bulkProjectActionMode === "copy" ? "Destination project" : undefined}
                >
                  {(loadingWorkspaceProjects || loadingDestinationFolders) ? (
                    <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading destinations...
                    </div>
                  ) : visibleDestinationProjects.length === 0 ? (
                    <div className="px-3 py-8 text-sm text-muted-foreground">
                      {destinationSearchQuery
                        ? "No projects or folders match your search."
                        : (bulkProjectActionMode === "move" ? "No destinations are available in this workspace." : "No other destinations are available in this workspace.")}
                    </div>
                  ) : (
                    visibleDestinationProjects.map((workspaceProject: any) => {
                      const projectId = String(workspaceProject.id);
                      const isCurrentProjectDestination = String(projectId) === String(project.id);
                      const canUseFolders = canUseDestinationProjectFolders(projectId);
                      const childrenByParent = destinationChildFoldersByProject.get(projectId) ?? new Map<string | null, any[]>();
                      const hasChildren = canUseFolders && (childrenByParent.get(null) ?? []).length > 0;
                      const isExpanded = destinationSearchQuery.length > 0 || expandedDestinationProjectIds.includes(projectId);
                      const isSelected = String(selectedDestinationProjectId) === projectId && !selectedDestinationFolderId;
                      const isCurrentLocation = hasCurrentLocation && currentLocationIsRoot && isCurrentProjectDestination;
                      const isComposerParent = canUseFolders && destinationFolderDraftTarget?.projectId === projectId
                        && destinationFolderDraftTarget?.parentFolderId === null;

                      return (
                        <div key={workspaceProject.id} className="space-y-1">
                          <div
                            data-destination-project-row={projectId}
                            role={bulkProjectActionMode === "copy" ? "radio" : "button"}
                            aria-checked={bulkProjectActionMode === "copy" ? isSelected : undefined}
                            tabIndex={0}
                            onClick={() => selectDestinationLocation(projectId, null)}
                            onDoubleClick={() => {
                              if (canUseFolders && hasChildren) toggleDestinationProjectExpanded(projectId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                selectDestinationLocation(projectId, null);
                              }
                            }}
                            className={cn(
                              "group flex min-w-0 items-center gap-2 overflow-hidden rounded-2xl border px-3 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                              isSelected
                                ? "border-primary/30 bg-primary/[0.08] text-foreground shadow-sm"
                                : isCurrentLocation
                                  ? "border-border/70 bg-muted/40"
                                  : "border-border/45 bg-muted/20 hover:border-border/80 hover:bg-muted/45",
                            )}
                          >
                            <button
                              type="button"
                              aria-label={hasChildren ? (isExpanded ? `Collapse ${workspaceProject.name}` : `Expand ${workspaceProject.name}`) : `${workspaceProject.name} has no folders`}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (canUseFolders && hasChildren) toggleDestinationProjectExpanded(projectId);
                              }}
                              tabIndex={-1}
                            >
                              {hasChildren ? (
                                <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
                              ) : (
                                <span className="h-4 w-4" />
                              )}
                            </button>
                            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="truncate text-sm font-medium">{workspaceProject.name}</span>
                                {isCurrentLocation ? currentLocationPill : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {isCurrentProjectDestination
                                  ? bulkProjectActionMode === "copy"
                                    ? "Current project root or folders"
                                    : "Current project root"
                                  : bulkProjectActionMode === "move" && !canUseFolders
                                  ? "Project root only for this selection"
                                  : bulkProjectActionMode === "copy"
                                  ? "Choose project root or folder"
                                  : "Project root"}
                              </div>
                            </div>
                            {allowCreateFolder && canUseFolders ? (
                              <button
                                type="button"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/90 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  startDestinationFolderCreate(projectId, null);
                                }}
                                aria-label={`Create folder inside ${workspaceProject.name}`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            ) : null}
                            {bulkProjectActionMode === "copy" ? (
                              <span
                                aria-hidden
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                                  isSelected ? "border-primary" : "border-muted-foreground/40",
                                )}
                              >
                                {isSelected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                              </span>
                            ) : isSelected ? (
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            ) : null}
                          </div>
                          {canUseFolders ? renderDestinationFolderComposer(projectId, null, 1) : null}
                          {canUseFolders && hasChildren && (isExpanded || isComposerParent) ? (
                            <div className="space-y-1" data-destination-project-children={projectId}>
                              {renderDestinationFolderNodes(projectId, null, 1)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 overflow-hidden space-y-1 text-left">
            {bulkProjectActionMode === "copy" ? (
              <div className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    From
                  </div>
                  <div className="truncate font-medium text-foreground">
                    {currentSelectionLocationLabel}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    To
                  </div>
                  <div className="truncate font-medium text-foreground" aria-live="polite">
                    {selectedDestinationProjectId ? destinationSummaryPathLabel : "Choose a destination"}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Destination
                </div>
                <div className="truncate text-sm font-medium text-foreground" aria-live="polite">
                  {selectedDestinationProjectId
                    ? `Moving ${selectionLabel} to: ${destinationSummaryPathLabel}`
                    : "Choose a destination to continue."}
                </div>
              </>
            )}
            {destinationActionDisabledReason ? (
              <div className="text-xs text-muted-foreground">
                {destinationActionDisabledReason}
              </div>
            ) : null}
          </div>
          <div className="flex w-full min-w-0 shrink-0 items-center justify-end gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => setBulkProjectActionOpen(false)}
              disabled={runningBulkProjectAction || creatingDestinationFolder}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleBulkProjectAction()}
              disabled={bulkProjectActionDisabled}
              className="min-w-0 max-w-full flex-1 sm:max-w-[260px] sm:flex-none"
            >
              {runningBulkProjectAction ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {bulkProjectActionMode === "move" ? "Moving..." : "Copying..."}
                </>
              ) : (
                <>
                  {bulkProjectActionMode === "move" ? (
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                  ) : (
                    <CopyPlus className="mr-2 h-4 w-4" />
                  )}
                  <span className="truncate">{primaryBulkProjectActionLabel}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

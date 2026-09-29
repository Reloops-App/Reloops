import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { folderPathParts } from "@/pages/Campaign/CampaignDetailsSearch";
import type { FolderRow } from "@/pages/Campaign/CampaignDetailsSearch";
import { revealDestinationRow } from "@/lib/destinationTreeScroll";

type DestinationTreeScrollTarget = {
  type: "project" | "folder";
  id: string;
  align?: "reveal" | "context";
};

type Options = {
  open: boolean;
  project: { id: string; name: string };
  // Already scoped to the share by the project-share edge function.
  folders: FolderRow[];
  // Where the files being moved currently live (for the "Current location" badge).
  currentFolderId: string | null;
  count: number;
  // A folder-scoped share can't target the true project root.
  allowRoot: boolean;
};

// Builds the prop bag BulkProjectActionDialog expects, from a single project's
// already-scoped folder list. Guests have no cross-project reach and can't
// create folders, so most of the authenticated picker's machinery collapses to
// a plain tree over `folders`.
export function useGuestMoveDestination({ open, project, folders, currentFolderId, count, allowRoot }: Options) {
  const [destinationSearch, setDestinationSearch] = useState("");
  const [selectedDestinationFolderId, setSelectedDestinationFolderId] = useState<string | null>(
    allowRoot ? null : currentFolderId,
  );
  const [expandedDestinationFolderIds, setExpandedDestinationFolderIds] = useState<string[]>([]);
  const [expandedDestinationProjectIds, setExpandedDestinationProjectIds] = useState<string[]>([project.id]);
  const destinationSearchInputRef = useRef<HTMLInputElement | null>(null);
  const destinationScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const destinationPendingScrollRef = useRef<DestinationTreeScrollTarget | null>(null);

  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // The folder + all of its ancestors, so the tree row for `folderId` is
  // reachable once expanded.
  const folderPathIds = useCallback(
    (folderId: string | null): string[] => {
      const ids: string[] = [];
      let cursor: string | null = folderId;
      while (cursor && foldersById.has(cursor)) {
        ids.push(cursor);
        cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
      }
      return ids;
    },
    [foldersById],
  );
  const destinationSearchQuery = destinationSearch.trim().toLowerCase();

  const pathOf = useCallback(
    (folderId: string | null) => [project.name, ...folderPathParts(folderId, foldersById)].join(" / "),
    [foldersById, project.name],
  );

  useEffect(() => {
    if (!open) {
      destinationPendingScrollRef.current = null;
      return;
    }
    setDestinationSearch("");
    setSelectedDestinationFolderId(allowRoot ? null : currentFolderId);
    // Reveal (do not select) where the files currently live: expand the path to
    // that folder and queue a smooth "context" scroll to its row.
    setExpandedDestinationFolderIds(folderPathIds(currentFolderId));
    setExpandedDestinationProjectIds([project.id]);
    destinationPendingScrollRef.current = currentFolderId
      ? { type: "folder", id: currentFolderId, align: "context" }
      : { type: "project", id: project.id, align: "context" };
  }, [open, allowRoot, currentFolderId, project.id, folderPathIds]);

  useEffect(() => {
    if (!open) return;
    const pendingTarget = destinationPendingScrollRef.current;
    if (!pendingTarget) return;
    destinationPendingScrollRef.current = null;

    const animationFrame = window.requestAnimationFrame(() => {
      const root = destinationScrollAreaRef.current;
      if (!root) return;
      const rowTarget = Array.from(
        root.querySelectorAll<HTMLElement>("[data-destination-project-row], [data-destination-folder-row]"),
      ).find((element) => (
        pendingTarget.type === "project"
          ? element.dataset.destinationProjectRow === pendingTarget.id
          : element.dataset.destinationFolderRow === pendingTarget.id
      ));
      revealDestinationRow(root, rowTarget ?? null, pendingTarget.align);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [open, expandedDestinationFolderIds, expandedDestinationProjectIds]);

  const destinationChildFoldersByProject = useMemo(() => {
    const byParent = new Map<string | null, FolderRow[]>();
    for (const folder of folders) {
      const parent = folder.parent_folder_id ?? null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
    }
    for (const [key, rows] of byParent) {
      byParent.set(
        key,
        [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
      );
    }
    return new Map([[project.id, byParent]]);
  }, [folders, project.id]);

  const destinationVisibilityByProject = useMemo(() => {
    const byParent = destinationChildFoldersByProject.get(project.id) ?? new Map<string | null, FolderRow[]>();
    const visibleFolderIds = new Set<string>();
    const visit = (folder: FolderRow): boolean => {
      const matchesSelf = !destinationSearchQuery || folder.name.toLowerCase().includes(destinationSearchQuery);
      let matchesDescendant = false;
      for (const child of byParent.get(folder.id) ?? []) if (visit(child)) matchesDescendant = true;
      const isVisible = !destinationSearchQuery || matchesSelf || matchesDescendant;
      if (isVisible) visibleFolderIds.add(folder.id);
      return isVisible;
    };
    for (const root of byParent.get(null) ?? []) visit(root);
    const projectVisible =
      !destinationSearchQuery || project.name.toLowerCase().includes(destinationSearchQuery) || visibleFolderIds.size > 0;
    return new Map([[project.id, { projectVisible, visibleFolderIds }]]);
  }, [destinationChildFoldersByProject, destinationSearchQuery, project]);

  const visibleDestinationProjects = useMemo(
    () => ((destinationVisibilityByProject.get(project.id)?.projectVisible ?? true) ? [{ id: project.id, name: project.name }] : []),
    [destinationVisibilityByProject, project],
  );

  const selectDestinationLocation = useCallback(
    (_projectId: string, folderId: string | null) => {
      setSelectedDestinationFolderId(folderId);
      if (!folderId) return;
      const ancestors: string[] = [];
      let cursor = foldersById.get(folderId)?.parent_folder_id ?? null;
      while (cursor) {
        ancestors.push(cursor);
        cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
      }
      setExpandedDestinationFolderIds((prev) => Array.from(new Set([...prev, ...ancestors])));
    },
    [foldersById],
  );

  const toggleDestinationFolderExpanded = useCallback(
    (id: string) => setExpandedDestinationFolderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [],
  );
  const toggleDestinationProjectExpanded = useCallback(
    (id: string) => setExpandedDestinationProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [],
  );

  const destinationSummaryPathLabel = selectedDestinationFolderId
    ? pathOf(selectedDestinationFolderId)
    : `${project.name} / Project root`;

  // The dialog reads selectedDestinationProjectId truthiness to decide whether a
  // destination has been chosen. A folder-scoped guest hasn't really chosen
  // anything until they pick a folder (root is off-limits) -- surface that.
  const rootChosenButDisallowed = selectedDestinationFolderId === null && !allowRoot;

  return {
    props: {
      bulkProjectActionMode: "move" as const,
      selectionLabel: count === 1 ? "1 file" : `${count} files`,
      project: { id: project.id, name: project.name },
      currentSelectionLocationLabel: currentFolderId ? pathOf(currentFolderId) : `${project.name} / Project root`,
      currentLocationFolderId: currentFolderId,
      destinationSearchInputRef,
      destinationScrollAreaRef,
      destinationSearch,
      setDestinationSearch,
      destinationSearchQuery,
      selectedDestinationProjectId: rootChosenButDisallowed ? null : project.id,
      selectedDestinationFolderId,
      setSelectedDestinationProjectId: () => {},
      setSelectedDestinationFolderId,
      canUseDestinationProjectFolders: () => true,
      allowCreateFolder: false,
      canCreateDestinationFolder: false,
      creatingDestinationFolder: false,
      creatingDestinationFolderDisabled: true,
      loadingDestinationFolders: false,
      loadingWorkspaceProjects: false,
      startDestinationFolderCreate: () => {},
      visibleDestinationProjects,
      destinationChildFoldersByProject,
      expandedDestinationProjectIds,
      expandedDestinationFolderIds,
      destinationVisibilityByProject,
      destinationFolderDraftTarget: null,
      destinationFolderInputRef: { current: null },
      destinationFolderDraftName: "",
      setDestinationFolderDraftName: () => {},
      handleCreateDestinationFolder: () => {},
      setDestinationFolderDraftTarget: () => {},
      selectDestinationLocation,
      toggleDestinationProjectExpanded,
      toggleDestinationFolderExpanded,
      isBlockedCurrentProjectDestination: () => false,
      destinationProjects: [{ id: project.id, name: project.name }],
      destinationFoldersById: foldersById,
      destinationSummaryPathLabel,
      destinationActionDisabledReason: rootChosenButDisallowed
        ? "This share link only allows its shared folder and its subfolders."
        : "",
      primaryBulkProjectActionLabel: "Move here",
    },
    // The caller reads this to know where to actually move the files.
    selectedDestinationFolderId,
    canConfirm: allowRoot || selectedDestinationFolderId !== null,
  };
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, SlidersHorizontal, X, ArrowUpDown, Users, Circle, PickaxeIcon, CheckCircle2, FileText, Clock5, LetterText, RefreshCw, FolderClosed, File, UserRound, Tags } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ColumnKey } from "../CampaignTypes";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { CollectionFilterPopover, type CollectionFilterPersonOption } from "@/pages/Collections/components/CollectionFilterPopover";
import type { CollectionAsset, CollectionFilter } from "@/lib/collections";

type SortKey = "none" | "createdAt" | "updatedAt" | "name" | "sizeBytes" | "status";
type SortDir = "asc" | "desc";
type SearchScope = "project" | "branch" | "folder";
type SearchSuggestion = {
  group: "Folders" | "Assets" | "People" | "Types" | "Metadata";
  label: ReactNode;
  subtitle?: ReactNode;
  value: string;
  action?: "open_folder" | "open_asset" | "apply_type" | "search";
  targetId?: string;
  filterValue?: string;
};

interface OrgMember {
  user_id: string;
  role: string;
  profile?: {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

type CampaignFiltersProps = {
  assetSearch: string;
  setAssetSearch: (s: string) => void;
  statusFilter: ColumnKey | "all";
  setStatusFilter: (v: ColumnKey | "all") => void;
  kindFilter: string;
  setKindFilter: (v: string) => void;
  assignFilter: string;
  setAssignFilter: (v: string) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  sortDir: SortDir;
  setSortDir: (v: SortDir) => void;
  clearFilters: () => void;
  availableKinds: string[];
  orgMembers: OrgMember[];
  filteredCount: number;
  workspaceId: string;
  projectId: string;
  onUpload: (file: any) => void;
  onInvite: () => void;
  advancedFilters?: CollectionFilter[];
  setAdvancedFilters?: (filters: CollectionFilter[]) => void;
  advancedFilterMatchMode?: "all" | "any";
  setAdvancedFilterMatchMode?: (mode: "all" | "any") => void;
  workspaceProjects?: { id: string; name: string }[];
  projectFolders?: { id: string; workspace_id: string; project_id?: string | null; parent_folder_id?: string | null; name: string; sort_order?: number | null; created_at?: string | null; deleted_at?: string | null; }[];
  projectAssets?: CollectionAsset[];
  people?: CollectionFilterPersonOption[];
  currentFolderName?: string | null;
  searchScope?: SearchScope;
  setSearchScope?: (scope: SearchScope) => void;
  searchSuggestions?: SearchSuggestion[];
  onSearchSuggestionSelect?: (suggestion: SearchSuggestion) => void;
  dismissSearchSuggestionsSignal?: number;
  showSearch?: boolean;
  showScope?: boolean;
  searchPlaceholderOverride?: string;
  helperText?: string;
  defaultSortKey?: SortKey;
  defaultSortDir?: SortDir;
  selectionMode?: boolean;
};

const STATUS_LABELS: Record<ColumnKey | "all", string> = {
  all: "All statuses",
  none: "No status",
  needs_review: "Needs review",
  in_review: "In review",
  approved: "Approved",
};

const SORT_LABELS: Record<SortKey, string> = {
  none: "Default order",
  createdAt: "Date created",
  updatedAt: "Recently updated",
  name: "Name",
  sizeBytes: "File size",
  status: "Status",
};

function kindLabel(kind: string) {
  if (!kind || kind === "all") return "All types";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export default function CampaignFilters({
  assetSearch,
  setAssetSearch,
  statusFilter,
  setStatusFilter,
  kindFilter,
  setKindFilter,
  assignFilter,
  setAssignFilter,
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  clearFilters,
  availableKinds,
  orgMembers,
  filteredCount,
  workspaceId,
  projectId,
  onUpload,
  onInvite,
  advancedFilters = [],
  setAdvancedFilters,
  advancedFilterMatchMode = "all",
  setAdvancedFilterMatchMode,
  workspaceProjects = [],
  projectFolders = [],
  projectAssets = [],
  people = [],
  currentFolderName,
  searchScope = "project",
  setSearchScope,
  searchSuggestions = [],
  onSearchSuggestionSelect,
  dismissSearchSuggestionsSignal = 0,
  showSearch = true,
  showScope = true,
  searchPlaceholderOverride,
  helperText = "Searches files, folders, descriptions, and tags in the current project.",
  defaultSortKey = "none",
  defaultSortDir = "desc",
  selectionMode = false,
}: CampaignFiltersProps) {
  void workspaceId;
  void projectId;
  void onUpload;
  void onInvite;

  const showAssigneeFilter = orgMembers.length > 0 || assignFilter !== "all";
  const supportsAdvancedFilters = Boolean(setAdvancedFilters && setAdvancedFilterMatchMode);
  const updateAdvancedFilters = setAdvancedFilters ?? (() => undefined);
  const updateSearchScope = setSearchScope ?? (() => undefined);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [dismissedSuggestionQuery, setDismissedSuggestionQuery] = useState<string | null>(null);
  const suggestionPanelRef = useRef<HTMLDivElement | null>(null);
  const dismissSuggestions = () => {
    setSearchFocused(false);
    setActiveSuggestionIndex(null);
    setDismissedSuggestionQuery(assetSearch.trim());
  };

  const assigneeLabel = useMemo(() => {
    if (assignFilter === "all") return "All assignees";
    if (assignFilter === "unassigned") return "Unassigned";
    const member = orgMembers.find((entry) => entry.user_id === assignFilter);
    return member?.profile?.display_name || assignFilter;
  }, [assignFilter, orgMembers]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    const trimmedSearch = assetSearch.trim();

    if (trimmedSearch) {
      chips.push({
        key: "search",
        label: trimmedSearch,
        clear: () => setAssetSearch(""),
      });
    }

    if (statusFilter !== "all") {
      chips.push({
        key: "status",
        label: `Status: ${STATUS_LABELS[statusFilter]}`,
        clear: () => setStatusFilter("all"),
      });
    }

    if (kindFilter !== "all") {
      chips.push({
        key: "kind",
        label: `Type: ${kindLabel(kindFilter)}`,
        clear: () => setKindFilter("all"),
      });
    }

    if (showAssigneeFilter && assignFilter !== "all") {
      chips.push({
        key: "assign",
        label: `Assigned: ${assigneeLabel}`,
        clear: () => setAssignFilter("all"),
      });
    }

    if (sortKey !== defaultSortKey || sortDir !== defaultSortDir) {
      chips.push({
        key: "sort",
        label: `Sort: ${SORT_LABELS[sortKey]} ${sortDir === "asc" ? "↑" : "↓"}`,
        clear: () => {
          setSortKey(defaultSortKey);
          setSortDir(defaultSortDir);
        },
      });
    }

    if (advancedFilters.length > 0) {
      chips.push({
        key: "advanced",
        label: `Advanced: ${advancedFilters.length} rule${advancedFilters.length === 1 ? "" : "s"} (${advancedFilterMatchMode})`,
        clear: () => updateAdvancedFilters([]),
      });
    }

    const defaultScope = currentFolderName ? "branch" : "project";
    if (showScope && searchScope !== defaultScope) {
      chips.push({
        key: "scope",
        label: `Scope: ${
          searchScope === "project"
            ? "Entire project"
            : searchScope === "branch"
              ? "Current folder + subfolders"
              : "Current folder only"
        }`,
        clear: () => updateSearchScope(defaultScope),
      });
    }

    return chips;
  }, [
    assetSearch,
    assignFilter,
    assigneeLabel,
    advancedFilters,
    advancedFilterMatchMode,
    currentFolderName,
    defaultSortDir,
    defaultSortKey,
    kindFilter,
    setAssignFilter,
    setAssetSearch,
    setKindFilter,
    setSortDir,
    setSortKey,
    setStatusFilter,
    showAssigneeFilter,
    sortDir,
    sortKey,
    searchScope,
    showScope,
    statusFilter,
    updateAdvancedFilters,
    updateSearchScope,
  ]);

  const hasActiveControls = activeChips.length > 0;
  const quickFilterCount = activeChips.filter((chip) => ["status", "kind", "assign", "sort"].includes(chip.key)).length;
  const suggestionGroups = ["Folders", "Assets", "People", "Types", "Metadata"] as const;
  const suggestionGroupLimits: Record<(typeof suggestionGroups)[number], number> = {
    Folders: 2,
    Assets: 2,
    People: 1,
    Types: 1,
    Metadata: 1,
  };
  const visibleSuggestionRows = useMemo(
    () =>
      suggestionGroups.flatMap((group) =>
        searchSuggestions
          .filter((suggestion) => suggestion.group === group)
          .slice(0, suggestionGroupLimits[group])
          .map((suggestion) => ({ group, suggestion })),
      ).slice(0, 6),
    [searchSuggestions],
  );
  const trimmedAssetSearch = assetSearch.trim();
  const suggestionsDismissed = dismissedSuggestionQuery === trimmedAssetSearch;
  const showSuggestions = showSearch && searchFocused && Boolean(trimmedAssetSearch) && !suggestionsDismissed && visibleSuggestionRows.length > 0;
  useEffect(() => {
    if (!dismissSearchSuggestionsSignal) return;
    dismissSuggestions();
  }, [dismissSearchSuggestionsSignal]);
  useEffect(() => {
    if (!showSuggestions) return;
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && suggestionPanelRef.current?.contains(event.target)) return;
      dismissSuggestions();
    };
    window.addEventListener("scroll", closeOnScroll, true);
    return () => window.removeEventListener("scroll", closeOnScroll, true);
  }, [showSuggestions, trimmedAssetSearch]);
  const searchPlaceholder = searchPlaceholderOverride ?? (currentFolderName ? `Search inside "${currentFolderName}"` : "Search in this project");
  const searchScopeLabel =
    searchScope === "project"
      ? "Entire project"
      : searchScope === "branch"
        ? "Folder + subfolders"
        : "Current folder";

  const pillBase = "h-8 rounded-full border px-3 text-xs font-medium shadow-none transition-colors";
  const pillInactive = "border-border/60 bg-background text-foreground hover:bg-muted/70";
  const pillActive = "border-foreground/15 bg-muted/80 text-foreground hover:bg-muted";
  const suggestionIconByGroup = {
    Folders: FolderClosed,
    Assets: File,
    People: UserRound,
    Types: FileText,
    Metadata: Tags,
  } as const;
  const selectSuggestion = (suggestion: SearchSuggestion) => {
    if (onSearchSuggestionSelect) onSearchSuggestionSelect(suggestion);
    else setAssetSearch(suggestion.value);
    dismissSuggestions();
  };

  return (
    <div className="sticky top-0 z-30 -mx-1 space-y-2 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/82">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
        {showSearch ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={assetSearch}
              onChange={(event) => {
                const nextValue = event.target.value;
                setAssetSearch(nextValue);
                setActiveSuggestionIndex(null);
                if (nextValue.trim() !== dismissedSuggestionQuery) setDismissedSuggestionQuery(null);
              }}
              onFocus={() => {
                setSearchFocused(true);
                setActiveSuggestionIndex(null);
                setDismissedSuggestionQuery(null);
              }}
              onClick={() => {
                setSearchFocused(true);
                setDismissedSuggestionQuery(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && showSuggestions) {
                  event.preventDefault();
                  setActiveSuggestionIndex((current) => current === null ? 0 : (current + 1) % visibleSuggestionRows.length);
                }
                if (event.key === "ArrowUp" && showSuggestions) {
                  event.preventDefault();
                  setActiveSuggestionIndex((current) => current === null ? visibleSuggestionRows.length - 1 : (current - 1 + visibleSuggestionRows.length) % visibleSuggestionRows.length);
                }
                if (event.key === "Enter") {
                  const active = showSuggestions && activeSuggestionIndex !== null ? visibleSuggestionRows[activeSuggestionIndex] : null;
                  if (active) {
                    selectSuggestion(active.suggestion);
                  } else {
                    dismissSuggestions();
                  }
                  event.currentTarget.blur();
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  dismissSuggestions();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  dismissSuggestions();
                }
              }}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              placeholder={searchPlaceholder}
              className="h-9 rounded-md border-border/70 bg-background pl-9 pr-9 text-sm shadow-none placeholder:text-muted-foreground/70"
            />
            {assetSearch.trim() ? (
              <button
                type="button"
                onClick={() => {
                  setAssetSearch("");
                  setSearchFocused(false);
                  setActiveSuggestionIndex(null);
                  setDismissedSuggestionQuery(null);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {showSuggestions ? (
              <div ref={suggestionPanelRef} className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg border border-border/60 bg-popover/96 shadow-xl">
                <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Suggestions</div>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={dismissSuggestions}
                    className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close suggestions"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="sidebar-scrollbar max-h-[196px] overflow-y-auto py-0.5">
                  {suggestionGroups.map((group) => {
                    const suggestions = visibleSuggestionRows
                      .filter((row) => row.group === group)
                      .map((row) => row.suggestion);
                    if (suggestions.length === 0) return null;
                    const SuggestionIcon = suggestionIconByGroup[group];
                    return (
                      <div key={group}>
                        <div className="px-3 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {group}
                        </div>
                        {suggestions.map((suggestion) => {
                          const rowIndex = visibleSuggestionRows.findIndex((row) => row.group === group && row.suggestion.value === suggestion.value);
                          const active = rowIndex === activeSuggestionIndex;
                          return (
                            <button
                              type="button"
                              key={`${suggestion.group}:${suggestion.value}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveSuggestionIndex(Math.max(0, rowIndex))}
                              onClick={() => selectSuggestion(suggestion)}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-0.5 text-left text-sm transition-colors hover:bg-muted/65",
                                active && "bg-muted/70",
                              )}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/65 text-muted-foreground">
                                <SuggestionIcon className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-foreground">{suggestion.label}</span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {suggestion.subtitle ?? `${group.slice(0, -1)} suggestion`}
                                </span>
                              </span>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {group.slice(0, -1)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={dismissSuggestions}
                  className="flex w-full items-start justify-between gap-3 border-t border-border/60 px-3 py-1 text-left transition-colors hover:bg-muted/65"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      View all {filteredCount} result{filteredCount === 1 ? "" : "s"} for “{assetSearch.trim()}”
                    </span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      Enter to search · Esc to close
                    </span>
                  </span>
                  <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showScope ? (
            <Select value={searchScope} onValueChange={(value) => {
              dismissSuggestions();
              updateSearchScope(value as SearchScope);
            }}>
              <SelectTrigger className="h-9 w-[190px] rounded-md border-border/70 bg-background px-3 text-xs shadow-none">
                <SelectValue placeholder={searchScopeLabel} />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="project">Entire project</SelectItem>
                <SelectItem value="branch" disabled={!currentFolderName}>
                  Current folder + subfolders
                </SelectItem>
                <SelectItem value="folder" disabled={!currentFolderName}>
                  Current folder only
                </SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          {!selectionMode ? (
            <>
            <Popover onOpenChange={(open) => {
              if (open) dismissSuggestions();
            }}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn(pillBase, quickFilterCount > 0 ? pillActive : pillInactive, "h-9 rounded-md gap-2")}>
                  <SlidersHorizontal className="h-4 w-4" />
                  Quick filters
                  {quickFilterCount > 0 ? (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[11px]">
                      {quickFilterCount}
                    </Badge>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-[360px] space-y-4 p-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-foreground">Quick filters</div>
                  <div className="text-xs text-muted-foreground">Common project filters and sorting.</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Status
                  </div>
                  <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ColumnKey | "all")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="none">No status</SelectItem>
                      <SelectItem value="needs_review">
                        <div className="flex items-center">
                          <Circle className="mr-2 h-4 w-4" />
                          Needs review
                        </div>
                      </SelectItem>
                      <SelectItem value="in_review">
                        <div className="flex items-center">
                          <PickaxeIcon className="mr-2 h-4 w-4" />
                          In review
                        </div>
                      </SelectItem>
                      <SelectItem value="approved">
                        <div className="flex items-center">
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Approved
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    File type
                  </div>
                  <Select value={kindFilter} onValueChange={setKindFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="File type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {availableKinds.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {kindLabel(kind)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {showAssigneeFilter ? (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Assignee
                    </div>
                    <Select value={assignFilter} onValueChange={setAssignFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Assigned to" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          <div className="flex items-center">
                            <Users className="mr-2 h-4 w-4" />
                            All assignees
                          </div>
                        </SelectItem>
                        <SelectItem value="unassigned">
                          <div className="flex items-center">
                            <Circle className="mr-2 h-4 w-4" />
                            Unassigned
                          </div>
                        </SelectItem>
                        {orgMembers.map((member) => (
                          <SelectItem key={member.user_id} value={member.user_id}>
                            <div className="flex items-center">
                              <Avatar className="mr-2 h-5 w-5">
                                <AvatarImage src={member.profile?.avatar_url || undefined} />
                                <AvatarFallback className={`text-xs ${AVATAR_FALLBACK_CLASS}`}>
                                  {getAvatarInitials(member.profile?.display_name || member.user_id)}
                                </AvatarFallback>
                              </Avatar>
                              <span>{member.profile?.display_name || member.user_id}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Sort by
                    </div>
                    <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <div className="flex items-center">
                            <ArrowUpDown className="mr-2 h-4 w-4" />
                            Default
                          </div>
                        </SelectItem>
                        <SelectItem value="createdAt">
                          <div className="flex items-center">
                            <Clock5 className="mr-2 h-4 w-4" />
                            Created
                          </div>
                        </SelectItem>
                        <SelectItem value="updatedAt">
                          <div className="flex items-center">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Updated
                          </div>
                        </SelectItem>
                        <SelectItem value="name">
                          <div className="flex items-center">
                            <LetterText className="mr-2 h-4 w-4" />
                            Name
                          </div>
                        </SelectItem>
                        <SelectItem value="sizeBytes">
                          <div className="flex items-center">
                            <FileText className="mr-2 h-4 w-4" />
                            Size
                          </div>
                        </SelectItem>
                        <SelectItem value="status">
                          <div className="flex items-center">
                            <Circle className="mr-2 h-4 w-4" />
                            Status
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Direction
                    </div>
                    <Select value={sortDir} onValueChange={(value) => setSortDir(value as SortDir)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Direction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">Descending</SelectItem>
                        <SelectItem value="asc">Ascending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/70 pt-3">
                  <div className="text-xs text-muted-foreground">
                    {quickFilterCount} active quick filter{quickFilterCount === 1 ? "" : "s"}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStatusFilter("all");
                      setKindFilter("all");
                      setAssignFilter("all");
                      setSortKey(defaultSortKey);
                      setSortDir(defaultSortDir);
                    }}
                    disabled={quickFilterCount === 0}
                    className={cn(quickFilterCount === 0 && "opacity-40")}
                  >
                    Clear
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

          {supportsAdvancedFilters ? (
          <div onPointerDownCapture={dismissSuggestions}>
          <CollectionFilterPopover
            filters={advancedFilters}
            onChange={updateAdvancedFilters}
            projects={workspaceProjects}
            folders={projectFolders}
            assets={projectAssets}
            people={people}
            triggerLabel="Advanced"
            panelTitle="Advanced project filters"
            panelDescription="Build precise rules using people, folders, descriptions, tags, dates, file properties, and status."
            presentation="sheet"
            matchMode={advancedFilterMatchMode}
            onMatchModeChange={setAdvancedFilterMatchMode}
            triggerClassName={cn(pillBase, advancedFilters.length > 0 ? pillActive : pillInactive, "h-9 rounded-md")}
          />
          </div>
          ) : null}
            </>
        ) : null}
      </div>
      </div>

      {showSearch && !assetSearch.trim() && searchFocused ? (
        <div className="pl-1 text-[11px] text-muted-foreground">
          {helperText}
        </div>
      ) : null}

      {hasActiveControls && !selectionMode ? (
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto px-1">
          {activeChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 text-[12px]">
              {chip.label}
              <button
                type="button"
                onClick={chip.clear}
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Remove ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={clearFilters}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

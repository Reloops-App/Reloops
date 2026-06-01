"use client";

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Columns3,
  File,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  Layers3,
  List,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Search,
  Square,
  Type,
  UserRound,
  Trash2,
  X,
  Share2,
  Download,
} from "lucide-react";
import { toast } from "sonner";

import { invokeEdgeFunction } from "@/api/edge";
import { supabase } from "@/lib/supabaseClient";
import { normalizeAssets } from "@/lib/assetUtils";
import { cn } from "@/lib/utils";
import {
  applyCollectionFilters,
  COLLECTION_SORT_OPTIONS,
  COLLECTION_VISIBLE_FIELD_OPTIONS,
  DEFAULT_COLLECTION_VISIBLE_FIELDS,
  filterAssetsForSource,
  filterRowsBySearch,
  getCollectionRows,
  mergeCollectionDefinitionPatch,
  getCollectionSourceLabel,
  normalizeCollectionRecord,
  normalizeVisibleFields,
  sortCollectionRows,
  type CollectionAppearanceDefinition,
  type CollectionAsset,
  type CollectionAssetRow,
  type CollectionFolderRow,
  type CollectionProjectSummary,
  type CollectionRecord,
  type CollectionVisibleField,
} from "@/lib/collections";
import { downloadCollectionZip } from "@/lib/zip";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CollectionBrandHeader,
  type CollectionCreatorProfile,
  type CollectionHeaderBackgroundAssetOption,
} from "./components/CollectionBrandHeader";
import {
  buildCollectionFolderSection,
  CollectionFolderSectionHeader,
  CollectionGridCard,
  CollectionListTable,
  DEFAULT_COLLECTION_APPEARANCE_SETTINGS,
  GRID_CARD_SIZE_CONFIG,
  type CollectionFolderSection,
} from "./components/CollectionViewPrimitives";
import { CollectionFilterPopover, type CollectionFilterPersonOption } from "./components/CollectionFilterPopover";
import { CollectionSourcePickerDialog } from "./components/CollectionSourcePickerDialog";
import { ShareCollectionDialog } from "./components/ShareCollectionDialog";

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

const SORT_OPTION_ICONS: Record<string, React.ElementType> = {
  uploaded_at: CalendarDays,
  updated_at: ArrowUpDown,
  name: Type,
  size_bytes: HardDrive,
  status: BadgeCheck,
};

function AspectRatioGlyph({ value }: { value: "square" | "portrait" | "landscape" }) {
  if (value === "portrait") {
    return <span className="block h-4 w-3 rounded-[3px] border border-current" aria-hidden="true" />;
  }
  if (value === "landscape") {
    return <span className="block h-3 w-5 rounded-[3px] border border-current" aria-hidden="true" />;
  }
  return <Square className="h-4 w-4" aria-hidden="true" />;
}

type AssetResponse = {
  data?: {
    assets?: any[];
    folders?: CollectionFolderRow[];
  };
};

function CollectionAppearancePopover({
  appearance,
  onChange,
  triggerClassName,
}: {
  appearance: CollectionAppearanceDefinition;
  onChange: (patch: Partial<CollectionAppearanceDefinition>) => void;
  triggerClassName: string;
}) {
  const isGrid = appearance.mode === "grid";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName}>
          {appearance.mode === "grid" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          Appearance
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={10}
        avoidCollisions={false}
        collisionPadding={0}
        className="w-[340px] border-border/70 p-0"
      >
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Appearance</div>
          <div className="mt-1 text-xs text-muted-foreground">Control the browser layout, thumbnail treatment, and how much metadata each card shows.</div>
        </div>

        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-[108px_1fr] items-center gap-3">
            <div className="text-sm font-medium text-foreground">Layout</div>
            <ToggleGroup
              type="single"
              value={appearance.mode}
              onValueChange={(next) => next && onChange({ mode: next as CollectionAppearanceDefinition["mode"] })}
              className="grid w-full grid-cols-2 rounded-lg bg-muted/70 p-1"
            >
              <ToggleGroupItem value="grid" size="sm" className="gap-2 rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                <LayoutGrid className="h-4 w-4" />
                Grid
              </ToggleGroupItem>
              <ToggleGroupItem value="list" size="sm" className="gap-2 rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                <List className="h-4 w-4" />
                List
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={cn("grid grid-cols-[108px_1fr] items-center gap-3", !isGrid && "opacity-55")}>
            <div className="text-sm font-medium text-foreground">Card Size</div>
            <ToggleGroup
              type="single"
              value={appearance.card_size}
              onValueChange={(next) => next && onChange({ card_size: next as CollectionAppearanceDefinition["card_size"] })}
              className="grid w-full grid-cols-3 rounded-lg bg-muted/70 p-1"
            >
              <ToggleGroupItem value="small" size="sm" disabled={!isGrid} className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                S
              </ToggleGroupItem>
              <ToggleGroupItem value="medium" size="sm" disabled={!isGrid} className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                M
              </ToggleGroupItem>
              <ToggleGroupItem value="large" size="sm" disabled={!isGrid} className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                L
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-[108px_1fr] items-center gap-3">
            <div className="text-sm font-medium text-foreground">Aspect Ratio</div>
            <ToggleGroup
              type="single"
              value={appearance.aspect_ratio}
              onValueChange={(next) => next && onChange({ aspect_ratio: next as CollectionAppearanceDefinition["aspect_ratio"] })}
              className="grid w-full grid-cols-3 rounded-lg bg-muted/70 p-1"
            >
              <ToggleGroupItem value="square" size="sm" className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                <AspectRatioGlyph value="square" />
                <span className="sr-only">Square</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="portrait" size="sm" className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                <AspectRatioGlyph value="portrait" />
                <span className="sr-only">Portrait</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="landscape" size="sm" className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                <AspectRatioGlyph value="landscape" />
                <span className="sr-only">Landscape</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-[108px_1fr] items-center gap-3">
            <div className="text-sm font-medium text-foreground">Thumbnail Scale</div>
            <ToggleGroup
              type="single"
              value={appearance.thumbnail_scale}
              onValueChange={(next) => next && onChange({ thumbnail_scale: next as CollectionAppearanceDefinition["thumbnail_scale"] })}
              className="grid w-full grid-cols-2 rounded-lg bg-muted/70 p-1"
            >
              <ToggleGroupItem value="fit" size="sm" className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                Fit
              </ToggleGroupItem>
              <ToggleGroupItem value="fill" size="sm" className="rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground">
                Fill
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-[108px_1fr] items-center gap-3">
            <div className="text-sm font-medium text-foreground">Show Card Info</div>
            <div className="flex justify-start">
              <Switch checked={appearance.show_card_info} onCheckedChange={(checked) => onChange({ show_card_info: checked })} />
            </div>
          </div>

          <div className="grid grid-cols-[108px_1fr] items-center gap-3">
            <div className="text-sm font-medium text-foreground">Titles</div>
            <Select value={appearance.title_display} onValueChange={(next) => onChange({ title_display: next as CollectionAppearanceDefinition["title_display"] })}>
              <SelectTrigger size="sm" className="h-9 border-border/70 bg-background">
                <SelectValue placeholder="Select title style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_line">1 Line</SelectItem>
                <SelectItem value="two_line">2 Lines</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CollectionVisibleFieldsPopover({
  visibleFields,
  onChange,
  triggerClassName,
}: {
  visibleFields: CollectionVisibleField[];
  onChange: (next: CollectionVisibleField[]) => void;
  triggerClassName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const allFieldValues = React.useMemo(
    () => COLLECTION_VISIBLE_FIELD_OPTIONS.map((option) => option.value),
    [],
  );
  const defaultFieldSet = React.useMemo(() => new Set(DEFAULT_COLLECTION_VISIBLE_FIELDS), []);
  const selectedFieldSet = React.useMemo(() => new Set(visibleFields), [visibleFields]);
  const isDefaultSelection = React.useMemo(
    () =>
      visibleFields.length === DEFAULT_COLLECTION_VISIBLE_FIELDS.length
      && DEFAULT_COLLECTION_VISIBLE_FIELDS.every((field) => selectedFieldSet.has(field)),
    [selectedFieldSet, visibleFields.length],
  );

  const toggleField = React.useCallback((field: CollectionVisibleField) => {
    const next = visibleFields.includes(field)
      ? visibleFields.filter((entry) => entry !== field)
      : [...visibleFields, field];
    onChange(next);
  }, [onChange, visibleFields]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName}>
          <Columns3 className="h-4 w-4" />
          Fields
          <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[11px]">
            {visibleFields.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={10}
        avoidCollisions={false}
        collisionPadding={0}
        className="w-[300px] border-border/70 p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Visible Fields</div>
            <div className="mt-1 text-xs text-muted-foreground">Choose which asset details appear on cards and in list columns.</div>
          </div>
          <Badge variant="secondary">{visibleFields.length} shown</Badge>
        </div>

        <Command>
          <CommandInput placeholder="Search visible fields..." />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No matching fields.</CommandEmpty>
            <CommandGroup>
              {COLLECTION_VISIBLE_FIELD_OPTIONS.map((option) => {
                const OptionIcon = VISIBLE_FIELD_ICONS[option.value] ?? FileText;
                const selected = visibleFields.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => toggleField(option.value)}
                    className="gap-3 py-2.5"
                  >
                    <Check className={cn("h-4 w-4", selected ? "opacity-100 text-primary" : "opacity-0")} />
                    <OptionIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{option.label}</span>
                    {defaultFieldSet.has(option.value) && selected ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        Default
                      </Badge>
                    ) : selected ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        Shown
                      </Badge>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(DEFAULT_COLLECTION_VISIBLE_FIELDS)}
              disabled={isDefaultSelection}
            >
              Reset defaults
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
              disabled={visibleFields.length === 0}
            >
              Clear all
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(allFieldValues)}
            disabled={visibleFields.length === allFieldValues.length}
          >
            Show all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}


export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { workspaceId, collectionId } = useParams<{ workspaceId: string; collectionId: string }>();

  const [projects, setProjects] = React.useState<CollectionProjectSummary[]>([]);
  const [folders, setFolders] = React.useState<CollectionFolderRow[]>([]);
  const [collection, setCollection] = React.useState<CollectionRecord | null>(null);
  const [sourceAssets, setSourceAssets] = React.useState<CollectionAsset[]>([]);
  const [sourceFolders, setSourceFolders] = React.useState<CollectionFolderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sourceLoading, setSourceLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = React.useState(false);
  const [groupMode, setGroupMode] = React.useState<"folder" | "none">("folder");
  const [titleDraft, setTitleDraft] = React.useState("");
  const [creatorProfile, setCreatorProfile] = React.useState<CollectionCreatorProfile>(null);
  const [organizationId, setOrganizationId] = React.useState<string | null>(null);
  const [workspacePeopleOptions, setWorkspacePeopleOptions] = React.useState<CollectionFilterPersonOption[]>([]);
  const [assetPeopleFallbackOptions, setAssetPeopleFallbackOptions] = React.useState<CollectionFilterPersonOption[]>([]);
  const [savingCollection, setSavingCollection] = React.useState(false);
  const latestSaveId = React.useRef(0);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [collectionShareUrl, setCollectionShareUrl] = React.useState<string | null>(null);
  const [collectionShareLinkId, setCollectionShareLinkId] = React.useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deletingCollection, setDeletingCollection] = React.useState(false);

  const foldersById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const projectsById = React.useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const sourceFoldersById = React.useMemo(() => new Map(sourceFolders.map((folder) => [folder.id, folder])), [sourceFolders]);
  const peopleOptions = React.useMemo(() => {
    const merged = new Map<string, CollectionFilterPersonOption>();
    for (const person of workspacePeopleOptions) merged.set(person.value, person);
    for (const person of assetPeopleFallbackOptions) {
      if (!merged.has(person.value)) merged.set(person.value, person);
    }
    return Array.from(merged.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [assetPeopleFallbackOptions, workspacePeopleOptions]);
  const peopleById = React.useMemo(
    () => new Map(peopleOptions.map((person) => [person.value, person.label])),
    [peopleOptions],
  );

  const updateCollection = React.useCallback(async (patch: Record<string, unknown>) => {
    if (!collection) return;
    const previous = collection;
    const nextDefinition = mergeCollectionDefinitionPatch(collection.definition, patch);
    const optimistic = normalizeCollectionRecord({
      ...collection,
      ...patch,
      definition: nextDefinition,
      source_type: nextDefinition.source.type,
      source_project_id: nextDefinition.source.project_id,
      source_folder_id: nextDefinition.source.folder_id,
      visible_fields: nextDefinition.fields.visible,
      filters: nextDefinition.filters.items,
      sort_key: nextDefinition.sort.key,
      sort_dir: nextDefinition.sort.dir,
      appearance: nextDefinition.appearance.mode,
      group_mode: nextDefinition.grouping.mode,
      header: nextDefinition.header,
      name: patch.name ?? collection.name,
    });
    const saveId = latestSaveId.current + 1;
    latestSaveId.current = saveId;

    setCollection(optimistic);
    setSavingCollection(true);

    const { data, error } = await invokeEdgeFunction<{ data?: any }>("collections", {
      body: {
        action: "update",
        collection_id: collection.id,
        ...patch,
      },
    });

    if (error || !data?.data) {
      if (latestSaveId.current === saveId) {
        setCollection(previous);
        setSavingCollection(false);
      }
      toast.error(error?.message || "Failed to save collection");
      return;
    }

    if (latestSaveId.current === saveId) {
      setCollection(normalizeCollectionRecord(data.data));
      setSavingCollection(false);
      window.dispatchEvent(new CustomEvent("collections:changed", { detail: { workspaceId } }));
    }
  }, [collection, workspaceId]);

  const handleDeleteCollection = React.useCallback(async () => {
    if (!collection || !workspaceId) return;
    setDeletingCollection(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: { id?: string } }>("collections", {
        body: {
          action: "delete",
          collection_id: collection.id,
        },
      });

      if (error || !data?.data?.id) {
        throw new Error(error?.message || "Failed to delete collection");
      }

      window.dispatchEvent(new CustomEvent("collections:changed", { detail: { workspaceId } }));
      toast.success(`Deleted ${collection.name}`);
      setDeleteDialogOpen(false);
      navigate(`/workspace/${workspaceId}/collections`);
    } catch (error) {
      console.error("Failed to delete collection", error);
      toast.error("Failed to delete collection");
    } finally {
      setDeletingCollection(false);
    }
  }, [collection, navigate, workspaceId]);

  React.useEffect(() => {
    if (!workspaceId || !collectionId) return;

    let mounted = true;
    setLoading(true);
    setLoadError(null);

    async function load() {
      try {
        const [{ data: projectsData }, { data: foldersData }, { data: collectionData, error: collectionError }] = await Promise.all([
          supabase
            .from("projects")
            .select("id, name")
            .eq("workspace_id", workspaceId)
            .neq("status", "deleted")
            .order("created_at", { ascending: false }),
          invokeEdgeFunction<{ data?: CollectionFolderRow[] }>("asset", {
            body: { action: "list_folders", workspace_id: workspaceId },
          }),
          invokeEdgeFunction<{ data?: any }>("collections", {
            body: { action: "get", collection_id: collectionId },
          }),
        ]);

        if (!mounted) return;
        if (collectionError || !collectionData?.data) {
          throw new Error(collectionError?.message || "Collection not found");
        }

        setProjects(Array.isArray(projectsData) ? projectsData : []);
        setFolders(Array.isArray(foldersData?.data) ? foldersData.data : []);
        const nextCollection = normalizeCollectionRecord(collectionData.data);
        setCollection(nextCollection);
        setTitleDraft(nextCollection.name);
      } catch (error) {
        console.error("Failed to load collection", error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "Failed to load collection");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [collectionId, workspaceId]);

  React.useEffect(() => {
    if (!collection) return;
    setTitleDraft(collection.name);
  }, [collection?.name]);

  React.useEffect(() => {
    if (!collection?.id) {
      setCollectionShareUrl(null);
      setCollectionShareLinkId(null);
      return;
    }

    let mounted = true;

    void invokeEdgeFunction<{ data?: Array<{ id: string; revoked_at?: string | null; expires_at?: string | null }> }>("share", {
      body: {
        action: "list-collection-share-links",
        collection_id: collection.id,
      },
    }).then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.error("Failed to load collection share links", error);
        setCollectionShareUrl(null);
        setCollectionShareLinkId(null);
        return;
      }

      const now = Date.now();
      const links = Array.isArray(data?.data) ? data.data : [];
      const activeLink = links.find((link) => {
        if (link.revoked_at) return false;
        if (link.expires_at && new Date(link.expires_at).getTime() < now) return false;
        return true;
      }) ?? null;

      if (!activeLink) {
        setCollectionShareUrl(null);
        setCollectionShareLinkId(null);
        return;
      }

      setCollectionShareLinkId(activeLink.id);
      setCollectionShareUrl(`${window.location.origin}/share/collection/${activeLink.id}`);
    });

    return () => {
      mounted = false;
    };
  }, [collection?.id]);

  React.useEffect(() => {
    if (!collection) return;
    setGroupMode((collection.group_mode ?? collection.definition.grouping.mode ?? "folder") as "folder" | "none");
  }, [collection?.group_mode, collection?.definition.grouping.mode]);

  React.useEffect(() => {
    if (!collection?.created_by) {
      setCreatorProfile(null);
      return;
    }

    let mounted = true;
    void supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", collection.created_by)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("Failed to load creator profile", error);
          setCreatorProfile(null);
          return;
        }
        setCreatorProfile(data ?? null);
      });

    return () => {
      mounted = false;
    };
  }, [collection?.created_by]);

  React.useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  React.useEffect(() => {
    if (!workspaceId) {
      setOrganizationId(null);
      return;
    }

    let mounted = true;
    void supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("Failed to load workspace organization", error);
          setOrganizationId(null);
          return;
        }
        setOrganizationId(data?.organization_id ?? null);
      });

    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  React.useEffect(() => {
    if (!organizationId) {
      setWorkspacePeopleOptions([]);
      return;
    }

    let mounted = true;
    void invokeEdgeFunction<any[]>("org-members", {
      body: { action: "list", organization_id: organizationId },
    }).then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.error("Failed to load workspace members for filters", error);
        setWorkspacePeopleOptions([]);
        return;
      }

      const next = (Array.isArray(data) ? data : []).map((member: any) => {
        const profile = member?.profile ?? null;
        const label = profile?.display_name?.trim() || `Member ${String(member?.user_id ?? "").slice(0, 8)}`;
        return {
          value: String(member.user_id),
          label,
          avatarUrl: profile?.avatar_url ?? null,
          keywords: `${label} ${member.user_id}`,
          role: typeof member?.role === "string" ? member.role : null,
        } satisfies CollectionFilterPersonOption;
      });

      setWorkspacePeopleOptions(next.sort((left, right) => left.label.localeCompare(right.label)));
    });

    return () => {
      mounted = false;
    };
  }, [organizationId]);

  React.useEffect(() => {
    const knownIds = new Set(workspacePeopleOptions.map((person) => person.value));
    const userIds = Array.from(new Set(
      sourceAssets.flatMap((asset) => [
        asset.created_by ?? null,
        asset.assigned_to ?? null,
        asset.uploaded_by ?? null,
        asset.updated_by ?? null,
      ]).filter((value): value is string => Boolean(value) && !knownIds.has(value)),
    ));

    if (userIds.length === 0) {
      setAssetPeopleFallbackOptions([]);
      return;
    }

    let mounted = true;
    void supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", userIds)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("Failed to load collection fallback people options", error);
        }
        const profilesById = new Map((data ?? []).map((profile) => [profile.id, profile]));
        setAssetPeopleFallbackOptions(
          userIds.map((id) => {
            const profile = profilesById.get(id);
            const label = profile?.display_name?.trim() || `Member ${id.slice(0, 8)}`;
            return {
              value: id,
              label,
              avatarUrl: profile?.avatar_url ?? null,
              keywords: `${label} ${id}`,
              role: null,
            } satisfies CollectionFilterPersonOption;
          }).sort((left, right) => left.label.localeCompare(right.label)),
        );
      });

    return () => {
      mounted = false;
    };
  }, [sourceAssets, workspacePeopleOptions]);

  const collectionSourceType = collection?.source_type ?? null;
  const collectionSourceProjectId = collection?.source_project_id ?? null;
  const collectionSourceFolderId = collection?.source_folder_id ?? null;

  React.useEffect(() => {
    if (!collection || !workspaceId) return;

    if (!collectionSourceType) {
      setSourceAssets([]);
      setSourceFolders([]);
      return;
    }

    let mounted = true;
    setSourceLoading(true);

    async function loadSourceAssets() {
      try {
        let result: { data: AssetResponse | null; error: { message: string } | null };
        if (collectionSourceType === "workspace_root" || collectionSourceType === "workspace_folder") {
          result = await invokeEdgeFunction<AssetResponse>("asset", {
            body: {
              action: "list_library",
              workspace_id: workspaceId,
              limit: 2000,
            },
          });
        } else {
          result = await invokeEdgeFunction<AssetResponse>("asset", {
            body: {
              action: "list_project",
              project_id: collectionSourceProjectId,
            },
          });
        }

        if (!mounted) return;
        if (result.error) throw new Error(result.error.message);

        const payload = result.data?.data ?? {};
        setSourceAssets(normalizeAssets(Array.isArray(payload.assets) ? payload.assets : []) as CollectionAsset[]);
        setSourceFolders(Array.isArray(payload.folders) ? payload.folders : []);
      } catch (error) {
        console.error("Failed to load collection assets", error);
        if (mounted) {
          setSourceAssets([]);
          setSourceFolders([]);
          toast.error("Failed to load assets for this collection");
        }
      } finally {
        if (mounted) setSourceLoading(false);
      }
    }

    void loadSourceAssets();
    return () => {
      mounted = false;
    };
  }, [collectionSourceFolderId, collectionSourceProjectId, collectionSourceType, workspaceId]);

  const scopedAssets = React.useMemo(
    () => filterAssetsForSource(sourceAssets, collection?.source_type ?? null, collection?.source_folder_id ?? null, sourceFolders),
    [collection?.source_folder_id, collection?.source_type, sourceAssets, sourceFolders],
  );

  const filteredRows = React.useMemo(() => {
    const baseRows = getCollectionRows(scopedAssets);
    return sortCollectionRows(
      applyCollectionFilters(baseRows, collection?.filters ?? []),
      collection?.sort_key ?? "uploaded_at",
      collection?.sort_dir ?? "desc",
    );
  }, [collection?.filters, collection?.sort_dir, collection?.sort_key, scopedAssets]);

  const rows = React.useMemo(() => {
    const searchedRows = filterRowsBySearch(filteredRows, search);
    return sortCollectionRows(searchedRows, collection?.sort_key ?? "uploaded_at", collection?.sort_dir ?? "desc");
  }, [collection?.sort_dir, collection?.sort_key, filteredRows, search]);

  const totalSize = React.useMemo(
    () => rows.reduce((sum, row) => sum + (row.asset.sizeBytes ?? 0), 0),
    [rows],
  );

  const headerBackgroundAssets = React.useMemo<CollectionHeaderBackgroundAssetOption[]>(
    () =>
      filteredRows
        .map((row) => ({
          rootId: row.rootId,
          assetId: row.asset.id,
          label: row.asset.name || "Untitled asset",
          imageUrl: row.asset.coverUrl || row.asset.url || "",
          mimeType: row.asset.type || null,
        }))
        .filter((asset) => asset.imageUrl),
    [filteredRows],
  );

  const sourceLabel = React.useMemo(
    () => getCollectionSourceLabel(
      collection?.source_type ?? null,
      collection?.source_project_id ?? null,
      collection?.source_folder_id ?? null,
      projectsById,
      foldersById,
    ),
    [collection?.source_folder_id, collection?.source_project_id, collection?.source_type, foldersById, projectsById],
  );

  const visibleFields = React.useMemo(
    () => normalizeVisibleFields(collection?.visible_fields ?? DEFAULT_COLLECTION_VISIBLE_FIELDS),
    [collection?.visible_fields],
  );
  const appearanceSettings = collection?.definition.appearance ?? DEFAULT_COLLECTION_APPEARANCE_SETTINGS;

  const activeFilterCount = collection?.filters.length ?? 0;
  const currentSortLabel = COLLECTION_SORT_OPTIONS.find((option) => option.value === (collection?.sort_key ?? "uploaded_at"))?.label ?? "Date Uploaded";
  const isSearchExpanded = searchOpen || search.trim().length > 0;
  const activeFoldersById = sourceFoldersById.size > 0 ? sourceFoldersById : foldersById;
  const folderSections = React.useMemo(() => {
    const groupedRows = new Map<string, CollectionAssetRow[]>();
    for (const row of rows) {
      const groupKey = row.asset.folder_id ?? "__root__";
      const existing = groupedRows.get(groupKey);
      if (existing) {
        existing.push(row);
      } else {
        groupedRows.set(groupKey, [row]);
      }
    }

    return Array.from(groupedRows.entries())
      .map(([groupKey, grouped]) => {
        const folderId = groupKey === "__root__" ? null : groupKey;
        const section = buildCollectionFolderSection(
          folderId,
          collection?.source_type ?? null,
          collection?.source_project_id ?? null,
          collection?.source_folder_id ?? null,
          activeFoldersById,
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
    activeFoldersById,
    collection?.source_folder_id,
    collection?.source_project_id,
    collection?.source_type,
    projectsById,
    rows,
  ]);
  const showFolderSections = React.useMemo(() => {
    const hasNamedFolderSection = folderSections.some((section) => section.folderId !== null);
    return folderSections.length > 1 || hasNamedFolderSection;
  }, [folderSections]);
  const renderSections = React.useMemo(
    () => (groupMode === "folder" && showFolderSections
      ? folderSections
      : [{ id: "all-assets", rows, label: "", pathLabel: null, totalSize, folderId: null, sortKey: "" }]),
    [folderSections, groupMode, rows, showFolderSections, totalSize],
  );
  const showSectionHeaders = groupMode === "folder" && showFolderSections;
  const missingFolder = Boolean(
    collection?.source_type &&
      collection.source_type.endsWith("_folder") &&
      collection.source_folder_id &&
      !foldersById.has(collection.source_folder_id),
  );

  function handleOpenAsset(row: CollectionAssetRow) {
    if (!workspaceId) return;
    const projectId = row.asset.project_id ?? null;
    if (projectId) {
      navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${row.asset.id}`);
      return;
    }
    navigate(`/workspace/${workspaceId}/assets/${row.asset.id}`);
  }

  async function handleTitleCommit() {
    if (!collection) return;
    const trimmed = titleDraft.trim();
    const nextTitle = trimmed || "Untitled Collection";
    if (nextTitle === collection.name) {
      setTitleDraft(collection.name);
      return;
    }
    await updateCollection({ name: nextTitle });
  }

  async function handlePatchHeader(patch: Record<string, unknown>) {
    await updateCollection({
      definition: {
        header: patch,
      },
    });
  }

  async function handlePatchAppearance(patch: Partial<CollectionAppearanceDefinition>) {
    await updateCollection({
      definition: {
        appearance: patch,
      },
    });
  }

  const toolbarButtonClass =
    "h-9 gap-2 rounded-lg border border-white/10 bg-black/18 px-3.5 text-white/88 shadow-none backdrop-blur-md hover:bg-black/28 hover:text-white";
  const toolbarIconButtonClass =
    "h-9 w-9 rounded-lg border border-white/10 bg-black/18 text-white/70 shadow-none backdrop-blur-md hover:bg-black/28 hover:text-white";
  const dropdownContentClass = "border-border/70 bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/90";
  const dropdownItemClass = "gap-2";
  const dropdownCheckItemClass = "gap-2 py-2";

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

  if (loadError || !collection) {
    return (
      <div className="min-h-screen space-y-6 bg-background p-6 text-foreground">
        <div className="flex items-center gap-3">
          <SidebarTrigger className="text-muted-foreground hover:bg-accent hover:text-accent-foreground" />
          <Button variant="ghost" onClick={() => navigate(`/workspace/${workspaceId}/collections`)}>
            Back to Collections
          </Button>
        </div>

        <Empty className="border border-dashed border-border/70 bg-background/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>Collection unavailable</EmptyTitle>
            <EmptyDescription>{loadError || "This collection could not be loaded."}</EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => navigate(`/workspace/${workspaceId}/collections`)}>
            Back to Collections
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-5 text-foreground">
      <div className="relative">
        <SidebarTrigger className="absolute left-2 top-2 z-30 h-11 w-11 rounded-xl border border-white/10 bg-black/24 text-white/72 backdrop-blur-md hover:bg-black/32 hover:text-white" />

        {savingCollection ? (
          <div className="absolute right-2 top-2 z-30 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-xs text-white/72 backdrop-blur-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving
          </div>
        ) : null}

        <CollectionBrandHeader
          workspaceId={workspaceId ?? ""}
          collection={collection}
          titleDraft={titleDraft}
          onTitleChange={setTitleDraft}
          onTitleCommit={handleTitleCommit}
          creatorProfile={creatorProfile}
          assetCount={filteredRows.length}
          backgroundAssets={headerBackgroundAssets}
          onPatchHeader={handlePatchHeader}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-end justify-between gap-3 px-5 sm:px-7 lg:px-9">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <CollectionSourcePickerDialog
              open={sourcePickerOpen}
              onOpenChange={setSourcePickerOpen}
              projects={projects}
              folders={folders}
              value={{
                sourceType: collection.source_type,
                sourceProjectId: collection.source_project_id,
                sourceFolderId: collection.source_folder_id,
              }}
              onApply={(next) => {
                void updateCollection({
                  source_type: next.sourceType,
                  source_project_id: next.sourceProjectId,
                  source_folder_id: next.sourceFolderId,
                });
              }}
              trigger={(
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    toolbarButtonClass,
                    (sourcePickerOpen || collection.source_type) && "border-white/14 bg-black/30 text-white",
                  )}
                >
                  <FolderOpen className="h-4 w-4" />
                  Source Folder
                </Button>
              )}
            />

            <CollectionAppearancePopover
              appearance={appearanceSettings}
              onChange={(patch) => {
                void handlePatchAppearance(patch);
              }}
              triggerClassName={toolbarButtonClass}
            />

            <CollectionVisibleFieldsPopover
              visibleFields={visibleFields}
              onChange={(next) => {
                void updateCollection({ visible_fields: next });
              }}
              triggerClassName={toolbarButtonClass}
            />

            <CollectionFilterPopover
              filters={collection.filters}
              projects={projects}
              folders={sourceFolders}
              assets={sourceAssets}
              people={peopleOptions}
              triggerClassName={cn(
                toolbarButtonClass,
                activeFilterCount > 0 && "border-white/14 bg-black/30 text-white",
              )}
              onChange={(next) => {
                void updateCollection({ filters: next });
              }}
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    toolbarButtonClass,
                    groupMode === "folder" && showFolderSections && "border-white/14 bg-black/30 text-white",
                  )}
                >
                  <Layers3 className="h-4 w-4" />
                  {groupMode === "folder" && showFolderSections ? "Grouped" : "No grouping"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={dropdownContentClass}>
                <DropdownMenuRadioGroup
                  value={groupMode}
                  onValueChange={(value) => {
                    const nextMode = value as "folder" | "none";
                    setGroupMode(nextMode);
                    void updateCollection({
                      definition: {
                        grouping: {
                          mode: nextMode,
                        },
                      },
                    });
                  }}
                >
                  <DropdownMenuRadioItem className={dropdownCheckItemClass} value="folder">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    Group by folder
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className={dropdownCheckItemClass} value="none">
                    <Layers3 className="h-4 w-4 text-muted-foreground" />
                    No grouping
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className={toolbarButtonClass}>
                  <ArrowUpDown className="h-4 w-4" />
                  Sorted by {currentSortLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={cn(dropdownContentClass, "w-56")}>
                <DropdownMenuRadioGroup
                  value={collection.sort_key}
                  onValueChange={(value) => void updateCollection({ sort_key: value })}
                >
                  {COLLECTION_SORT_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} className={dropdownCheckItemClass} value={option.value}>
                      {React.createElement(SORT_OPTION_ICONS[option.value] ?? ArrowUpDown, {
                        className: "h-4 w-4 text-muted-foreground",
                      })}
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={dropdownItemClass} onClick={() => void updateCollection({ sort_dir: collection.sort_dir === "asc" ? "desc" : "asc" })}>
                  {collection.sort_dir === "asc" ? "Switch to descending" : "Switch to ascending"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              className={toolbarButtonClass}
              onClick={() => {
                if (rows.length === 0) return toast.info("No assets to download");
                toast.promise(downloadCollectionZip(rows, collection.name || "Collection"), {
                  loading: "Preparing ZIP...",
                  success: "Download started!",
                  error: "Failed to create ZIP",
                });
              }}
            >
              <Download className="h-4 w-4" />
              Download All
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={toolbarButtonClass}
              onClick={() => setShareDialogOpen(true)}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={cn(toolbarButtonClass, "w-9 px-0")}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={dropdownContentClass}>
                <DropdownMenuItem className={dropdownItemClass} onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ShareCollectionDialog
              open={shareDialogOpen}
              onOpenChange={setShareDialogOpen}
              collectionName={collection.name}
              existingShareUrl={collectionShareUrl}
              onCreateLink={async (options) => {
                const { data, error } = await invokeEdgeFunction("share", {
                  body: {
                    action: "create-collection-share-link",
                    collection_id: collection.id,
                    expires_at: options.expiresAt,
                    allow_download: options.allowDownload,
                    allow_comments: options.allowComments,
                  },
                });
                if (error || !data?.data?.share_url) throw new Error(error?.message || "No share url");
                setCollectionShareLinkId(data.data.id ?? null);
                setCollectionShareUrl(data.data.share_url);
                return data.data.share_url;
              }}
              onRevokeLink={async () => {
                if (!collectionShareLinkId) return;
                const { error } = await invokeEdgeFunction("share", {
                  body: {
                    action: "revoke-collection-share-link",
                    share_link_id: collectionShareLinkId,
                  },
                });
                if (error) throw new Error(error.message);
                setCollectionShareUrl(null);
                setCollectionShareLinkId(null);
              }}
            />
          </div>

          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete collection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes <span className="font-medium text-foreground">{collection.name}</span> from the collections list. Source assets are not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletingCollection}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDeleteCollection();
                  }}
                  disabled={deletingCollection}
                >
                  {deletingCollection ? "Deleting..." : "Delete collection"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
                  className={cn(
                    "h-9 w-9 shrink-0 rounded-none border-0 bg-transparent text-white/55 shadow-none hover:bg-transparent hover:text-white",
                  )}
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

      {missingFolder ? (
        <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          The selected source folder no longer exists. Choose a new source to restore this collection.
        </div>
      ) : null}

      {!collection.source_type ? (
        <div className="relative min-h-[72vh] pt-6">
          <button
            type="button"
            className="absolute left-0 top-6 w-[240px] rounded-2xl border border-border/60 bg-card/60 px-4 py-4 text-left shadow-sm transition-colors hover:bg-accent/40"
            onClick={() => setSourcePickerOpen(true)}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium text-foreground">Start here</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  Choose a source folder to pull assets for this Collection
                </div>
              </div>
            </div>
          </button>

          <div className="flex min-h-[62vh] items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-muted/30">
                <FolderOpen className="h-11 w-11 text-muted-foreground" />
              </div>
              <div className="mt-8 text-3xl font-semibold text-foreground">Add Assets to This Collection</div>
              <div className="mt-3 text-base leading-7 text-muted-foreground">
                Choose a <span className="font-medium text-foreground">Source Folder</span> to pull assets from, then set the <span className="font-medium text-foreground">Fields</span> you want to be visible.
              </div>
              <button type="button" className="mt-6 text-sm font-medium text-primary hover:underline">
                Learn More About Collections
              </button>
            </div>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[62vh] items-center justify-center pt-6">
          <Empty className="border border-dashed border-border/70 bg-background/60 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <File />
              </EmptyMedia>
              <EmptyTitle>No assets match this collection</EmptyTitle>
              <EmptyDescription>
                Adjust the source, fields, filters, or search query to widen the view.
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

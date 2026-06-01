import * as React from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  File,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  Type,
  UserRound,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  COLLECTION_FILTER_FIELD_OPTIONS,
  COLLECTION_FILTER_OPERATOR_LABELS,
  COLLECTION_STATUS_OPTIONS,
  getCollectionFilterFieldOption,
  getAssetFileExtension,
  getFolderPath,
  type CollectionAsset,
  type CollectionFilter,
  type CollectionFilterField,
  type CollectionFolderRow,
  type CollectionProjectSummary,
} from "@/lib/collections";
import { mimeKind } from "@/lib/assetUtils";

type Props = {
  filters: CollectionFilter[];
  projects: CollectionProjectSummary[];
  folders: CollectionFolderRow[];
  assets: CollectionAsset[];
  people: CollectionFilterPersonOption[];
  onChange: (filters: CollectionFilter[]) => void;
  triggerClassName?: string;
  triggerLabel?: string;
  panelTitle?: string;
  panelDescription?: string;
  presentation?: "popover" | "sheet";
  matchMode?: "all" | "any";
  onMatchModeChange?: (mode: "all" | "any") => void;
};

export type CollectionFilterPersonOption = {
  value: string;
  label: string;
  avatarUrl: string | null;
  keywords?: string;
  role?: string | null;
};

type PickerOption = {
  value: string;
  label: string;
  icon?: React.ElementType;
  keywords?: string;
  avatarUrl?: string | null;
  description?: string | null;
};

const FILTER_FIELD_ICONS: Record<string, React.ElementType> = {
  root_id: Search,
  name: Type,
  description: FileText,
  smart_description: FileText,
  ai_description: FileText,
  tags: BadgeCheck,
  storage_path: FileText,
  project_name: FolderOpen,
  status: BadgeCheck,
  created_by: UserRound,
  assigned_to: UserRound,
  uploaded_by: UserRound,
  updated_by: UserRound,
  reviewer_ids: UserRound,
  file_extension: File,
  mime_kind: Layers3,
  mime_type: FileText,
  size_bytes: HardDrive,
  duration_ms: Clock3,
  width: ImageIcon,
  height: ImageIcon,
  project_id: FolderOpen,
  folder_id: FolderOpen,
  created_at: CalendarDays,
  uploaded_at: CalendarDays,
  updated_at: CalendarDays,
};

const PERSON_FILTER_FIELDS = new Set(["created_by", "assigned_to", "uploaded_by", "updated_by", "reviewer_ids"]);
const HIDDEN_FILTER_PICKER_FIELDS = new Set([
  "root_id",
  "storage_path",
  "project_name",
  "created_by",
  "updated_by",
  "reviewer_ids",
  "smart_description",
  "ai_description",
]);
const VALUELESS_OPERATORS = new Set([
  "is_empty",
  "is_not_empty",
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
]);

function initialsForLabel(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || "U";
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function OptionContent({
  option,
  selected,
  compact = false,
}: {
  option: PickerOption;
  selected?: boolean;
  compact?: boolean;
}) {
  const OptionIcon = option.icon;

  if (option.avatarUrl !== undefined) {
    return (
      <>
        {selected !== undefined ? <Check className={cn("h-4 w-4", selected ? "opacity-100 text-primary" : "opacity-0")} /> : null}
        <Avatar className={compact ? "h-6 w-6" : "h-7 w-7"}>
          <AvatarImage src={option.avatarUrl ?? undefined} alt={option.label} />
          <AvatarFallback className="text-[10px]">{initialsForLabel(option.label)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate">{option.label}</div>
          {!compact && option.description ? (
            <div className="truncate text-[11px] text-muted-foreground">{option.description}</div>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      {selected !== undefined ? <Check className={cn("h-4 w-4", selected ? "opacity-100 text-primary" : "opacity-0")} /> : null}
      {OptionIcon ? <OptionIcon className="h-4 w-4 text-muted-foreground" /> : null}
      <div className="min-w-0 truncate">{option.label}</div>
    </>
  );
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function getDefaultFilterUnit(field: CollectionFilterField) {
  const option = getCollectionFilterFieldOption(field);
  if (option.kind === "bytes") return "mb";
  if (option.kind === "duration") return "seconds";
  return undefined;
}

function getDefaultFilterValue(field: CollectionFilterField, operator: string) {
  const option = getCollectionFilterFieldOption(field);
  if (option.kind === "select" && (operator === "in" || operator === "not_in")) return [];
  return "";
}

function createFilter(field?: CollectionFilterField): CollectionFilter {
  const option = getCollectionFilterFieldOption(field ?? "name");
  const next: CollectionFilter = {
    id: crypto.randomUUID(),
    field: option.value,
    operator: option.operators[0],
    value: getDefaultFilterValue(option.value, option.operators[0]),
  };
  const defaultUnit = getDefaultFilterUnit(option.value);
  if (defaultUnit) next.value_unit = defaultUnit;
  return next;
}

function SearchableOptionPicker({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 w-full justify-between border-border/70 bg-background px-3 font-normal shadow-none"
        >
          <span className="flex min-w-0 items-center gap-2 text-left">
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <OptionContent option={selected} compact />
              </span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
        collisionPadding={0}
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.keywords ?? ""}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="gap-2 py-2"
                  >
                    <OptionContent option={option} selected={isSelected} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SearchableMultiOptionPicker({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string[];
  options: PickerOption[];
  onChange: (value: string[]) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedOptions = options.filter((option) => value.includes(option.value));
  const selectedOption = selectedOptions[0] ?? null;
  const label = selectedOptions.length === 0
    ? null
    : selectedOptions.length === 1
      ? selectedOption
      : `${selectedOptions.length} selected`;

  function toggle(nextValue: string) {
    const next = value.includes(nextValue)
      ? value.filter((entry) => entry !== nextValue)
      : [...value, nextValue];
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 w-full justify-between border-border/70 bg-background px-3 font-normal shadow-none"
        >
          <span className="flex min-w-0 items-center gap-2 text-left">
            {typeof label === "string" ? (
              <span className="truncate">{label}</span>
            ) : label ? (
              <span className="flex min-w-0 items-center gap-2">
                <OptionContent option={label} compact />
              </span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
        collisionPadding={0}
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.keywords ?? ""}`}
                    onSelect={() => toggle(option.value)}
                    className="gap-2 py-2"
                  >
                    <OptionContent option={option} selected={isSelected} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={value.length === 0}>
            Clear
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getFieldSpecificHelp(field: CollectionFilterField, operator: string) {
  const option = getCollectionFilterFieldOption(field);
  if (option.kind === "date") {
    if (operator === "equals") return "Matches the same calendar day.";
    if (operator === "before") return "Matches assets dated before this day starts.";
    if (operator === "after") return "Matches assets dated after this day ends.";
    if (operator === "today") return "Matches assets from today.";
    if (operator === "yesterday") return "Matches assets from yesterday.";
    if (operator === "last_7_days") return "Matches assets from the last 7 days, including today.";
    if (operator === "last_30_days") return "Matches assets from the last 30 days, including today.";
    if (operator === "this_month") return "Matches assets dated in the current calendar month.";
  }
  return option.help_text ?? null;
}

function titleCaseWords(value: string) {
  return value
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getOperatorLabelForField(field: CollectionFilterField, operator: string) {
  const fieldOption = getCollectionFilterFieldOption(field);
  if (fieldOption.kind === "date") {
    if (operator === "equals") return "is on";
    if (operator === "before") return "is before";
    if (operator === "after") return "is after";
  }

  if (fieldOption.kind === "number" || fieldOption.kind === "bytes" || fieldOption.kind === "duration") {
    if (operator === "equals") return "is equal to";
    if (operator === "not_equals") return "is not equal to";
  }

  if (field === "name") {
    if (operator === "equals") return "is exactly";
    if (operator === "not_equals") return "is not exactly";
  }

  if (field === "tags") {
    if (operator === "contains") return "has tag";
    if (operator === "equals") return "is exactly";
    if (operator === "not_equals") return "is not exactly";
    if (operator === "in") return "has any tag";
    if (operator === "not_in") return "has none of";
  }

  return COLLECTION_FILTER_OPERATOR_LABELS[operator] ?? operator;
}

export function CollectionFilterPopover({
  filters,
  projects,
  folders,
  assets,
  people,
  onChange,
  triggerClassName,
  triggerLabel = "Filters",
  panelTitle = "Filter Assets",
  panelDescription = "Use field-specific rules so comparisons behave correctly for dates, sizes, duration, and workflow states.",
  presentation = "popover",
  matchMode = "all",
  onMatchModeChange,
}: Props) {
  const foldersById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const filterCount = filters.length;

  const fieldOptions = React.useMemo(
    () =>
      COLLECTION_FILTER_FIELD_OPTIONS
        .filter((option) => !HIDDEN_FILTER_PICKER_FIELDS.has(option.value))
        .map((option) => ({
          value: option.value,
          label: option.label,
          icon: FILTER_FIELD_ICONS[option.value] ?? Search,
          keywords: `${option.label} ${option.value}`,
        })),
    [],
  );

  const projectOptions = React.useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        icon: FolderOpen,
        keywords: project.name,
      })),
    [projects],
  );

  const statusOptions = React.useMemo(
    () =>
      COLLECTION_STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        icon: BadgeCheck,
        keywords: option.label,
      })),
    [],
  );

  const folderOptions = React.useMemo(
    () =>
      [...folders]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((folder) => ({
          value: folder.id,
          label: getFolderPath(folder.id, foldersById).join(" / ") || folder.name,
          icon: FolderOpen,
          keywords: folder.name,
        })),
    [folders, foldersById],
  );

  const peopleOptions = React.useMemo(
    () =>
      people.map((person) => ({
        value: person.value,
        label: person.label,
        avatarUrl: person.avatarUrl,
        keywords: person.keywords ?? person.label,
        description: person.role ? titleCaseWords(person.role) : "Workspace member",
      })),
    [people],
  );

  const fileExtensionOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          assets
            .map((asset) => getAssetFileExtension(asset).trim().toLowerCase())
            .filter(Boolean),
        ),
      )
        .sort((left, right) => left.localeCompare(right))
        .map((extension) => ({
          value: extension,
          label: extension.toUpperCase(),
          icon: File,
          keywords: `${extension} .${extension}`,
        })),
    [assets],
  );

  const mimeKindOptions = React.useMemo(() => {
    const discovered = Array.from(
      new Set(
        assets
          .map((asset) => mimeKind(asset.type))
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    const values = discovered.length > 0 ? discovered : ["image", "video", "audio", "pdf", "application", "text", "other"];
    return values.map((value) => ({
      value,
      label: titleCaseWords(value),
      icon: ImageIcon,
      keywords: value,
    }));
  }, [assets]);

  const mimeTypeOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          assets
            .map((asset) => String(asset.type || "").trim().toLowerCase())
            .filter(Boolean),
        ),
      )
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({
          value,
          label: value,
          icon: FileText,
          keywords: value,
        })),
    [assets],
  );

  function updateFilter(id: string, patch: Partial<CollectionFilter>) {
    onChange(filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
  }

  function removeFilter(id: string) {
    onChange(filters.filter((filter) => filter.id !== id));
  }

  function getSelectOptions(field: CollectionFilterField) {
    if (field === "status") return statusOptions;
    if (field === "project_id") return projectOptions;
    if (field === "folder_id") return folderOptions;
    if (PERSON_FILTER_FIELDS.has(field)) return peopleOptions;
    if (field === "file_extension") return fileExtensionOptions;
    if (field === "mime_kind") return mimeKindOptions;
    if (field === "mime_type") return mimeTypeOptions;
    return [];
  }

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "h-8 gap-2",
        "border-border/70 bg-background/60 shadow-none",
        filterCount > 0 && !triggerClassName && "bg-accent text-accent-foreground",
        triggerClassName,
      )}
    >
      <SlidersHorizontal className="h-4 w-4" />
      {triggerLabel}
      {filterCount > 0 ? (
        <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[11px]">
          {filterCount}
        </Badge>
      ) : null}
    </Button>
  );

  const panelContent = (
    <>
      {presentation === "sheet" ? (
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <SheetTitle>{panelTitle}</SheetTitle>
              <SheetDescription className="mt-1 leading-6">{panelDescription}</SheetDescription>
            </div>
            <Badge variant="secondary" className="mt-0.5 shrink-0">
              {filterCount === 0 ? "No rules" : `${filterCount} active`}
            </Badge>
          </div>
        </SheetHeader>
      ) : (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{panelTitle}</div>
            <div className="mt-1 text-xs text-muted-foreground">{panelDescription}</div>
          </div>
          <Badge variant="secondary">{filterCount === 0 ? "No filters" : `${filterCount} active`}</Badge>
        </div>
      )}

      <div className={cn("space-y-3", presentation === "sheet" ? "flex-1 overflow-y-auto px-5 py-4" : "px-4 py-3.5")}>
        {onMatchModeChange ? (
          <div className="inline-flex rounded-md border border-border/70 bg-muted/25 p-0.5">
            <Button
              type="button"
              variant={matchMode === "all" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-sm px-2.5 text-xs shadow-none"
              onClick={() => onMatchModeChange("all")}
            >
              Match all
            </Button>
            <Button
              type="button"
              variant={matchMode === "any" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 rounded-sm px-2.5 text-xs shadow-none"
              onClick={() => onMatchModeChange("any")}
            >
              Match any
            </Button>
          </div>
        ) : null}
        {filterCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-5">
            <div className="text-sm font-medium text-foreground">No advanced filters yet</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              Add a rule to narrow this project by descriptions, tags, folders, dates, assignees, status, or file properties.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-2"
              onClick={() => onChange([createFilter()])}
            >
              <Plus className="h-4 w-4" />
              Add first rule
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filters.map((filter, index) => {
              const fieldOption = getCollectionFilterFieldOption(filter.field);
              const FieldIcon = FILTER_FIELD_ICONS[fieldOption.value] ?? Search;
              const valueInputHidden = VALUELESS_OPERATORS.has(filter.operator);
              const useSingleSelectInput =
                fieldOption.kind === "select" &&
                (filter.operator === "equals" || filter.operator === "not_equals");
              const useMultiSelectInput =
                fieldOption.kind === "select" &&
                (filter.operator === "in" || filter.operator === "not_in");
              const selectOptions = getSelectOptions(filter.field);
              const fieldHelp = getFieldSpecificHelp(filter.field, filter.operator);
              const fieldPickerOptions = fieldOptions.some((option) => option.value === fieldOption.value)
                ? fieldOptions
                : [
                    {
                      value: fieldOption.value,
                      label: fieldOption.label,
                      icon: FILTER_FIELD_ICONS[fieldOption.value] ?? Search,
                      keywords: `${fieldOption.label} ${fieldOption.value}`,
                    },
                    ...fieldOptions,
                  ];
              const unitValue = typeof filter.value_unit === "string"
                ? filter.value_unit
                : getDefaultFilterUnit(filter.field);

              return (
                <div key={filter.id} className="rounded-xl border border-border/60 bg-card/40 p-3.5 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md border border-border/60 bg-background p-1.5 text-muted-foreground">
                        <FieldIcon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{fieldOption.label}</div>
                        <div className="text-xs text-muted-foreground">Rule {index + 1}</div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => removeFilter(filter.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid items-start gap-3 md:grid-cols-[minmax(0,184px)_minmax(0,170px)_minmax(0,1.55fr)]">
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Field</div>
                      <SearchableOptionPicker
                        value={filter.field}
                        options={fieldPickerOptions}
                        onChange={(nextField) => {
                          const nextOption = getCollectionFilterFieldOption(nextField as CollectionFilterField);
                          const nextOperator = nextOption.operators[0];
                          updateFilter(filter.id, {
                            field: nextField as CollectionFilterField,
                            operator: nextOperator,
                            value: getDefaultFilterValue(nextOption.value, nextOperator),
                            value_unit: getDefaultFilterUnit(nextOption.value),
                          });
                        }}
                        placeholder="Select a field"
                        searchPlaceholder="Search fields..."
                        emptyLabel="No matching fields."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Condition</div>
                        <Select
                        value={filter.operator}
                        onValueChange={(nextOperator) => updateFilter(filter.id, {
                          operator: nextOperator as any,
                          value: getDefaultFilterValue(filter.field, nextOperator),
                        })}
                      >
                        <SelectTrigger size="sm" className="h-10 w-full border-border/70 bg-background">
                          <SelectValue placeholder="Condition" />
                        </SelectTrigger>
                        <SelectContent>
                          {fieldOption.operators.map((operator) => (
                            <SelectItem key={operator} value={operator} className="py-2">
                              {getOperatorLabelForField(filter.field, operator)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Value</div>
                      {valueInputHidden ? (
                        <div className="flex h-10 min-w-0 items-center rounded-md border border-dashed border-border/60 bg-background/60 px-3 text-sm text-muted-foreground">
                          No value needed for this condition
                        </div>
                      ) : useSingleSelectInput ? (
                        <SearchableOptionPicker
                          value={typeof filter.value === "string" ? filter.value : ""}
                          options={selectOptions}
                          onChange={(nextValue) => updateFilter(filter.id, { value: nextValue })}
                          placeholder={`Choose ${fieldOption.label.toLowerCase()}`}
                          searchPlaceholder={`Search ${fieldOption.label.toLowerCase()}...`}
                          emptyLabel={`No ${fieldOption.label.toLowerCase()} values found.`}
                        />
                      ) : useMultiSelectInput ? (
                        <SearchableMultiOptionPicker
                          value={normalizeStringArray(filter.value)}
                          options={selectOptions}
                          onChange={(nextValue) => updateFilter(filter.id, { value: nextValue })}
                          placeholder={`Choose ${fieldOption.label.toLowerCase()} values`}
                          searchPlaceholder={`Search ${fieldOption.label.toLowerCase()}...`}
                          emptyLabel={`No ${fieldOption.label.toLowerCase()} values found.`}
                        />
                      ) : fieldOption.kind === "bytes" || fieldOption.kind === "duration" ? (
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_132px]">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={typeof filter.value === "string" || typeof filter.value === "number" ? String(filter.value) : ""}
                            placeholder={fieldOption.placeholder ?? "Enter a value"}
                            onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                            className="h-10 min-w-[140px] border-border/70 bg-background px-3 text-sm"
                          />
                          <Select
                            value={unitValue}
                            onValueChange={(nextUnit) => updateFilter(filter.id, { value_unit: nextUnit })}
                          >
                            <SelectTrigger size="sm" className="h-10 w-full min-w-[120px] border-border/70 bg-background">
                              <SelectValue placeholder="Unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {fieldOption.unit_options?.map((unit) => (
                                <SelectItem key={unit.value} value={unit.value}>
                                  {unit.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <Input
                          type={fieldOption.kind === "date" ? "date" : "text"}
                          inputMode={fieldOption.kind === "number" ? "decimal" : undefined}
                          value={typeof filter.value === "string" || typeof filter.value === "number" ? String(filter.value) : ""}
                          placeholder={
                            filter.operator === "in" || filter.operator === "not_in"
                              ? fieldOption.multi_placeholder ?? "Comma-separated values"
                              : fieldOption.placeholder ?? "Enter a value"
                          }
                          onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                          className="h-10 min-w-0 border-border/70 bg-background text-sm"
                        />
                      )}

                    </div>
                  </div>
                  {fieldHelp ? (
                    <div className="mt-2.5 pl-px text-[11px] leading-5 text-muted-foreground">
                      {fieldHelp}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {presentation === "sheet" ? (
        <SheetFooter className="border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {matchMode === "all" ? "All active filters must match." : "Any active filter can match."}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onChange([...filters, createFilter()])}
              >
                <Plus className="h-4 w-4" />
                Add rule
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                disabled={filterCount === 0}
              >
                Clear all
              </Button>
              <SheetClose asChild>
                <Button size="sm">Apply</Button>
              </SheetClose>
            </div>
          </div>
        </SheetFooter>
      ) : (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => onChange([...filters, createFilter()])}
            >
              <Plus className="h-4 w-4" />
              Add Filter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
              disabled={filterCount === 0}
            >
              Clear All
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {matchMode === "all" ? "All active filters must match." : "Any active filter can match."}
          </div>
        </div>
      )}
    </>
  );

  if (presentation === "sheet") {
    return (
      <Sheet>
        <SheetTrigger asChild>{triggerButton}</SheetTrigger>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
          {panelContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {triggerButton}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={10}
        avoidCollisions={false}
        collisionPadding={0}
        className="w-[820px] max-w-[calc(100vw-2rem)] border-border/70 p-0"
      >
        {panelContent}
      </PopoverContent>
    </Popover>
  );
}

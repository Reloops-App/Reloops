import { groupByRoot, mimeKind, rootIdOf } from "@/lib/assetUtils";

export type CollectionSourceType = string;
export type CollectionLayoutMode = "grid" | "list";
export type CollectionCardSize = "small" | "medium" | "large";
export type CollectionAspectRatio = "square" | "portrait" | "landscape";
export type CollectionThumbnailScale = "fit" | "fill";
export type CollectionTitleDisplay = "one_line" | "two_line";
export type CollectionAppearance = CollectionLayoutMode | string;
export type CollectionGroupMode = "folder" | "none";
export type CollectionSortKey = string;
export type CollectionSortDir = "asc" | "desc";
export type CollectionVisibleField = string;
export type CollectionFilterField = string;
export type CollectionFilterOperator = string;

export type CollectionFilter = {
  id: string;
  field: CollectionFilterField;
  operator: CollectionFilterOperator;
  value: unknown;
  [key: string]: unknown;
};

export type CollectionHeaderBackgroundMode = "preset" | "upload" | "asset";
export type CollectionHeaderIconMode = "initials" | "emoji" | "image";

export type CollectionHeaderDefinition = {
  description: string;
  background: {
    mode: CollectionHeaderBackgroundMode;
    preset_id: string;
    image_url: string | null;
    asset_root_id: string | null;
    position_x: number;
    position_y: number;
    [key: string]: unknown;
  };
  icon: {
    mode: CollectionHeaderIconMode;
    color: string;
    emoji: string;
    image_url: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CollectionAppearanceDefinition = {
  mode: CollectionLayoutMode;
  card_size: CollectionCardSize;
  aspect_ratio: CollectionAspectRatio;
  thumbnail_scale: CollectionThumbnailScale;
  show_card_info: boolean;
  title_display: CollectionTitleDisplay;
  [key: string]: unknown;
};

export type CollectionDefinition = {
  version: number;
  source: {
    type: CollectionSourceType | null;
    project_id: string | null;
    folder_id: string | null;
    include_descendants: boolean;
    [key: string]: unknown;
  };
  appearance: CollectionAppearanceDefinition;
  grouping: {
    mode: CollectionGroupMode;
    [key: string]: unknown;
  };
  fields: {
    visible: CollectionVisibleField[];
    [key: string]: unknown;
  };
  filters: {
    combinator: string;
    items: CollectionFilter[];
    [key: string]: unknown;
  };
  sort: {
    key: CollectionSortKey;
    dir: CollectionSortDir;
    [key: string]: unknown;
  };
  header: CollectionHeaderDefinition;
  [key: string]: unknown;
};

export type CollectionRecord = {
  id: string;
  workspace_id: string;
  name: string;
  definition_version: number;
  definition: CollectionDefinition;
  source_type: CollectionSourceType | null;
  source_project_id: string | null;
  source_folder_id: string | null;
  appearance: CollectionAppearance;
  group_mode?: CollectionGroupMode;
  visible_fields: CollectionVisibleField[];
  filters: CollectionFilter[];
  sort_key: CollectionSortKey;
  sort_dir: CollectionSortDir;
  header: CollectionHeaderDefinition;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CollectionProjectSummary = {
  id: string;
  name: string;
};

export type CollectionFolderRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
};

export type CollectionAsset = {
  id: string;
  name: string;
  type: string;
  project_id?: string | null;
  created_by?: string | null;
  uploaded_by?: string | null;
  updated_by?: string | null;
  description?: string | null;
  ai_description?: string | null;
  tags?: string[];
  smart_tags?: string[];
  smart_description?: string | null;
  version_no?: number | null;
  parent_asset_id?: string | null;
  folder_id?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  uploadedAt?: string | null;
  coverUrl?: string | null;
  url?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  comments_count?: number;
  __raw?: any;
  [key: string]: unknown;
};

export type CollectionAssetRow = {
  rootId: string;
  asset: CollectionAsset;
  versionCount: number;
};

type FilterFieldOption = {
  value: CollectionFilterField;
  label: string;
  input: "text" | "number" | "date" | "select";
  kind: "text" | "select" | "number" | "bytes" | "duration" | "date";
  operators: CollectionFilterOperator[];
  placeholder?: string;
  multi_placeholder?: string;
  help_text?: string;
  unit_options?: Array<{ value: string; label: string; multiplier: number }>;
};

type VisibleFieldOption = {
  value: CollectionVisibleField;
  label: string;
};

const DEFAULT_FILTER_OPERATOR = "equals";
const DEFAULT_SORT_KEY = "uploaded_at";
const DEFAULT_APPEARANCE: CollectionLayoutMode = "grid";
const DEFAULT_CARD_SIZE: CollectionCardSize = "large";
const DEFAULT_ASPECT_RATIO: CollectionAspectRatio = "square";
const DEFAULT_THUMBNAIL_SCALE: CollectionThumbnailScale = "fill";
const DEFAULT_SHOW_CARD_INFO = true;
const DEFAULT_TITLE_DISPLAY: CollectionTitleDisplay = "one_line";
const DEFAULT_GROUP_MODE: CollectionGroupMode = "folder";
const DEFAULT_FILTER_COMBINATOR = "all";
const DEFAULT_HEADER_BACKGROUND_PRESET = "aurora";
const DEFAULT_HEADER_ICON_COLOR = "#4f46e5";

export const COLLECTION_HEADER_BACKGROUND_PRESETS = [
  {
    id: "aurora",
    label: "Aurora",
    backgroundImage:
      "radial-gradient(circle at 18% 16%, rgba(59,130,246,0.85), transparent 34%), radial-gradient(circle at 82% 14%, rgba(251,113,133,0.78), transparent 28%), radial-gradient(circle at 34% 78%, rgba(245,158,11,0.3), transparent 24%), linear-gradient(135deg, #08112f 0%, #171f46 38%, #17132a 100%)",
  },
  {
    id: "ember",
    label: "Ember",
    backgroundImage:
      "radial-gradient(circle at 12% 18%, rgba(251,146,60,0.55), transparent 24%), radial-gradient(circle at 84% 18%, rgba(244,63,94,0.6), transparent 30%), radial-gradient(circle at 60% 70%, rgba(59,130,246,0.38), transparent 30%), linear-gradient(135deg, #190d16 0%, #2f1d2f 42%, #0f1629 100%)",
  },
  {
    id: "evergreen",
    label: "Evergreen",
    backgroundImage:
      "radial-gradient(circle at 16% 18%, rgba(34,197,94,0.55), transparent 28%), radial-gradient(circle at 80% 12%, rgba(96,165,250,0.45), transparent 26%), radial-gradient(circle at 64% 78%, rgba(251,191,36,0.25), transparent 28%), linear-gradient(140deg, #06151a 0%, #143032 45%, #0f172a 100%)",
  },
  {
    id: "violet-haze",
    label: "Violet Haze",
    backgroundImage:
      "radial-gradient(circle at 22% 24%, rgba(99,102,241,0.72), transparent 32%), radial-gradient(circle at 84% 18%, rgba(244,114,182,0.55), transparent 26%), radial-gradient(circle at 58% 76%, rgba(59,130,246,0.3), transparent 28%), linear-gradient(135deg, #12152d 0%, #1d1640 48%, #0f172a 100%)",
  },
  {
    id: "midnight",
    label: "Midnight",
    backgroundImage:
      "radial-gradient(circle at 18% 22%, rgba(56,189,248,0.3), transparent 24%), radial-gradient(circle at 82% 14%, rgba(148,163,184,0.25), transparent 24%), linear-gradient(135deg, #020617 0%, #0f172a 45%, #111827 100%)",
  },
  {
    id: "sunrise",
    label: "Sunrise",
    backgroundImage:
      "radial-gradient(circle at 18% 18%, rgba(251,191,36,0.65), transparent 28%), radial-gradient(circle at 84% 16%, rgba(236,72,153,0.55), transparent 28%), radial-gradient(circle at 64% 78%, rgba(59,130,246,0.3), transparent 24%), linear-gradient(135deg, #1b1034 0%, #2f1b45 42%, #13192e 100%)",
  },
] as const;

export const COLLECTION_HEADER_ICON_COLORS = [
  "#4f46e5",
  "#4338ca",
  "#2563eb",
  "#0ea5e9",
  "#0f766e",
  "#14b8a6",
  "#059669",
  "#22c55e",
  "#16a34a",
  "#65a30d",
  "#f59e0b",
  "#d97706",
  "#b45309",
  "#7c3aed",
  "#a855f7",
  "#be123c",
  "#ec4899",
  "#dc2626",
  "#334155",
  "#1f2937",
];

export const COLLECTION_HEADER_ICON_EMOJIS = [
  "✨",
  "⭐",
  "💫",
  "🎯",
  "🎨",
  "🖌️",
  "🪄",
  "🧩",
  "🪩",
  "📁",
  "🗂️",
  "🎬",
  "📣",
  "🧠",
  "💡",
  "🔥",
  "🚀",
  "🌈",
  "🌟",
  "⚡",
  "📌",
  "🧭",
  "📎",
  "🪙",
];

export const DEFAULT_COLLECTION_VISIBLE_FIELDS: CollectionVisibleField[] = [
  "status",
  "file_extension",
  "uploaded_at",
  "size_bytes",
];

export const COLLECTION_VISIBLE_FIELD_OPTIONS: VisibleFieldOption[] = [
  { value: "root_id", label: "Version Stack" },
  { value: "status", label: "Status" },
  { value: "file_extension", label: "Format" },
  { value: "mime_kind", label: "Media Type" },
  { value: "mime_type", label: "MIME Type" },
  { value: "size_bytes", label: "Size" },
  { value: "duration_ms", label: "Duration" },
  { value: "dimensions", label: "Dimensions" },
  { value: "project", label: "Source Project" },
  { value: "folder", label: "Source Folder" },
  { value: "uploaded_at", label: "Uploaded" },
  { value: "updated_at", label: "Last Updated" },
  { value: "assigned_to", label: "Assignee" },
  { value: "comments_count", label: "Comments" },
  { value: "version_count", label: "Versions" },
  { value: "description", label: "Description" },
  { value: "tags", label: "Tags" },
];

export const COLLECTION_FILTER_FIELD_OPTIONS: FilterFieldOption[] = [
  {
    value: "root_id",
    label: "Version Stack",
    input: "text",
    kind: "text",
    operators: ["equals", "in", "not_in"],
    placeholder: "Asset root IDs",
    multi_placeholder: "Choose asset stacks",
    help_text: "Internal version stack identifier used by saved selections.",
  },
  {
    value: "name",
    label: "Name",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search by file name",
  },
  {
    value: "description",
    label: "Description",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search all descriptions",
    help_text: "Searches manual, smart, AI, caption, and alt text descriptions.",
  },
  {
    value: "smart_description",
    label: "Generated Summary",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search generated summary",
  },
  {
    value: "ai_description",
    label: "Generated Description",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search generated description",
  },
  {
    value: "tags",
    label: "Tags",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    placeholder: "Search tags",
    multi_placeholder: "Comma-separated tags",
  },
  {
    value: "storage_path",
    label: "Storage Location",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search storage path",
  },
  {
    value: "project_name",
    label: "Source Project Name",
    input: "text",
    kind: "text",
    operators: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
    placeholder: "Search project name",
  },
  {
    value: "status",
    label: "Status",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Use one or more workflow statuses.",
  },
  {
    value: "created_by",
    label: "Created By",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Filter by who originally created the asset.",
  },
  {
    value: "assigned_to",
    label: "Assignee",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Filter by the current assignee.",
  },
  {
    value: "uploaded_by",
    label: "Uploaded By",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Filter by who uploaded the asset.",
  },
  {
    value: "updated_by",
    label: "Updated By",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Filter by who last updated the asset.",
  },
  {
    value: "reviewer_ids",
    label: "Reviewers",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "contains", "is_empty", "is_not_empty"],
    help_text: "Filter by reviewers attached to the asset.",
  },
  {
    value: "file_extension",
    label: "Format",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    placeholder: "Choose one or more extensions",
    multi_placeholder: "Choose one or more extensions",
    help_text: "Pick from the extensions currently present in this collection source.",
  },
  {
    value: "mime_kind",
    label: "Media Type",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    placeholder: "Choose one or more file types",
    multi_placeholder: "Choose one or more file types",
    help_text: "Choose from the media types found in this collection source.",
  },
  {
    value: "mime_type",
    label: "MIME Type",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    placeholder: "Choose one or more MIME types",
    multi_placeholder: "Choose one or more MIME types",
    help_text: "Choose exact MIME types from assets in this collection source.",
  },
  {
    value: "size_bytes",
    label: "Size",
    input: "number",
    kind: "bytes",
    operators: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
    placeholder: "10",
    help_text: "Compare file size using a unit like MB or GB.",
    unit_options: [
      { value: "b", label: "Bytes", multiplier: 1 },
      { value: "kb", label: "KB", multiplier: 1024 },
      { value: "mb", label: "MB", multiplier: 1024 ** 2 },
      { value: "gb", label: "GB", multiplier: 1024 ** 3 },
    ],
  },
  {
    value: "duration_ms",
    label: "Duration",
    input: "number",
    kind: "duration",
    operators: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
    placeholder: "30",
    help_text: "Compare media duration using seconds, minutes, or hours.",
    unit_options: [
      { value: "ms", label: "Milliseconds", multiplier: 1 },
      { value: "seconds", label: "Seconds", multiplier: 1000 },
      { value: "minutes", label: "Minutes", multiplier: 60 * 1000 },
      { value: "hours", label: "Hours", multiplier: 60 * 60 * 1000 },
    ],
  },
  {
    value: "width",
    label: "Width",
    input: "number",
    kind: "number",
    operators: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
    placeholder: "1920",
    help_text: "Pixel width.",
  },
  {
    value: "height",
    label: "Height",
    input: "number",
    kind: "number",
    operators: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
    placeholder: "1080",
    help_text: "Pixel height.",
  },
  {
    value: "project_id",
    label: "Source Project",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Match one project or a set of projects.",
  },
  {
    value: "folder_id",
    label: "Source Folder",
    input: "select",
    kind: "select",
    operators: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
    help_text: "Match one folder or a set of folders.",
  },
  {
    value: "created_at",
    label: "Created",
    input: "date",
    kind: "date",
    operators: ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "before", "after", "equals", "is_empty", "is_not_empty"],
    help_text: "Calendar date comparison.",
  },
  {
    value: "uploaded_at",
    label: "Uploaded",
    input: "date",
    kind: "date",
    operators: ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "before", "after", "equals", "is_empty", "is_not_empty"],
    help_text: "Calendar date comparison.",
  },
  {
    value: "updated_at",
    label: "Last Updated",
    input: "date",
    kind: "date",
    operators: ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "before", "after", "equals", "is_empty", "is_not_empty"],
    help_text: "Calendar date comparison.",
  },
];

export const COLLECTION_SORT_OPTIONS: Array<{ value: CollectionSortKey; label: string }> = [
  { value: "uploaded_at", label: "Date Uploaded" },
  { value: "updated_at", label: "Last Updated" },
  { value: "name", label: "Name" },
  { value: "size_bytes", label: "File Size" },
  { value: "status", label: "Status" },
];

export const COLLECTION_STATUS_OPTIONS = [
  { value: "needs_review", label: "Needs review" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "none", label: "No status" },
];

export const COLLECTION_FILTER_OPERATOR_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "is",
  not_equals: "is not",
  in: "is any of",
  not_in: "is none of",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  today: "is today",
  yesterday: "is yesterday",
  last_7_days: "is in the last 7 days",
  last_30_days: "is in the last 30 days",
  this_month: "is this month",
  before: "before",
  after: "after",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export function getCollectionFilterFieldOption(field: CollectionFilterField) {
  return COLLECTION_FILTER_FIELD_OPTIONS.find((option) => option.value === field) ?? COLLECTION_FILTER_FIELD_OPTIONS[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeSortDir(value: unknown): CollectionSortDir {
  return normalizeText(value, "desc") === "asc" ? "asc" : "desc";
}

function normalizeLayoutMode(value: unknown): CollectionLayoutMode {
  return normalizeText(value, DEFAULT_APPEARANCE) === "list" ? "list" : "grid";
}

function normalizeCardSize(value: unknown): CollectionCardSize {
  const normalized = normalizeText(value, DEFAULT_CARD_SIZE);
  if (normalized === "medium" || normalized === "large") return normalized;
  return "small";
}

function normalizeAspectRatio(value: unknown): CollectionAspectRatio {
  const normalized = normalizeText(value, DEFAULT_ASPECT_RATIO);
  if (normalized === "portrait" || normalized === "landscape") return normalized;
  return "square";
}

function normalizeThumbnailScale(value: unknown): CollectionThumbnailScale {
  return normalizeText(value, DEFAULT_THUMBNAIL_SCALE) === "fit" ? "fit" : "fill";
}

function normalizeTitleDisplay(value: unknown): CollectionTitleDisplay {
  return normalizeText(value, DEFAULT_TITLE_DISPLAY) === "two_line" ? "two_line" : "one_line";
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function normalizeGroupMode(value: unknown): CollectionGroupMode {
  return normalizeText(value, DEFAULT_GROUP_MODE) === "none" ? "none" : "folder";
}

function clampPercent(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function dedupeStrings(values: unknown, fallback: string[] = []) {
  if (!Array.isArray(values)) return [...fallback];

  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const normalized = normalizeText(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }

  return next.length > 0 ? next : [...fallback];
}

function normalizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry, depth + 1)]),
    );
  }
  return null;
}

export function humanizeCollectionKey(key: string) {
  return key
    .replace(/[._]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeVisibleFields(value: unknown): CollectionVisibleField[] {
  if (!Array.isArray(value)) return [...DEFAULT_COLLECTION_VISIBLE_FIELDS];

  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeText(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

export function normalizeCollectionFilters(value: unknown): CollectionFilter[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const field = normalizeText(entry.field);
    if (!field) return [];

    const extras = Object.fromEntries(
      Object.entries(entry)
        .filter(([key]) => !["id", "field", "operator", "value"].includes(key))
        .map(([key, val]) => [key, normalizeJsonValue(val)]),
    );

    return [{
      ...extras,
      id: normalizeText(entry.id, crypto.randomUUID()),
      field,
      operator: normalizeText(entry.operator, DEFAULT_FILTER_OPERATOR),
      value: normalizeJsonValue(entry.value ?? ""),
    }];
  });
}

export function normalizeSortKey(value: unknown): CollectionSortKey {
  return normalizeText(value, DEFAULT_SORT_KEY);
}

export function normalizeCollectionDefinition(value: unknown): CollectionDefinition {
  const input = isRecord(normalizeJsonValue(value)) ? normalizeJsonValue(value) as Record<string, unknown> : {};
  const sourceInput = isRecord(input.source) ? input.source : {};
  const appearanceInput = isRecord(input.appearance) ? input.appearance : {};
  const groupingInput = isRecord(input.grouping) ? input.grouping : {};
  const fieldsInput = isRecord(input.fields) ? input.fields : {};
  const filtersInput = isRecord(input.filters) ? input.filters : {};
  const sortInput = isRecord(input.sort) ? input.sort : {};
  const headerInput = isRecord(input.header) ? input.header : {};
  const headerBackgroundInput = isRecord(headerInput.background) ? headerInput.background : {};
  const headerIconInput = isRecord(headerInput.icon) ? headerInput.icon : {};

  return {
    ...input,
    version: typeof input.version === "number" && Number.isFinite(input.version)
      ? Math.max(1, Math.trunc(input.version))
      : 1,
    source: {
      ...sourceInput,
      type: normalizeOptionalText(sourceInput.type),
      project_id: normalizeOptionalText(sourceInput.project_id ?? sourceInput.projectId),
      folder_id: normalizeOptionalText(sourceInput.folder_id ?? sourceInput.folderId),
      include_descendants: sourceInput.include_descendants !== false && sourceInput.includeDescendants !== false,
    },
    appearance: {
      ...appearanceInput,
      mode: normalizeLayoutMode(appearanceInput.mode ?? input.appearance),
      card_size: normalizeCardSize(appearanceInput.card_size ?? appearanceInput.cardSize),
      aspect_ratio: normalizeAspectRatio(appearanceInput.aspect_ratio ?? appearanceInput.aspectRatio),
      thumbnail_scale: normalizeThumbnailScale(appearanceInput.thumbnail_scale ?? appearanceInput.thumbnailScale),
      show_card_info: normalizeBoolean(
        appearanceInput.show_card_info ?? appearanceInput.showCardInfo,
        DEFAULT_SHOW_CARD_INFO,
      ),
      title_display: normalizeTitleDisplay(appearanceInput.title_display ?? appearanceInput.titleDisplay),
    },
    grouping: {
      ...groupingInput,
      mode: normalizeGroupMode(groupingInput.mode ?? input.group_mode),
    },
    fields: {
      ...fieldsInput,
      visible: normalizeVisibleFields(fieldsInput.visible ?? input.visible_fields),
    },
    filters: {
      ...filtersInput,
      combinator: normalizeText(filtersInput.combinator ?? filtersInput.mode, DEFAULT_FILTER_COMBINATOR),
      items: normalizeCollectionFilters(filtersInput.items ?? input.filters),
    },
    sort: {
      ...sortInput,
      key: normalizeSortKey(sortInput.key ?? input.sort_key),
      dir: normalizeSortDir(sortInput.dir ?? input.sort_dir),
    },
    header: {
      ...headerInput,
      description: normalizeText(headerInput.description ?? ""),
      background: {
        ...headerBackgroundInput,
        mode: normalizeText(headerBackgroundInput.mode, "preset") as CollectionHeaderBackgroundMode,
        preset_id: normalizeText(headerBackgroundInput.preset_id ?? headerBackgroundInput.presetId, DEFAULT_HEADER_BACKGROUND_PRESET),
        image_url: normalizeOptionalText(headerBackgroundInput.image_url ?? headerBackgroundInput.imageUrl),
        asset_root_id: normalizeOptionalText(headerBackgroundInput.asset_root_id ?? headerBackgroundInput.assetRootId),
        position_x: clampPercent(headerBackgroundInput.position_x ?? headerBackgroundInput.positionX, 50),
        position_y: clampPercent(headerBackgroundInput.position_y ?? headerBackgroundInput.positionY, 50),
      },
      icon: {
        ...headerIconInput,
        mode: normalizeText(headerIconInput.mode, "initials") as CollectionHeaderIconMode,
        color: normalizeText(headerIconInput.color, DEFAULT_HEADER_ICON_COLOR),
        emoji: normalizeText(headerIconInput.emoji, "✨"),
        image_url: normalizeOptionalText(headerIconInput.image_url ?? headerIconInput.imageUrl),
      },
    },
  };
}

export function mergeCollectionDefinitionPatch(
  baseDefinition: CollectionDefinition | Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
) {
  const base = normalizeCollectionDefinition(baseDefinition ?? {});
  const incomingDefinition = isRecord(payload.definition) ? payload.definition : {};

  const sourcePatch = isRecord(incomingDefinition.source) ? incomingDefinition.source : {};
  const appearancePatch = isRecord(incomingDefinition.appearance) ? incomingDefinition.appearance : {};
  const groupingPatch = isRecord(incomingDefinition.grouping) ? incomingDefinition.grouping : {};
  const fieldsPatch = isRecord(incomingDefinition.fields) ? incomingDefinition.fields : {};
  const filtersPatch = isRecord(incomingDefinition.filters) ? incomingDefinition.filters : {};
  const sortPatch = isRecord(incomingDefinition.sort) ? incomingDefinition.sort : {};
  const headerPatch = isRecord(incomingDefinition.header) ? incomingDefinition.header : {};
  const headerBackgroundPatch = isRecord(headerPatch.background) ? headerPatch.background : {};
  const headerIconPatch = isRecord(headerPatch.icon) ? headerPatch.icon : {};

  return normalizeCollectionDefinition({
    ...base,
    ...incomingDefinition,
    source: {
      ...base.source,
      ...sourcePatch,
      type: hasOwnProperty(payload, "source_type") || hasOwnProperty(payload, "sourceType")
        ? payload.source_type ?? payload.sourceType
        : sourcePatch.type ?? base.source.type,
      project_id: hasOwnProperty(payload, "source_project_id") || hasOwnProperty(payload, "sourceProjectId")
        ? payload.source_project_id ?? payload.sourceProjectId
        : sourcePatch.project_id ?? sourcePatch.projectId ?? base.source.project_id,
      folder_id: hasOwnProperty(payload, "source_folder_id") || hasOwnProperty(payload, "sourceFolderId")
        ? payload.source_folder_id ?? payload.sourceFolderId
        : sourcePatch.folder_id ?? sourcePatch.folderId ?? base.source.folder_id,
    },
    appearance: {
      ...base.appearance,
      ...appearancePatch,
      mode: hasOwnProperty(payload, "appearance")
        ? normalizeLayoutMode(payload.appearance)
        : appearancePatch.mode ?? base.appearance.mode,
      card_size: hasOwnProperty(appearancePatch, "card_size") || hasOwnProperty(appearancePatch, "cardSize")
        ? normalizeCardSize(appearancePatch.card_size ?? appearancePatch.cardSize)
        : base.appearance.card_size,
      aspect_ratio: hasOwnProperty(appearancePatch, "aspect_ratio") || hasOwnProperty(appearancePatch, "aspectRatio")
        ? normalizeAspectRatio(appearancePatch.aspect_ratio ?? appearancePatch.aspectRatio)
        : base.appearance.aspect_ratio,
      thumbnail_scale: hasOwnProperty(appearancePatch, "thumbnail_scale") || hasOwnProperty(appearancePatch, "thumbnailScale")
        ? normalizeThumbnailScale(appearancePatch.thumbnail_scale ?? appearancePatch.thumbnailScale)
        : base.appearance.thumbnail_scale,
      show_card_info: hasOwnProperty(appearancePatch, "show_card_info") || hasOwnProperty(appearancePatch, "showCardInfo")
        ? normalizeBoolean(appearancePatch.show_card_info ?? appearancePatch.showCardInfo, DEFAULT_SHOW_CARD_INFO)
        : base.appearance.show_card_info,
      title_display: hasOwnProperty(appearancePatch, "title_display") || hasOwnProperty(appearancePatch, "titleDisplay")
        ? normalizeTitleDisplay(appearancePatch.title_display ?? appearancePatch.titleDisplay)
        : base.appearance.title_display,
    },
    grouping: {
      ...base.grouping,
      ...groupingPatch,
      mode: normalizeGroupMode(
        hasOwnProperty(payload, "group_mode") || hasOwnProperty(payload, "groupMode")
          ? payload.group_mode ?? payload.groupMode
          : groupingPatch.mode ?? base.grouping.mode,
      ),
    },
    fields: {
      ...base.fields,
      ...fieldsPatch,
      visible: normalizeVisibleFields(
        hasOwnProperty(payload, "visible_fields") || hasOwnProperty(payload, "visibleFields")
          ? payload.visible_fields ?? payload.visibleFields
          : fieldsPatch.visible ?? base.fields.visible,
      ),
    },
    filters: {
      ...base.filters,
      ...filtersPatch,
      items: normalizeCollectionFilters(
        hasOwnProperty(payload, "filters")
          ? payload.filters
          : filtersPatch.items ?? base.filters.items,
      ),
    },
    sort: {
      ...base.sort,
      ...sortPatch,
      key: normalizeSortKey(
        hasOwnProperty(payload, "sort_key") || hasOwnProperty(payload, "sortKey")
          ? payload.sort_key ?? payload.sortKey
          : sortPatch.key ?? base.sort.key,
      ),
      dir: normalizeSortDir(
        hasOwnProperty(payload, "sort_dir") || hasOwnProperty(payload, "sortDir")
          ? payload.sort_dir ?? payload.sortDir
          : sortPatch.dir ?? base.sort.dir,
      ),
    },
    header: {
      ...base.header,
      ...headerPatch,
      description: hasOwnProperty(headerPatch, "description")
        ? headerPatch.description
        : base.header.description,
      background: {
        ...base.header.background,
        ...headerBackgroundPatch,
      },
      icon: {
        ...base.header.icon,
        ...headerIconPatch,
      },
    },
  });
}

function hasOwnProperty(target: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

export function normalizeCollectionRecord(value: any): CollectionRecord {
  const legacyDefinition = {
    source: {
      type: value?.source_type ?? null,
      project_id: value?.source_project_id ?? null,
      folder_id: value?.source_folder_id ?? null,
    },
    appearance: {
      mode: value?.appearance ?? DEFAULT_APPEARANCE,
    },
    grouping: {
      mode: value?.group_mode ?? DEFAULT_GROUP_MODE,
    },
    fields: {
      visible: value?.visible_fields,
    },
    filters: {
      items: value?.filters,
    },
    sort: {
      key: value?.sort_key ?? DEFAULT_SORT_KEY,
      dir: value?.sort_dir ?? "desc",
    },
  };

  const definition = normalizeCollectionDefinition(value?.definition ?? legacyDefinition);

  return {
    id: String(value?.id ?? ""),
    workspace_id: String(value?.workspace_id ?? ""),
    name: typeof value?.name === "string" && value.name.trim() ? value.name : "Untitled Collection",
    definition_version: typeof value?.definition_version === "number" && Number.isFinite(value.definition_version)
      ? Math.max(1, Math.trunc(value.definition_version))
      : Number(definition.version ?? 1) || 1,
    definition,
    source_type: normalizeOptionalText(definition.source.type),
    source_project_id: normalizeOptionalText(definition.source.project_id),
    source_folder_id: normalizeOptionalText(definition.source.folder_id),
    appearance: normalizeLayoutMode(definition.appearance.mode),
    group_mode: normalizeGroupMode(definition.grouping.mode),
    visible_fields: normalizeVisibleFields(definition.fields.visible),
    filters: normalizeCollectionFilters(definition.filters.items),
    sort_key: normalizeSortKey(definition.sort.key),
    sort_dir: normalizeSortDir(definition.sort.dir),
    header: definition.header,
    created_by: value?.created_by ?? null,
    updated_by: value?.updated_by ?? null,
    created_at: value?.created_at ?? null,
    updated_at: value?.updated_at ?? null,
  };
}

export function getCollectionHeaderBackgroundPreset(presetId: string | null | undefined) {
  return COLLECTION_HEADER_BACKGROUND_PRESETS.find((preset) => preset.id === presetId)
    ?? COLLECTION_HEADER_BACKGROUND_PRESETS[0];
}

export function collectFolderIds(folderId: string, folders: CollectionFolderRow[]) {
  const ids = new Set<string>();
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (ids.has(currentId)) continue;
    ids.add(currentId);

    for (const folder of folders) {
      if ((folder.parent_folder_id ?? null) === currentId) {
        queue.push(folder.id);
      }
    }
  }

  return ids;
}

export function getCollectionRows(assets: CollectionAsset[]) {
  const stacks = groupByRoot(assets as any[]);
  const rows: CollectionAssetRow[] = [];

  for (const [rootId, stack] of stacks.entries()) {
    if (stack.length === 0) continue;
    rows.push({
      rootId,
      asset: stack[0] as CollectionAsset,
      versionCount: stack.length,
    });
  }

  return rows;
}

function toCamelCase(value: string) {
  return value.replace(/[_-]([a-zA-Z0-9])/g, (_, part: string) => part.toUpperCase());
}

function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]/g, "_")
    .toLowerCase();
}

function readPath(target: unknown, path: string) {
  if (!isRecord(target)) return undefined;
  let current: unknown = target;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function resolveDynamicValue(asset: CollectionAsset, field: string) {
  const raw = asset.__raw ?? {};
  const baseCandidates = [
    field,
    field.replace(/\./g, "_"),
    toCamelCase(field),
    toSnakeCase(field),
  ];
  const candidates = Array.from(new Set(baseCandidates));

  for (const candidate of candidates) {
    if (candidate in asset && (asset as any)[candidate] !== undefined) return (asset as any)[candidate];
    if (isRecord(raw) && candidate in raw && raw[candidate] !== undefined) return raw[candidate];
  }

  for (const candidate of Array.from(new Set([field, field.replace(/_/g, "."), field.replace(/-/g, ".")]))) {
    const fromAsset = readPath(asset, candidate);
    if (fromAsset !== undefined) return fromAsset;
    const fromRaw = readPath(raw, candidate);
    if (fromRaw !== undefined) return fromRaw;
  }

  return null;
}

function stringifyFilterValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function joinSearchValues(values: unknown[]) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => stringifyFilterValue(value).trim())
    .filter(Boolean)
    .join(" ");
}

function assetDescriptionValue(asset: CollectionAsset, raw: Record<string, any>) {
  return joinSearchValues([
    asset.description,
    raw.description,
    asset.smart_description,
    raw.smart_description,
    asset.ai_description,
    raw.ai_description,
    raw.aiDescription,
    raw.generated_description,
    raw.auto_description,
    raw.caption,
    raw.alt_text,
  ]);
}

export function getCollectionAssetValue(row: CollectionAssetRow, field: CollectionFilterField | CollectionVisibleField) {
  const asset = row.asset;
  const raw = asset.__raw ?? {};

  switch (field) {
    case "root_id":
      return row.rootId;
    case "name":
      return asset.name ?? "";
    case "description":
      return assetDescriptionValue(asset, raw);
    case "smart_description":
      return asset.smart_description ?? raw.smart_description ?? "";
    case "ai_description":
      return asset.ai_description ?? raw.ai_description ?? raw.aiDescription ?? raw.generated_description ?? raw.auto_description ?? "";
    case "tags": {
      const tags = raw.tags ?? raw.smart_tags ?? raw.ai_tags ?? raw.labels ?? raw.keywords ?? "";
      return Array.isArray(tags) ? tags.join(", ") : tags;
    }
    case "storage_path":
      return raw.storage_path ?? asset.url ?? "";
    case "project_name":
      return raw.project_name ?? raw.project?.name ?? "";
    case "metadata":
      return stringifyFilterValue(raw.metadata ?? raw.custom_metadata ?? raw.ai_metadata ?? raw.extracted_metadata ?? raw.content_metadata ?? "");
    case "usage_rights":
      return raw.usage_rights ?? raw.rights ?? raw.license ?? raw.license_status ?? raw.usage_restrictions ?? "";
    case "approval_status":
      return raw.approval_status ?? raw.review_status ?? raw.workflow_status ?? asset.status ?? "";
    case "status":
      return asset.status ?? "none";
    case "file_extension":
      return getAssetFileExtension(asset);
    case "mime_kind":
      return mimeKind(asset.type);
    case "mime_type":
      return asset.type ?? "";
    case "size_bytes":
      return asset.sizeBytes ?? raw.size_bytes ?? null;
    case "duration_ms":
      return raw.duration_ms ?? null;
    case "width":
      return raw.width ?? null;
    case "height":
      return raw.height ?? null;
    case "dimensions": {
      const width = raw.width ?? null;
      const height = raw.height ?? null;
      if (!width || !height) return "";
      return `${width} × ${height}`;
    }
    case "project":
    case "project_id":
      return asset.project_id ?? null;
    case "folder":
    case "folder_id":
      return asset.folder_id ?? null;
    case "created_at":
      return asset.createdAt ?? raw.created_at ?? null;
    case "created_by":
      return asset.created_by ?? raw.created_by ?? null;
    case "uploaded_at":
      return asset.uploadedAt ?? asset.createdAt ?? raw.uploaded_at ?? raw.created_at ?? null;
    case "updated_at":
      return asset.updatedAt ?? raw.updated_at ?? null;
    case "assigned_to":
      return asset.assigned_to ?? null;
    case "uploaded_by":
      return asset.uploaded_by ?? raw.uploaded_by ?? null;
    case "updated_by":
      return asset.updated_by ?? raw.updated_by ?? null;
    case "owner":
      return raw.owner_id ?? raw.owner?.id ?? raw.owner?.user_id ?? raw.owner ?? raw.created_by ?? asset.created_by ?? null;
    case "reviewer_ids": {
      const reviewers = raw.reviewer_ids ?? raw.reviewers ?? raw.reviewerIds ?? raw.review_assignments ?? [];
      if (Array.isArray(reviewers)) {
        return reviewers.map((reviewer) => {
          if (isRecord(reviewer)) return reviewer.user_id ?? reviewer.id ?? reviewer.email ?? reviewer.name ?? reviewer.display_name ?? "";
          return reviewer;
        }).filter(Boolean);
      }
      return reviewers;
    }
    case "comments_count":
      return asset.comments_count ?? 0;
    case "version_count":
      return row.versionCount;
    default:
      return resolveDynamicValue(asset, field);
  }
}

function normalizeForCompare(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return stringifyFilterValue(value).trim().toLowerCase();
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDateMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getDayBounds(value: unknown) {
  const timestamp = toDateMs(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return {
    start,
    end: start + 24 * 60 * 60 * 1000,
  };
}

function getRelativeDayBounds(operator: CollectionFilterOperator) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  switch (operator) {
    case "today":
      return { start: todayStart, end: todayStart + oneDay };
    case "yesterday":
      return { start: todayStart - oneDay, end: todayStart };
    case "last_7_days":
      return { start: todayStart - 6 * oneDay, end: todayStart + oneDay };
    case "last_30_days":
      return { start: todayStart - 29 * oneDay, end: todayStart + oneDay };
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { start, end };
    }
    default:
      return null;
  }
}

function getFilterValueUnit(filter: CollectionFilter) {
  return typeof filter.value_unit === "string" ? filter.value_unit : null;
}

function convertFieldValueForCompare(field: CollectionFilterField, rawValue: unknown, filter: CollectionFilter) {
  const option = getCollectionFilterFieldOption(field);
  const numericValue = toNumber(rawValue);
  if (numericValue === null) return rawValue;

  if ((option.kind === "bytes" || option.kind === "duration") && option.unit_options?.length) {
    const unit = option.unit_options.find((entry) => entry.value === getFilterValueUnit(filter));
    return unit ? numericValue * unit.multiplier : numericValue;
  }

  return numericValue;
}

export function matchesCollectionFilter(row: CollectionAssetRow, filter: CollectionFilter) {
  const current = getCollectionAssetValue(row, filter.field);
  const fieldOption = getCollectionFilterFieldOption(filter.field);

  if (filter.operator === "is_empty") {
    return current === null || current === undefined || String(current).trim() === "" || current === "none";
  }
  if (filter.operator === "is_not_empty") {
    return !(current === null || current === undefined || String(current).trim() === "" || current === "none");
  }

  if (filter.operator === "contains") {
    return stringifyFilterValue(current).toLowerCase().includes(String(filter.value ?? "").toLowerCase().trim());
  }

  if (filter.operator === "equals") {
    const currentValues = asArray(current).map(normalizeForCompare);
    const target = normalizeForCompare(filter.value);
    return currentValues.length > 0 ? currentValues.includes(target) : normalizeForCompare(current) === target;
  }
  if (filter.operator === "not_equals") {
    const currentValues = asArray(current).map(normalizeForCompare);
    const target = normalizeForCompare(filter.value);
    return currentValues.length > 0 ? !currentValues.includes(target) : normalizeForCompare(current) !== target;
  }

  if (filter.operator === "in" || filter.operator === "not_in") {
    const haystack = asArray(filter.value).map(normalizeForCompare);
    const currentValues = asArray(current).map(normalizeForCompare);
    const currentScalar = normalizeForCompare(current);
    const matched = currentValues.length > 0
      ? currentValues.some((value) => haystack.includes(value))
      : haystack.includes(currentScalar);
    return filter.operator === "in" ? matched : !matched;
  }

  if (fieldOption.kind === "date") {
    const currentDate = toDateMs(current);
    if (currentDate === null) return false;

    const relativeDay = getRelativeDayBounds(filter.operator);
    if (relativeDay) {
      return currentDate >= relativeDay.start && currentDate < relativeDay.end;
    }

    const targetDay = getDayBounds(filter.value);
    if (!targetDay) return false;

    if (filter.operator === "equals") {
      return currentDate >= targetDay.start && currentDate < targetDay.end;
    }
    if (filter.operator === "before") {
      return currentDate < targetDay.start;
    }
    if (filter.operator === "after") {
      return currentDate >= targetDay.end;
    }
  }

  const leftNumber = toNumber(current);
  const rightNumber = toNumber(convertFieldValueForCompare(filter.field, filter.value, filter));
  if (leftNumber === null || rightNumber === null) return false;

  switch (filter.operator) {
    case "gt":
      return leftNumber > rightNumber;
    case "gte":
      return leftNumber >= rightNumber;
    case "lt":
      return leftNumber < rightNumber;
    case "lte":
      return leftNumber <= rightNumber;
    default:
      return false;
  }
}

export function applyCollectionFilters(rows: CollectionAssetRow[], filters: CollectionFilter[]) {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((filter) => matchesCollectionFilter(row, filter)));
}

function compareUnknownValues(left: unknown, right: unknown) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;

  const leftDate = toDateMs(left);
  const rightDate = toDateMs(right);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;

  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortCollectionRows(
  rows: CollectionAssetRow[],
  sortKey: CollectionSortKey,
  sortDir: CollectionSortDir,
) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((leftRow, rightRow) => {
    const left = leftRow.asset;
    const right = rightRow.asset;

    if (sortKey === "status") {
      const orderMap: Record<string, number> = { none: 0, needs_review: 1, in_review: 2, approved: 3 };
      const leftStatus = orderMap[String(left.status ?? "none")] ?? 0;
      const rightStatus = orderMap[String(right.status ?? "none")] ?? 0;
      return dir * (leftStatus - rightStatus);
    }

    const leftValue = getCollectionAssetValue(leftRow, sortKey);
    const rightValue = getCollectionAssetValue(rightRow, sortKey);
    return dir * compareUnknownValues(leftValue, rightValue);
  });
}

export function filterRowsBySearch(rows: CollectionAssetRow[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter((row) => {
    const asset = row.asset;
    const haystack = [
      asset.name,
      asset.type,
      getAssetFileExtension(asset),
      mimeKind(asset.type),
      getCollectionAssetValue(row, "description"),
      getCollectionAssetValue(row, "tags"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });
}

export function filterAssetsForSource(
  assets: CollectionAsset[],
  sourceType: CollectionSourceType | null,
  sourceFolderId: string | null,
  folders: CollectionFolderRow[],
) {
  if (!sourceFolderId || (sourceType !== "workspace_folder" && sourceType !== "project_folder")) {
    return assets;
  }
  const allowedIds = collectFolderIds(sourceFolderId, folders);
  return assets.filter((asset) => {
    const folderId = asset.folder_id ?? null;
    return Boolean(folderId && allowedIds.has(folderId));
  });
}

export function getAssetFileExtension(asset: CollectionAsset) {
  const name = asset.name || asset.__raw?.title || asset.__raw?.storage_path || "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

export function formatBytes(value: number | null | undefined) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const next = value / 1024 ** exponent;
  return `${Number(next.toFixed(next >= 10 || exponent === 0 ? 0 : 1))} ${units[exponent]}`;
}

export function formatDuration(value: number | null | undefined) {
  if (!value || value <= 0) return "0s";
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getCollectionSourceLabel(
  sourceType: CollectionSourceType | null,
  sourceProjectId: string | null,
  sourceFolderId: string | null,
  projectsById: Map<string, CollectionProjectSummary>,
  foldersById: Map<string, CollectionFolderRow>,
) {
  if (!sourceType) return "Choose source folder";
  if (sourceType === "workspace_root") return "Workspace Library";
  if (sourceType === "project_root") {
    return projectsById.get(sourceProjectId ?? "")?.name ?? "Project";
  }

  const folder = foldersById.get(sourceFolderId ?? "");
  if (!folder) {
    if (sourceType === "workspace_folder") return "Library folder";
    if (sourceProjectId) return projectsById.get(sourceProjectId)?.name ?? "Project folder";
    return humanizeCollectionKey(sourceType);
  }

  const path = getFolderPath(folder.id, foldersById).join(" / ");
  if (sourceType === "workspace_folder") return `Workspace Library / ${path}`;
  if (sourceProjectId) {
    const projectName = projectsById.get(sourceProjectId)?.name ?? "Project";
    return `${projectName} / ${path}`;
  }
  return path;
}

export function getFolderPath(folderId: string | null, foldersById: Map<string, CollectionFolderRow>) {
  const parts: string[] = [];
  let cursor = folderId;
  while (cursor) {
    const folder = foldersById.get(cursor);
    if (!folder) break;
    parts.unshift(folder.name);
    cursor = folder.parent_folder_id ?? null;
  }
  return parts;
}

export function formatCollectionFieldValue(
  row: CollectionAssetRow,
  field: CollectionVisibleField,
  projectsById: Map<string, CollectionProjectSummary>,
  foldersById: Map<string, CollectionFolderRow>,
  peopleById?: Map<string, string>,
) {
  const value = getCollectionAssetValue(row, field);

  switch (field) {
    case "status": {
      const match = COLLECTION_STATUS_OPTIONS.find((option) => option.value === value);
      return match?.label ?? "No status";
    }
    case "size_bytes":
      return formatBytes(typeof value === "number" ? value : null);
    case "duration_ms":
      return formatDuration(typeof value === "number" ? value : null);
    case "created_at":
    case "uploaded_at":
    case "updated_at":
      return formatDate(typeof value === "string" ? value : null);
    case "project":
      return value ? projectsById.get(String(value))?.name ?? "Project" : "Workspace Library";
    case "folder":
      return value ? getFolderPath(String(value), foldersById).join(" / ") || "Root" : "Root";
    case "mime_kind":
      return String(value || "").replace(/^\w/, (char) => char.toUpperCase());
    case "comments_count":
    case "version_count":
      return String(value ?? 0);
    case "created_by":
    case "assigned_to":
    case "uploaded_by":
    case "updated_by":
      return value ? peopleById?.get(String(value)) ?? String(value) : "Unassigned";
    default:
      if (Array.isArray(value)) return value.join(", ");
      if (typeof value === "object" && value !== null) return JSON.stringify(value);
      return value ? String(value) : "—";
  }
}

export function formatCollectionFilterSummary(
  filter: CollectionFilter,
  projectsById: Map<string, CollectionProjectSummary>,
  foldersById: Map<string, CollectionFolderRow>,
  peopleById?: Map<string, string>,
) {
  const fieldOption = getCollectionFilterFieldOption(filter.field);
  const fieldLabel = fieldOption?.label ?? humanizeCollectionKey(filter.field);
  const operatorLabel = COLLECTION_FILTER_OPERATOR_LABELS[filter.operator] ?? humanizeCollectionKey(filter.operator);

  if (filter.operator === "is_empty" || filter.operator === "is_not_empty") {
    return `${fieldLabel} ${operatorLabel}`;
  }

  if (["today", "yesterday", "last_7_days", "last_30_days", "this_month"].includes(filter.operator)) {
    return `${fieldLabel} ${operatorLabel}`;
  }

  const rawValue = filter.value;
  const formatSingleValue = (value: unknown) => {
    if (filter.field === "status") {
      return COLLECTION_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? String(value ?? "");
    }
    if (filter.field === "project_id") {
      return value ? projectsById.get(String(value))?.name ?? "Project" : "Workspace Library";
    }
    if (filter.field === "folder_id") {
      return value ? getFolderPath(String(value), foldersById).join(" / ") || "Root" : "Root";
    }
    if (filter.field === "created_by" || filter.field === "assigned_to" || filter.field === "uploaded_by" || filter.field === "updated_by") {
      return value ? peopleById?.get(String(value)) ?? String(value) : "Unassigned";
    }
    if (fieldOption.kind === "bytes") {
      const numeric = toNumber(value);
      const unit = fieldOption.unit_options?.find((entry) => entry.value === getFilterValueUnit(filter));
      if (numeric !== null) return `${numeric} ${unit?.label ?? "Bytes"}`;
    }
    if (fieldOption.kind === "duration") {
      const numeric = toNumber(value);
      const unit = fieldOption.unit_options?.find((entry) => entry.value === getFilterValueUnit(filter));
      if (numeric !== null) return `${numeric} ${unit?.label ?? "Milliseconds"}`;
    }
    return String(value ?? "");
  };

  const formattedValue = Array.isArray(rawValue)
    ? rawValue.map(formatSingleValue).filter(Boolean).join(", ")
    : typeof rawValue === "string" && (filter.operator === "in" || filter.operator === "not_in")
      ? rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(formatSingleValue)
        .join(", ")
      : formatSingleValue(rawValue);

  return `${fieldLabel} ${operatorLabel} ${formattedValue || "—"}`;
}

export function getCollectionRootId(asset: CollectionAsset) {
  return rootIdOf(asset as any);
}

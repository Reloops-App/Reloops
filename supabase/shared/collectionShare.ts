import { admin } from "./supabaseAdmin.ts";
import { listProjectAssetRows, rootAssetIdOf } from "./dam.ts";

type JsonRecord = Record<string, unknown>;

type CollectionSourceType = string | null;
type CollectionFilterField = string;
type CollectionFilterOperator = string;
type CollectionSortKey = string;
type CollectionSortDir = "asc" | "desc";

export type CollectionShareFilter = {
  id?: string;
  field: CollectionFilterField;
  operator: CollectionFilterOperator;
  value: unknown;
  [key: string]: unknown;
};

export type CollectionShareAsset = {
  id: string;
  title: string;
  name: string;
  mime_type: string | null;
  type: string;
  storage_path: string | null;
  cover_image_url: string | null;
  workspace_id: string | null;
  project_id: string | null;
  folder_id: string | null;
  parent_asset_id: string | null;
  version_no: number | null;
  size_bytes: number | null;
  sizeBytes: number | null;
  created_at: string | null;
  createdAt: string | null;
  updated_at: string | null;
  updatedAt: string | null;
  uploaded_at: string | null;
  uploadedAt: string | null;
  comments_count: number;
  status: string | null;
  assigned_to: string | null;
  url: string | null;
  coverUrl: string | null;
  __raw: JsonRecord;
  [key: string]: unknown;
};

export type CollectionShareFolderRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
};

export type CollectionShareRow = {
  rootId: string;
  asset: CollectionShareAsset;
  versionCount: number;
};

type CollectionShareSource = {
  sourceType: CollectionSourceType;
  sourceProjectId: string | null;
  sourceFolderId: string | null;
  filters: CollectionShareFilter[];
  sortKey: CollectionSortKey;
  sortDir: CollectionSortDir;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalId(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value === null || value === undefined) return null;
  return String(value);
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

function normalizeForCompare(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim().toLowerCase();
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

function mimeKind(type?: string | null) {
  if (!type) return "other";
  const [major, minor] = type.split("/");
  if (!major) return "other";
  if (minor === "pdf") return "pdf";
  return major;
}

function normalizeScopedAssetFolders(rows: JsonRecord[], scopedFolders: CollectionShareFolderRow[]) {
  const allowedFolderIds = new Set(scopedFolders.map((folder) => String(folder.id)));
  return rows.map((row) => {
    const folderId = row?.folder_id ? String(row.folder_id) : null;
    if (!folderId || allowedFolderIds.has(folderId)) return row;
    return { ...row, folder_id: null };
  });
}

function normalizeAsset(row: JsonRecord, commentCount: number): CollectionShareAsset {
  const title = typeof row.title === "string"
    ? row.title
    : typeof row.name === "string"
      ? row.name
      : typeof row.filename === "string"
        ? row.filename
        : "";
  const mimeType = typeof row.mime_type === "string"
    ? row.mime_type
    : typeof row.type === "string"
      ? row.type
      : null;
  const storagePath = typeof row.storage_path === "string"
    ? row.storage_path
    : typeof row.path === "string"
      ? row.path
      : typeof row.url === "string"
        ? row.url
        : null;
  const coverImageUrl = typeof row.cover_image_url === "string"
    ? row.cover_image_url
    : typeof row.coverUrl === "string"
      ? row.coverUrl
      : null;
  const createdAt = typeof row.created_at === "string"
    ? row.created_at
    : typeof row.uploaded_at === "string"
      ? row.uploaded_at
      : null;
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
  const uploadedAt = typeof row.uploaded_at === "string" ? row.uploaded_at : createdAt;

  return {
    id: String(row.id ?? ""),
    title,
    name: title,
    mime_type: mimeType,
    type: mimeType ?? "",
    storage_path: storagePath,
    cover_image_url: coverImageUrl,
    workspace_id: normalizeOptionalId(row.workspace_id),
    project_id: normalizeOptionalId(row.project_id),
    folder_id: normalizeOptionalId(row.folder_id),
    parent_asset_id: normalizeOptionalId(row.parent_asset_id),
    version_no: typeof row.version_no === "number" ? row.version_no : toNumber(row.version_no),
    size_bytes: toNumber(row.size_bytes),
    sizeBytes: toNumber(row.size_bytes ?? row.sizeBytes ?? row.size),
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
    uploaded_at: uploadedAt,
    uploadedAt,
    comments_count: commentCount,
    status: typeof row.status === "string" ? row.status : null,
    assigned_to: normalizeOptionalId(row.assigned_to),
    url: storagePath,
    coverUrl: coverImageUrl,
    __raw: row,
  };
}

function groupByRoot<T extends { id: string; parent_asset_id?: string | null; version_no?: number | null; createdAt?: string | null }>(assets: T[]) {
  const byRoot = new Map<string, T[]>();
  for (const asset of assets) {
    const rootId = String(rootAssetIdOf(asset));
    if (!byRoot.has(rootId)) byRoot.set(rootId, []);
    byRoot.get(rootId)!.push(asset);
  }

  for (const [, stack] of byRoot) {
    stack.sort((left, right) => {
      const leftVersion = typeof left.version_no === "number" ? left.version_no : -1;
      const rightVersion = typeof right.version_no === "number" ? right.version_no : -1;
      if (leftVersion !== rightVersion) return rightVersion - leftVersion;
      const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightCreatedAt - leftCreatedAt;
    });
  }

  return byRoot;
}

function getCollectionRows(assets: CollectionShareAsset[]) {
  const stacks = groupByRoot(assets);
  const rows: CollectionShareRow[] = [];

  for (const [rootId, stack] of stacks.entries()) {
    if (stack.length === 0) continue;
    rows.push({
      rootId,
      asset: stack[0],
      versionCount: stack.length,
    });
  }

  return rows;
}

function getAssetFileExtension(asset: CollectionShareAsset) {
  const name = typeof asset.name === "string"
    ? asset.name
    : typeof asset.title === "string"
      ? asset.title
      : typeof asset.__raw?.storage_path === "string"
        ? asset.__raw.storage_path
        : "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
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

function toCamelCase(value: string) {
  return value.replace(/[_-]([a-zA-Z0-9])/g, (_, part: string) => part.toUpperCase());
}

function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]/g, "_")
    .toLowerCase();
}

function resolveDynamicValue(asset: CollectionShareAsset, field: string) {
  const raw = asset.__raw ?? {};
  const candidates = Array.from(new Set([
    field,
    field.replace(/\./g, "_"),
    toCamelCase(field),
    toSnakeCase(field),
  ]));

  for (const candidate of candidates) {
    if (candidate in asset && asset[candidate] !== undefined) return asset[candidate];
    if (candidate in raw && raw[candidate] !== undefined) return raw[candidate];
  }

  for (const candidate of Array.from(new Set([field, field.replace(/_/g, "."), field.replace(/-/g, ".")]))) {
    const fromAsset = readPath(asset, candidate);
    if (fromAsset !== undefined) return fromAsset;
    const fromRaw = readPath(raw, candidate);
    if (fromRaw !== undefined) return fromRaw;
  }

  return null;
}

function getCollectionAssetValue(row: CollectionShareRow, field: CollectionFilterField) {
  const asset = row.asset;
  const raw = asset.__raw ?? {};

  switch (field) {
    case "root_id":
      return row.rootId;
    case "name":
      return asset.name ?? "";
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
      return raw.created_by ?? null;
    case "uploaded_at":
      return asset.uploadedAt ?? asset.createdAt ?? raw.uploaded_at ?? raw.created_at ?? null;
    case "updated_at":
      return asset.updatedAt ?? raw.updated_at ?? null;
    case "assigned_to":
      return asset.assigned_to ?? null;
    case "uploaded_by":
      return raw.uploaded_by ?? null;
    case "updated_by":
      return raw.updated_by ?? null;
    case "comments_count":
      return asset.comments_count ?? 0;
    case "version_count":
      return row.versionCount;
    default:
      return resolveDynamicValue(asset, field);
  }
}

function getFilterValueUnit(filter: CollectionShareFilter) {
  return typeof filter.value_unit === "string" ? filter.value_unit : null;
}

function getFilterKind(field: CollectionFilterField) {
  if (["created_at", "uploaded_at", "updated_at"].includes(field)) return "date";
  if (["size_bytes", "duration_ms", "width", "height", "comments_count", "version_count"].includes(field)) return "number";
  return "text";
}

function convertFieldValueForCompare(field: CollectionFilterField, rawValue: unknown, filter: CollectionShareFilter) {
  const numericValue = toNumber(rawValue);
  if (numericValue === null) return rawValue;

  const unit = getFilterValueUnit(filter);
  if (field === "size_bytes") {
    const sizeUnitMultipliers: Record<string, number> = {
      bytes: 1,
      kb: 1024,
      mb: 1024 ** 2,
      gb: 1024 ** 3,
    };
    return numericValue * (sizeUnitMultipliers[unit ?? "bytes"] ?? 1);
  }

  if (field === "duration_ms") {
    const durationUnitMultipliers: Record<string, number> = {
      ms: 1,
      sec: 1000,
      min: 60_000,
      hr: 3_600_000,
    };
    return numericValue * (durationUnitMultipliers[unit ?? "ms"] ?? 1);
  }

  return numericValue;
}

function matchesCollectionFilter(row: CollectionShareRow, filter: CollectionShareFilter) {
  const current = getCollectionAssetValue(row, filter.field);
  const filterKind = getFilterKind(filter.field);

  if (filter.operator === "is_empty") {
    return current === null || current === undefined || String(current).trim() === "" || current === "none";
  }
  if (filter.operator === "is_not_empty") {
    return !(current === null || current === undefined || String(current).trim() === "" || current === "none");
  }

  if (filter.operator === "contains") {
    return String(current ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase().trim());
  }

  if (filter.operator === "equals") {
    return normalizeForCompare(current) === normalizeForCompare(filter.value);
  }
  if (filter.operator === "not_equals") {
    return normalizeForCompare(current) !== normalizeForCompare(filter.value);
  }

  if (filter.operator === "in" || filter.operator === "not_in") {
    const haystack = asArray(filter.value).map(normalizeForCompare);
    const matched = haystack.includes(normalizeForCompare(current));
    return filter.operator === "in" ? matched : !matched;
  }

  if (filterKind === "date") {
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

function applyCollectionFilters(rows: CollectionShareRow[], filters: CollectionShareFilter[]) {
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

function sortCollectionRows(rows: CollectionShareRow[], sortKey: CollectionSortKey, sortDir: CollectionSortDir) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((leftRow, rightRow) => {
    if (sortKey === "status") {
      const orderMap: Record<string, number> = { none: 0, needs_review: 1, in_review: 2, approved: 3 };
      const leftStatus = orderMap[String(leftRow.asset.status ?? "none")] ?? 0;
      const rightStatus = orderMap[String(rightRow.asset.status ?? "none")] ?? 0;
      return dir * (leftStatus - rightStatus);
    }

    const leftValue = getCollectionAssetValue(leftRow, sortKey);
    const rightValue = getCollectionAssetValue(rightRow, sortKey);
    return dir * compareUnknownValues(leftValue, rightValue);
  });
}

function collectFolderIds(folderId: string, folders: CollectionShareFolderRow[]) {
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

function filterAssetsForSource(
  assets: CollectionShareAsset[],
  sourceType: CollectionSourceType,
  sourceFolderId: string | null,
  folders: CollectionShareFolderRow[],
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

function getCollectionSource(collection: JsonRecord): CollectionShareSource {
  const definition = isRecord(collection.definition) ? collection.definition : {};
  const source = isRecord(definition.source) ? definition.source : {};
  const filtersRecord = isRecord(definition.filters) ? definition.filters : {};
  const sortRecord = isRecord(definition.sort) ? definition.sort : {};

  return {
    sourceType: normalizeText(source.type ?? collection.source_type) || null,
    sourceProjectId: normalizeOptionalId(source.project_id ?? source.projectId ?? collection.source_project_id),
    sourceFolderId: normalizeOptionalId(source.folder_id ?? source.folderId ?? collection.source_folder_id),
    filters: Array.isArray(filtersRecord.items)
      ? filtersRecord.items.filter((entry): entry is CollectionShareFilter => isRecord(entry) && typeof entry.field === "string" && typeof entry.operator === "string")
      : Array.isArray(collection.filters)
        ? collection.filters.filter((entry): entry is CollectionShareFilter => isRecord(entry) && typeof entry.field === "string" && typeof entry.operator === "string")
        : [],
    sortKey: normalizeText(sortRecord.key ?? collection.sort_key, "uploaded_at"),
    sortDir: normalizeText(sortRecord.dir ?? collection.sort_dir, "desc") === "asc" ? "asc" : "desc",
  };
}

async function loadProjectFolders(projectId: string) {
  const { data, error } = await admin
    .from("folders")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CollectionShareFolderRow[];
}

async function loadLibraryFolders(workspaceId: string) {
  const { data, error } = await admin
    .from("folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("project_id", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CollectionShareFolderRow[];
}

async function computeCommentCounts(assetIds: string[]) {
  if (!assetIds.length) return new Map<string, number>();

  const { data, error } = await admin
    .from("asset_comments")
    .select("asset_id")
    .in("asset_id", assetIds)
    .neq("status", "deleted");

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const assetId = String((row as JsonRecord).asset_id ?? "");
    if (!assetId) continue;
    counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
  }
  return counts;
}

async function listWorkspaceAssets(workspaceId: string) {
  const { data, error } = await admin
    .from("assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or("status.neq.deleted,status.is.null")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as JsonRecord[];
}

export async function resolveSharedCollectionRows(collection: JsonRecord): Promise<{
  rows: CollectionShareRow[];
  folders: CollectionShareFolderRow[];
}> {
  const workspaceId = normalizeOptionalId(collection.workspace_id);
  if (!workspaceId) {
    return { rows: [], folders: [] };
  }

  const source = getCollectionSource(collection);
  if (!source.sourceType) {
    return { rows: [], folders: [] };
  }
  let rawAssets: JsonRecord[] = [];
  let folders: CollectionShareFolderRow[] = [];

  if (source.sourceType === "project_root" || source.sourceType === "project_folder") {
    if (!source.sourceProjectId) {
      return { rows: [], folders: [] };
    }
    const [projectAssets, projectFolders] = await Promise.all([
      listProjectAssetRows(source.sourceProjectId),
      loadProjectFolders(source.sourceProjectId),
    ]);
    rawAssets = normalizeScopedAssetFolders(projectAssets as JsonRecord[], projectFolders);
    folders = projectFolders;
  } else {
    const [workspaceAssets, libraryFolders] = await Promise.all([
      listWorkspaceAssets(workspaceId),
      loadLibraryFolders(workspaceId),
    ]);
    rawAssets = normalizeScopedAssetFolders(workspaceAssets, libraryFolders);
    folders = libraryFolders;
  }

  const commentCounts = await computeCommentCounts(rawAssets.map((asset) => String(asset.id ?? "")).filter(Boolean));
  const normalizedAssets = rawAssets.map((asset) => normalizeAsset(asset, commentCounts.get(String(asset.id ?? "")) ?? 0));
  const scopedAssets = filterAssetsForSource(normalizedAssets, source.sourceType, source.sourceFolderId, folders);
  const baseRows = getCollectionRows(scopedAssets);
  const filteredRows = applyCollectionFilters(baseRows, source.filters);
  const rows = sortCollectionRows(filteredRows, source.sortKey, source.sortDir);

  return { rows, folders };
}

export async function isAssetVisibleInSharedCollection(collection: JsonRecord, assetId: string): Promise<boolean> {
  const { rows } = await resolveSharedCollectionRows(collection);
  return rows.some((row) => row.asset.id === assetId);
}

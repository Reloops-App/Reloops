"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invokeEdgeFunction } from "@/api/edge";
import { createProject } from "@/api/project";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import CampaignFilters from "@/pages/Campaign/components/CampaignFilters";
import { AssetCard } from "@/pages/Campaign/components/AssetCard";
import { Asset, ColumnKey, toColumnKey } from "@/pages/Campaign/CampaignTypes";
import type { CollectionFilterPersonOption } from "@/pages/Collections/components/CollectionFilterPopover";
import {
  groupByRoot,
  mimeKind,
  normalizeAssets,
  rootIdOf,
  STATUS_ORDER as UTIL_STATUS_ORDER,
} from "@/lib/assetUtils";
import {
  CollectionAsset,
  CollectionFilter,
  matchesCollectionFilter,
} from "@/lib/collections";
import { downloadZipArchive } from "@/lib/downloadArchive";
import { supabase } from "@/lib/supabaseClient";
import { changeAssetStatus, downloadFile } from "@/lib/utils";
import {
  AlertCircle,
  CheckSquare2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Loader2,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

type SortKey = "none" | "createdAt" | "updatedAt" | "name" | "sizeBytes" | "status";
type SortDir = "asc" | "desc";

type FolderRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
};

type SearchSuggestion = {
  group: "Folders" | "Assets" | "People" | "Types" | "Metadata";
  label: React.ReactNode;
  value: string;
};

type MatchDetail = {
  label: string;
  value: string;
};

type SearchIndexField = {
  label: string;
  value: string;
  normalized: string;
  weight: number;
};

type AssetSearchIndex = {
  haystack: string;
  fields: SearchIndexField[];
};

type PeopleLookup = Map<string, CollectionFilterPersonOption>;

const STATUS_ORDER: Record<string, number> = UTIL_STATUS_ORDER as any;

function sanitizeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, " - ").replace(/\s+/g, " ").trim();
}

function appendDuplicateSuffix(path: string, occurrence: number) {
  if (occurrence <= 0) return path;

  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  return `${directory}${base} (${occurrence + 1})${extension}`;
}

function folderPathParts(folderId: string | null | undefined, foldersById: Map<string, FolderRow>) {
  const parts: string[] = [];
  let cursor = folderId ?? null;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const folder = foldersById.get(cursor);
    if (!folder) break;
    parts.unshift(folder.name);
    cursor = folder.parent_folder_id ?? null;
  }

  return parts;
}

function folderTrailRows(folderId: string | null | undefined, foldersById: Map<string, FolderRow>) {
  const rows: FolderRow[] = [];
  let cursor = folderId ?? null;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const folder = foldersById.get(cursor);
    if (!folder) break;
    rows.unshift(folder);
    cursor = folder.parent_folder_id ?? null;
  }

  return rows;
}

function formatRelativeFolderPath(folderId: string | null | undefined, foldersById: Map<string, FolderRow>) {
  const parts = folderPathParts(folderId, foldersById);
  return parts.length ? `/${parts.join(" / ")}` : "/";
}

function resolveDownloadUrl(asset: Asset) {
  const rawUrl = asset.url;
  if (!rawUrl) return null;
  if (rawUrl.startsWith("http")) return rawUrl;

  const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
  const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
  const path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return `${base}${path}`;
}

function formatBytes(bytes?: number | null) {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dateSearchVariants(value?: string | null) {
  if (!value) return [];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return [];
  return [
    parsed.toLocaleDateString(),
    parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    parsed.toISOString().slice(0, 10),
  ].map((entry) => entry.toLowerCase());
}

function highlightMatch(text: string, query: string) {
  const value = String(text ?? "");
  const q = query.trim();
  if (!q) return value;
  const index = value.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-amber-300/25 px-0.5 text-inherit ring-1 ring-amber-200/20">{value.slice(index, index + q.length)}</mark>
      {value.slice(index + q.length)}
    </>
  );
}

function containsQuery(value: unknown, query: string) {
  const q = normalizeText(query);
  if (!q) return false;
  return normalizeText(value).includes(q);
}

function stringifyMetadataValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuidLike(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function addUnique(values: string[], value: unknown) {
  const rendered = String(value ?? "").trim();
  if (!rendered || values.includes(rendered)) return;
  values.push(rendered);
}

function extractPersonIdsFromValue(value: unknown, ids: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    if (isUuidLike(value)) ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractPersonIdsFromValue(entry, ids));
    return;
  }
  if (!isRecord(value)) return;

  for (const key of ["id", "user_id", "userId", "profile_id", "profileId", "created_by", "uploaded_by", "updated_by", "assigned_to", "owner_id"]) {
    extractPersonIdsFromValue(value[key], ids);
  }
}

function extractPersonSearchValues(value: unknown, peopleById: PeopleLookup) {
  const values: string[] = [];

  const visit = (entry: unknown) => {
    if (!entry) return;
    if (typeof entry === "string" || typeof entry === "number") {
      const id = String(entry).trim();
      addUnique(values, id);
      const person = peopleById.get(id);
      if (person) {
        addUnique(values, person.label);
        addUnique(values, person.keywords);
        addUnique(values, person.role);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }

    if (!isRecord(entry)) return;
    for (const key of [
      "id",
      "user_id",
      "userId",
      "profile_id",
      "profileId",
      "display_name",
      "full_name",
      "name",
      "email",
      "role",
      "username",
    ]) {
      addUnique(values, entry[key]);
      if (typeof entry[key] === "string") {
        const person = peopleById.get(entry[key] as string);
        if (person) {
          addUnique(values, person.label);
          addUnique(values, person.keywords);
          addUnique(values, person.role);
        }
      }
    }

    for (const nestedKey of ["profile", "profiles", "user", "member", "assignee", "owner", "reviewer"]) {
      visit(entry[nestedKey]);
    }
  };

  visit(value);
  return values;
}

function pushPersonSearchField(
  fields: SearchIndexField[],
  label: string,
  value: unknown,
  peopleById: PeopleLookup,
  weight = 8,
) {
  const values = extractPersonSearchValues(value, peopleById);
  values.forEach((entry) => {
    const isId = isUuidLike(entry);
    pushSearchField(fields, isId ? `${label} ID` : label, entry, isId ? Math.max(2, weight - 4) : weight);
  });
}

function findMetadataMatch(value: unknown, query: string, prefix = "metadata"): MatchDetail | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);

  for (const [key, entryValue] of entries) {
    const fieldPath = `${prefix}.${key}`;
    const renderedValue = stringifyMetadataValue(entryValue);
    if (containsQuery(key, query) || containsQuery(renderedValue, query)) {
      return {
        label: `Metadata: ${key}`,
        value: renderedValue,
      };
    }
    const nested = findMetadataMatch(entryValue, query, fieldPath);
    if (nested) return nested;
  }

  return null;
}

function pushSearchField(fields: SearchIndexField[], label: string, value: unknown, weight = 1) {
  const rendered = stringifyMetadataValue(value).trim();
  if (!rendered) return;
  const normalized = normalizeText(rendered);
  if (!normalized) return;
  fields.push({ label, value: rendered, normalized, weight });
}

function pushObjectFields(fields: SearchIndexField[], value: unknown, labelPrefix: string, weight = 1, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (entry && typeof entry === "object") {
        pushObjectFields(fields, entry, `${labelPrefix} ${index + 1}`, weight, depth + 1);
      } else {
        pushSearchField(fields, labelPrefix, entry, weight);
      }
    });
    return;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (entryValue === null || entryValue === undefined || key.startsWith("_")) continue;
    const readableKey = key.replace(/[_-]+/g, " ");
    if (entryValue && typeof entryValue === "object") {
      pushSearchField(fields, labelPrefix, readableKey, weight);
      pushObjectFields(fields, entryValue, `${labelPrefix}: ${readableKey}`, weight, depth + 1);
    } else {
      pushSearchField(fields, `${labelPrefix}: ${readableKey}`, entryValue, weight);
    }
  }
}

function assetStatusLabel(status: unknown) {
  const value = String(status ?? "").trim();
  if (!value) return "No status";
  return value.replace(/[_-]+/g, " ");
}

function buildAssetSearchIndex(asset: Asset, foldersById: Map<string, FolderRow>, peopleById: PeopleLookup = new Map()): AssetSearchIndex {
  const raw = (asset as any).__raw ?? {};
  const fields: SearchIndexField[] = [];
  const folderPath = formatRelativeFolderPath(asset.folder_id ?? null, foldersById);
  const folderParts = folderPathParts(asset.folder_id ?? null, foldersById);
  const extension = String(asset.name || "").includes(".") ? String(asset.name).split(".").pop() : "";
  const rootId = rootIdOf(asset);

  pushSearchField(fields, "Name", asset.name, 12);
  pushSearchField(fields, "Asset ID", asset.id, 2);
  pushSearchField(fields, "Asset stack", rootId, 2);
  pushSearchField(fields, "File extension", extension, 5);
  pushSearchField(fields, "MIME type", asset.type, 5);
  pushSearchField(fields, "File type", mimeKind(asset.type), 6);
  pushSearchField(fields, "Status", assetStatusLabel(asset.status), 5);
  pushPersonSearchField(fields, "Assignee", asset.assigned_to ?? raw.assigned_to ?? raw.assignee ?? raw.assigned_user ?? raw.assigned_profile, peopleById, 9);
  pushPersonSearchField(fields, "Owner", raw.owner ?? raw.owner_id ?? raw.owner_user ?? raw.owner_profile, peopleById, 8);
  pushPersonSearchField(fields, "Created by", asset.created_by ?? raw.created_by ?? raw.creator ?? raw.created_profile ?? raw.created_by_profile, peopleById, 8);
  pushPersonSearchField(fields, "Uploaded by", asset.uploaded_by ?? raw.uploaded_by ?? raw.uploader ?? raw.uploaded_profile ?? raw.uploaded_by_profile, peopleById, 8);
  pushPersonSearchField(fields, "Updated by", asset.updated_by ?? raw.updated_by ?? raw.updater ?? raw.updated_profile ?? raw.updated_by_profile, peopleById, 7);
  pushPersonSearchField(fields, "Reviewer", raw.reviewer_ids ?? raw.reviewers ?? raw.reviewerIds ?? raw.review_assignments, peopleById, 8);
  pushSearchField(fields, "Project", raw.project_name ?? raw.project ?? asset.project_id, 5);
  pushSearchField(fields, "Project ID", asset.project_id, 2);
  pushSearchField(fields, "Folder path", folderPath === "/" ? "Workspace root" : folderPath, 7);
  folderParts.forEach((part) => pushSearchField(fields, "Folder", part, 6));
  pushSearchField(fields, "Storage path", raw.storage_path ?? asset.url, 3);
  pushSearchField(fields, "URL", asset.url, 2);
  pushSearchField(fields, "Description", asset.description ?? raw.description ?? raw.caption ?? raw.alt_text, 7);
  pushSearchField(fields, "Approval status", raw.approval_status ?? raw.review_status ?? raw.workflow_status, 6);
  pushSearchField(fields, "Usage rights", raw.usage_rights ?? raw.rights ?? raw.license ?? raw.license_status ?? raw.usage_restrictions, 6);

  for (const [label, value] of [
    ["Created", asset.createdAt ?? raw.created_at],
    ["Updated", asset.updated_at ?? raw.updated_at],
    ["Uploaded", raw.uploaded_at ?? asset.createdAt],
  ] as const) {
    pushSearchField(fields, label, value, 4);
    dateSearchVariants(value).forEach((variant) => pushSearchField(fields, label, variant, 4));
  }

  if (raw.width || raw.height) pushSearchField(fields, "Dimensions", `${raw.width ?? "?"} x ${raw.height ?? "?"}`, 4);
  pushSearchField(fields, "Width", raw.width, 3);
  pushSearchField(fields, "Height", raw.height, 3);
  pushSearchField(fields, "File size", raw.size_bytes ?? asset.sizeBytes, 2);

  const tagLikeKeys = ["tags", "labels", "keywords"];
  for (const key of tagLikeKeys) {
    const value = raw[key];
    if (Array.isArray(value)) value.forEach((entry) => pushSearchField(fields, key.replace(/_/g, " "), entry, 8));
    else pushSearchField(fields, key.replace(/_/g, " "), value, 8);
  }

  pushObjectFields(fields, raw.metadata, "Metadata", 6);
  pushObjectFields(fields, raw.custom_metadata, "Custom metadata", 6);
  pushObjectFields(fields, raw.extracted_metadata, "Extracted metadata", 5);
  pushObjectFields(fields, raw.content_metadata, "Content metadata", 5);
  pushObjectFields(fields, raw.ocr, "OCR", 5);
  pushObjectFields(fields, raw.transcript, "Transcript", 5);
  pushObjectFields(fields, raw, "Asset field", 1);

  const haystack = fields.map((field) => `${normalizeText(field.label)} ${field.normalized}`).join(" ");
  return { haystack, fields };
}

function getQueryTerms(query: string) {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

function scoreAssetSearch(index: AssetSearchIndex, query: string) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return 0;
  let score = 0;

  for (const term of terms) {
    let best = 0;
    for (const field of index.fields) {
      if (field.normalized === term) best = Math.max(best, 100 * field.weight);
      else if (field.normalized.startsWith(term)) best = Math.max(best, 80 * field.weight);
      else if (field.normalized.includes(term)) best = Math.max(best, 45 * field.weight);
      else if (normalizeText(field.label).includes(term)) best = Math.max(best, 20 * field.weight);
    }
    score += best;
  }

  return score;
}

function matchesAssetSearch(index: AssetSearchIndex, query: string) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return true;
  return terms.every((term) => index.haystack.includes(term));
}

function assetToCollectionAsset(asset: Asset): CollectionAsset {
  const raw = (asset as any).__raw ?? {};
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    project_id: asset.project_id ?? null,
    created_by: raw.created_by ?? null,
    uploaded_by: raw.uploaded_by ?? null,
    updated_by: raw.updated_by ?? null,
    description: asset.description ?? raw.description ?? null,
    tags: Array.isArray(asset.tags) ? asset.tags : Array.isArray(raw.tags) ? raw.tags : [],
    version_no: asset.version_no ?? null,
    parent_asset_id: asset.parent_asset_id ?? null,
    folder_id: asset.folder_id ?? null,
    sizeBytes: asset.sizeBytes ?? null,
    createdAt: asset.createdAt ?? raw.created_at ?? null,
    updatedAt: asset.updated_at ?? raw.updated_at ?? null,
    uploadedAt: raw.uploaded_at ?? asset.createdAt ?? null,
    coverUrl: asset.coverUrl ?? null,
    url: asset.url ?? null,
    status: asset.status ?? null,
    assigned_to: asset.assigned_to ?? null,
    comments_count: asset.comments_count ?? 0,
    __raw: raw,
  };
}

function assetSearchText(asset: Asset, foldersById: Map<string, FolderRow>, peopleById?: PeopleLookup) {
  return buildAssetSearchIndex(asset, foldersById, peopleById).haystack;
}

function getMatchDetails(asset: Asset, query: string, foldersById: Map<string, FolderRow>, index?: AssetSearchIndex, peopleById?: PeopleLookup): MatchDetail[] {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return [];
  const searchIndex = index ?? buildAssetSearchIndex(asset, foldersById, peopleById);
  const details: MatchDetail[] = [];

  for (const field of [...searchIndex.fields].sort((left, right) => right.weight - left.weight)) {
    const labelText = normalizeText(field.label);
    const matched = terms.some((term) => field.normalized.includes(term) || labelText.includes(term));
    if (!matched) continue;
    if (details.some((detail) => detail.label === field.label && detail.value === field.value)) continue;
    details.push({ label: field.label, value: field.value });
    if (details.length >= 5) break;
  }

  if (details.length === 0 && matchesAssetSearch(searchIndex, query)) {
    details.push({ label: "Indexed asset field", value: "Matched a workspace asset field" });
  }

  return details;
}

function matchReason(asset: Asset, query: string, foldersById: Map<string, FolderRow>, peopleById?: PeopleLookup) {
  const details = getMatchDetails(asset, query, foldersById, undefined, peopleById);
  if (details.length === 0) return null;
  return details.length === 1 ? `${details[0].label} match` : `${details.length} match fields`;
}

function matchSummary(details: MatchDetail[]) {
  if (details.length === 0) return null;
  const labels = Array.from(new Set(details.map((detail) => {
    const label = detail.label.toLowerCase();
    if (label.includes("name")) return "name";
    if (label.includes("folder") || label.includes("path")) return "path";
    if (label.includes("tag")) return "tag";
    if (label.includes("metadata")) return "metadata";
    if (label.includes("assignee") || label.includes("owner") || label.includes("reviewer") || label.includes(" by")) return "person";
    if (label.includes("type") || label.includes("extension")) return "type";
    if (label.includes("date") || label.includes("created") || label.includes("updated") || label.includes("uploaded")) return "date";
    return label;
  })));
  if (labels.length === 1) return `${labels[0].charAt(0).toUpperCase()}${labels[0].slice(1)} match`;
  return `${labels.length} matches`;
}

function sortAssets(assets: Asset[], sortKey: SortKey, sortDir: SortDir) {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...assets].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name) * direction;
    if (sortKey === "sizeBytes") return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * direction;
    if (sortKey === "status") {
      return ((STATUS_ORDER[toColumnKey(a.status)] ?? 0) - (STATUS_ORDER[toColumnKey(b.status)] ?? 0)) * direction;
    }
    const key = sortKey === "updatedAt" ? "updated_at" : "createdAt";
    const aTime = new Date((a as any)[key] ?? a.createdAt ?? 0).getTime() || 0;
    const bTime = new Date((b as any)[key] ?? b.createdAt ?? 0).getTime() || 0;
    return (aTime - bTime) * direction;
  });
}

function collectAssetPersonIds(asset: Asset) {
  const raw = (asset as any).__raw ?? {};
  const ids = new Set<string>();
  [
    (asset as any).created_by,
    (asset as any).uploaded_by,
    (asset as any).updated_by,
    asset.assigned_to,
    raw.created_by,
    raw.uploaded_by,
    raw.updated_by,
    raw.assigned_to,
    raw.assignee,
    raw.assigned_user,
    raw.assigned_profile,
    raw.owner,
    raw.owner_id,
    raw.owner_user,
    raw.owner_profile,
    raw.creator,
    raw.uploader,
    raw.updater,
    raw.created_profile,
    raw.uploaded_profile,
    raw.updated_profile,
    raw.created_by_profile,
    raw.uploaded_by_profile,
    raw.updated_by_profile,
    raw.reviewer_ids,
    raw.reviewerIds,
    raw.reviewers,
    raw.review_assignments,
  ].forEach((value) => extractPersonIdsFromValue(value, ids));
  return Array.from(ids);
}

export default function WorkspaceAssetSearchPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ColumnKey | "all">("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [assignFilter, setAssignFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [advancedFilters, setAdvancedFilters] = useState<CollectionFilter[]>([]);
  const [advancedFilterMatchMode, setAdvancedFilterMatchMode] = useState<"all" | "any">("all");
  const [peopleOptions, setPeopleOptions] = useState<CollectionFilterPersonOption[]>([]);
  const [selectedRootIds, setSelectedRootIds] = useState<string[]>([]);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareCollectionName, setShareCollectionName] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCollectionId, setShareCollectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadWorkspaceAssets() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data, error } = await invokeEdgeFunction<any>("asset", {
          body: { action: "list_library", workspace_id: workspaceId, limit: 1000 },
          signal: controller.signal,
        });
        if (error) throw error;
        const payload = data?.data ?? data ?? {};
        const rows = Array.isArray(payload.assets) ? payload.assets : [];
        const folderRows = Array.isArray(payload.folders) ? payload.folders : [];
        if (!cancelled) {
          setAssets(normalizeAssets(rows) as Asset[]);
          setFolders(folderRows as FolderRow[]);
        }
      } catch (error: any) {
        if (cancelled || error?.name === "AbortError") return;
        setLoadError(error?.message || "Unable to load workspace assets.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadWorkspaceAssets();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId]);

  const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const collectionAssets = useMemo(() => assets.map(assetToCollectionAsset), [assets]);
  const stacksMap = useMemo(() => groupByRoot(assets), [assets]);
  const peopleById = useMemo(() => new Map(peopleOptions.map((person) => [person.value, person])), [peopleOptions]);
  const orgMembers = useMemo(
    () =>
      peopleOptions.map((person) => ({
        user_id: person.value,
        role: person.role ?? "member",
        profile: {
          id: person.value,
          display_name: person.label,
          avatar_url: person.avatarUrl,
        },
      })),
    [peopleOptions],
  );
  const assetSearchIndex = useMemo(() => {
    const next = new Map<string, AssetSearchIndex>();
    assets.forEach((asset) => {
      next.set(asset.id, buildAssetSearchIndex(asset, foldersById, peopleById));
    });
    return next;
  }, [assets, foldersById, peopleById]);

  useEffect(() => {
    const userIds = Array.from(new Set(assets.flatMap(collectAssetPersonIds)));
    if (userIds.length === 0) {
      setPeopleOptions([]);
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
          console.error("Failed to load workspace asset people for search", error);
        }

        const profilesById = new Map((data ?? []).map((profile: any) => [String(profile.id), profile]));
        const next = userIds.map((id) => {
          const profile: any = profilesById.get(id);
          const label = String(profile?.display_name ?? "").trim() || `Member ${id.slice(0, 8)}`;
          return {
            value: id,
            label,
            avatarUrl: profile?.avatar_url ?? null,
            keywords: [label, id].filter(Boolean).join(" "),
            role: null,
          } satisfies CollectionFilterPersonOption;
        });

        setPeopleOptions(next.sort((left, right) => left.label.localeCompare(right.label)));
      });

    return () => {
      mounted = false;
    };
  }, [assets]);

  const availableKinds = useMemo(() => {
    const kinds = new Set<string>();
    assets.forEach((asset) => kinds.add(mimeKind(asset.type)));
    return Array.from(kinds).sort();
  }, [assets]);

  const workspaceProjects = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    assets.forEach((asset) => {
      if (!asset.project_id) return;
      const raw = (asset as any).__raw ?? {};
      byId.set(asset.project_id, {
        id: asset.project_id,
        name: String(raw.project_name || raw.project?.name || `Project ${asset.project_id.slice(0, 8)}`),
      });
    });
    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [assets]);

  const activeAdvancedFilters = useMemo(() => {
    return advancedFilters.filter((filter) => {
      if (filter.operator === "is_empty" || filter.operator === "is_not_empty") return true;
      if (["today", "yesterday", "last_7_days", "last_30_days", "this_month"].includes(filter.operator)) return true;
      if (Array.isArray(filter.value)) return filter.value.length > 0;
      return String(filter.value ?? "").trim().length > 0;
    });
  }, [advancedFilters]);

  const filteredAssets = useMemo(() => {
    const byId = new Map(collectionAssets.map((asset) => [asset.id, asset]));
    const filtered = assets.filter((asset) => {
      const index = assetSearchIndex.get(asset.id) ?? buildAssetSearchIndex(asset, foldersById, peopleById);
      if (!matchesAssetSearch(index, assetSearch)) return false;
      if (statusFilter !== "all" && toColumnKey(asset.status) !== statusFilter) return false;
      if (kindFilter !== "all" && mimeKind(asset.type) !== kindFilter) return false;
      if (assignFilter === "unassigned" && asset.assigned_to) return false;
      if (assignFilter !== "all" && assignFilter !== "unassigned" && asset.assigned_to !== assignFilter) return false;

      if (activeAdvancedFilters.length > 0) {
        const collectionAsset = byId.get(asset.id) ?? assetToCollectionAsset(asset);
        const row = {
          rootId: rootIdOf(asset),
          asset: collectionAsset,
          versionCount: stacksMap.get(rootIdOf(asset))?.length ?? 1,
        };
        const matcher = (filter: CollectionFilter) => matchesCollectionFilter(row, filter);
        if (advancedFilterMatchMode === "all" && !activeAdvancedFilters.every(matcher)) return false;
        if (advancedFilterMatchMode === "any" && !activeAdvancedFilters.some(matcher)) return false;
      }

      return true;
    });

    const query = assetSearch.trim();
    if (query && sortKey === "updatedAt" && sortDir === "desc") {
      return [...filtered].sort((left, right) => {
        const leftScore = scoreAssetSearch(assetSearchIndex.get(left.id) ?? buildAssetSearchIndex(left, foldersById, peopleById), query);
        const rightScore = scoreAssetSearch(assetSearchIndex.get(right.id) ?? buildAssetSearchIndex(right, foldersById, peopleById), query);
        if (leftScore !== rightScore) return rightScore - leftScore;
        const leftTime = new Date(left.updated_at ?? left.createdAt ?? 0).getTime() || 0;
        const rightTime = new Date(right.updated_at ?? right.createdAt ?? 0).getTime() || 0;
        return rightTime - leftTime;
      });
    }

    return sortAssets(filtered, sortKey, sortDir);
  }, [
    advancedFilterMatchMode,
    activeAdvancedFilters,
    assetSearch,
    assetSearchIndex,
    assets,
    assignFilter,
    collectionAssets,
    foldersById,
    kindFilter,
    peopleById,
    sortDir,
    sortKey,
    stacksMap,
    statusFilter,
  ]);

  const resultStacks = useMemo(() => Array.from(groupByRoot(filteredAssets).values()), [filteredAssets]);
  const rootAssets = useMemo(() => resultStacks.map((stack) => stack[0]).filter(Boolean), [resultStacks]);
  const resultRootIds = useMemo(
    () => Array.from(new Set(rootAssets.map((asset) => rootIdOf(asset)))),
    [rootAssets],
  );
  const selectedRootSet = useMemo(() => new Set(selectedRootIds), [selectedRootIds]);
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedRootSet.has(rootIdOf(asset))),
    [assets, selectedRootSet],
  );
  const selectedRootCount = selectedRootIds.length;
  const selectionMode = selectedRootCount > 0;

  const searchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const query = normalizeText(assetSearch);
    if (!query) return [];
    const suggestions: SearchSuggestion[] = [];
    const seen = new Set<string>();
    const add = (group: SearchSuggestion["group"], value: string, label = value) => {
      const clean = String(value ?? "").trim();
      if (!clean) return;
      const key = `${group}:${clean.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      suggestions.push({ group, value: clean, label: highlightMatch(label, assetSearch) });
    };

    folders.forEach((folder) => {
      const path = formatRelativeFolderPath(folder.id, foldersById);
      if (normalizeText(`${folder.name} ${path}`).includes(query)) add("Folders", folder.name);
    });
    assets.forEach((asset) => {
      if (normalizeText(asset.name).includes(query)) add("Assets", asset.name);
      const kind = mimeKind(asset.type);
      if (normalizeText(kind).includes(query) || normalizeText(asset.type).includes(query)) add("Types", kind);

      const index = assetSearchIndex.get(asset.id);
      index?.fields.forEach((field) => {
        if (!field.normalized.includes(query) && !normalizeText(field.label).includes(query)) return;
        if (field.label.includes("by") || ["Assignee", "Owner", "Reviewer"].some((label) => field.label.startsWith(label))) {
          add("People", field.value);
        } else if (field.label.includes("MIME") || field.label.includes("type") || field.label.includes("extension")) {
          add("Types", field.value);
        } else if (field.label !== "Name") {
          add("Metadata", field.value);
        }
      });
    });

    return suggestions.slice(0, 16);
  }, [assetSearch, assetSearchIndex, assets, folders, foldersById]);

  const clearFilters = () => {
    setAssetSearch("");
    setStatusFilter("all");
    setKindFilter("all");
    setAssignFilter("all");
    setSortKey("updatedAt");
    setSortDir("desc");
    setAdvancedFilters([]);
    setAdvancedFilterMatchMode("all");
    setSelectedRootIds([]);
  };

  const handleStatusChange = async (id: string, status: any) => {
    const previous = assets;
    setAssets((current) => current.map((asset) => (asset.id === id ? { ...asset, status } : asset)));
    const result = await changeAssetStatus(id, status);
    if (result.error) {
      setAssets(previous);
      toast.error("Could not update asset status.");
    }
  };

  const handleDownload = (asset: Asset) => {
    if (!asset.url) {
      toast.error("This asset does not have a downloadable file URL.");
      return;
    }
    void downloadFile(asset.url, sanitizeDownloadName(asset.name || "asset"));
  };

  const makeArchiveEntryPath = (asset: Asset) => {
    const raw = (asset as any).__raw ?? {};
    const projectLabel = raw.project_name ? sanitizeDownloadName(String(raw.project_name)) : asset.project_id ? `Project ${String(asset.project_id).slice(0, 8)}` : "Workspace";
    const folderParts = folderPathParts(asset.folder_id ?? null, foldersById)
      .map((part) => sanitizeDownloadName(part))
      .filter(Boolean);
    const fileLabel = sanitizeDownloadName(asset.name || "asset") || "asset";
    return [projectLabel, ...folderParts, fileLabel].filter(Boolean).join("/");
  };

  const downloadAssetArchive = async (scopeAssets: Asset[], options: { label: string; archiveName: string }) => {
    const downloadable = scopeAssets
      .map((asset) => ({ asset, url: resolveDownloadUrl(asset) }))
      .filter((row): row is { asset: Asset; url: string } => Boolean(row.url));

    if (downloadable.length === 0) {
      toast.info(`No downloadable assets found in ${options.label}.`);
      return;
    }

    const usedPaths = new Map<string, number>();
    const entries = downloadable.map(({ asset, url }) => {
      const rawPath = makeArchiveEntryPath(asset);
      const key = rawPath.toLowerCase();
      const seen = usedPaths.get(key) ?? 0;
      usedPaths.set(key, seen + 1);
      return { path: appendDuplicateSuffix(rawPath, seen), url };
    });

    await downloadZipArchive(entries, options.archiveName, { label: options.label });
  };

  const assetsForRootIds = (rootIds: string[]) => {
    const allowed = new Set(rootIds);
    return assets.filter((asset) => allowed.has(rootIdOf(asset)));
  };

  const toggleRootSelection = (rootId: string, selected: boolean) => {
    setSelectedRootIds((current) => {
      if (selected) return current.includes(rootId) ? current : [...current, rootId];
      return current.filter((id) => id !== rootId);
    });
  };

  const selectAllResults = () => {
    setSelectedRootIds(resultRootIds);
  };

  const clearSelection = () => {
    setSelectedRootIds([]);
  };

  const handleDownloadResults = async () => {
    if (resultRootIds.length === 0) return;
    setRunningAction("download-results");
    try {
      await downloadAssetArchive(assetsForRootIds(resultRootIds), {
        label: "current search results",
        archiveName: `workspace-search-results.zip`,
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleDownloadSelection = async () => {
    if (selectedRootIds.length === 0) return;
    setRunningAction("download-selection");
    try {
      await downloadAssetArchive(selectedAssets, {
        label: "selected assets",
        archiveName: `workspace-search-selection.zip`,
      });
    } finally {
      setRunningAction(null);
    }
  };

  const openCreateProjectDialog = () => {
    if (selectedRootIds.length === 0) return;
    setProjectName(`Search selection - ${new Date().toLocaleDateString()}`);
    setProjectDialogOpen(true);
  };

  const handleCreateProjectFromSelection = async () => {
    if (!workspaceId || selectedRootIds.length === 0) return;
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      toast.error("Enter a project name.");
      return;
    }

    setRunningAction("create-project");
    try {
      const response = await createProject({ name: trimmedName, workspaceId });
      if (!response.ok) throw new Error("Failed to create project.");
      const payload = await response.json().catch(() => null);
      const projectId = payload?.data?.id;
      if (!projectId) throw new Error("Project was created but no id was returned.");

      let attached = 0;
      for (const rootId of selectedRootIds) {
        const { error } = await invokeEdgeFunction("asset", {
          body: {
            action: "attach_project",
            project_id: projectId,
            asset_id: rootId,
          },
        });
        if (error) throw error;
        attached += 1;
      }

      window.dispatchEvent(new CustomEvent("projects:changed", {
        detail: { workspaceId, projectId, action: "created" },
      }));
      setProjectDialogOpen(false);
      setSelectedRootIds([]);
      toast.success(`Created project with ${attached} asset stack${attached === 1 ? "" : "s"}.`);
      navigate(`/workspace/${workspaceId}/projects/${projectId}`);
    } catch (error) {
      console.error("Failed to create project from DAM selection", error);
      toast.error(error instanceof Error ? error.message : "Failed to create project from selection.");
    } finally {
      setRunningAction(null);
    }
  };

  const openShareDialog = () => {
    if (selectedRootIds.length === 0) return;
    setShareCollectionName(`Shared DAM selection - ${new Date().toLocaleDateString()}`);
    setShareUrl(null);
    setShareCollectionId(null);
    setShareDialogOpen(true);
  };

  const handleCreateShareLink = async () => {
    if (!workspaceId || selectedRootIds.length === 0) return;
    const trimmedName = shareCollectionName.trim() || "Shared DAM selection";

    setRunningAction("share-selection");
    try {
      const { data: collectionData, error: collectionError } = await invokeEdgeFunction<{ data?: any }>("collections", {
        body: {
          action: "create",
          workspace_id: workspaceId,
          name: trimmedName,
          source_type: "workspace_root",
          filters: [{
            id: crypto.randomUUID(),
            field: "root_id",
            operator: "in",
            value: selectedRootIds,
          }],
          visible_fields: ["status", "file_extension", "folder", "uploaded_at", "size_bytes"],
          sort_key: "updated_at",
          sort_dir: "desc",
        },
      });
      if (collectionError || !collectionData?.data?.id) {
        throw new Error(collectionError?.message || "Failed to create collection.");
      }

      const collectionId = collectionData.data.id;
      const { data: shareData, error: shareError } = await invokeEdgeFunction<{ data?: any }>("share", {
        body: {
          action: "create-collection-share-link",
          collection_id: collectionId,
          allow_download: true,
          allow_comments: true,
        },
      });
      const nextShareUrl = shareData?.data?.share_url;
      if (shareError || !nextShareUrl) {
        throw new Error(shareError?.message || "Failed to create share link.");
      }

      setShareCollectionId(collectionId);
      setShareUrl(nextShareUrl);
      window.dispatchEvent(new CustomEvent("collections:changed", { detail: { workspaceId } }));
      await navigator.clipboard?.writeText(nextShareUrl).catch(() => undefined);
      toast.success("Collection share link is ready.");
    } catch (error) {
      console.error("Failed to share DAM selection", error);
      toast.error(error instanceof Error ? error.message : "Failed to share selected assets.");
    } finally {
      setRunningAction(null);
    }
  };

  const openAsset = (asset: Asset) => {
    const folderTrail = folderTrailRows(asset.folder_id ?? null, foldersById).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parent_folder_id: folder.parent_folder_id ?? null,
      project_id: folder.project_id ?? null,
    }));
    if (asset.project_id) {
      navigate(`/workspace/${workspaceId}/projects/${asset.project_id}/assets/${asset.id}`, { state: { asset, folderTrail } });
      return;
    }
    navigate(`/workspace/${workspaceId}/assets/${asset.id}`, { state: { asset, folderTrail } });
  };

  const openCompare = (asset: Asset) => {
    const rootId = rootIdOf(asset);
    if (asset.project_id) {
      navigate(`/workspace/${workspaceId}/projects/${asset.project_id}/assets/${rootId}/compare`);
      return;
    }
    navigate(`/workspace/${workspaceId}/assets/${rootId}/compare`);
  };

  const filteredTotalSize = useMemo(() => rootAssets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0), [rootAssets]);
  const totalFormats = availableKinds.length;
  const query = assetSearch.trim();

  return (
    <div className="flex min-h-screen w-full bg-background">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Digital Asset Search</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <section className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border bg-[radial-gradient(circle_at_12%_20%,rgba(14,165,233,0.12),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.04),rgba(248,250,252,0))] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-2">
                <Badge variant="outline" className="w-fit gap-1.5 rounded-full bg-background/70">
                  <Sparkles className="h-3.5 w-3.5" />
                  Workspace DAM
                </Badge>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Search every asset in this workspace</h1>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Find assets by name, type, folder path, status, dates, tags, metadata, and version stacks from one focused DAM search surface.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm lg:min-w-[360px]">
                <div className="rounded-xl border bg-background/75 p-2.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Database className="h-4 w-4" />
                    Assets
                  </div>
                  <div className="mt-1 text-lg font-semibold">{assets.length}</div>
                </div>
                <div className="rounded-xl border bg-background/75 p-2.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    Folders
                  </div>
                  <div className="mt-1 text-lg font-semibold">{folders.length}</div>
                </div>
                <div className="rounded-xl border bg-background/75 p-2.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Search className="h-4 w-4" />
                    Formats
                  </div>
                  <div className="mt-1 text-lg font-semibold">{totalFormats}</div>
                </div>
              </div>
            </div>
          </div>

          <CampaignFilters
            assetSearch={assetSearch}
            setAssetSearch={setAssetSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            kindFilter={kindFilter}
            setKindFilter={setKindFilter}
            assignFilter={assignFilter}
            setAssignFilter={setAssignFilter}
            sortKey={sortKey}
            setSortKey={setSortKey}
            sortDir={sortDir}
            setSortDir={setSortDir}
            clearFilters={clearFilters}
            availableKinds={availableKinds}
            orgMembers={orgMembers}
            filteredCount={filteredAssets.length}
            workspaceId={String(workspaceId)}
            projectId=""
            onUpload={() => undefined}
            onInvite={() => undefined}
            advancedFilters={advancedFilters}
            setAdvancedFilters={setAdvancedFilters}
            advancedFilterMatchMode={advancedFilterMatchMode}
            setAdvancedFilterMatchMode={setAdvancedFilterMatchMode}
            workspaceProjects={workspaceProjects}
            projectFolders={folders}
            projectAssets={collectionAssets}
            people={peopleOptions}
            showScope={false}
            searchPlaceholderOverride="Search workspace assets"
            helperText="Search names, people, formats, paths, status, tags, metadata, usage rights, OCR, transcripts, and dates across this workspace."
            searchSuggestions={searchSuggestions}
            defaultSortKey="updatedAt"
            defaultSortDir="desc"
            selectionMode={selectionMode}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
            <div className="min-w-0 text-sm text-muted-foreground">
              {selectionMode ? (
                <>
                  <span className="font-semibold text-foreground">{selectedRootCount}</span> asset stack{selectedRootCount === 1 ? "" : "s"} selected
                </>
              ) : query ? (
                <>
                  <span className="font-semibold text-foreground">{rootAssets.length}</span> result{rootAssets.length === 1 ? "" : "s"} for{" "}
                  <span className="font-semibold text-foreground">“{query}”</span>
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{rootAssets.length}</span> workspace asset stack{rootAssets.length === 1 ? "" : "s"}
                </>
              )}
              {rootAssets.length > 0 ? (
                <span> · {formatBytes(filteredTotalSize) ?? "Unknown size"} total</span>
              ) : null}
              {rootAssets.length !== filteredAssets.length ? (
                <span> · {filteredAssets.length} versions</span>
              ) : null}
            </div>
            {selectionMode ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadSelection()}
                  disabled={runningAction !== null}
                >
                  {runningAction === "download-selection" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Download selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCreateProjectDialog}
                  disabled={runningAction !== null}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Create project
                </Button>
                <Button
                  size="sm"
                  onClick={openShareDialog}
                  disabled={runningAction !== null}
                >
                  <Share2 className="mr-2 h-4 w-4" />
                  Share selection
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllResults}
                  disabled={resultRootIds.length === 0}
                >
                  <CheckSquare2 className="mr-2 h-4 w-4" />
                  Select all {resultRootIds.length}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadResults()}
                  disabled={resultRootIds.length === 0 || runningAction !== null}
                >
                  {runningAction === "download-results" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Download matching assets
                </Button>
              </div>
            )}
          </div>

          {loadError ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{loadError}</div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading workspace assets...
              </div>
            </div>
          ) : rootAssets.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
              <Search className="h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-semibold">
                {query ? `No assets found for “${query}”` : "No workspace assets found"}
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {query || statusFilter !== "all" || kindFilter !== "all" || advancedFilters.length > 0
                  ? "Try clearing search terms or filters. DAM search only shows assets available in this workspace."
                  : "Assets uploaded to this workspace will appear here for search and filtering."}
              </p>
              {(query || statusFilter !== "all" || kindFilter !== "all" || advancedFilters.length > 0) ? (
                <Button variant="outline" className="mt-4" onClick={clearFilters}>
                  Clear search and filters
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {resultStacks.map((stack) => {
                const top = stack[0];
                const rootId = rootIdOf(top);
                const path = formatRelativeFolderPath(top.folder_id ?? null, foldersById);
                const size = formatBytes(top.sizeBytes);
                const matchDetails = getMatchDetails(top, assetSearch, foldersById, assetSearchIndex.get(top.id));
                const compactMatchSummary = matchSummary(matchDetails);
                return (
                  <AssetCard
                    key={rootId}
                    asset={top}
                    onStatusChange={handleStatusChange}
                    onClick={() => openAsset(top)}
                    onEdit={() => openAsset(top)}
                    onDownload={handleDownload}
                    onCompare={openCompare}
                    stackCount={stack.length}
                    sortKey={sortKey}
                    subtitleContent={(
                      <div className="space-y-1">
                        {path !== "/" ? (
                          <div className="truncate" title={path}>{highlightMatch(path, assetSearch)}</div>
                        ) : null}
                        <div className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                          {mimeKind(top.type)}{size ? ` · ${size}` : ""}
                        </div>
                      </div>
                    )}
                    titleContent={highlightMatch(top.name, assetSearch)}
                    matchReason={compactMatchSummary}
                    selectable
                    selectionMode={selectionMode}
                    selected={selectedRootSet.has(rootId)}
                    onSelectedChange={(selected) => toggleRootSelection(rootId, selected)}
                    selectionAriaLabel={`Select ${top.name}`}
                  />
                );
              })}
            </div>
          )}
        </section>

        <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create project from selection</DialogTitle>
              <DialogDescription>
                A new project will be created and the selected asset stacks will be linked into it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="dam-project-name">Project name</Label>
              <Input
                id="dam-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Launch asset shortlist"
              />
              <p className="text-xs text-muted-foreground">
                {selectedRootCount} asset stack{selectedRootCount === 1 ? "" : "s"} will be added.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProjectDialogOpen(false)} disabled={runningAction === "create-project"}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateProjectFromSelection()} disabled={runningAction === "create-project"}>
                {runningAction === "create-project" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderPlus className="mr-2 h-4 w-4" />}
                Create project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Share selected assets</DialogTitle>
              <DialogDescription>
                This creates a collection containing exactly the selected asset stacks, then prepares a share link.
              </DialogDescription>
            </DialogHeader>
            {shareUrl ? (
              <div className="space-y-3">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Share link</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input value={shareUrl} readOnly className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        void navigator.clipboard?.writeText(shareUrl);
                        toast.success("Share link copied");
                      }}
                      aria-label="Copy share link"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={shareUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open share link
                    </a>
                  </Button>
                  {shareCollectionId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/workspace/${workspaceId}/collections/${shareCollectionId}`)}
                    >
                      Open collection
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="dam-share-collection-name">Collection name</Label>
                <Input
                  id="dam-share-collection-name"
                  value={shareCollectionName}
                  onChange={(event) => setShareCollectionName(event.target.value)}
                  placeholder="Shared DAM selection"
                />
                <p className="text-xs text-muted-foreground">
                  {selectedRootCount} asset stack{selectedRootCount === 1 ? "" : "s"} will be saved into this share collection.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShareDialogOpen(false)} disabled={runningAction === "share-selection"}>
                {shareUrl ? "Close" : "Cancel"}
              </Button>
              {!shareUrl ? (
                <Button onClick={() => void handleCreateShareLink()} disabled={runningAction === "share-selection"}>
                  {runningAction === "share-selection" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
                  Create share link
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

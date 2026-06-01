"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderActionsMenu } from "@/components/folders/FolderActionsMenu";
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
import { useFileUpload } from "@/hooks/useFileUpload";
import { Upload } from "lucide-react"; // Import Upload icon directly
import { ACCEPT, getFilesFromEvent } from "@/components/file-upload-utils";
import { changeAssetStatus, cn } from "@/lib/utils";
import { downloadZipArchive } from "@/lib/downloadArchive";
import { Project } from "@/types/interfaces";
import { getSessionToken, supabase } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { updateAsset } from "@/api";
import { toast } from "sonner";
import {
  MailPlus,
  Mail,
  Trash,
  Users,
  Link2,
  LayoutGrid,
  Eye,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Globe,
  Loader2,
  Download,
  Pencil,
  Plus,
  ArrowRightLeft,
  Check,
  CopyPlus,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

import KanbanBoard from "./components/KanbanBoard";
import { Asset, AssetStatus, ColumnKey, STATUS_STYLES, toColumnKey } from "./CampaignTypes";
import ProjectShareLinks from "./components/ProjectShareLinks";
import {
  buildRecursiveFolderAssetCounts,
  mimeKind as utilMimeKind,
  rootIdOf as utilRootIdOf,
  groupByRoot as utilGroupByRoot,
  normalizeAssets as utilNormalizeAssets,
  STATUS_ORDER as UTIL_STATUS_ORDER,
  nextVersionForRootFromMap,
} from "@/lib/assetUtils";
import {
  CollectionFilterPopover,
  type CollectionFilterPersonOption,
} from "@/pages/Collections/components/CollectionFilterPopover";
import {
  type CollectionAsset,
  type CollectionFilter,
  matchesCollectionFilter,
} from "@/lib/collections";
import InviteReviewersDialog from "./InviteReviewersDialog";
import { InviteOrgMemberDialog } from "@/components/team/InviteOrgMemberDialog";
import CampaignFilters from "./components/CampaignFilters";
import AssetCard from "./components/AssetCard";
import VersionStacksGrid from "./components/VersionStacksGrid";
import { UploadProgressCard } from "@/components/upload/UploadProgressCard";
// NOTE: select and version stack UI moved to smaller components in ./components/

// ⬇️ dnd-kit (we only need sensors + DragEndEvent type here)
import {
  useSensors,
  useSensor,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  DragEndEvent,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { updateProject } from "@/api/project";
import { refreshAssetUntilCoverReady } from "@/api/assets";
import { motion, AnimatePresence } from "framer-motion";
// CSS not needed here

/* =========================
   Types
   ========================= */
type SortKey = "none" | "createdAt" | "updatedAt" | "name" | "sizeBytes" | "status";
type SortDir = "asc" | "desc";
type SearchScope = "project" | "branch" | "folder";
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
type BulkProjectActionMode = "move" | "copy";
type ProjectOption = {
  id: string;
  name: string;
  status?: string | null;
  created_at?: string | null;
};
type DestinationFolderDraftTarget = {
  projectId: string;
  parentFolderId: string | null;
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
type ProjectReviewer = {
  type?: "member" | "guest";
  user_id?: string | null;
  role?: string;
  email?: string | null;
  comment_count?: number;
  asset_ids?: string[];
  last_seen_at?: string | null;
  profile?: { id?: string; display_name?: string | null; avatar_url?: string | null };
};

/* =========================
   Kanban column styles
   ========================= */
// use shared COLUMN_STYLE from `CampaignTypes`

/* Helpers */
const mimeKind = utilMimeKind;
const STATUS_ORDER: Record<ColumnKey, number> = UTIL_STATUS_ORDER as any;

/* ===== Versioning helpers (inline; feel free to move to @/lib/utils) ===== */
const rootIdOf = utilRootIdOf;
const groupByRoot = utilGroupByRoot;

/* ===== Normalization: adapt server/supabase snake_case rows to the component's expected shape ===== */
const normalizeAssets = utilNormalizeAssets;

function projectAssetToCollectionAsset(asset: Asset): CollectionAsset {
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

function normalizeIdList(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function assetIncludesReviewer(asset: Asset, reviewerId: string | null | undefined) {
  if (!reviewerId) return false;
  const raw = (asset as any).__raw ?? {};
  const ids = [
    asset.assigned_to,
    raw.assigned_to,
    ...normalizeIdList(raw.reviewer_ids),
    ...normalizeIdList(raw.reviewerIds),
    ...normalizeIdList(raw.reviewers),
    ...normalizeIdList(raw.review_assignments),
  ].filter(Boolean).map((entry) => String(entry));
  return ids.includes(String(reviewerId));
}

function assetStatusLabel(status: Asset["status"]) {
  const key = toColumnKey(status as string | null);
  return key === "none" ? "No status" : STATUS_STYLES[key]?.label ?? "Review";
}

function sameFolderRows(a: FolderRow[] | undefined, b: FolderRow[] | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const lf = left[index];
    const rf = right[index];
    if (
      lf.id !== rf.id ||
      lf.name !== rf.name ||
      (lf.parent_folder_id ?? null) !== (rf.parent_folder_id ?? null) ||
      (lf.project_id ?? null) !== (rf.project_id ?? null) ||
      (lf.sort_order ?? 0) !== (rf.sort_order ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

function sameStringList(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function sameTrail(
  a: Array<{ id: string; name: string }>,
  b: Array<{ id: string; name: string }>,
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].id !== b[index].id || a[index].name !== b[index].name) {
      return false;
    }
  }
  return true;
}

function collectFolderIds(folderId: string, folders: FolderRow[]) {
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

function folderPathParts(folderId: string | null | undefined, foldersById: Map<string, FolderRow>) {
  const parts: string[] = [];
  let cursor = folderId ?? null;
  while (cursor) {
    const folder = foldersById.get(cursor);
    if (!folder) break;
    parts.unshift(folder.name);
    cursor = folder.parent_folder_id ?? null;
  }
  return parts;
}

function folderSearchText(folder: FolderRow, foldersById: Map<string, FolderRow>) {
  return normalizeSearchText([folder.name, folderPathParts(folder.id, foldersById).join(" / ")].join(" "));
}

function sanitizeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, " - ").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: unknown) {
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

function matchScore(texts: Array<string | null | undefined>, query: string) {
  if (!query) return 0;
  const q = query.trim().toLowerCase();
  let score = 0;
  for (const raw of texts) {
    const text = normalizeSearchText(raw);
    if (!text) continue;
    if (text === q) score = Math.max(score, 100);
    else if (text.startsWith(q)) score = Math.max(score, 90);
    else if (text.includes(q)) score = Math.max(score, 70);
  }
  return score;
}

function stringifySearchValue(value: unknown) {
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

    for (const key of ["id", "user_id", "userId", "profile_id", "profileId", "display_name", "full_name", "name", "email", "role", "username"]) {
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

function pushSearchField(fields: SearchIndexField[], label: string, value: unknown, weight = 1) {
  const rendered = stringifySearchValue(value).trim();
  if (!rendered) return;
  const normalized = normalizeSearchText(rendered);
  if (!normalized) return;
  fields.push({ label, value: rendered, normalized, weight });
}

function pushPersonSearchField(fields: SearchIndexField[], label: string, value: unknown, peopleById: PeopleLookup, weight = 8) {
  extractPersonSearchValues(value, peopleById).forEach((entry) => {
    pushSearchField(fields, isUuidLike(entry) ? `${label} ID` : label, entry, isUuidLike(entry) ? Math.max(2, weight - 4) : weight);
  });
}

function pushObjectFields(fields: SearchIndexField[], value: unknown, labelPrefix: string, weight = 1, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (entry && typeof entry === "object") pushObjectFields(fields, entry, `${labelPrefix} ${index + 1}`, weight, depth + 1);
      else pushSearchField(fields, labelPrefix, entry, weight);
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

function assetStatusSearchLabel(status: unknown) {
  const value = String(status ?? "").trim();
  if (!value) return "No status";
  return value.replace(/[_-]+/g, " ");
}

function getQueryTerms(query: string) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function buildAssetSearchIndex(asset: Asset, foldersById: Map<string, FolderRow>, peopleById: PeopleLookup = new Map()): AssetSearchIndex {
  const raw = (asset as any).__raw ?? {};
  const fields: SearchIndexField[] = [];
  const folderPath = formatRelativeFolderPath(asset.folder_id ? foldersById.get(asset.folder_id) : null, foldersById);
  const folderParts = folderPathParts(asset.folder_id ?? null, foldersById);
  const extension = String(asset.name || "").includes(".") ? String(asset.name).split(".").pop() : "";
  const rootId = rootIdOf(asset);

  pushSearchField(fields, "Name", asset.name, 12);
  pushSearchField(fields, "Asset ID", asset.id, 2);
  pushSearchField(fields, "Asset stack", rootId, 2);
  pushSearchField(fields, "File extension", extension, 5);
  pushSearchField(fields, "MIME type", asset.type, 5);
  pushSearchField(fields, "File type", mimeKind(asset.type), 6);
  pushSearchField(fields, "Status", assetStatusSearchLabel(asset.status), 5);
  pushPersonSearchField(fields, "Assignee", asset.assigned_to ?? raw.assigned_to ?? raw.assignee ?? raw.assigned_user ?? raw.assigned_profile, peopleById, 9);
  pushPersonSearchField(fields, "Owner", raw.owner ?? raw.owner_id ?? raw.owner_user ?? raw.owner_profile, peopleById, 8);
  pushPersonSearchField(fields, "Created by", raw.created_by ?? raw.creator ?? raw.created_profile ?? raw.created_by_profile, peopleById, 8);
  pushPersonSearchField(fields, "Uploaded by", raw.uploaded_by ?? raw.uploader ?? raw.uploaded_profile ?? raw.uploaded_by_profile, peopleById, 8);
  pushPersonSearchField(fields, "Updated by", raw.updated_by ?? raw.updater ?? raw.updated_profile ?? raw.updated_by_profile, peopleById, 7);
  pushPersonSearchField(fields, "Reviewer", raw.reviewer_ids ?? raw.reviewers ?? raw.reviewerIds ?? raw.review_assignments, peopleById, 8);
  pushSearchField(fields, "Project", raw.project_name ?? raw.project ?? asset.project_id, 5);
  pushSearchField(fields, "Project ID", asset.project_id, 2);
  pushSearchField(fields, "Folder path", folderPath === "/" ? "Project root" : folderPath, 7);
  folderParts.forEach((part) => pushSearchField(fields, "Folder", part, 6));
  pushSearchField(fields, "Storage path", raw.storage_path ?? asset.url, 3);
  pushSearchField(fields, "URL", asset.url, 2);
  pushSearchField(fields, "Description", asset.description ?? raw.description ?? raw.caption ?? raw.alt_text, 7);
  pushSearchField(fields, "Approval status", raw.approval_status ?? raw.review_status ?? raw.workflow_status, 6);
  pushSearchField(fields, "Usage rights", raw.usage_rights ?? raw.rights ?? raw.license ?? raw.license_status ?? raw.usage_restrictions, 6);

  for (const [label, value] of [
    ["Created", asset.createdAt ?? raw.created_at],
    ["Updated", asset.updatedAt ?? raw.updated_at],
    ["Uploaded", raw.uploaded_at ?? asset.createdAt],
  ] as const) {
    pushSearchField(fields, label, value, 4);
    dateSearchVariants(value).forEach((variant) => pushSearchField(fields, label, variant, 4));
  }

  if (raw.width || raw.height) pushSearchField(fields, "Dimensions", `${raw.width ?? "?"} x ${raw.height ?? "?"}`, 4);
  pushSearchField(fields, "Width", raw.width, 3);
  pushSearchField(fields, "Height", raw.height, 3);
  pushSearchField(fields, "File size", raw.size_bytes ?? asset.sizeBytes, 2);

  for (const key of ["tags", "labels", "keywords"]) {
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

  const haystack = fields.map((field) => `${normalizeSearchText(field.label)} ${field.normalized}`).join(" ");
  return { haystack, fields };
}

function matchesAssetSearch(index: AssetSearchIndex, query: string) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return true;
  return terms.every((term) => index.haystack.includes(term));
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
      else if (normalizeSearchText(field.label).includes(term)) best = Math.max(best, 20 * field.weight);
    }
    score += best;
  }
  return score;
}

function getAssetMatchDetails(asset: Asset, query: string, foldersById: Map<string, FolderRow>, index?: AssetSearchIndex, peopleById?: PeopleLookup) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return [];
  const searchIndex = index ?? buildAssetSearchIndex(asset, foldersById, peopleById);
  const details: Array<{ label: string; value: string }> = [];

  for (const field of [...searchIndex.fields].sort((left, right) => right.weight - left.weight)) {
    const labelText = normalizeSearchText(field.label);
    const matched = terms.some((term) => field.normalized.includes(term) || labelText.includes(term));
    if (!matched) continue;
    if (details.some((detail) => detail.label === field.label && detail.value === field.value)) continue;
    details.push({ label: field.label, value: field.value });
    if (details.length >= 5) break;
  }

  return details;
}

function matchSummary(details: Array<{ label: string; value: string }>) {
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

function formatProjectFolderPath(folder: FolderRow | null | undefined, foldersById: Map<string, FolderRow>, projectName: string) {
  if (!folder) return projectName;
  const pathParts: string[] = [];
  let cursor: string | null | undefined = folder.id;
  while (cursor) {
    const row = foldersById.get(cursor);
    if (!row) break;
    pathParts.unshift(row.name);
    cursor = row.parent_folder_id ?? null;
  }
  return [projectName, ...pathParts].join(" / ");
}

function formatRelativeFolderPath(folder: FolderRow | null | undefined, foldersById: Map<string, FolderRow>) {
  if (!folder) return "/";
  const pathParts: string[] = [];
  let cursor: string | null | undefined = folder.id;
  while (cursor) {
    const row = foldersById.get(cursor);
    if (!row) break;
    pathParts.unshift(row.name);
    cursor = row.parent_folder_id ?? null;
  }
  return `/${pathParts.join(" / ")}`.replace(/\/$/, "/");
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

/* dnd wrappers moved to `@/components/dnd/DndWrappers` */

function FolderLevelCard({
  folder,
  itemCount,
  previewImages,
  onOpen,
  onToggleSelected,
  footerActions,
  nameContent,
  subtitle,
  subtitleContent,
  matchReason,
  draggable = false,
  isDragTarget = false,
  isDragging = false,
  selectionMode = false,
  selected = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: FolderRow;
  itemCount: number;
  previewImages: string[];
  onOpen: () => void;
  onToggleSelected?: (selected: boolean) => void;
  footerActions?: React.ReactNode;
  nameContent?: React.ReactNode;
  subtitle?: string;
  subtitleContent?: React.ReactNode;
  matchReason?: string | null;
  draggable?: boolean;
  isDragTarget?: boolean;
  isDragging?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>;
  onDragOver?: React.DragEventHandler<HTMLButtonElement>;
  onDragLeave?: React.DragEventHandler<HTMLButtonElement>;
  onDrop?: React.DragEventHandler<HTMLButtonElement>;
}) {
  const visiblePreviews = previewImages.slice(0, 3);

  return (
    <div
      className={cn(
        "group relative mt-2 h-[198px] w-[204px] shrink-0 text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary/60",
        isDragging && "cursor-grabbing opacity-60",
        isDragTarget && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
        selected && "rounded-xl bg-primary/[0.08] ring-2 ring-primary/35 ring-offset-2 ring-offset-background",
      )}
    >
      <div
        className={cn(
          "absolute left-3 top-4 z-20 transition-opacity",
          selectionMode || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="rounded-full border border-white/[0.16] bg-black/45 p-1.5 text-white backdrop-blur-sm">
          <Checkbox
            checked={selected}
            aria-label={`Select folder ${folder.name}`}
            className="border-white/45 bg-white/10 text-white data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-black"
            onCheckedChange={(checked) => onToggleSelected?.(checked === true)}
          />
        </div>
      </div>
      <button
        type="button"
        draggable={draggable}
        onClick={() => {
          if (selectionMode && onToggleSelected) {
            onToggleSelected(!selected);
            return;
          }
          onOpen();
        }}
        onDoubleClick={() => {
          if (!selectionMode) return;
          onOpen();
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="block h-full w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
      <div className={cn(
        "absolute left-0 top-0 h-7 w-[78px] rounded-tl-lg rounded-tr-2xl border border-b-0 border-white/[0.06] bg-[#202334] shadow-[0_-2px_16px_rgba(0,0,0,0.20)] transition-colors group-hover:bg-[#25293a]",
        selected && "bg-primary/20",
      )} />

      <div className={cn(
        "absolute inset-x-0 bottom-0 top-2 overflow-hidden rounded-lg border border-white/[0.06] bg-[#202334] shadow-[0_4px_8px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.22)] transition-colors group-hover:bg-[#25293a]",
        selected && "border-primary/35 bg-[#262d45]",
      )}>
        <div className="h-[130px] p-1.5">
          {visiblePreviews.length > 0 ? (
            <div className="grid h-full grid-cols-[1fr_58px] gap-1 overflow-hidden rounded-md bg-black/35">
              <img
                src={visiblePreviews[0]}
                alt=""
                draggable={false}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
              {visiblePreviews.length > 1 && (
                <div className={`grid gap-1 ${visiblePreviews.length > 2 ? "grid-rows-2" : "grid-rows-1"}`}>
                  {visiblePreviews.slice(1).map((src, index) => (
                    <img
                      key={`${src}-${index}`}
                      src={src}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-muted-foreground">
              <FolderClosed className="h-8 w-8 opacity-70" />
            </div>
          )}
        </div>
        <div className="relative border-t border-white/[0.04] px-3 pb-3 pt-2">
          <div className="line-clamp-2 pr-10 text-sm font-semibold leading-tight text-foreground">
            {nameContent ?? folder.name}
          </div>
          {(subtitleContent ?? subtitle) ? (
            <div className="mt-1 line-clamp-1 pr-10 text-[11px] text-muted-foreground">
              {subtitleContent ?? subtitle}
            </div>
          ) : null}
          <div className="mt-1.5 pr-10 text-xs text-muted-foreground">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </div>
          {matchReason ? (
            <div className="mt-1 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-foreground">
              {matchReason}
            </div>
          ) : null}
        </div>
      </div>
      </button>
      {footerActions ? (
        <div
          className="absolute bottom-3 right-3 z-10"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {footerActions}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Page: CampaignDetails with Version Stacks
   ========================= */
export default function CampaignDetails({
  project: initialProject,
  workspaceId,
  onProjectUpdate,
  onFolderTrailChange,
  assetSearch: controlledAssetSearch,
  onAssetSearchChange,
}: {
  project: Project & { assets?: Asset[]; folders?: FolderRow[] };
  workspaceId: string;
  onProjectUpdate?: (updatedProject: Partial<Project & { assets?: Asset[]; folders?: FolderRow[] }>) => void;
  onFolderTrailChange?: (trail: Array<{ id: string; name: string }>) => void;
  assetSearch?: string;
  onAssetSearchChange?: (search: string) => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(initialProject);
  const [activeTab, setActiveTab] = useState("assets");
  // -- Web Page Review (Screenshot) --
  const [screenshotDialogOpen, setScreenshotDialogOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotTitle, setScreenshotTitle] = useState("");
  const [isGeneratingScreenshot, setIsGeneratingScreenshot] = useState(false);
  const [folders, setFolders] = useState<FolderRow[]>(() => initialProject.folders ?? []);
  const [projectFolderIds, setProjectFolderIds] = useState<string[]>(() =>
    (initialProject.folders ?? []).map((folder) => folder.id),
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => searchParams.get("folder"));
  const folderLoadSeqRef = useRef(0);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState(false);
  const [moveFolderTarget, setMoveFolderTarget] = useState<Asset | null>(null);
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [bulkProjectActionOpen, setBulkProjectActionOpen] = useState(false);
  const [bulkProjectActionMode, setBulkProjectActionMode] = useState<BulkProjectActionMode>("copy");
  const [workspaceProjects, setWorkspaceProjects] = useState<ProjectOption[]>([]);
  const [loadingWorkspaceProjects, setLoadingWorkspaceProjects] = useState(false);
  const [destinationFolders, setDestinationFolders] = useState<FolderRow[]>([]);
  const [loadingDestinationFolders, setLoadingDestinationFolders] = useState(false);
  const [destinationSearch, setDestinationSearch] = useState("");
  const [selectedDestinationProjectId, setSelectedDestinationProjectId] = useState<string | null>(null);
  const [selectedDestinationFolderId, setSelectedDestinationFolderId] = useState<string | null>(null);
  const [expandedDestinationProjectIds, setExpandedDestinationProjectIds] = useState<string[]>([]);
  const [expandedDestinationFolderIds, setExpandedDestinationFolderIds] = useState<string[]>([]);
  const [destinationFolderDraftTarget, setDestinationFolderDraftTarget] = useState<DestinationFolderDraftTarget | null>(null);
  const [destinationFolderDraftName, setDestinationFolderDraftName] = useState("");
  const [creatingDestinationFolder, setCreatingDestinationFolder] = useState(false);
  const [runningBulkProjectAction, setRunningBulkProjectAction] = useState(false);
  const destinationFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<Asset[]>([]);
  const [loadingLibraryAssets, setLoadingLibraryAssets] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | "__root__" | null>(null);
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<FolderRow | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<FolderRow | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const lastReportedTrailRef = useRef<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const nextFolders = initialProject.folders ?? [];
    const nextFolderIds = nextFolders.map((folder) => folder.id);
    setProject((prev) => (
      prev === initialProject ||
      (
        prev.id === initialProject.id &&
        prev.name === initialProject.name &&
        prev.assets === initialProject.assets &&
        prev.folders === initialProject.folders
      )
    ) ? prev : initialProject);
    setFolders((prev) => (sameFolderRows(prev, nextFolders) ? prev : nextFolders));
    setProjectFolderIds((prev) => (sameStringList(prev, nextFolderIds) ? prev : nextFolderIds));
  }, [initialProject]);

  const goToFolder = React.useCallback((folderId: string | null, options?: { replace?: boolean }) => {
    setCurrentFolderId(folderId);
    const nextParams = new URLSearchParams(searchParams);
    if (folderId) {
      nextParams.set("folder", folderId);
    } else {
      nextParams.delete("folder");
    }
    setSearchParams(nextParams, { replace: options?.replace ?? false });
  }, [searchParams, setSearchParams]);

  const projectAssetPath = (asset: Asset, options?: { assetId?: string; suffix?: string }) => {
    const folderId = asset.folder_id ?? currentFolderId;
    const query = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
    return `/workspace/${workspaceId}/projects/${project.id}/assets/${options?.assetId ?? asset.id}${options?.suffix ?? ""}${query}`;
  };

  async function handleScreenshotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!screenshotUrl.trim()) return;

    setIsGeneratingScreenshot(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ assetId: string }>("screenshot", {
        body: {
          url: screenshotUrl.trim().startsWith("http") ? screenshotUrl.trim() : `https://${screenshotUrl.trim()}`,
          workspaceId,
          projectId: project.id,
          title: screenshotTitle.trim() || undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.assetId) throw new Error("No asset ID returned");

      toast.success("Screenshot captured!");
      setScreenshotDialogOpen(false);
      setScreenshotUrl("");
      setScreenshotTitle("");

      // Redirect to review page
      navigate(`/workspace/${workspaceId}/projects/${project.id}/assets/${data.assetId}`);
    } catch (err: any) {
      console.error("Screenshot failed:", err);
      toast.error(err.message || "Failed to capture screenshot");
    } finally {
      setIsGeneratingScreenshot(false);
    }
  }

  // -- File Upload Hook --
  const {
    addFiles,
    cancelUpload,
    activeUploads,
  } = useFileUpload({
    workspaceId,
    projectId: String(project.id),
    folderId: currentFolderId,
    onUploaded: (file) => handleUploaded(file),
  });

  // -- Drag & Drop --
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const requestUploadAccess = () => {
    return true;
  };

  function onDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFile(true);
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDraggingFile(false);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingFile(false);
    if (!requestUploadAccess()) return;

    const files = await getFilesFromEvent(e);
    if (files.length) {
      addFiles(files);
      setActiveTab("assets");
    }
  }

  const handleTriggerUploadFiles = () => {
    if (!requestUploadAccess()) return;
    fileInputRef.current?.click();
  };

  const handleTriggerUploadFolder = () => {
    if (!requestUploadAccess()) return;
    folderInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!requestUploadAccess()) {
      e.target.value = "";
      return;
    }

    if (e.target.files?.length) {
      addFiles(e.target.files);
      setActiveTab("assets");
    }
    e.target.value = "";
  };

  const handleTriggerUpload = handleTriggerUploadFiles;

  const [localAssetSearch, setLocalAssetSearch] = useState("");
  const assetSearch = controlledAssetSearch ?? localAssetSearch;
  const setAssetSearch = onAssetSearchChange ?? setLocalAssetSearch;
  const [dismissSearchSuggestionsSignal, setDismissSearchSuggestionsSignal] = useState(0);
  const [assets, setAssets] = useState<Asset[]>(() => normalizeAssets(project.assets ?? []) as Asset[]);
  const [selectedRootIds, setSelectedRootIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectionDeleteOpen, setSelectionDeleteOpen] = useState(false);
  const [runningSelectionAction, setRunningSelectionAction] = useState(false);

  // filters/sort
  const [statusFilter, setStatusFilter] = useState<ColumnKey | "all">("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [assignFilter, setAssignFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchScope, setSearchScope] = useState<SearchScope>("project");
  const [searchScopeTouched, setSearchScopeTouched] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<CollectionFilter[]>([]);
  const [advancedFilterMatchMode, setAdvancedFilterMatchMode] = useState<"all" | "any">("all");

  // Organization members for assign filter
  const [orgMembers, setOrgMembers] = useState<
    {
      user_id: string;
      role: string;
      profile?: {
        id: string;
        display_name?: string | null;
        avatar_url?: string | null;
      };
    }[]
  >([]);

  const availableKinds = useMemo(() => {
    const kinds = new Set<string>();
    assets.forEach((a) => kinds.add(mimeKind(a.type)));
    const order = ["Image", "Video", "Audio", "PDF", "Text", "Application", "Other"];
    // Map icons to these as well
    // Icons mapping can be added here if needed in the future
    const present = Array.from(kinds);
    present.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });
    return present;
  }, [assets]);

  const foldersById = useMemo(() => {
    return new Map(folders.map((folder) => [folder.id, folder]));
  }, [folders]);

  const canMoveFolderToParent = React.useCallback((folderId: string, nextParentFolderId: string | null) => {
    if (!folderId) return false;
    if (folderId === nextParentFolderId) return false;

    let cursor = nextParentFolderId;
    while (cursor) {
      if (cursor === folderId) return false;
      cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
    }

    return true;
  }, [foldersById]);

  const moveFolder = React.useCallback(async (folderId: string, nextParentFolderId: string | null) => {
    const sourceFolder = foldersById.get(folderId);
    if (!sourceFolder || !canMoveFolderToParent(folderId, nextParentFolderId)) {
      setDraggingFolderId(null);
      setFolderDropTargetId(null);
      return;
    }

    if ((sourceFolder.parent_folder_id ?? null) === nextParentFolderId) {
      setDraggingFolderId(null);
      setFolderDropTargetId(null);
      return;
    }

    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderRow }>("asset", {
        body: {
          action: "move_folder",
          folder_id: folderId,
          parent_folder_id: nextParentFolderId,
        },
      });

      if (error) throw error;
      if (!data?.data) throw new Error("No folder returned");

      setFolders((prev) => {
        const nextFolders = prev.map((folder) => (
          folder.id === data.data!.id ? { ...folder, ...data.data! } : folder
        ));
        onProjectUpdate?.({ folders: nextFolders });
        return nextFolders;
      });
      window.dispatchEvent(new CustomEvent("asset-folders:changed", {
        detail: { workspaceId, projectId: project.id, folderId: data.data.id },
      }));
      toast.success(`Moved ${sourceFolder.name}`);
    } catch (err) {
      console.error("Failed to move folder", err);
      toast.error("Failed to move folder");
    } finally {
      setDraggingFolderId(null);
      setFolderDropTargetId(null);
    }
  }, [canMoveFolderToParent, foldersById, onProjectUpdate, project.id, workspaceId]);

  const handleFolderDragStart = React.useCallback((folderId: string) =>
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", folderId);
      setDraggingFolderId(folderId);
    }, []);

  const handleFolderDragEnd = React.useCallback(() => {
    setDraggingFolderId(null);
    setFolderDropTargetId(null);
  }, []);

  const handleFolderDragOver = React.useCallback((targetParentFolderId: string | null) =>
    (event: React.DragEvent<HTMLElement>) => {
      const draggedFolderId = draggingFolderId || event.dataTransfer.getData("text/plain");
      if (!draggedFolderId || !canMoveFolderToParent(draggedFolderId, targetParentFolderId)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setFolderDropTargetId(targetParentFolderId ?? "__root__");
    }, [canMoveFolderToParent, draggingFolderId]);

  const handleFolderDragLeave = React.useCallback((targetParentFolderId: string | null) =>
    (event: React.DragEvent<HTMLElement>) => {
      event.stopPropagation();
      if (folderDropTargetId === (targetParentFolderId ?? "__root__")) {
        setFolderDropTargetId(null);
      }
    }, [folderDropTargetId]);

  const handleFolderDrop = React.useCallback((targetParentFolderId: string | null) =>
    async (event: React.DragEvent<HTMLElement>) => {
      const draggedFolderId = draggingFolderId || event.dataTransfer.getData("text/plain");
      if (!draggedFolderId || !canMoveFolderToParent(draggedFolderId, targetParentFolderId)) return;
      event.preventDefault();
      event.stopPropagation();
      await moveFolder(draggedFolderId, targetParentFolderId);
    }, [canMoveFolderToParent, draggingFolderId, moveFolder]);

  const projectVisibleFolderIds = useMemo(() => {
    const visible = new Set<string>();
    for (const directId of projectFolderIds) {
      let cursor: string | null | undefined = directId;
      while (cursor) {
        const folder = foldersById.get(cursor);
        if (!folder || visible.has(folder.id)) break;
        visible.add(folder.id);
        cursor = folder.parent_folder_id ?? null;
      }
    }
    return visible;
  }, [foldersById, projectFolderIds]);

  const childFoldersByParent = useMemo(() => {
    const grouped = new Map<string | null, FolderRow[]>();
    for (const folder of folders) {
      if (!projectVisibleFolderIds.has(folder.id)) continue;
      const key = folder.parent_folder_id ?? null;
      grouped.set(key, [...(grouped.get(key) ?? []), folder]);
    }
    for (const [key, rows] of grouped.entries()) {
      grouped.set(
        key,
        [...rows].sort((a, b) => {
          const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
          if (sortDiff !== 0) return sortDiff;
          return a.name.localeCompare(b.name);
        }),
      );
    }
    return grouped;
  }, [folders, projectVisibleFolderIds]);

  const currentFolder = useMemo(
    () => (currentFolderId && projectVisibleFolderIds.has(currentFolderId) ? foldersById.get(currentFolderId) ?? null : null),
    [currentFolderId, foldersById, projectVisibleFolderIds],
  );

  const currentFolderTrail = useMemo(() => {
    const trail: FolderRow[] = [];
    if (currentFolderId && !projectVisibleFolderIds.has(currentFolderId)) return trail;
    let cursor = currentFolderId;
    while (cursor) {
      const folder = foldersById.get(cursor);
      if (!folder) break;
      trail.unshift(folder);
      cursor = folder.parent_folder_id ?? null;
    }
    return trail;
  }, [currentFolderId, foldersById, projectVisibleFolderIds]);

  const currentLocationTitle = currentFolder?.name ?? project.name;

  const folderDropTargets = useMemo(() => {
    const targets: Array<{ id: string | null; label: string }> = [
      { id: null, label: "Project Root" },
    ];
    for (const folder of currentFolderTrail) {
      targets.push({ id: folder.id, label: folder.name });
    }
    return targets;
  }, [currentFolderTrail]);

  useEffect(() => {
    const nextTrail = currentFolderTrail.map((folder) => ({ id: folder.id, name: folder.name }));
    if (sameTrail(lastReportedTrailRef.current, nextTrail)) return;
    lastReportedTrailRef.current = nextTrail;
    onFolderTrailChange?.(nextTrail);
  }, [currentFolderTrail, onFolderTrailChange]);

  useEffect(() => {
    setCurrentFolderId(searchParams.get("folder"));
  }, [searchParams]);

  useEffect(() => {
    if (searchScopeTouched) return;
    setSearchScope(currentFolderId ? "branch" : "project");
  }, [currentFolderId, searchScopeTouched]);

  useEffect(() => {
    if (!currentFolder) return;
    const handleGoToParentShortcut = (event: KeyboardEvent) => {
      if (!(event.altKey || event.metaKey) || event.key !== "ArrowUp") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      goToFolder(currentFolder.parent_folder_id ?? null);
    };
    window.addEventListener("keydown", handleGoToParentShortcut);
    return () => window.removeEventListener("keydown", handleGoToParentShortcut);
  }, [currentFolder, goToFolder]);

  const searchQuery = normalizeSearchText(assetSearch);

  const projectFolderIdSet = useMemo(() => new Set(projectVisibleFolderIds), [projectVisibleFolderIds]);

  const searchScopeFolderIds = useMemo(() => {
    if (!currentFolderId) return projectFolderIdSet;
    if (searchScope === "project") return projectFolderIdSet;

    if (searchScope === "folder") {
      return new Set([currentFolderId]);
    }

    const branchIds = collectFolderIds(currentFolderId, folders);
    const visibleBranch = new Set<string>();
    for (const folderId of branchIds) {
      if (projectFolderIdSet.has(folderId)) {
        visibleBranch.add(folderId);
      }
    }
    return visibleBranch;
  }, [currentFolderId, folders, projectFolderIdSet, searchScope]);

  const searchScopeLabel = useMemo(() => {
    if (!currentFolderId || searchScope === "project") return "this project";
    const folderName = currentFolder?.name ?? "this folder";
    if (searchScope === "folder") return `“${folderName}”`;
    return `“${folderName}” and subfolders`;
  }, [currentFolder, currentFolderId, searchScope]);
  const childFolders = useMemo(() => {
    return childFoldersByParent.get(currentFolderId) ?? [];
  }, [childFoldersByParent, currentFolderId]);

  const visibleChildFolderIdSet = useMemo(
    () => new Set(childFolders.map((folder) => folder.id)),
    [childFolders],
  );

  const projectAssetsForFilters = useMemo(
    () => assets.map((asset) => projectAssetToCollectionAsset(asset)),
    [assets],
  );

  const projectFilterPeople = useMemo(
    () => orgMembers.map((member) => ({
      value: member.user_id,
      label: member.profile?.display_name || member.user_id,
      avatarUrl: member.profile?.avatar_url ?? null,
      keywords: `${member.profile?.display_name || ""} ${member.user_id}`.trim(),
      role: member.role,
    })),
    [orgMembers],
  );

  const projectPeopleById = useMemo(
    () => new Map(projectFilterPeople.map((person) => [person.value, person])),
    [projectFilterPeople],
  );

  const assetSearchIndex = useMemo(() => {
    const next = new Map<string, AssetSearchIndex>();
    assets.forEach((asset) => {
      next.set(asset.id, buildAssetSearchIndex(asset, foldersById, projectPeopleById));
    });
    return next;
  }, [assets, foldersById, projectPeopleById]);

  const activeAdvancedFilters = useMemo(() => {
    return advancedFilters.filter((filter) => {
      if (filter.operator === "is_empty" || filter.operator === "is_not_empty") return true;
      if (["today", "yesterday", "last_7_days", "last_30_days", "this_month"].includes(filter.operator)) return true;
      if (Array.isArray(filter.value)) return filter.value.length > 0;
      return String(filter.value ?? "").trim().length > 0;
    });
  }, [advancedFilters]);

  const filteredAssets = useMemo(() => {
    const res = assets.filter((a) => {
      const collectionAsset = projectAssetToCollectionAsset(a);
      const index = assetSearchIndex.get(a.id) ?? buildAssetSearchIndex(a, foldersById, projectPeopleById);
      const matchesSearch = !searchQuery || matchesAssetSearch(index, searchQuery);
      const col = toColumnKey(a.status as string | null);
      const matchesStatus = statusFilter === "all" ? true : col === statusFilter;
      const k = mimeKind(a.type);
      const matchesKind = kindFilter === "all" ? true : k === kindFilter;

      const matchesAssign = assignFilter === "all" ? true :
        assignFilter === "unassigned" ? (!a.assigned_to || a.assigned_to === "") :
          (a.assigned_to === assignFilter);

      const matchesAdvanced = activeAdvancedFilters.length === 0
        ? true
        : advancedFilterMatchMode === "all"
          ? activeAdvancedFilters.every((filter) =>
            matchesCollectionFilter({
              rootId: rootIdOf(a),
              asset: collectionAsset,
              versionCount: 1,
            } as any, filter),
          )
          : activeAdvancedFilters.some((filter) =>
            matchesCollectionFilter({
              rootId: rootIdOf(a),
              asset: collectionAsset,
              versionCount: 1,
            } as any, filter),
          );

      return matchesSearch && matchesStatus && matchesKind && matchesAssign && matchesAdvanced;
    });
    if (searchQuery && sortKey === "updatedAt" && sortDir === "desc") {
      res.sort((a, b) => {
        const aScore = scoreAssetSearch(assetSearchIndex.get(a.id) ?? buildAssetSearchIndex(a, foldersById, projectPeopleById), searchQuery);
        const bScore = scoreAssetSearch(assetSearchIndex.get(b.id) ?? buildAssetSearchIndex(b, foldersById, projectPeopleById), searchQuery);
        if (aScore !== bScore) return bScore - aScore;
        const at = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bt = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bt - at;
      });
    } else if (sortKey !== "none") {
      res.sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortKey === "name") return dir * (a.name || "").localeCompare(b.name || "");
        if (sortKey === "createdAt") {
          const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dir * (at - bt);
        }
        if (sortKey === "updatedAt") {
          const at = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const bt = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return dir * (at - bt);
        }
        if (sortKey === "sizeBytes") {
          const asz = a.sizeBytes ?? -1;
          const bsz = b.sizeBytes ?? -1;
          return dir * (asz - bsz);
        }
        const ac = STATUS_ORDER[toColumnKey(a.status as string | null)];
        const bc = STATUS_ORDER[toColumnKey(b.status as string | null)];
        return dir * (ac - bc);
      });
    }
    return res;
  }, [activeAdvancedFilters, advancedFilterMatchMode, assetSearchIndex, assets, assignFilter, foldersById, kindFilter, projectPeopleById, searchQuery, sortDir, sortKey, statusFilter]);

  const folderScopedAssets = useMemo(() => {
    if (!searchQuery) {
      return filteredAssets.filter((asset) => (asset.folder_id ?? null) === currentFolderId);
    }

    return filteredAssets.filter((asset) => {
      const folderId = asset.folder_id ?? null;
      if (!folderId) return currentFolderId === null || searchScopeFolderIds.has(folderId);
      return searchScopeFolderIds.has(folderId);
    });
  }, [currentFolderId, filteredAssets, searchQuery, searchScopeFolderIds]);

  const searchFolderCandidates = useMemo(() => {
    if (!searchQuery) return childFolders;

    if (searchScope === "folder") {
      return (currentFolderId ? childFolders : folders.filter((folder) => (folder.parent_folder_id ?? null) === null))
        .filter((folder) => projectFolderIdSet.has(folder.id));
    }

    return folders.filter((folder) => searchScopeFolderIds.has(folder.id));
  }, [childFolders, currentFolderId, folders, projectFolderIdSet, searchQuery, searchScope, searchScopeFolderIds]);

  const searchAssetCandidates = useMemo(() => {
    if (!searchQuery) return folderScopedAssets;
    return folderScopedAssets;
  }, [folderScopedAssets, searchQuery]);

  const searchAssetRanks = useMemo(() => {
    if (!searchQuery) return new Map<string, number>();
    const ranks = new Map<string, number>();
    for (const asset of searchAssetCandidates) {
      const score = scoreAssetSearch(assetSearchIndex.get(asset.id) ?? buildAssetSearchIndex(asset, foldersById, projectPeopleById), searchQuery);
      const rootId = rootIdOf(asset);
      ranks.set(rootId, Math.max(ranks.get(rootId) ?? 0, score));
    }
    return ranks;
  }, [assetSearchIndex, foldersById, projectPeopleById, searchAssetCandidates, searchQuery]);

  const searchFolderResults = useMemo(() => {
    if (!searchQuery) return [];

    const descendantAssetMatches = new Map<string, number>();
    for (const asset of searchAssetCandidates) {
      const rootFolderId = asset.folder_id ?? null;
      if (!rootFolderId) continue;
      let cursor: string | null | undefined = rootFolderId;
      while (cursor) {
        if (descendantAssetMatches.has(cursor)) {
          cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
          continue;
        }
        descendantAssetMatches.set(cursor, 1);
        cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
      }
    }

    return searchFolderCandidates
      .map((folder) => {
        const directScore = matchScore(
          [
            folder.name,
            folderPathParts(folder.id, foldersById).join(" / "),
          ],
          searchQuery,
        );
        const subtreeScore = descendantAssetMatches.has(folder.id) ? 20 : 0;
        const score = Math.max(directScore, subtreeScore);
        return { folder, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.folder.name.localeCompare(b.folder.name);
      });
  }, [foldersById, searchAssetCandidates, searchFolderCandidates, searchQuery]);

  const searchFolderMatchCounts = useMemo(() => {
    if (!searchQuery) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const asset of searchAssetCandidates) {
      const folderId = asset.folder_id ?? null;
      if (!folderId) {
        if (currentFolderId === null) {
          counts.set("__root__", (counts.get("__root__") ?? 0) + 1);
        }
        continue;
      }

      let cursor: string | null | undefined = folderId;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
        cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
      }
    }
    return counts;
  }, [currentFolderId, foldersById, searchAssetCandidates, searchQuery]);

  const searchStackGroups = useMemo(() => {
    if (!searchQuery) return [];
    const grouped = Array.from(groupByRoot(searchAssetCandidates).values());
    return grouped
      .map((stack) => ({
        stack,
        score: searchAssetRanks.get(rootIdOf(stack[0])) ?? 0,
        modifiedAt: stack[0].updatedAt ?? stack[0].createdAt ?? null,
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const at = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
        const bt = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
        return bt - at;
      });
  }, [searchAssetCandidates, searchAssetRanks, searchQuery]);

  const searchSuggestions = useMemo(() => {
    if (!searchQuery) return [];
    const seen = new Set<string>();
    const q = assetSearch.trim();
    const items: Array<{
      group: "Folders" | "Assets" | "People" | "Types" | "Metadata";
      label: React.ReactNode;
      subtitle?: React.ReactNode;
      value: string;
      action?: "open_folder" | "open_asset" | "apply_type" | "search";
      targetId?: string;
      filterValue?: string;
    }> = [];
    const add = (
      group: "Folders" | "Assets" | "People" | "Types" | "Metadata",
      label?: string | null,
      value?: string | null,
      subtitle?: string | null,
      options?: {
        action?: "open_folder" | "open_asset" | "apply_type" | "search";
        targetId?: string;
        filterValue?: string;
      },
    ) => {
      const nextLabel = String(label ?? "").trim();
      const nextValue = String(value ?? label ?? "").trim();
      if (!nextLabel || !nextValue) return;
      const key = `${group}:${nextValue.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        group,
        label: q ? highlightMatch(nextLabel, q) : nextLabel,
        subtitle: subtitle ? (q ? highlightMatch(subtitle, q) : subtitle) : undefined,
        value: nextValue,
        ...options,
      });
    };

    for (const row of searchFolderResults.slice(0, 3)) {
      add("Folders", row.folder.name, row.folder.name, formatRelativeFolderPath(row.folder, foldersById), {
        action: "open_folder",
        targetId: row.folder.id,
      });
    }

    for (const row of searchStackGroups.slice(0, 4)) {
      const asset = row.stack[0];
      add("Assets", asset?.name, asset?.name, formatRelativeFolderPath(asset?.folder_id ? foldersById.get(asset.folder_id) : null, foldersById), {
        action: "open_asset",
        targetId: asset?.id,
      });
    }

    for (const asset of searchAssetCandidates.slice(0, 10)) {
      const index = assetSearchIndex.get(asset.id);
      index?.fields.forEach((field) => {
        const labelMatch = normalizeSearchText(field.label).includes(searchQuery);
        const valueMatch = field.normalized.includes(searchQuery);
        if (!labelMatch && !valueMatch) return;
        if (field.label.includes("by") || ["Assignee", "Owner", "Reviewer"].some((label) => field.label.startsWith(label))) {
          add("People", field.value, field.value, field.label, { action: "search" });
        } else if (field.label.includes("MIME") || field.label.includes("type") || field.label.includes("extension")) {
          add("Types", mimeKind(asset.type), field.value, field.label, {
            action: "apply_type",
            filterValue: mimeKind(asset.type),
          });
        } else if (field.label !== "Name") {
          add("Metadata", field.value, field.value, field.label, { action: "search" });
        }
      });
    }

    return items.slice(0, 8);
  }, [assetSearch, assetSearchIndex, foldersById, searchAssetCandidates, searchFolderResults, searchQuery, searchStackGroups]);

  const hasSearchResults = searchQuery
    ? searchFolderResults.length > 0 || searchStackGroups.length > 0
    : childFolders.length > 0 || folderScopedAssets.length > 0;

  const folderCounts = useMemo(() => {
    return buildRecursiveFolderAssetCounts(assets, folders);
  }, [assets, folders]);

  const folderPreviewMap = useMemo(() => {
    const previews = new Map<string, string[]>();
    const orderedAssets = [...assets].sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    for (const asset of orderedAssets) {
      const folderId = asset.folder_id ?? null;
      if (!folderId || !asset.coverUrl) continue;
      const existing = previews.get(folderId) ?? [];
      if (existing.length >= 3) continue;
      previews.set(folderId, [...existing, asset.coverUrl]);
    }

    return previews;
  }, [assets]);

  const assetsForFolderScope = React.useCallback((folderId: string) => {
    const folderIds = collectFolderIds(folderId, folders);
    return assets.filter((asset) => {
      const assetFolderId = asset.folder_id ?? null;
      return Boolean(assetFolderId && folderIds.has(assetFolderId));
    });
  }, [assets, folders]);

  const folderDeleteImpact = useMemo(() => {
    if (!folderToDelete) {
      return {
        folderIds: [] as string[],
        assetCount: 0,
        subfolderCount: 0,
      };
    }

    const folderIds = Array.from(collectFolderIds(folderToDelete.id, folders));
    const assetCount = assets.filter((asset) => {
      const assetFolderId = asset.folder_id ?? null;
      return Boolean(assetFolderId && folderIds.includes(assetFolderId));
    }).length;

    return {
      folderIds,
      assetCount,
      subfolderCount: Math.max(0, folderIds.length - 1),
    };
  }, [assets, folderToDelete, folders]);

  const resolveDownloadUrl = React.useCallback((asset: Asset) => {
    const rawUrl = asset.url;
    if (!rawUrl) return null;

    if (rawUrl.startsWith("http")) return rawUrl;

    const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
    const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
    const path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    return `${base}${path}`;
  }, []);

  const makeArchiveEntryPath = React.useCallback((asset: Asset, options?: { relativeToFolderId?: string | null }) => {
    const fullParts = folderPathParts(asset.folder_id ?? null, foldersById);
    const relativeBase = options?.relativeToFolderId
      ? folderPathParts(options.relativeToFolderId, foldersById)
      : [];
    const relativeParts = fullParts
      .slice(relativeBase.length)
      .map((part) => sanitizeDownloadName(part))
      .filter(Boolean);
    const fileLabel = sanitizeDownloadName(asset.name || "asset") || "asset";
    return [...relativeParts, fileLabel].join("/");
  }, [foldersById]);

  const downloadAssetArchive = React.useCallback(async (
    scopeAssets: Asset[],
    options: { label: string; archiveName: string; relativeToFolderId?: string | null },
  ) => {
    const downloadable = scopeAssets
      .map((asset) => ({ asset, url: resolveDownloadUrl(asset) }))
      .filter((row): row is { asset: Asset; url: string } => Boolean(row.url));

    if (downloadable.length === 0) {
      toast.info(`No downloadable assets found in ${options.label}.`);
      return;
    }

    const usedPaths = new Map<string, number>();
    const entries = downloadable.map(({ asset, url }) => {
      const rawPath = makeArchiveEntryPath(asset, { relativeToFolderId: options.relativeToFolderId ?? null });
      const key = rawPath.toLowerCase();
      const seen = usedPaths.get(key) ?? 0;
      usedPaths.set(key, seen + 1);

      return {
        path: appendDuplicateSuffix(rawPath, seen),
        url,
      };
    });

    await downloadZipArchive(entries, options.archiveName, { label: options.label });
  }, [makeArchiveEntryPath, resolveDownloadUrl]);

  function handleUploaded(file: {
    id: string;
    name: string;
    type: string;
    sizeBytes: number;
    coverUrl?: string;
    url?: string;
    folderId?: string | null;
    projectId?: string | null;
  }) {
    // const id = typeof crypto !== "undefined" && (crypto as any).randomUUID
    //   ? (crypto as any).randomUUID()
    //   : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const newAsset: Asset = {
      id: file.id,
      name: file.name,
      type: file.type,
      sizeBytes: file.sizeBytes,
      createdAt: new Date().toISOString(),
      coverUrl: file.coverUrl,
      url: file.url,
      status: "needs_review",
      version_no: 1,
      parent_asset_id: null,
      folder_id: file.folderId ?? currentFolderId ?? null,
      project_id: file.projectId ?? String(project.id),
      comments_count: 0, // New assets have no comments
      updated_at: new Date().toISOString(),
      updated_by: null,
    };
    setAssets((prev) => [newAsset, ...prev]);
    setActiveTab("assets");
    if (file.type === "application/pdf") {
      void refreshAssetUntilCoverReady(file.id, { workspaceId: String(workspaceId), projectId: project.id }).then((refreshed) => {
        if (!refreshed) return;
        mergeAssetsIntoState([refreshed]);
      }).catch((err) => {
        console.error("Failed to refresh uploaded PDF asset", err);
      });
    }
  }

  // status change
  async function handleStatusChange(assetId: string, newStatus: AssetStatus | null) {
    const prev = assets;
    setAssets((curr) => curr.map((a) => (a.id === assetId ? { ...a, status: newStatus } : a)));
    try {
      await changeAssetStatus(assetId, newStatus);
    } catch (err) {
      console.error("Failed to change asset status:", err);
      setAssets(prev);
    }
  }

  async function handleAssignReviewer(assetId: string, reviewerId: string | null) {
    const prev = assets;
    setAssets((curr) => curr.map((asset) => (asset.id === assetId ? { ...asset, assigned_to: reviewerId } : asset)));
    try {
      const response = await updateAsset({ id: assetId, assigned_to: reviewerId });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error?.message || data?.error || "Failed to assign reviewer");
    } catch (err) {
      console.error("Failed to assign reviewer:", err);
      setAssets(prev);
      toast.error("Could not update reviewer.");
    }
  }

  const [inviteReviewerOpen, setInviteReviewerOpen] = useState(false);
  const [inviteMemberOpen, setInviteMemberOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<ProjectReviewer[]>([]);
  const [loadingReviewers, setLoadingReviewers] = useState(false);

  const reviewerAssetMap = useMemo(() => {
    const latestAssets = Array.from(groupByRoot(assets).values()).map((stack) => stack[0]);
    const next = new Map<string, Asset[]>();

    reviewers.forEach((reviewer) => {
      const key = reviewer.user_id ?? reviewer.email ?? "";
      if (!key) return;
      const reviewerAssetIds = new Set((reviewer.asset_ids ?? []).map((id) => String(id)));
      const rows = latestAssets.filter((asset) => {
        const rootId = rootIdOf(asset);
        if (reviewerAssetIds.has(asset.id) || reviewerAssetIds.has(rootId)) return true;
        if (reviewer.type !== "guest" && assetIncludesReviewer(asset, reviewer.user_id)) return true;
        return false;
      });
      rows.sort((left, right) => {
        const leftTime = left.updated_at ? new Date(left.updated_at).getTime() : left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightTime = right.updated_at ? new Date(right.updated_at).getTime() : right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return rightTime - leftTime;
      });
      next.set(key, rows);
    });

    return next;
  }, [assets, reviewers]);

  // Asset Editing State
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [newAssetName, setNewAssetName] = useState("");
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false);

  const handleEditAsset = (asset: Asset) => {
    setEditingAsset(asset);
    setNewAssetName(asset.name);
  };

  const handleSaveAssetEdit = async () => {
    if (!editingAsset || !newAssetName.trim()) return;
    setIsUpdatingAsset(true);
    try {
      const { error } = await invokeEdgeFunction("asset", {
        method: "PATCH",
        body: { id: editingAsset.id, title: newAssetName.trim() }
      });

      if (error) throw error;

      setAssets((prev) =>
        prev.map((a) => (a.id === editingAsset.id ? { ...a, name: newAssetName.trim() } : a))
      );
      toast.success("Asset updated");
      setEditingAsset(null);
    } catch (err) {
      console.error("Error updating asset:", err);
      toast.error("Failed to update asset");
    } finally {
      setIsUpdatingAsset(false);
    }
  };

  // Project Editing State
  const [editingProject, setEditingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);

  const handleEditProject = () => {
    setNewProjectName(project?.name || "");
    setEditingProject(true);
  };

  const handleSaveProjectEdit = async () => {
    if (!project || !newProjectName.trim()) return;
    setIsUpdatingProject(true);
    try {
      const response = await updateProject({ id: project.id, name: newProjectName.trim() });

      if (!response.ok) throw new Error("Failed to update project");
      const updatedName = newProjectName.trim();
      setProject((prev) => ({ ...prev, name: updatedName }));
      onProjectUpdate?.({ name: updatedName });
      window.dispatchEvent(new CustomEvent("projects:changed", {
        detail: { workspaceId, projectId: project.id, action: "updated" },
      }));
      toast.success("Project updated");
      setEditingProject(false);
    } catch (err) {
      console.error("Error updating project:", err);
      toast.error("Failed to update project");
    } finally {
      setIsUpdatingProject(false);
    }
  };

  const handleSendInvite = async (emails: string[], message: string) => {
    console.log("emails", emails);
    console.log("message", message);
    if (!project.id || !workspaceId) {
      console.error("Missing projectId or workspaceId");
      return;
    }
    try {
      const token = await getSessionToken();

      const { error } = await invokeEdgeFunction("invite", {
        body: { action: "project", projectId: project.id, emails, message },
        headers: {
          Authorization: `Bearer ${token}`
        },
      });
      if (error) {
        const payload = error.payload as any;
        const msg = (payload && typeof payload === "object" && payload.error) ? String(payload.error) : error.message;
        throw new Error(msg || "Failed to send invites");
      }
      toast.success("Invites sent!");
    } catch (error: any) {
      console.error("Error sending invites:", error);
      let msg = "Failed to send invites";
      if (error.message) {
        try {
          const p = JSON.parse(error.message);
          if (p.error) msg = p.error;
          else msg = error.message;
        } catch {
          msg = error.message;
        }
      }
      toast.error(msg);
    }
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setKindFilter("all");
    setAssignFilter("all");
    setSortKey("none");
    setSortDir("desc");
    setAssetSearch("");
    setAdvancedFilters([]);
    setAdvancedFilterMatchMode("all");
    setSearchScope(currentFolderId ? "branch" : "project");
    setSearchScopeTouched(false);
  };

  // Keep assets normalized if the project.assets prop updates (ensures first-render stacks work)
  useEffect(() => {
    setAssets(normalizeAssets(project.assets ?? []) as Asset[]);
  }, [project.assets]);

  useEffect(() => {
    let mounted = true;
    const requestSeq = ++folderLoadSeqRef.current;
    const controller = new AbortController();

    const loadFolders = async () => {
      try {
        const foldersResult = await invokeEdgeFunction<{ data?: FolderRow[] }>("asset", {
          body: { action: "list_folders", workspace_id: workspaceId, project_id: project.id },
          signal: controller.signal,
        });

        if (foldersResult.error) throw foldersResult.error;
        if (!mounted || requestSeq !== folderLoadSeqRef.current) return;
        const nextFolders = Array.isArray(foldersResult.data?.data) ? foldersResult.data.data : [];
        React.startTransition(() => {
          setFolders((prev) => (sameFolderRows(prev, nextFolders) ? prev : nextFolders));
          setProjectFolderIds((prev) => {
            const nextIds = nextFolders.map((folder) => folder.id);
            return sameStringList(prev, nextIds) ? prev : nextIds;
          });
        });
        if (!sameFolderRows(project.folders as FolderRow[] | undefined, nextFolders)) {
          onProjectUpdate?.({ folders: nextFolders });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn("Failed to load folders for project view", err);
        if (mounted) {
          setFolders([]);
          setProjectFolderIds([]);
        }
      }
    };

    void loadFolders();
    const onFoldersChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (detail?.workspaceId && String(detail.workspaceId) !== String(workspaceId)) return;
      if (detail?.projectId && String(detail.projectId) !== String(project.id)) return;
      void loadFolders();
    };
    window.addEventListener("asset-folders:changed", onFoldersChanged);
    return () => {
      mounted = false;
      controller.abort();
      window.removeEventListener("asset-folders:changed", onFoldersChanged);
    };
  }, [project.id, workspaceId]);

  useEffect(() => {
    if (!currentFolderId || folders.length === 0 || projectVisibleFolderIds.has(currentFolderId)) return;
    goToFolder(null, { replace: true });
  }, [currentFolderId, folders.length, foldersById, goToFolder, projectVisibleFolderIds]);

  function mergeAssetsIntoState(rows: any[]) {
    const normalized = normalizeAssets(rows) as Asset[];
    setAssets((prev) => {
      const merged = new Map(prev.map((asset) => [asset.id, asset]));
      for (const asset of normalized) {
        const existing = merged.get(asset.id);
        merged.set(asset.id, existing ? { ...existing, ...asset } : asset);
      }
      return Array.from(merged.values()).sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
    });
  }

  async function loadLibraryAssets() {
    setLoadingLibraryAssets(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: { assets?: any[] } }>("asset", {
        body: { action: "list_library", workspace_id: workspaceId, limit: 1000 },
      });

      if (error) throw error;

      const rows = Array.isArray(data?.data?.assets) ? data.data.assets : [];
      setLibraryAssets(normalizeAssets(rows) as Asset[]);
    } catch (err) {
      console.error("Failed to load library assets", err);
      toast.error("Failed to load workspace library");
      setLibraryAssets([]);
    } finally {
      setLoadingLibraryAssets(false);
    }
  }

  async function loadWorkspaceProjects() {
    setLoadingWorkspaceProjects(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, status, created_at")
        .eq("workspace_id", workspaceId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWorkspaceProjects((data ?? []) as ProjectOption[]);
    } catch (err) {
      console.error("Failed to load workspace projects", err);
      toast.error("Failed to load projects");
      setWorkspaceProjects([]);
    } finally {
      setLoadingWorkspaceProjects(false);
    }
  }

  async function loadDestinationFolders() {
    setLoadingDestinationFolders(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderRow[] }>("asset", {
        body: { action: "list_folders", workspace_id: workspaceId },
      });

      if (error) throw error;
      const rows = Array.isArray(data?.data) ? data.data : [];
      setDestinationFolders(rows.filter((folder) => Boolean(folder.project_id)));
    } catch (err) {
      console.error("Failed to load destination folders", err);
      toast.error("Failed to load destination folders");
      setDestinationFolders([]);
    } finally {
      setLoadingDestinationFolders(false);
    }
  }

  async function reloadProjectView() {
    const { data, error } = await invokeEdgeFunction<{
      data?: {
        project?: Partial<Project>;
        assets?: any[];
        folders?: FolderRow[];
      };
    }>("asset", {
      body: { action: "list_project", project_id: project.id },
    });

    if (error) throw error;

    const nextProject = data?.data?.project ?? {};
    const nextAssets = normalizeAssets(data?.data?.assets ?? []) as Asset[];
    const nextFolders = Array.isArray(data?.data?.folders) ? data.data.folders : [];
    const nextFolderIds = nextFolders.map((folder) => folder.id);

    setProject((prev) => ({
      ...prev,
      ...nextProject,
      assets: nextAssets,
      folders: nextFolders,
    }));
    setAssets(nextAssets);
    setFolders((prev) => (sameFolderRows(prev, nextFolders) ? prev : nextFolders));
    setProjectFolderIds((prev) => (sameStringList(prev, nextFolderIds) ? prev : nextFolderIds));
    onProjectUpdate?.({
      ...nextProject,
      assets: nextAssets,
      folders: nextFolders,
    });
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;

    setSavingFolder(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderRow }>("asset", {
        body: {
          action: "create_folder",
          workspace_id: workspaceId,
          project_id: project.id,
          parent_folder_id: currentFolderId,
          name,
        },
      });

      if (error) throw error;
      if (!data?.data) throw new Error("No folder returned");

      setFolders((prev) => [...prev, data.data]);
      setProjectFolderIds((prev) => Array.from(new Set([...prev, data.data!.id])));
      window.dispatchEvent(new CustomEvent("asset-folders:changed", {
        detail: { workspaceId, projectId: project.id, folderId: data.data.id },
      }));
      setCreateFolderOpen(false);
      setNewFolderName("");
      toast.success("Folder created");
    } catch (err) {
      console.error("Failed to create folder", err);
      toast.error("Failed to create folder");
    } finally {
      setSavingFolder(false);
    }
  }

  function requestRenameFolder(folder: FolderRow) {
    setFolderToRename(folder);
    setRenameFolderName(folder.name);
    setRenameFolderOpen(true);
  }

  async function handleRenameFolder() {
    const name = renameFolderName.trim();
    if (!folderToRename || !name) return;

    setRenamingFolder(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderRow }>("asset", {
        body: {
          action: "rename_folder",
          folder_id: folderToRename.id,
          name,
        },
      });

      if (error) throw error;
      if (!data?.data) throw new Error("No folder returned");

      setFolders((prev) => {
        const nextFolders = prev.map((folder) => (folder.id === data.data!.id ? data.data! : folder));
        onProjectUpdate?.({ folders: nextFolders });
        return nextFolders;
      });
      window.dispatchEvent(new CustomEvent("asset-folders:changed", {
        detail: { workspaceId, projectId: project.id, folderId: data.data.id, action: "updated" },
      }));
      setRenameFolderOpen(false);
      setFolderToRename(null);
      setRenameFolderName("");
      toast.success("Folder renamed");
    } catch (err) {
      console.error("Failed to rename folder", err);
      toast.error("Failed to rename folder");
    } finally {
      setRenamingFolder(false);
    }
  }

  function requestDeleteFolder(folder: FolderRow) {
    setFolderToDelete(folder);
  }

  async function handleDeleteFolder() {
    if (!folderToDelete) return;

    setDeletingFolder(true);
    try {
      const { data, error } = await invokeEdgeFunction<{
        data?: {
          deleted_folder_ids?: string[];
          deleted_asset_ids?: string[];
          deleted_folder_count?: number;
          deleted_asset_count?: number;
        };
      }>("asset", {
        body: {
          action: "delete_folder",
          folder_id: folderToDelete.id,
        },
      });

      if (error) throw error;

      const deletedFolderIds = data?.data?.deleted_folder_ids ?? [];
      const deletedAssetIds = data?.data?.deleted_asset_ids ?? [];

      setFolders((prev) => {
        const nextFolders = prev.filter((folder) => !deletedFolderIds.includes(folder.id));
        onProjectUpdate?.({ folders: nextFolders });
        return nextFolders;
      });
      setProjectFolderIds((prev) => prev.filter((folderId) => !deletedFolderIds.includes(folderId)));
      setAssets((prev) => prev.filter((asset) => !deletedAssetIds.includes(asset.id)));

      if (currentFolderId && deletedFolderIds.includes(currentFolderId)) {
        goToFolder(folderToDelete.parent_folder_id ?? null, { replace: true });
      }

      window.dispatchEvent(new CustomEvent("asset-folders:changed", {
        detail: {
          workspaceId,
          projectId: project.id,
          action: "deleted",
          deletedFolderIds,
        },
      }));
      setFolderToDelete(null);
      toast.success(`Deleted ${data?.data?.deleted_folder_count ?? deletedFolderIds.length} folder${(data?.data?.deleted_folder_count ?? deletedFolderIds.length) === 1 ? "" : "s"} and ${data?.data?.deleted_asset_count ?? deletedAssetIds.length} asset${(data?.data?.deleted_asset_count ?? deletedAssetIds.length) === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("Failed to delete folder", err);
      toast.error("Failed to delete folder");
    } finally {
      setDeletingFolder(false);
    }
  }

  async function handleDownloadAllProject() {
    const projectLabel = sanitizeDownloadName(project.name || "project") || "project";
    await downloadAssetArchive(assets, {
      label: project.name || "this project",
      archiveName: `${projectLabel}.zip`,
    });
  }

  async function handleDownloadFolder(folder: FolderRow) {
    const projectLabel = sanitizeDownloadName(project.name || "project") || "project";
    const folderLabel = sanitizeDownloadName(folder.name) || "folder";
    await downloadAssetArchive(assetsForFolderScope(folder.id), {
      label: folder.name,
      archiveName: `${projectLabel} - ${folderLabel}.zip`,
      relativeToFolderId: folder.id,
    });
  }

  function requestMoveToFolder(asset: Asset) {
    setMoveFolderTarget(asset);
    setMoveFolderId(asset.folder_id ?? null);
    setMoveFolderOpen(true);
  }

  async function handleMoveToFolder() {
    if (!moveFolderTarget) return;

    try {
      const { data, error } = await invokeEdgeFunction<{ data?: any[] }>("asset", {
        body: {
          action: "move_stack_to_folder",
          asset_id: moveFolderTarget.id,
          folder_id: moveFolderId,
          project_id: project.id,
        },
      });

      if (error) throw error;
      mergeAssetsIntoState(Array.isArray(data?.data) ? data.data : []);
      if (moveFolderId) {
        setProjectFolderIds((prev) => Array.from(new Set([...prev, moveFolderId])));
        window.dispatchEvent(new CustomEvent("asset-folders:changed", {
          detail: { workspaceId, projectId: project.id, folderId: moveFolderId },
        }));
      }
      setMoveFolderOpen(false);
      setMoveFolderTarget(null);
      toast.success("Asset moved");
    } catch (err) {
      console.error("Failed to move asset to folder", err);
      toast.error("Failed to move asset");
    }
  }

  async function handleAttachExistingAsset(asset: Asset) {
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: any[] }>("asset", {
        body: {
          action: "attach_project",
          project_id: project.id,
          asset_id: asset.id,
        },
      });

      if (error) throw error;
      const rows = Array.isArray(data?.data) ? data.data : [];
      mergeAssetsIntoState(rows);
      const nextFolderIds = rows
        .map((row: any) => row?.folder_id ?? null)
        .filter((folderId: string | null): folderId is string => Boolean(folderId));
      if (nextFolderIds.length > 0) {
        setProjectFolderIds((prev) => Array.from(new Set([...prev, ...nextFolderIds])));
        for (const folderId of new Set(nextFolderIds)) {
          window.dispatchEvent(new CustomEvent("asset-folders:changed", {
            detail: { workspaceId, projectId: project.id, folderId },
          }));
        }
      }
      setAttachOpen(false);
      toast.success("Asset added to project");
    } catch (err) {
      console.error("Failed to attach asset to project", err);
      toast.error("Failed to add asset to project");
    }
  }

  function toggleStackSelection(rootId: string, selected: boolean) {
    setSelectedRootIds((prev) => {
      if (selected) {
        return prev.includes(rootId) ? prev : [...prev, rootId];
      }
      return prev.filter((id) => id !== rootId);
    });
  }

  function toggleFolderSelection(folderId: string, selected: boolean) {
    setSelectedFolderIds((prev) => {
      if (selected) {
        return prev.includes(folderId) ? prev : [...prev, folderId];
      }
      return prev.filter((id) => id !== folderId);
    });
  }

  function exitSelectionMode() {
    setSelectedRootIds([]);
    setSelectedFolderIds([]);
  }

  function openBulkProjectAction(mode: BulkProjectActionMode) {
    if (mode === "copy" && !canCopySelectionToProject) return;
    if (mode === "move" && !canMoveSelectionToProject) return;
    setBulkProjectActionMode(mode);
    setBulkProjectActionOpen(true);
  }

  const ensureDestinationPathExpanded = React.useCallback((projectId: string, folderId: string | null) => {
    setExpandedDestinationProjectIds((prev) => (
      prev.includes(projectId) ? prev : [...prev, projectId]
    ));

    if (!folderId) return;

    setExpandedDestinationFolderIds((prev) => {
      const foldersById = new Map(destinationFolders.map((folder) => [folder.id, folder]));
      const next = new Set(prev);
      let cursor: string | null = folderId;
      while (cursor) {
        next.add(cursor);
        cursor = foldersById.get(cursor)?.parent_folder_id ?? null;
      }
      return Array.from(next);
    });
  }, [destinationFolders]);

  const selectDestinationLocation = React.useCallback((projectId: string, folderId: string | null) => {
    setSelectedDestinationProjectId(projectId);
    setSelectedDestinationFolderId(folderId);
    setDestinationFolderDraftTarget(null);
    setDestinationFolderDraftName("");
    ensureDestinationPathExpanded(projectId, folderId);
  }, [ensureDestinationPathExpanded]);

  function toggleDestinationProjectExpanded(projectId: string) {
    setExpandedDestinationProjectIds((prev) => (
      prev.includes(projectId)
        ? prev.filter((value) => value !== projectId)
        : [...prev, projectId]
    ));
  }

  function toggleDestinationFolderExpanded(folderId: string) {
    setExpandedDestinationFolderIds((prev) => (
      prev.includes(folderId)
        ? prev.filter((value) => value !== folderId)
        : [...prev, folderId]
    ));
  }

  function startDestinationFolderCreate(projectId: string, parentFolderId: string | null) {
    selectDestinationLocation(projectId, parentFolderId);
    setDestinationFolderDraftTarget({ projectId, parentFolderId });
    setDestinationFolderDraftName("");
  }

  async function handleCreateDestinationFolder() {
    if (!destinationFolderDraftTarget) return;
    const trimmedName = destinationFolderDraftName.trim();
    if (!trimmedName) return;

    setCreatingDestinationFolder(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderRow }>("asset", {
        body: {
          action: "create_folder",
          workspace_id: workspaceId,
          project_id: destinationFolderDraftTarget.projectId,
          parent_folder_id: destinationFolderDraftTarget.parentFolderId,
          name: trimmedName,
        },
      });

      if (error) throw error;
      if (!data?.data) throw new Error("No folder returned");

      setDestinationFolders((prev) => [
        ...prev.filter((folder) => folder.id !== data.data!.id),
        data.data!,
      ]);
      selectDestinationLocation(destinationFolderDraftTarget.projectId, data.data.id);
      setDestinationFolderDraftTarget(null);
      setDestinationFolderDraftName("");
      toast.success(`Created ${data.data.name}`);
    } catch (err) {
      console.error("Failed to create destination folder", err);
      toast.error("Failed to create folder");
    } finally {
      setCreatingDestinationFolder(false);
    }
  }

  async function handleDownloadSelection() {
    const projectLabel = sanitizeDownloadName(project.name || "project") || "project";
    await downloadAssetArchive(selectedDownloadAssets, {
      label: "your selection",
      archiveName: `${projectLabel} - selection.zip`,
      relativeToFolderId: null,
    });
  }

  async function handleDeleteSelection() {
    if (totalSelectedCount === 0) return;

    setRunningSelectionAction(true);
    try {
      for (const rootId of selectedRootIds) {
        const { error } = await invokeEdgeFunction("asset", {
          body: {
            action: "detach_project",
            project_id: project.id,
            asset_id: rootId,
          },
        });

        if (error) throw error;
      }

      for (const folderId of selectedFolderIds) {
        const { error } = await invokeEdgeFunction("asset", {
          body: {
            action: "delete_folder",
            folder_id: folderId,
          },
        });

        if (error) throw error;
      }

      await reloadProjectView();
      setSelectionDeleteOpen(false);
      exitSelectionMode();
    toast.success(`Deleted ${selectionLabel}.`);
    } catch (err) {
      console.error("Failed to delete selection", err);
      toast.error("Failed to delete selection");
    } finally {
      setRunningSelectionAction(false);
    }
  }

  async function handleBulkProjectAction() {
    if (!selectedDestinationProjectId) return;
    if (selectedDestinationIsBlocked) return;

    const targetProject = destinationProjects.find(
      (workspaceProject) => String(workspaceProject.id) === String(selectedDestinationProjectId),
    );
    const movingInsideCurrentProject = bulkProjectActionMode === "move"
      && String(selectedDestinationProjectId) === String(project.id);

    setRunningBulkProjectAction(true);
    try {
      let completedAssets = 0;
      let skippedAssets = 0;
      let movedFolders = 0;

      if (movingInsideCurrentProject) {
        for (const rootId of selectedRootIds) {
          const rootAsset = assets.find((asset) => rootIdOf(asset) === rootId && !asset.parent_asset_id);
          if ((rootAsset?.folder_id ?? null) === selectedDestinationFolderId) {
            skippedAssets += 1;
            continue;
          }

          const { error } = await invokeEdgeFunction("asset", {
            body: {
              action: "move_stack_to_folder",
              asset_id: rootId,
              folder_id: selectedDestinationFolderId,
              project_id: project.id,
            },
          });

          if (error) throw error;
          completedAssets += 1;
        }

        for (const folderId of selectedFolderIds) {
          const folder = foldersById.get(folderId);
          if ((folder?.parent_folder_id ?? null) === selectedDestinationFolderId) {
            continue;
          }
          if (!canMoveFolderToParent(folderId, selectedDestinationFolderId)) {
            continue;
          }

          const { error } = await invokeEdgeFunction("asset", {
            body: {
              action: "move_folder",
              folder_id: folderId,
              parent_folder_id: selectedDestinationFolderId,
            },
          });

          if (error) throw error;
          movedFolders += 1;
        }
      } else if (selectedRootIds.length > 0) {
        const action = bulkProjectActionMode === "move"
          ? "move_to_project_bulk"
          : "copy_to_project_bulk";
        const { data, error } = await invokeEdgeFunction<{
          data?: {
            moved_root_ids?: string[];
            copied_root_ids?: string[];
            skipped_root_ids?: string[];
          };
        }>("asset", {
          body: {
            action,
            source_project_id: project.id,
            target_project_id: selectedDestinationProjectId,
            asset_root_ids: selectedRootIds,
            destination_folder_id: bulkProjectActionMode === "move" ? selectedDestinationFolderId : null,
          },
        });

        if (error) throw error;

        completedAssets += bulkProjectActionMode === "move"
          ? (data?.data?.moved_root_ids?.length ?? 0)
          : (data?.data?.copied_root_ids?.length ?? 0);
        skippedAssets += data?.data?.skipped_root_ids?.length ?? 0;
      }

      if (!movingInsideCurrentProject && bulkProjectActionMode === "move" && selectedFolderIds.length > 0) {
        const { data, error } = await invokeEdgeFunction<{
          data?: {
            moved_folder_ids?: string[];
          };
        }>("asset", {
          body: {
            action: "move_folders_to_project_bulk",
            source_project_id: project.id,
            target_project_id: selectedDestinationProjectId,
            folder_ids: selectedFolderIds,
            destination_folder_id: selectedDestinationFolderId,
          },
        });

        if (error) throw error;
        movedFolders += data?.data?.moved_folder_ids?.length ?? 0;
      }

      if (bulkProjectActionMode === "move") {
        await reloadProjectView();
      }

      const targetLabel = selectedDestinationPathLabel || targetProject?.name || "the destination project";
      const baseVerb = bulkProjectActionMode === "move" ? "Moved" : "Copied";

      if ((completedAssets + movedFolders) > 0) {
        const summaryParts: string[] = [];
        if (completedAssets > 0) {
          summaryParts.push(`${completedAssets} ${completedAssets === 1 ? "asset stack" : "asset stacks"}`);
        }
        if (movedFolders > 0) {
          summaryParts.push(`${movedFolders} ${movedFolders === 1 ? "folder" : "folders"}`);
        }
        toast.success(`${baseVerb} ${summaryParts.join(" and ")} to ${targetLabel}.`);
      } else if (skippedAssets > 0) {
        toast.error(`Nothing changed. The selected assets are already in ${targetLabel} or unavailable.`);
      }

      if ((completedAssets + movedFolders) > 0 && skippedAssets > 0) {
        toast.message(`${skippedAssets} ${skippedAssets === 1 ? "stack was" : "stacks were"} skipped because they were already available there or no longer in this view.`);
      }

      setBulkProjectActionOpen(false);
      exitSelectionMode();
      setSelectedDestinationProjectId(null);
      setSelectedDestinationFolderId(null);
    } catch (err) {
      console.error("Failed to run bulk project action", err);
      toast.error(`Failed to ${bulkProjectActionMode} selected items`);
    } finally {
      setRunningBulkProjectAction(false);
    }
  }

  // Load reviewers
  React.useEffect(() => {
    const load = async () => {
      if (!project?.id || !workspaceId) return;
      setLoadingReviewers(true);
      try {

        const { data: reviewersData, error: reviewersErr } = await invokeEdgeFunction("review", {
          body: { action: "list", projectId: project.id },
        });
        if (reviewersErr) throw reviewersErr;
        const reviewersList = Array.isArray(reviewersData) ? reviewersData : (reviewersData?.data ?? []);
        setReviewers(reviewersList || []);

        // Load organization members for assign filter
        // First get workspace to find organization_id
        const { data: workspaceData } = await supabase
          .from("workspaces")
          .select("organization_id")
          .eq("id", workspaceId)
          .single();

      } catch (e) {
        console.error("Failed to load reviewers:", e);
        setReviewers([]);
        setOrgMembers([]);
      } finally {
        setLoadingReviewers(false);
      }

      //

    };
    const loadOrgMembers = async () => {

      if (!workspaceId) return;
      const { data: workspaceData, error: workspaceError } = await supabase
        .from("workspaces")
        .select("organization_id, id")
        .eq("id", workspaceId)
        .maybeSingle();

      if (workspaceError) {
        console.error("Error fetching workspace for org members:", workspaceError);
        return;
      }
      if (workspaceData?.organization_id) {
        setOrganizationId(workspaceData.organization_id);
      }

      const { data: list_of_users_in_organization, error: orgMembersError } = await invokeEdgeFunction("org-members", {
        body: { action: "list", organization_id: workspaceData?.organization_id }
      });

      if (orgMembersError) {
        console.error("Error fetching org members:", orgMembersError);
        return;
      }

      // The edge function already returns profiles, so we don't need to fetch them separately
      // Structure from edge function: { user_id, role, profiles: { ... } }

      const orgMemberRows = Array.isArray(list_of_users_in_organization)
        ? list_of_users_in_organization
        : Array.isArray((list_of_users_in_organization as any)?.data)
          ? (list_of_users_in_organization as any).data
          : [];

      const merged_members = orgMemberRows.map((member: any) => ({
        user_id: member.user_id,
        role: member.role || 'member',
        profile: member.profile ? {
          id: member.profile.id,
          display_name: member.profile.display_name,
          avatar_url: member.profile.avatar_url,
        } : undefined,
      }));

      setOrgMembers(merged_members);
    }
    load();
    loadOrgMembers();
  }, [project?.id, workspaceId]);

  useEffect(() => {
    if (attachOpen && libraryAssets.length === 0 && !loadingLibraryAssets) {
      void loadLibraryAssets();
    }
  }, [attachOpen, libraryAssets.length, loadingLibraryAssets]);

  /* ========= Version stacks: compute stacks and stack on drop ========= */
  const stacksMap = useMemo(() => groupByRoot(folderScopedAssets), [folderScopedAssets]);
  const stacks = useMemo(() => Array.from(stacksMap.values()), [stacksMap]);
  const visibleStackRootIds = useMemo(
    () => stacks.map((stack) => rootIdOf(stack[0])).filter(Boolean),
    [stacks],
  );
  const visibleStackRootIdSet = useMemo(
    () => new Set(visibleStackRootIds),
    [visibleStackRootIds],
  );
  const selectedAssetCount = selectedRootIds.length;
  const selectedFolderCount = selectedFolderIds.length;
  const totalSelectedCount = selectedAssetCount + selectedFolderCount;
  const selectionMode = activeTab === "assets" && totalSelectedCount > 0;
  const attachedRootIds = useMemo(() => {
    return new Set(assets.map((asset) => rootIdOf(asset)));
  }, [assets]);
  const attachableLibraryAssets = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    const libraryStacks = Array.from(groupByRoot(libraryAssets).values());
    return libraryStacks
      .map((stack) => stack[0] as Asset)
      .filter((asset) => !attachedRootIds.has(rootIdOf(asset)))
      .filter((asset) => {
        if (!q) return true;
        return (
          asset.name.toLowerCase().includes(q) ||
          (asset.type || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
  }, [attachedRootIds, libraryAssets, librarySearch]);

  const destinationProjects = useMemo(
    () => bulkProjectActionMode === "move"
      ? workspaceProjects
      : workspaceProjects.filter((workspaceProject) => String(workspaceProject.id) !== String(project.id)),
    [bulkProjectActionMode, project.id, workspaceProjects],
  );
  const destinationProjectIdSet = useMemo(
    () => new Set(destinationProjects.map((workspaceProject) => String(workspaceProject.id))),
    [destinationProjects],
  );
  const selectedRootAssets = useMemo(() => {
    return selectedRootIds
      .map((rootId) => assets.find((asset) => rootIdOf(asset) === rootId && !asset.parent_asset_id) ?? null)
      .filter((asset): asset is Asset => Boolean(asset));
  }, [assets, selectedRootIds]);
  const destinationFoldersById = useMemo(() => {
    return new Map(
      destinationFolders
        .filter((folder) => folder.project_id && destinationProjectIdSet.has(String(folder.project_id)))
        .map((folder) => [folder.id, folder]),
    );
  }, [destinationFolders, destinationProjectIdSet]);

  const destinationChildFoldersByProject = useMemo(() => {
    const grouped = new Map<string, Map<string | null, FolderRow[]>>();

    for (const folder of destinationFolders) {
      const projectId = folder.project_id ? String(folder.project_id) : null;
      if (!projectId || !destinationProjectIdSet.has(projectId)) continue;
      const projectMap = grouped.get(projectId) ?? new Map<string | null, FolderRow[]>();
      const parentFolderId = folder.parent_folder_id ?? null;
      projectMap.set(parentFolderId, [...(projectMap.get(parentFolderId) ?? []), folder]);
      grouped.set(projectId, projectMap);
    }

    for (const projectMap of grouped.values()) {
      for (const [parentFolderId, rows] of projectMap.entries()) {
        projectMap.set(
          parentFolderId,
          [...rows].sort((a, b) => {
            const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
            if (sortDiff !== 0) return sortDiff;
            return a.name.localeCompare(b.name);
          }),
        );
      }
    }

    return grouped;
  }, [destinationFolders, destinationProjectIdSet]);
  const destinationSearchQuery = destinationSearch.trim().toLowerCase();
  const isBlockedCurrentProjectDestination = React.useCallback((folderId: string | null) => {
    if (!folderId || selectedFolderIds.length === 0) return false;

    let cursor: string | null = folderId;
    while (cursor) {
      if (selectedFolderIds.includes(cursor)) return true;
      cursor = destinationFoldersById.get(cursor)?.parent_folder_id ?? null;
    }

    return false;
  }, [destinationFoldersById, selectedFolderIds]);
  const canMoveSelectionIntoProjectFolders = React.useCallback((targetProjectId: string) => {
    if (bulkProjectActionMode !== "move") return false;
    if (selectedFolderIds.length > 0) return true;
    return selectedRootAssets.every((asset) => {
      const primaryProjectId = asset.project_id ? String(asset.project_id) : "";
      return primaryProjectId === String(project.id) || primaryProjectId === String(targetProjectId);
    });
  }, [bulkProjectActionMode, project.id, selectedFolderIds.length, selectedRootAssets]);
  const destinationVisibilityByProject = useMemo(() => {
    const visibility = new Map<string, { projectVisible: boolean; visibleFolderIds: Set<string> }>();

    for (const workspaceProject of destinationProjects) {
      const projectId = String(workspaceProject.id);
      const childrenByParent = destinationChildFoldersByProject.get(projectId) ?? new Map<string | null, FolderRow[]>();
      const visibleFolderIds = new Set<string>();
      const canUseFolders = canMoveSelectionIntoProjectFolders(projectId);

      const visit = (folder: FolderRow): boolean => {
        const matchesSelf = !destinationSearchQuery || folder.name.toLowerCase().includes(destinationSearchQuery);
        let matchesDescendant = false;
        for (const child of childrenByParent.get(folder.id) ?? []) {
          if (visit(child)) matchesDescendant = true;
        }
        const isVisible = !destinationSearchQuery || matchesSelf || matchesDescendant;
        if (isVisible) visibleFolderIds.add(folder.id);
        return isVisible;
      };

      if (bulkProjectActionMode === "move" && canUseFolders) {
        for (const rootFolder of childrenByParent.get(null) ?? []) {
          visit(rootFolder);
        }
      }

      const matchesProject = !destinationSearchQuery || workspaceProject.name.toLowerCase().includes(destinationSearchQuery);
      const projectVisible = bulkProjectActionMode === "move"
        ? (matchesProject || visibleFolderIds.size > 0)
        : matchesProject;

      visibility.set(projectId, { projectVisible, visibleFolderIds });
    }

    return visibility;
  }, [bulkProjectActionMode, canMoveSelectionIntoProjectFolders, destinationChildFoldersByProject, destinationProjects, destinationSearchQuery]);
  const selectedDestinationProject = useMemo(
    () => destinationProjects.find((workspaceProject) => String(workspaceProject.id) === String(selectedDestinationProjectId)) ?? null,
    [destinationProjects, selectedDestinationProjectId],
  );
  const selectedDestinationPathLabel = useMemo(() => {
    if (!selectedDestinationProjectId) return "";
    const destinationProjectName = selectedDestinationProject?.name ?? "Selected project";
    const folderParts = folderPathParts(selectedDestinationFolderId, destinationFoldersById);
    return [destinationProjectName, ...folderParts].join(" / ");
  }, [destinationFoldersById, selectedDestinationFolderId, selectedDestinationProject, selectedDestinationProjectId]);
  const selectedDestinationIsBlocked = bulkProjectActionMode === "move"
    && String(selectedDestinationProjectId) === String(project.id)
    && isBlockedCurrentProjectDestination(selectedDestinationFolderId);

  const selectedFolderAssets = useMemo(() => {
    const seen = new Set<string>();
    const rows: Asset[] = [];

    for (const folderId of selectedFolderIds) {
      for (const asset of assetsForFolderScope(folderId)) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        rows.push(asset);
      }
    }

    return rows;
  }, [assetsForFolderScope, selectedFolderIds]);

  const selectedDownloadAssets = useMemo(() => {
    const seen = new Set<string>();
    const rows: Asset[] = [];

    for (const rootId of selectedRootIds) {
      for (const stackAsset of assets.filter((asset) => rootIdOf(asset) === rootId)) {
        if (seen.has(stackAsset.id)) continue;
        seen.add(stackAsset.id);
        rows.push(stackAsset);
      }
    }

    for (const folderAsset of selectedFolderAssets) {
      if (seen.has(folderAsset.id)) continue;
      seen.add(folderAsset.id);
      rows.push(folderAsset);
    }

    return rows;
  }, [assets, selectedFolderAssets, selectedRootIds]);

  const selectionLabel = useMemo(() => {
    if (totalSelectedCount === 0) return "0 items";
    if (selectedAssetCount > 0 && selectedFolderCount === 0) {
      return `${selectedAssetCount} asset${selectedAssetCount === 1 ? "" : "s"}`;
    }
    if (selectedFolderCount > 0 && selectedAssetCount === 0) {
      return `${selectedFolderCount} folder${selectedFolderCount === 1 ? "" : "s"}`;
    }
    return `${totalSelectedCount} items`;
  }, [selectedAssetCount, selectedFolderCount, totalSelectedCount]);
  const selectionSummaryLabel = `${selectionLabel} selected`;
  const canCopySelectionToProject = selectedAssetCount > 0 && selectedFolderCount === 0;
  const canMoveSelectionToProject = totalSelectedCount > 0;

  useEffect(() => {
    setSelectedRootIds((prev) => prev.filter((rootId) => visibleStackRootIdSet.has(rootId)));
  }, [visibleStackRootIdSet]);

  useEffect(() => {
    setSelectedFolderIds((prev) => prev.filter((folderId) => visibleChildFolderIdSet.has(folderId)));
  }, [visibleChildFolderIdSet]);

  useEffect(() => {
    if (activeTab !== "assets" && (selectedRootIds.length > 0 || selectedFolderIds.length > 0)) {
      setSelectedRootIds([]);
      setSelectedFolderIds([]);
    }
  }, [activeTab, selectedFolderIds.length, selectedRootIds.length]);

  useEffect(() => {
    setSelectedRootIds([]);
    setSelectedFolderIds([]);
  }, [currentFolderId]);

  useEffect(() => {
    if (bulkProjectActionOpen) {
      void loadWorkspaceProjects();
      if (bulkProjectActionMode === "move") {
        void loadDestinationFolders();
      }
    }
  }, [bulkProjectActionMode, bulkProjectActionOpen]);

  useEffect(() => {
    if (!bulkProjectActionOpen) return;
    setSelectedDestinationProjectId((current) => (
      current && destinationProjects.some((workspaceProject) => workspaceProject.id === current)
        ? current
        : bulkProjectActionMode === "move"
          ? String(project.id)
          : destinationProjects[0]?.id ?? null
    ));
  }, [bulkProjectActionMode, bulkProjectActionOpen, destinationProjects, project.id]);

  useEffect(() => {
    if (!bulkProjectActionOpen || !selectedDestinationProjectId) return;
    ensureDestinationPathExpanded(selectedDestinationProjectId, selectedDestinationFolderId);
  }, [bulkProjectActionOpen, ensureDestinationPathExpanded, selectedDestinationFolderId, selectedDestinationProjectId]);

  useEffect(() => {
    if (bulkProjectActionMode !== "copy") return;
    if (selectedDestinationFolderId !== null) setSelectedDestinationFolderId(null);
    if (destinationFolderDraftTarget) setDestinationFolderDraftTarget(null);
    if (destinationFolderDraftName) setDestinationFolderDraftName("");
  }, [bulkProjectActionMode, destinationFolderDraftName, destinationFolderDraftTarget, selectedDestinationFolderId]);

  useEffect(() => {
    if (!selectedDestinationFolderId) return;
    const selectedFolder = destinationFoldersById.get(selectedDestinationFolderId);
    if (!selectedFolder || String(selectedFolder.project_id) !== String(selectedDestinationProjectId)) {
      setSelectedDestinationFolderId(null);
    }
  }, [destinationFoldersById, selectedDestinationFolderId, selectedDestinationProjectId]);

  useEffect(() => {
    if (!bulkProjectActionOpen) {
      setDestinationSearch("");
      setSelectedDestinationFolderId(null);
      setDestinationFolderDraftTarget(null);
      setDestinationFolderDraftName("");
      setExpandedDestinationFolderIds([]);
      setExpandedDestinationProjectIds([]);
      return;
    }

    setExpandedDestinationProjectIds((prev) => {
      const next = prev.filter((projectId) => destinationProjects.some((workspaceProject) => workspaceProject.id === projectId));
      if (next.length > 0) return next;
      return destinationProjects.map((workspaceProject) => workspaceProject.id);
    });
  }, [bulkProjectActionOpen, destinationProjects]);

  useEffect(() => {
    if (!destinationFolderDraftTarget) return;
    destinationFolderInputRef.current?.focus();
    destinationFolderInputRef.current?.select();
  }, [destinationFolderDraftTarget]);


  // Delete flow: use a dialog to confirm (shadcn dialog)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  function requestDeleteAssetById(assetId: string) {
    const asset = assets.find((a) => a.id === assetId) ?? null;
    if (!asset) return;
    setDeleteTarget(asset);
    setDeleteOpen(true);
  }

  async function performDeleteAsset(asset: Asset) {
    setDeleting(true);
    const prev = assets;
    const rootId = rootIdOf(asset);
    const removedIds = new Set(
      prev.filter((row) => rootIdOf(row) === rootId).map((row) => row.id),
    );
    setAssets((curr) => curr.filter((row) => !removedIds.has(row.id)));
    try {
      const { data, error } = await invokeEdgeFunction<{
        data?: { removed_asset_ids?: string[] };
      }>("asset", {
        body: {
          action: "detach_project",
          project_id: project.id,
          asset_id: asset.id,
        },
      });

      if (error) throw error;

      const serverRemovedIds = new Set(data?.data?.removed_asset_ids ?? Array.from(removedIds));
      setAssets((curr) => curr.filter((row) => !serverRemovedIds.has(row.id)));
      toast.success("Asset removed from project");
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to remove asset from project", err);
      setAssets(prev);
      toast.error("Failed to remove asset from project");
    } finally {
      setDeleting(false);
    }
  }


  async function stackAssets(droppedId: string, targetTopId: string) {
    if (droppedId === targetTopId) return;
    const src = assets.find((a) => a.id === droppedId);
    const target = assets.find((a) => a.id === targetTopId);
    if (!src || !target) return;

    const rootId = rootIdOf(target);
    const newVersionNo = nextVersionForRootFromMap(rootId, stacksMap);
    const prev = { parent: src.parent_asset_id, ver: src.version_no };

    // optimistic update
    setAssets((curr) =>
      curr.map((a) =>
        a.id === src.id ? { ...a, parent_asset_id: rootId, version_no: newVersionNo } : a
      )
    );

    try {
      const { data, error } = await invokeEdgeFunction('stack-asset', {
        body: { srcId: src.id, targetTopId: target.id },
      });
      if (error) throw error;
      if (data && (data as any).ok === false) throw new Error('Server reported failure');
    } catch (e) {
      console.error("Failed to stack assets", e);
      // rollback
      setAssets((curr) =>
        curr.map((a) =>
          a.id === src.id ? { ...a, parent_asset_id: prev.parent, version_no: prev.ver } : a
        )
      );
    }
  }

  // dnd-kit sensors + handler
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  function onDragEnd(e: DragEndEvent) {
    const srcId = String(e.active?.id ?? "");
    const overId = e.over?.id ? String(e.over.id) : "";
    if (!srcId || !overId || srcId === overId) return;
    void stackAssets(srcId, overId);
  }

  // Handler extracted from inline VersionStackCard onSave — keeps UI updates local and calls edge function
  async function handleSaveStack({ orderedIds, removedIds }: { orderedIds: string[]; removedIds?: string[] }) {
    console.log("handleSaveStack", { orderedIds, removedIds });
    try {
      console.log("Getting session");
      const token = await getSessionToken();
      if (!token) throw new Error("No access token");

      const { data, error } = await invokeEdgeFunction('reorder-versions', {
        body: { orderedIds, removedIds },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw error;
      if (data && (data as any).error) throw new Error((data as any).error);
    } catch (e) {
      console.error("reorder-versions failed", e);
      toast.error("Couldn’t reorder versions");
      return;
    }

    // Reflect DB changes in local UI
    setAssets((curr) => {
      const removedSet = new Set(removedIds ?? []);
      const L = orderedIds.length;
      const versionMap = new Map<string, number>();
      orderedIds.forEach((id, idx) => versionMap.set(id, L - idx));

      const anyId = orderedIds[0] ?? removedIds?.[0];
      const anyRow = curr.find((a) => a.id === anyId);
      const oldRootId = anyRow ? (anyRow.parent_asset_id ?? anyRow.id) : undefined;
      
      const newRootId = oldRootId && removedSet.has(oldRootId) ? orderedIds[0] : oldRootId;

      return curr.map((a) => {
        if (removedSet.has(a.id)) {
          return { ...a, parent_asset_id: null, version_no: 1 };
        }
        if (versionMap.has(a.id)) {
          return {
            ...a,
            parent_asset_id: (newRootId === a.id) ? null : (newRootId ?? a.parent_asset_id ?? a.id),
            version_no: versionMap.get(a.id)!,
          };
        }
        return a;
      });
    });

    toast.success("Version stack saved");
  }

  const handleDownload = (asset: Asset) => {
    const projectLabel = sanitizeDownloadName(project.name || "project") || "project";
    const assetLabel = sanitizeDownloadName(asset.name || "asset") || "asset";

    void downloadAssetArchive([asset], {
      label: asset.name || "asset",
      archiveName: `${projectLabel} - ${assetLabel}.zip`,
    });
  };

  const renderDestinationFolderComposer = (
    projectId: string,
    parentFolderId: string | null,
    depth: number,
  ) => {
    if (bulkProjectActionMode !== "move") return null;
    const isActive = destinationFolderDraftTarget?.projectId === projectId
      && destinationFolderDraftTarget?.parentFolderId === parentFolderId;
    if (!isActive) return null;

    return (
      <div className="pt-2" style={{ paddingLeft: `${depth * 18}px` }}>
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
  ): React.ReactNode => {
    if (bulkProjectActionMode !== "move") return null;
    const childrenByParent = destinationChildFoldersByProject.get(projectId) ?? new Map<string | null, FolderRow[]>();
    const visibleFolderIds = destinationVisibilityByProject.get(projectId)?.visibleFolderIds ?? new Set<string>();
    const folderRows = (childrenByParent.get(parentFolderId) ?? []).filter((folder) => (
      (!destinationSearchQuery || visibleFolderIds.has(folder.id))
      && (String(projectId) !== String(project.id) || !isBlockedCurrentProjectDestination(folder.id))
    ));

    return folderRows.map((folder) => {
      const hasChildren = (childrenByParent.get(folder.id) ?? []).length > 0;
      const isExpanded = destinationSearchQuery.length > 0 || expandedDestinationFolderIds.includes(folder.id);
      const isSelected = String(selectedDestinationProjectId) === projectId
        && String(selectedDestinationFolderId) === String(folder.id);
      const isComposerParent = destinationFolderDraftTarget?.projectId === projectId
        && destinationFolderDraftTarget?.parentFolderId === folder.id;

      return (
        <div key={folder.id} className="space-y-1">
          <div style={{ paddingLeft: `${depth * 18}px` }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => selectDestinationLocation(projectId, folder.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectDestinationLocation(projectId, folder.id);
                }
              }}
              className={cn(
                "group flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                isSelected
                  ? "border-primary/30 bg-primary/[0.08] text-foreground shadow-sm"
                  : "border-transparent hover:border-border/70 hover:bg-muted/45",
              )}
            >
              <span
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
              </span>
              {isExpanded || isSelected ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
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
              {isSelected ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          </div>
          {renderDestinationFolderComposer(projectId, folder.id, depth + 1)}
          {hasChildren && (isExpanded || isComposerParent) ? (
            <div className="space-y-1">
              {renderDestinationFolderNodes(projectId, folder.id, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  };

  const visibleDestinationProjects = destinationProjects.filter((workspaceProject) => (
    destinationVisibilityByProject.get(String(workspaceProject.id))?.projectVisible ?? !destinationSearchQuery
  ));

  return (
    <TooltipProvider>
      <div
        className="relative min-h-[calc(100vh-3.5rem)]"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Drag Overlay */}
        <AnimatePresence>
          {isDraggingFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md rounded-lg pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="flex flex-col items-center gap-6 p-12 rounded-[2rem] border-2 border-dashed border-primary/50 bg-primary/5 shadow-[0_0_80px_rgba(var(--primary),0.1)]"
              >
                <div className="p-6 bg-primary/20 rounded-full animate-pulse">
                  <Upload className="w-14 h-14 text-primary" strokeWidth={1.5} />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-3xl font-bold tracking-tight text-foreground">
                    Drop it like it's hot
                  </h3>
                  <p className="text-muted-foreground text-lg max-w-[300px]">
                    Drag and drop your files or folders here to upload them instantly.
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden Input */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept={ACCEPT}
          onChange={handleFileChange}
        />
        <input
          type="file"
          ref={folderInputRef}
          className="hidden"
          multiple
          {...({ webkitdirectory: "", directory: "" } as any)}
          onChange={handleFileChange}
        />

        <div className="min-w-0 space-y-4 px-6 py-5">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {currentLocationTitle}
              </h1>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => currentFolder ? requestRenameFolder(currentFolder) : handleEditProject()}
                aria-label={currentFolder ? "Rename folder" : "Edit project name"}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <TabsList className="w-fit">
              <TabsTrigger value="assets" className="inline-flex items-center gap-2">
                <FolderClosed className="h-4 w-4" />
                Assets
              </TabsTrigger>
              <TabsTrigger value="kanban" className="inline-flex items-center gap-2">
                <LayoutGrid className="h-4 w-4" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="reviewers" className="inline-flex items-center gap-2">
                <Users className="h-4 w-4" />
                Reviewers
              </TabsTrigger>
              <TabsTrigger value="links" className="inline-flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Links
              </TabsTrigger>
            </TabsList>

            <div className="flex flex-wrap items-center gap-2">
              {selectionMode ? (
                <>
                  <span className="rounded-full border border-border/70 bg-muted/35 px-3 py-1 text-sm font-medium text-foreground">
                    {selectionSummaryLabel}
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={exitSelectionMode}>
                    Cancel
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canCopySelectionToProject}
                          onClick={() => openBulkProjectAction("copy")}
                          className="disabled:pointer-events-none"
                        >
                          <CopyPlus className="mr-2 h-4 w-4" />
                          Copy to project
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canCopySelectionToProject ? (
                      <TooltipContent side="bottom">
                        {selectedFolderCount > 0 ? "Copy is unavailable for folders." : "Copy is unavailable for this selection."}
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canMoveSelectionToProject}
                    onClick={() => openBulkProjectAction("move")}
                  >
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Move...
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="outline">
                        More
                        <MoreHorizontal className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuItem onClick={() => void handleDownloadSelection()}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled title="Share is unavailable for this selection.">
                        <MailPlus className="mr-2 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setSelectionDeleteOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm">
                        <Upload className="mr-2 size-4" />
                        Upload
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[220px]">
                      <DropdownMenuLabel>Upload</DropdownMenuLabel>
                      <DropdownMenuItem onClick={handleTriggerUploadFiles}>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Files
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleTriggerUploadFolder}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Upload Folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[260px]">
                      <DropdownMenuLabel>Add Content</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-3 pt-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        Import
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setAttachOpen(true)}
                        className="flex cursor-pointer flex-col items-start gap-1 p-3"
                      >
                        <div className="font-medium flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-primary" /> Add Existing Asset
                        </div>
                        <p className="text-xs text-muted-foreground text-left">
                          Reuse an asset already in your workspace library.
                        </p>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setScreenshotDialogOpen(true)}
                        className="flex cursor-pointer flex-col items-start gap-1 p-3"
                      >
                        <div className="font-medium flex items-center gap-2">
                          <Globe className="h-4 w-4 text-primary" /> Capture Web Page
                        </div>
                        <p className="text-xs text-muted-foreground text-left">
                          Create a reviewable snapshot from a live URL.
                        </p>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button size="sm" variant="outline" onClick={() => setCreateFolderOpen(true)}>
                    <FolderPlus className="mr-2 h-4 w-4" />
                    New Folder
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        <MailPlus className="mr-2 h-4 w-4" />
                        Share
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[320px]">
                      <DropdownMenuItem
                        onClick={() => setInviteMemberOpen(true)}
                        className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                      >
                        <div className="font-medium flex items-center gap-2">
                          <Users className="h-4 w-4 text-primary" /> Invite Team Member
                        </div>
                        <p className="text-xs text-muted-foreground text-left">
                          Add a member to your organization. They can access all projects.
                        </p>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="flex flex-col items-start gap-1 p-3 opacity-80"
                        disabled
                      >
                        <div className="font-medium flex items-center gap-2">
                          <Eye className="h-4 w-4 text-primary" /> Invite Guest Reviewer
                          <Badge variant="secondary" className="ml-2 text-xs text-muted-foreground">Experimental</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground text-left">
                          Invite a guest to review or view this specific project only.
                        </p>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[280px]">
                      <DropdownMenuLabel>Export</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => void handleDownloadAllProject()}>
                        <Download className="mr-2 h-4 w-4" />
                        Download project as ZIP
                      </DropdownMenuItem>
                      {currentFolder ? (
                        <DropdownMenuItem onClick={() => void handleDownloadFolder(currentFolder)}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Download this folder as ZIP
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {currentFolder ? (
                    <FolderActionsMenu
                      folderName={currentFolder.name}
                      onRename={() => requestRenameFolder(currentFolder)}
                      onDelete={() => requestDeleteFolder(currentFolder)}
                      trigger={(
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Folder Actions
                          <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                      )}
                      contentClassName="w-[220px]"
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Shared Filters (visible for assets and kanban) */}
          {(activeTab === "assets" || activeTab === "kanban") && (
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
              filteredCount={searchQuery ? searchFolderResults.length + searchStackGroups.length : folderScopedAssets.length}
              workspaceId={workspaceId}
              projectId={String(project.id)}
              onUpload={handleUploaded}
              onInvite={() => setInviteReviewerOpen(true)}
              advancedFilters={advancedFilters}
              setAdvancedFilters={setAdvancedFilters}
              advancedFilterMatchMode={advancedFilterMatchMode}
              setAdvancedFilterMatchMode={setAdvancedFilterMatchMode}
              workspaceProjects={workspaceProjects}
              projectFolders={folders}
              projectAssets={projectAssetsForFilters}
              people={projectFilterPeople}
              currentFolderName={currentFolder?.name ?? null}
              searchScope={searchScope}
              setSearchScope={(scope) => {
                setSearchScopeTouched(true);
                setSearchScope(scope);
              }}
              searchSuggestions={searchSuggestions}
              dismissSearchSuggestionsSignal={dismissSearchSuggestionsSignal}
              onSearchSuggestionSelect={(suggestion) => {
                if (suggestion.action === "open_folder" && suggestion.targetId) {
                  setAssetSearch("");
                  goToFolder(suggestion.targetId);
                  return;
                }
                if (suggestion.action === "open_asset" && suggestion.targetId) {
                  const asset = assets.find((entry) => entry.id === suggestion.targetId);
                  if (asset) navigate(projectAssetPath(asset));
                  return;
                }
                if (suggestion.action === "apply_type" && suggestion.filterValue) {
                  setKindFilter(suggestion.filterValue);
                  return;
                }
                setAssetSearch(suggestion.value);
              }}
              selectionMode={selectionMode}
            />
          )}

          {/* Assets */}
          <TabsContent value="assets" className="space-y-4">
            <div className="space-y-6">
              {searchQuery && !hasSearchResults ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search className="h-6 w-6" />
                    </EmptyMedia>
                    <EmptyTitle>No results found for “{assetSearch.trim()}”</EmptyTitle>
                    <EmptyDescription>
                      No results found in {searchScopeLabel}. Try a different keyword, clear search, or widen the scope.
                    </EmptyDescription>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setAssetSearch("")}>
                        Clear search
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                        Remove filters
                      </Button>
                      {searchScope !== "project" ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => {
                          setSearchScopeTouched(true);
                          setSearchScope("project");
                        }}>
                          Search entire project
                        </Button>
                      ) : null}
                      {currentFolder && searchScope === "folder" ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => {
                          setSearchScopeTouched(true);
                          setSearchScope("branch");
                        }}>
                          Include subfolders
                        </Button>
                      ) : null}
                    </div>
                  </EmptyHeader>
                </Empty>
              ) : null}

              {searchQuery && hasSearchResults ? (
                <div
                  className="space-y-6"
                  onPointerDownCapture={() => setDismissSearchSuggestionsSignal((current) => current + 1)}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {searchFolderResults.length + searchStackGroups.length} result{searchFolderResults.length + searchStackGroups.length === 1 ? "" : "s"}
                      {" "}for “{assetSearch.trim()}”
                    </span>
                    <span>•</span>
                    <span>{searchFolderResults.length} folder{searchFolderResults.length === 1 ? "" : "s"}</span>
                    <span>•</span>
                    <span>{searchStackGroups.length} asset{searchStackGroups.length === 1 ? "" : "s"}</span>
                  </div>

                  {searchFolderResults.length > 0 ? (
                    <section className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-foreground">Folders</span>
                        <span className="text-muted-foreground/90">
                          {searchFolderResults.length} {searchFolderResults.length === 1 ? "match" : "matches"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {searchFolderResults.map(({ folder }) => {
                          const path = formatRelativeFolderPath(folder, foldersById);
                          const matchCount = searchFolderMatchCounts.get(folder.id) ?? 0;
                          const selected = selectedFolderIds.includes(folder.id);
                          const folderMatched = folderSearchText(folder, foldersById).includes(searchQuery);
                          return (
                            <FolderLevelCard
                              key={folder.id}
                              folder={folder}
                              itemCount={matchCount}
                              previewImages={folderPreviewMap.get(folder.id) ?? []}
                              nameContent={highlightMatch(folder.name, assetSearch.trim())}
                              subtitleContent={path !== "/" ? highlightMatch(path, assetSearch.trim()) : undefined}
                              matchReason={folderMatched ? "Folder match" : "Matching assets inside"}
                              onOpen={() => {
                                if (selectionMode) {
                                  toggleFolderSelection(folder.id, !selected);
                                  return;
                                }
                                goToFolder(folder.id);
                              }}
                              onToggleSelected={(selectedNext) => toggleFolderSelection(folder.id, selectedNext)}
                              selected={selected}
                              selectionMode={selectionMode}
                              footerActions={selectionMode ? undefined : (
                                <FolderActionsMenu
                                  folderName={folder.name}
                                  onDownload={() => void handleDownloadFolder(folder)}
                                  downloadLabel="Download as ZIP"
                                  onRename={() => requestRenameFolder(folder)}
                                  onDelete={() => requestDeleteFolder(folder)}
                                  trigger={(
                                    <button
                                      type="button"
                                      className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-background/90 hover:text-foreground"
                                      aria-label={`Actions for ${folder.name}`}
                                    >
                                      ...
                                    </button>
                                  )}
                                />
                              )}
                              draggable={!selectionMode}
                              isDragging={!selectionMode && draggingFolderId === folder.id}
                              isDragTarget={!selectionMode && folderDropTargetId === folder.id}
                              onDragStart={!selectionMode ? handleFolderDragStart(folder.id) : undefined}
                              onDragEnd={!selectionMode ? handleFolderDragEnd : undefined}
                              onDragOver={!selectionMode ? handleFolderDragOver(folder.id) : undefined}
                              onDragLeave={!selectionMode ? handleFolderDragLeave(folder.id) : undefined}
                              onDrop={!selectionMode ? handleFolderDrop(folder.id) : undefined}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {searchStackGroups.length > 0 ? (
                    <section className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-foreground">Assets</span>
                        <span className="text-muted-foreground/90">
                          {searchStackGroups.length} {searchStackGroups.length === 1 ? "match" : "matches"}
                        </span>
                      </div>
                      <div className="grid items-start gap-5 grid-cols-[repeat(auto-fill,minmax(204px,1fr))] sm:grid-cols-[repeat(auto-fill,204px)]">
                        {searchStackGroups.map(({ stack }) => {
                          const top = stack[0];
                          const path = formatRelativeFolderPath(
                            top.folder_id ? foldersById.get(top.folder_id) : null,
                            foldersById,
                          );
                          const rootId = rootIdOf(top);
                          const selected = selectedRootIds.includes(rootId);
                          const details = getAssetMatchDetails(top, assetSearch, foldersById, assetSearchIndex.get(top.id), projectPeopleById);
                          return (
                            <AssetCard
                              key={top.id}
                              asset={top}
                              onStatusChange={handleStatusChange}
                              onClick={() => navigate(projectAssetPath(top), {
                                state: {
                                  asset: top,
                                  folderTrail: currentFolderTrail.map((folder) => ({
                                    id: folder.id,
                                    name: folder.name,
                                    parent_folder_id: folder.parent_folder_id ?? null,
                                    project_id: folder.project_id ?? null,
                                  })),
                                },
                              })}
                              onDownload={handleDownload}
                              onDelete={requestDeleteAssetById}
                              onEdit={handleEditAsset}
                              onCompare={stack.length > 1 ? (asset) => navigate(projectAssetPath(asset, {
                                assetId: asset.parent_asset_id || asset.id,
                                suffix: "/compare",
                              })) : undefined}
                              stackCount={stack.length}
                              sortKey={sortKey}
                              userProfiles={orgMembers.map(member => ({
                                id: member.user_id,
                                display_name: member.profile?.display_name,
                                avatar_url: member.profile?.avatar_url,
                              }))}
                              onMoveToFolder={requestMoveToFolder}
                              selectable
                              selectionMode={selectionMode}
                              selected={selected}
                              onSelectedChange={(selectedNext) => toggleStackSelection(rootId, selectedNext)}
                              selectionAriaLabel={`Select ${top.name}`}
                              titleContent={highlightMatch(top.name, assetSearch.trim())}
                              subtitleContent={path !== "/" ? highlightMatch(path, assetSearch.trim()) : undefined}
                              matchReason={matchSummary(details)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : (
                <>
                  {activeUploads.length > 0 ? (
                    <section className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">
                            {activeUploads.some((item) => item.relativePath) ? "Preparing folder upload" : "Uploads in progress"}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {activeUploads.some((item) => item.relativePath)
                              ? "Your desktop folder is being expanded into project folders before the files appear."
                              : "Files are uploading into the right folder."
                            }
                          </p>
                        </div>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {activeUploads.length} active
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        <AnimatePresence mode="popLayout">
                          {activeUploads.map((item) => (
                            <div key={item.id} className="relative">
                              <UploadProgressCard
                                item={item}
                                onCancel={cancelUpload || (() => { })}
                              />
                            </div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </section>
                  ) : null}

                  {childFolders.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-foreground">Folders</span>
                          <span className="text-muted-foreground/90">
                            {childFolders.length} {childFolders.length === 1 ? "folder" : "folders"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {childFolders.map((folder) => (
                          <FolderLevelCard
                            key={folder.id}
                            folder={folder}
                            itemCount={folderCounts.get(folder.id) ?? 0}
                            previewImages={folderPreviewMap.get(folder.id) ?? []}
                            onOpen={() => goToFolder(folder.id)}
                            onToggleSelected={(selected) => toggleFolderSelection(folder.id, selected)}
                            selected={selectedFolderIds.includes(folder.id)}
                            selectionMode={selectionMode}
                            footerActions={selectionMode ? undefined : (
                              <FolderActionsMenu
                                folderName={folder.name}
                                onDownload={() => void handleDownloadFolder(folder)}
                                downloadLabel="Download as ZIP"
                                onRename={() => requestRenameFolder(folder)}
                                onDelete={() => requestDeleteFolder(folder)}
                                trigger={(
                                  <button
                                    type="button"
                                    className="rounded-md px-2 py-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-background/90 hover:text-foreground"
                                    aria-label={`Actions for ${folder.name}`}
                                  >
                                    ...
                                  </button>
                                )}
                              />
                            )}
                            draggable={!selectionMode}
                            isDragging={!selectionMode && draggingFolderId === folder.id}
                            isDragTarget={!selectionMode && folderDropTargetId === folder.id}
                            onDragStart={!selectionMode ? handleFolderDragStart(folder.id) : undefined}
                            onDragEnd={!selectionMode ? handleFolderDragEnd : undefined}
                            onDragOver={!selectionMode ? handleFolderDragOver(folder.id) : undefined}
                            onDragLeave={!selectionMode ? handleFolderDragLeave(folder.id) : undefined}
                            onDrop={!selectionMode ? handleFolderDrop(folder.id) : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={cn("space-y-3", childFolders.length > 0 && "border-t border-border/60 pt-5")}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-foreground">Assets</span>
                      <span className="text-muted-foreground/90">
                        {folderScopedAssets.length} {folderScopedAssets.length === 1 ? "item" : "items"}
                      </span>
                      {activeUploads.length > 0 ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {activeUploads.some((item) => item.relativePath) ? "Preparing folder upload" : "Uploading"}
                        </span>
                      ) : null}
                    </div>

                    {folderScopedAssets.length > 0 || activeUploads.length > 0 || currentFolder ? (
                      <VersionStacksGrid
                        stacks={stacks}
                        sensors={sensors}
                        onDragEnd={onDragEnd}
                        handleStatusChange={handleStatusChange}
                        requestDeleteAssetById={requestDeleteAssetById}
                        workspaceId={workspaceId}
                        project={project}
                        onSaveStack={handleSaveStack}
                        sortKey={sortKey}
                        userProfiles={orgMembers.map(member => ({
                          id: member.user_id,
                          display_name: member.profile?.display_name,
                          avatar_url: member.profile?.avatar_url,
                        }))}
                        onEditAsset={handleEditAsset}
                        onAssetClick={(asset) => navigate(projectAssetPath(asset), {
                          state: {
                            asset,
                            folderTrail: currentFolderTrail.map((folder) => ({
                              id: folder.id,
                              name: folder.name,
                              parent_folder_id: folder.parent_folder_id ?? null,
                              project_id: folder.project_id ?? null,
                            })),
                          },
                        })}
                        onCompareClick={(asset) => navigate(projectAssetPath(asset, {
                          assetId: asset.parent_asset_id || asset.id,
                          suffix: "/compare",
                        }))}
                        onDownloadClick={handleDownload}
                        onMoveToFolder={requestMoveToFolder}
                        deleteLabel="Remove from project"
                        onTriggerUpload={handleTriggerUpload}
                        selectedRootIds={selectedRootIds}
                        onToggleSelection={toggleStackSelection}
                        selectionMode={selectionMode}
                      />
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Kanban */}
          <TabsContent value="kanban">
            <KanbanBoard
              assets={filteredAssets}
              onStatusChange={handleStatusChange}
              workspaceId={workspaceId}
              projectId={String(project.id)}
              userProfiles={orgMembers.map(member => ({
                id: member.user_id,
                display_name: member.profile?.display_name,
                avatar_url: member.profile?.avatar_url,
              }))}
              onEditAsset={handleEditAsset}
              onAssignReviewer={handleAssignReviewer}
              onAssetClick={(asset) => navigate(projectAssetPath(asset), {
                state: {
                  asset,
                  folderTrail: currentFolderTrail.map((folder) => ({
                    id: folder.id,
                    name: folder.name,
                    parent_folder_id: folder.parent_folder_id ?? null,
                    project_id: folder.project_id ?? null,
                  })),
                },
              })}
              onDownloadClick={handleDownload}
              onDownloadAssets={(rows, label) => {
                const projectLabel = sanitizeDownloadName(project.name || "project") || "project";
                void downloadAssetArchive(rows, {
                  label,
                  archiveName: `${projectLabel} - ${sanitizeDownloadName(label)}.zip`,
                });
              }}
            />
          </TabsContent>

          <TabsContent value="reviewers">
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Reviewers</h2>
                </div>

                <div>
                  {loadingReviewers ? (
                    <div className="text-sm text-muted-foreground">Loading reviewers...</div>
                  ) : reviewers.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Users className="h-6 w-6" />
                        </EmptyMedia>
                        <EmptyTitle>No reviewers</EmptyTitle>
                        <EmptyDescription>
                          Invite reviewers by email or share review links. Guests appear here after they leave feedback.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <Card>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Reviewer</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Assets</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reviewers.map((r) => {
                              const isGuestReviewer = r.type === "guest";
                              const reviewerName = r.profile?.display_name ?? r.user_id ?? (r.email ?? "Unknown");
                              const reviewerKey = r.user_id ?? r.email ?? "";
                              const interactedAssets = reviewerAssetMap.get(reviewerKey) ?? [];
                              const visibleAssets = interactedAssets.slice(0, 3);
                              const hiddenAssetCount = Math.max(0, interactedAssets.length - visibleAssets.length);

                              return (
                                <TableRow key={reviewerKey}>
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <Avatar>
                                        {r.profile?.avatar_url ? (
                                          <AvatarImage src={r.profile.avatar_url} />
                                        ) : (
                                          <AvatarFallback className={AVATAR_FALLBACK_CLASS}>
                                            {getAvatarInitials(r.profile?.display_name)}
                                          </AvatarFallback>
                                        )}
                                      </Avatar>
                                      <div>
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                          <span>{reviewerName}</span>
                                          {isGuestReviewer ? (
                                            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px] font-normal">
                                              Guest
                                            </Badge>
                                          ) : null}
                                        </div>
                                        {isGuestReviewer && r.last_seen_at ? (
                                          <div className="text-xs text-muted-foreground">
                                            Last commented {new Date(r.last_seen_at).toLocaleDateString()}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {r.email ? (
                                      <a
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:underline"
                                        href={`mailto:${r.email}`}
                                      >
                                        <Mail className="h-4 w-4" />
                                        <span className="truncate">{r.email}</span>
                                      </a>
                                    ) : (
                                      <div className="text-sm text-muted-foreground">—</div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm capitalize">{r.role ?? "reviewer"}</div>
                                    {isGuestReviewer && typeof r.comment_count === "number" ? (
                                      <div className="text-xs text-muted-foreground">
                                        {r.comment_count} comment{r.comment_count === 1 ? "" : "s"}
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>
                                    {visibleAssets.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {visibleAssets.map((asset) => (
                                          <button
                                            key={asset.id}
                                            type="button"
                                            className="group inline-flex max-w-[240px] items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2 py-1.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/60"
                                            onClick={() => navigate(projectAssetPath(asset))}
                                          >
                                            <span className="grid h-8 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                                              {asset.coverUrl ? (
                                                <img src={asset.coverUrl} alt="" className="h-full w-full object-cover" />
                                              ) : (
                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                              )}
                                            </span>
                                            <span className="min-w-0">
                                              <span className="block truncate text-xs font-medium text-foreground group-hover:text-primary">
                                                {asset.name || "Untitled asset"}
                                              </span>
                                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                                {assetStatusLabel(asset.status)}
                                              </span>
                                            </span>
                                          </button>
                                        ))}
                                        {hiddenAssetCount > 0 ? (
                                          <Badge variant="secondary" className="h-7 self-center rounded-full px-2 text-[11px] font-normal">
                                            +{hiddenAssetCount}
                                          </Badge>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-muted-foreground">No asset activity yet</div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="links">
            <ProjectShareLinks projectId={project.id} />
          </TabsContent>
        </Tabs>
        </div>

        {/* Delete confirmation dialog (shadcn boxed) */}
        <Dialog open={deleteOpen} onOpenChange={(v) => { if (!v) { setDeleteOpen(false); setDeleteTarget(null); } else setDeleteOpen(v); }}>
          <DialogContent className="sm:max-w-sm w-full">
            <DialogHeader>
              <DialogTitle>Remove asset from project</DialogTitle>
            </DialogHeader>
            <div className="py-2 text-sm text-muted-foreground">
              {deleteTarget ? (
                <p>
                  Remove <strong>{deleteTarget.name}</strong> from <strong>{project.name}</strong>? The asset stays in the workspace library.
                </p>
              ) : (
                <p>Remove this asset from the project?</p>
              )}
            </div>
            <DialogFooter>
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => { setDeleteOpen(false); setDeleteTarget(null); }}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={() => { if (deleteTarget) void performDeleteAsset(deleteTarget); }} disabled={deleting}>
                  {deleting ? "Removing..." : "Remove"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Folder</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="text-sm text-muted-foreground">
                {currentFolder
                  ? `This folder will be created inside ${currentFolder.name}.`
                  : "This folder will be created at the project root."}
              </div>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateFolderOpen(false)} disabled={savingFolder}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateFolder()} disabled={savingFolder || !newFolderName.trim()}>
                {savingFolder ? "Creating..." : "Create Folder"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={renameFolderOpen}
          onOpenChange={(open) => {
            setRenameFolderOpen(open);
            if (!open) {
              setFolderToRename(null);
              setRenameFolderName("");
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rename Folder</DialogTitle>
              <DialogDescription>
                Update the folder name. Existing files stay in place.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Input
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                placeholder="Folder name"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRenameFolderOpen(false)}
                disabled={renamingFolder}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleRenameFolder()}
                disabled={renamingFolder || !renameFolderName.trim()}
              >
                {renamingFolder ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={Boolean(folderToDelete)}
          onOpenChange={(open) => {
            if (!open) setFolderToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Folder</AlertDialogTitle>
              <AlertDialogDescription>
                {folderToDelete ? (
                  <>
                    Delete <strong>{folderToDelete.name}</strong> and everything inside it?
                    This will also delete {folderDeleteImpact.assetCount} asset{folderDeleteImpact.assetCount === 1 ? "" : "s"}
                    {folderDeleteImpact.subfolderCount > 0 ? ` and ${folderDeleteImpact.subfolderCount} nested folder${folderDeleteImpact.subfolderCount === 1 ? "" : "s"}` : ""}.
                  </>
                ) : (
                  "Delete this folder and everything inside it?"
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingFolder}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteFolder();
                }}
                disabled={deletingFolder}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingFolder ? "Deleting..." : "Delete Folder"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={moveFolderOpen}
          onOpenChange={(open) => {
            setMoveFolderOpen(open);
            if (!open) {
              setMoveFolderTarget(null);
              setMoveFolderId(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Move To Folder</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="text-sm text-muted-foreground">
                {moveFolderTarget ? `Choose where ${moveFolderTarget.name} should live.` : "Choose a destination folder."}
              </div>
              <div className="grid gap-2 max-h-80 overflow-y-auto">
                <Button
                  type="button"
                  variant={moveFolderId === null ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setMoveFolderId(null)}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Project Root
                </Button>
                {folders.filter((folder) => projectVisibleFolderIds.has(folder.id)).map((folder) => (
                  <Button
                    key={folder.id}
                    type="button"
                    variant={moveFolderId === folder.id ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => setMoveFolderId(folder.id)}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {folder.name}
                  </Button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMoveFolderOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleMoveToFolder()}>
                Move Asset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
          <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
            <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
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
                    ? `Move ${selectionLabel} to a folder in ${project.name} or into another project.`
                    : `Copy ${selectionLabel} into another project. Copied assets will appear at the destination project root.`}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                  {selectionSummaryLabel}
                </Badge>
                <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                  Current: {project.name}
                </Badge>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={destinationSearch}
                  onChange={(event) => setDestinationSearch(event.target.value)}
                  placeholder={bulkProjectActionMode === "move" ? "Search projects and folders" : "Search destination projects"}
                  className="h-11 rounded-xl border-border/70 pl-10"
                />
              </div>

              <div className="rounded-3xl border border-border/70 bg-background shadow-sm">
                <div className="border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Destination
                </div>
                <ScrollArea className="max-h-[360px]">
                  <div className="space-y-2 px-3 py-3">
                    {(loadingWorkspaceProjects || (bulkProjectActionMode === "move" && loadingDestinationFolders)) ? (
                      <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading destinations...
                      </div>
                    ) : visibleDestinationProjects.length === 0 ? (
                      <div className="px-3 py-8 text-sm text-muted-foreground">
                        {destinationSearchQuery
                          ? (bulkProjectActionMode === "move" ? "No projects or folders match your search." : "No projects match your search.")
                          : (bulkProjectActionMode === "move" ? "No destinations are available in this workspace." : "No other projects are available in this workspace.")}
                      </div>
                    ) : (
                      visibleDestinationProjects.map((workspaceProject) => {
                        const projectId = String(workspaceProject.id);
                        const isCurrentProjectDestination = String(projectId) === String(project.id);
                        const canUseFolders = canMoveSelectionIntoProjectFolders(projectId);
                        const childrenByParent = destinationChildFoldersByProject.get(projectId) ?? new Map<string | null, FolderRow[]>();
                        const hasChildren = canUseFolders && (childrenByParent.get(null) ?? []).length > 0;
                        const isExpanded = destinationSearchQuery.length > 0 || expandedDestinationProjectIds.includes(projectId);
                        const isSelected = String(selectedDestinationProjectId) === projectId && !selectedDestinationFolderId;
                        const isComposerParent = canUseFolders && destinationFolderDraftTarget?.projectId === projectId
                          && destinationFolderDraftTarget?.parentFolderId === null;

                        return (
                          <div key={workspaceProject.id} className="space-y-1">
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => selectDestinationLocation(projectId, null)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  selectDestinationLocation(projectId, null);
                                }
                              }}
                              className={cn(
                                "group flex items-center gap-2 rounded-2xl border px-3 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                                isSelected
                                  ? "border-primary/30 bg-primary/[0.08] text-foreground shadow-sm"
                                  : "border-transparent hover:border-border/70 hover:bg-muted/45",
                              )}
                            >
                              <button
                                type="button"
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
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{workspaceProject.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {isCurrentProjectDestination
                                    ? "Current project root"
                                    : bulkProjectActionMode === "move" && !canUseFolders
                                    ? "Project root only for this selection"
                                    : "Project root"}
                                </div>
                              </div>
                              {bulkProjectActionMode === "move" && canUseFolders ? (
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
                              {isSelected ? (
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <Check className="h-3.5 w-3.5" />
                                </span>
                              ) : null}
                            </div>
                            {bulkProjectActionMode === "move" && canUseFolders ? renderDestinationFolderComposer(projectId, null, 1) : null}
                            {bulkProjectActionMode === "move" && canUseFolders && hasChildren && (isExpanded || isComposerParent) ? (
                              <div className="space-y-1">
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

            <DialogFooter className="border-t border-border/60 px-6 py-4 sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {selectedDestinationIsBlocked
                  ? "Choose a destination outside the selected folders."
                  : selectedDestinationProjectId
                  ? `Destination: ${selectedDestinationPathLabel}`
                  : "Choose a destination project to continue."}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setBulkProjectActionOpen(false)}
                  disabled={runningBulkProjectAction || creatingDestinationFolder}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleBulkProjectAction()}
                  disabled={!selectedDestinationProjectId || selectedDestinationIsBlocked || runningBulkProjectAction || loadingWorkspaceProjects || (bulkProjectActionMode === "move" && loadingDestinationFolders) || creatingDestinationFolder}
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
                      {bulkProjectActionMode === "move" ? "Move selected items" : "Copy selected assets"}
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={selectionDeleteOpen}
          onOpenChange={(open) => {
            if (!open) setSelectionDeleteOpen(false);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Selection</AlertDialogTitle>
              <AlertDialogDescription>
                Delete {selectionLabel} from this project?
                {selectedFolderCount > 0
                  ? ` This also removes ${selectedFolderAssets.length} asset${selectedFolderAssets.length === 1 ? "" : "s"} inside the selected folder${selectedFolderCount === 1 ? "" : "s"}.`
                  : " Selected assets are removed from this project but remain in the workspace library."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={runningSelectionAction}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteSelection();
                }}
                disabled={runningSelectionAction}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {runningSelectionAction ? "Deleting..." : "Delete selected items"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Add Existing Asset</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search workspace library"
              />
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {loadingLibraryAssets ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading library assets...
                  </div>
                ) : attachableLibraryAssets.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No library assets are available to add to this project.
                  </div>
                ) : (
                  attachableLibraryAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{asset.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {mimeKind(asset.type)} • {asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : "Unknown date"}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => void handleAttachExistingAsset(asset)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add To Project
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <InviteReviewersDialog
          open={inviteReviewerOpen}
          onOpenChange={setInviteReviewerOpen}
          projectName={project?.name}
          onSend={async (emails: string[], message: string) => {
            await handleSendInvite(emails, message);
            setInviteReviewerOpen(false);
          }}
        />

        <InviteOrgMemberDialog
          open={inviteMemberOpen}
          onOpenChange={setInviteMemberOpen}
          organizationId={organizationId}
          onInviteSent={() => {
            // Maybe reload org members?
            toast.success("Invitation sent successfully");
          }}
        />

        {/* Edit Asset Dialog */}
        <Dialog open={!!editingAsset} onOpenChange={(open) => !open && setEditingAsset(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Asset</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="asset-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="asset-name"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  placeholder="Asset name"
                />
                <p className="text-xs text-muted-foreground">
                  Only the display name will be updated. The original filename and path remain unchanged.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingAsset(null)} disabled={isUpdatingAsset}>
                Cancel
              </Button>
              <Button onClick={handleSaveAssetEdit} disabled={isUpdatingAsset || !newAssetName.trim()}>
                {isUpdatingAsset ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Project Dialog */}
        <Dialog open={editingProject} onOpenChange={(open) => !open && setEditingProject(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="project-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingProject(false)} disabled={isUpdatingProject}>
                Cancel
              </Button>
              <Button onClick={handleSaveProjectEdit} disabled={isUpdatingProject || !newProjectName.trim()}>
                {isUpdatingProject ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Review Web Page Dialog */}
        <Dialog open={screenshotDialogOpen} onOpenChange={setScreenshotDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Review Web Page
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleScreenshotSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="url" className="text-sm font-medium">URL to review</label>
                <Input
                  id="url"
                  placeholder="https://example.com"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  We'll capture a full-page screenshot for you to annotate.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium">Title (optional)</label>
                <Input
                  id="title"
                  placeholder="Homepage Redesign"
                  value={screenshotTitle}
                  onChange={(e) => setScreenshotTitle(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setScreenshotDialogOpen(false)}
                  disabled={isGeneratingScreenshot}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isGeneratingScreenshot || !screenshotUrl.trim()}>
                  {isGeneratingScreenshot ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Capturing...
                    </>
                  ) : (
                    "Capture & Review"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider >
  );
}

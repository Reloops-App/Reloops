import type { CollectionFilterPersonOption } from "@/pages/Collections/components/CollectionFilterPopover";
import type { CollectionAsset } from "@/lib/collections";
import { resolveMediaUrl } from "@/lib/mediaDelivery";
import { isLiveUrlReviewAsset } from "@/lib/liveUrlReview";
import { apiKeyActorProfileId } from "@/lib/api-key-actors";
import {
  compareFileExtensions,
  compareMimeKinds,
  groupByRoot,
  mimeKind,
  normalizeAssets,
  rootIdOf,
  STATUS_ORDER as UTIL_STATUS_ORDER,
} from "@/lib/assetUtils";
import { type Asset, type ColumnKey, STATUS_STYLES, toColumnKey } from "./CampaignTypes";

export {
  compareFileExtensions,
  compareMimeKinds,
  groupByRoot,
  mimeKind,
  normalizeAssets,
  rootIdOf,
};

export const STATUS_ORDER: Record<ColumnKey, number> = UTIL_STATUS_ORDER as Record<ColumnKey, number>;

export type LibrarySemanticHit = {
  asset_id: string;
  root_id: string;
  score?: number | null;
  similarity?: number | null;
  match_type?: "semantic" | "text" | "none" | string;
};

export type LibraryMatchInfo = {
  label: "Exact match" | "Name match" | "Text match" | "AI match" | "File type match" | "Related match";
  reason: string;
  rank: number;
};

export type FolderRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
};

export type SearchIndexField = {
  label: string;
  value: string;
  normalized: string;
  weight: number;
};

export type AssetSearchIndex = {
  haystack: string;
  fields: SearchIndexField[];
};

export type PeopleLookup = Map<string, CollectionFilterPersonOption>;
type AssetRaw = NonNullable<CollectionAsset["__raw"]>;
type AssetWithRaw = Asset & { __raw?: AssetRaw };

function assetRaw(asset: Asset): AssetRaw {
  return (asset as AssetWithRaw).__raw ?? {};
}

const ATTACH_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "all",
  "asset",
  "assets",
  "file",
  "files",
  "find",
  "for",
  "from",
  "give",
  "in",
  "me",
  "of",
  "show",
  "the",
  "to",
  "with",
]);

const ATTACH_FILE_TYPE_TERMS = new Set([
  "ai",
  "gif",
  "heic",
  "image",
  "jpeg",
  "jpg",
  "mov",
  "mp4",
  "pdf",
  "png",
  "svg",
  "video",
  "webp",
]);

export function readableAssetFileType(asset: Asset) {
  const extension = String(asset.name || "").includes(".")
    ? String(asset.name).split(".").pop()?.toUpperCase()
    : "";
  if (extension) return extension === "JPG" ? "JPEG" : extension;
  const [, subtype] = String(asset.type || "").split("/");
  if (subtype) return subtype.split(";")[0].toUpperCase();
  return "FILE";
}

export function readableAssetKind(asset: Asset) {
  const kind = mimeKind(asset.type);
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "Text";
  return "Asset";
}

export function assetPreviewSource(asset: Asset) {
  if (asset.coverUrl) return asset.coverUrl;
  // Calls resolveMediaUrl(asset.url) directly rather than
  // resolveAssetMediaUrl(asset), so mediaDelivery.ts's own
  // isLiveUrlReviewAsset guard never runs for this call -- a live-url-review
  // asset's storage_path/url is a synthetic placeholder with no real file
  // behind it, so this needs its own guard to be safe on its own. Checked
  // after coverUrl (not before) so a real cover thumbnail, if one's ever
  // added for this asset type, still takes priority.
  if (isLiveUrlReviewAsset(asset)) return null;
  if (!asset.url) return null;
  return resolveMediaUrl(asset.url);
}

export function assetDateChip(asset: Asset) {
  const raw = asset.updated_at ?? asset.createdAt ?? null;
  if (!raw) return "Unknown date";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function normalizeAttachTerm(term: string) {
  const value = normalizeSearchText(term);
  if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

export function getAttachQueryTerms(query: string) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .map(normalizeAttachTerm)
    .filter((term) => term && !ATTACH_SEARCH_STOP_WORDS.has(term));
}

export function attachFileTypeTokens(asset: Asset) {
  const [major, subtypeRaw] = String(asset.type || "").toLowerCase().split("/");
  const subtype = normalizeAttachTerm(subtypeRaw?.split(";")[0] ?? "");
  const extension = normalizeAttachTerm(readableAssetFileType(asset).toLowerCase());
  return new Set(
    [major, subtype, extension, mimeKind(asset.type), subtype === "jpeg" ? "jpg" : "", extension === "jpeg" ? "jpg" : ""]
      .map(normalizeAttachTerm)
      .filter(Boolean),
  );
}

function firstMatchingTerm(text: string, terms: string[]) {
  const normalized = normalizeSearchText(text);
  return terms.find((term) => normalized.includes(term)) ?? terms[0] ?? "";
}

function attachSearchPhrase(query: string, fallback = "your search") {
  const terms = getAttachQueryTerms(query).filter((term) => !ATTACH_FILE_TYPE_TERMS.has(term));
  const phrase = terms.join(" ").trim();
  return phrase || normalizeSearchText(query) || fallback;
}

function bestAttachTextField(index: AssetSearchIndex, terms: string[], labels: string[]) {
  return [...index.fields]
    .sort((left, right) => right.weight - left.weight)
    .find((field) => {
      const label = normalizeSearchText(field.label);
      if (!labels.some((needle) => label.includes(needle))) return false;
      return terms.some((term) => field.normalized.includes(term) || label.includes(term));
    });
}

export function buildLibraryMatchInfo({
  asset,
  index,
  query,
  semanticScore,
  semanticMatchType,
}: {
  asset: Asset;
  index: AssetSearchIndex;
  query: string;
  semanticScore: number;
  semanticMatchType?: string | null;
}): LibraryMatchInfo {
  const terms = getAttachQueryTerms(query);
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(asset.name);
  const nameWithoutExtension = normalizeSearchText(String(asset.name || "").replace(/\.[^.]+$/, ""));
  const fileTokens = attachFileTypeTokens(asset);
  const fileTypeTerm = terms.find((term) => fileTokens.has(term) || (ATTACH_FILE_TYPE_TERMS.has(term) && fileTokens.has(normalizeAttachTerm(term))));
  const nonTypeTerms = terms.filter((term) => !fileTokens.has(term) && !ATTACH_FILE_TYPE_TERMS.has(term));
  const nameTerm = firstMatchingTerm(asset.name, nonTypeTerms);
  const nameMatches = Boolean(nameTerm) || Boolean(nonTypeTerms.length && nonTypeTerms.every((term) => normalizedName.includes(term)));
  const exactName = Boolean(normalizedQuery && (normalizedName === normalizedQuery || nameWithoutExtension === normalizedQuery));
  const textField = bestAttachTextField(index, terms, ["ocr", "transcript", "caption", "detected text", "extracted"]);
  const descriptionField = bestAttachTextField(index, terms, ["description", "smart description", "ai description", "visual", "ai metadata"]);
  const relatedField = bestAttachTextField(index, terms, ["tag", "keyword", "label", "metadata", "folder", "project"]);
  const quotedNameTerm = nameTerm || attachSearchPhrase(query);
  const quoted = `“${quotedNameTerm}”`;

  if ((exactName || nameMatches) && fileTypeTerm) {
    return {
      label: "Exact match",
      reason: `Matched because ${quoted} appears in the file name and this asset is a ${readableAssetFileType(asset)}.`,
      rank: 6000,
    };
  }

  if (exactName || nameMatches) {
    return {
      label: "Name match",
      reason: `Matched because ${quoted} appears in the file name.`,
      rank: 5200,
    };
  }

  if (fileTypeTerm) {
    return {
      label: "File type match",
      reason: `Matched because this asset is a ${readableAssetFileType(asset)}.`,
      rank: 4400,
    };
  }

  if (textField) {
    return {
      label: "Text match",
      reason: `Matched because text inside the asset includes “${firstMatchingTerm(textField.value, terms) || attachSearchPhrase(query)}”.`,
      rank: 3600,
    };
  }

  if (semanticScore > 0 || semanticMatchType === "semantic" || descriptionField) {
    return {
      label: "AI match",
      reason: `Matched because the asset description is related to “${attachSearchPhrase(query)}”.`,
      rank: 2800,
    };
  }

  if (relatedField) {
    return {
      label: "Related match",
      reason: `Matched because related metadata includes “${firstMatchingTerm(relatedField.value, terms) || attachSearchPhrase(query)}”.`,
      rank: 1800,
    };
  }

  return {
    label: "Related match",
    reason: query ? "Shown because it is related to your search." : "Shown because it is an available workspace asset.",
    rank: 1000,
  };
}

export function projectAssetToCollectionAsset(asset: Asset): CollectionAsset {
  const raw = assetRaw(asset);
  const assigneeValues = assetAssigneeFilterValues(asset);
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    project_id: asset.project_id ?? null,
    created_by: raw.created_by ?? null,
    uploaded_by: raw.uploaded_by ?? null,
    updated_by: raw.updated_by ?? null,
    description: asset.description ?? raw.description ?? null,
    ai_description: asset.ai_description ?? raw.ai_description ?? raw.aiDescription ?? null,
    tags: Array.isArray(asset.tags) ? asset.tags : Array.isArray(raw.tags) ? raw.tags : [],
    smart_tags: Array.isArray(asset.smart_tags) ? asset.smart_tags : Array.isArray(raw.smart_tags) ? raw.smart_tags : [],
    smart_description: asset.smart_description ?? raw.smart_description ?? null,
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
    assigned_to: assigneeValues[0] ?? null,
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

function apiKeyAssigneeValue(value: unknown) {
  if (!value) return null;
  const id = String(value).trim();
  if (!id) return null;
  return id.startsWith("api-key:") ? id : apiKeyActorProfileId(id);
}

export function assetAssigneeFilterValues(asset: Asset) {
  const raw = assetRaw(asset);
  const values = new Set<string>();
  for (const value of [asset.assigned_to, raw.assigned_to, raw.assignee, raw.assigned_user]) {
    if (!value) continue;
    const id = String(value).trim();
    if (id) values.add(id);
  }
  for (const value of [asset.assigned_to_api_key_id, raw.assigned_to_api_key_id, raw.assignedToApiKeyId]) {
    const id = apiKeyAssigneeValue(value);
    if (id) values.add(id);
  }
  return Array.from(values);
}

export function parseAssigneeFilter(value: string) {
  if (!value || value === "all") return [];
  return normalizeIdList(value);
}

export function assetIncludesReviewer(asset: Asset, reviewerId: string | null | undefined) {
  if (!reviewerId) return false;
  const raw = assetRaw(asset);
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

export function assetStatusLabel(status: Asset["status"]) {
  const key = toColumnKey(status as string | null);
  return key === "none" ? "No status" : STATUS_STYLES[key]?.label ?? "Review";
}

export function sameFolderRows(a: FolderRow[] | undefined, b: FolderRow[] | undefined) {
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

export function sameStringList(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function sameTrail(
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

export function collectFolderIds(folderId: string, folders: FolderRow[]) {
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

export function folderPathParts(folderId: string | null | undefined, foldersById: Map<string, FolderRow>) {
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

export function sanitizeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, " - ").replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const SEARCH_TERM_EQUIVALENTS: Record<string, string[]> = {
  music: ["music", "lyric", "lyrics", "song", "audio", "suno", "soundtrack"],
  lyric: ["lyric", "lyrics", "music", "song", "captioned"],
  lyrics: ["lyrics", "lyric", "music", "song", "captioned"],
  song: ["song", "music", "lyric", "lyrics", "audio", "suno"],
  songs: ["song", "songs", "music", "lyric", "lyrics", "audio", "suno"],
};

const SEARCH_COMMAND_STOP_WORDS = new Set([
  "a",
  "an",
  "all",
  "and",
  "any",
  "asset",
  "assets",
  "by",
  "file",
  "files",
  "find",
  "for",
  "from",
  "get",
  "give",
  "i",
  "in",
  "list",
  "look",
  "looking",
  "me",
  "need",
  "of",
  "please",
  "search",
  "show",
  "that",
  "the",
  "to",
  "want",
  "with",
]);

export function canonicalSearchTerm(term: string) {
  if (SEARCH_TERM_EQUIVALENTS[term]) return term;
  if (term.length > 3 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 3 && term.endsWith("es")) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s")) return term.slice(0, -1);
  return term;
}

export function equivalentSearchTerms(term: string) {
  return SEARCH_TERM_EQUIVALENTS[term] ?? SEARCH_TERM_EQUIVALENTS[canonicalSearchTerm(term)] ?? [term];
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

export function matchScore(texts: Array<string | null | undefined>, query: string) {
  if (!query) return 0;
  const q = normalizeSearchText(query);
  const terms = getQueryTerms(query);
  let score = 0;
  for (const raw of texts) {
    const text = normalizeSearchText(raw);
    if (!text) continue;
    if (text === q) score = Math.max(score, 100);
    else if (text.startsWith(q)) score = Math.max(score, 90);
    else if (text.includes(q)) score = Math.max(score, 70);
    else if (terms.length > 0 && terms.every((term) => equivalentSearchTerms(term).some((equivalentTerm) => text.includes(equivalentTerm)))) {
      score = Math.max(score, 55);
    }
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

export function getQueryTerms(query: string) {
  const terms = normalizeSearchText(query)
    .split(/\s+/)
    .map(canonicalSearchTerm)
    .filter((term) => term && !SEARCH_COMMAND_STOP_WORDS.has(term));
  return terms.length > 0 ? terms : normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

export function buildAssetSearchIndex(asset: Asset, foldersById: Map<string, FolderRow>, peopleById: PeopleLookup = new Map()): AssetSearchIndex {
  const raw = assetRaw(asset);
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
  pushPersonSearchField(fields, "Assignee", [
    ...assetAssigneeFilterValues(asset),
    raw.assigned_profile,
  ], peopleById, 9);
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
  pushSearchField(fields, "Smart description", asset.smart_description ?? raw.smart_description, 7);
  pushSearchField(fields, "AI description", asset.ai_description ?? raw.ai_description ?? raw.aiDescription ?? raw.generated_description ?? raw.auto_description, 7);
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

  for (const key of ["tags", "smart_tags", "ai_tags", "labels", "keywords"]) {
    const value = raw[key];
    if (Array.isArray(value)) value.forEach((entry) => pushSearchField(fields, key.replace(/_/g, " "), entry, 8));
    else pushSearchField(fields, key.replace(/_/g, " "), value, 8);
  }

  pushObjectFields(fields, raw.metadata, "Metadata", 6);
  pushObjectFields(fields, raw.custom_metadata, "Custom metadata", 6);
  pushObjectFields(fields, raw.ai_metadata, "AI metadata", 5);
  pushObjectFields(fields, raw.extracted_metadata, "Extracted metadata", 5);
  pushObjectFields(fields, raw.content_metadata, "Content metadata", 5);
  pushObjectFields(fields, raw.ocr, "OCR", 5);
  pushObjectFields(fields, raw.transcript, "Transcript", 5);
  pushObjectFields(fields, raw, "Asset field", 1);

  const haystack = fields.map((field) => `${normalizeSearchText(field.label)} ${field.normalized}`).join(" ");
  return { haystack, fields };
}

export function matchesAssetSearch(index: AssetSearchIndex, query: string) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return true;
  return terms.every((term) => equivalentSearchTerms(term).some((equivalentTerm) => index.haystack.includes(equivalentTerm)));
}

export function scoreAssetSearch(index: AssetSearchIndex, query: string) {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    const equivalentTerms = equivalentSearchTerms(term);
    let best = 0;
    for (const field of index.fields) {
      for (const equivalentTerm of equivalentTerms) {
        if (field.normalized === equivalentTerm) best = Math.max(best, 100 * field.weight);
        else if (field.normalized.startsWith(equivalentTerm)) best = Math.max(best, 80 * field.weight);
        else if (field.normalized.includes(equivalentTerm)) best = Math.max(best, 45 * field.weight);
        else if (normalizeSearchText(field.label).includes(equivalentTerm)) best = Math.max(best, 20 * field.weight);
      }
    }
    score += best;
  }
  return score;
}

// Backend `score` (from search_workspace_assets_semantic, see migration
// 20260806020000_reconcile_asset_semantic_search_score_bands.sql) now comes
// pre-tiered: any real lexical/keyword hit lands >= 500,000, pure-semantic
// hits are capped at 10,000. `scoreAssetSearch` (this file, above) produces
// small local scores (roughly 0-1,200). Combining these by addition or
// multiplication -- as every call site used to do (`local + semantic * 1000`)
// -- re-scales an already-scaled number and makes the final order effectively
// arbitrary. Comparing as a [tier, tiebreak] pair instead keeps the ordering
// rule to one sentence: any real keyword match outranks every AI-only match;
// among AI-only matches, higher similarity wins.
export function getSearchRankKey(
  localScore: number,
  semanticHit?: LibrarySemanticHit | null,
): readonly [number, number] {
  if (localScore > 0 || semanticHit?.match_type === "text") {
    return [0, Math.max(localScore, Number(semanticHit?.score ?? 0))] as const;
  }
  if (semanticHit && Number(semanticHit.similarity ?? 0) > 0) {
    return [1, Number(semanticHit.similarity)] as const;
  }
  return [2, 0] as const;
}

export function compareSearchRank(
  aLocalScore: number,
  aSemanticHit: LibrarySemanticHit | null | undefined,
  bLocalScore: number,
  bSemanticHit: LibrarySemanticHit | null | undefined,
): number {
  const a = getSearchRankKey(aLocalScore, aSemanticHit);
  const b = getSearchRankKey(bLocalScore, bSemanticHit);
  if (a[0] !== b[0]) return a[0] - b[0];
  return b[1] - a[1];
}

// Same ordering as getSearchRankKey/compareSearchRank, folded into a single
// descending-sortable number for call sites that need a plain scalar (e.g. a
// `Map<rootId, number>` used both to sort and as a `> 0` "is this a match at
// all" gate). Tier dominates by a wide, fixed margin so the tiebreak (which
// can itself range up to ~1.1M for an exact SQL lexical hit) can never spill
// into the next tier's range.
export function getSearchRankScore(localScore: number, semanticHit?: LibrarySemanticHit | null): number {
  const [tier, tiebreak] = getSearchRankKey(localScore, semanticHit);
  if (tier >= 2) return 0;
  return (2 - tier) * 10_000_000 + tiebreak;
}

export function getAssetMatchDetails(asset: Asset, query: string, foldersById: Map<string, FolderRow>, index?: AssetSearchIndex, peopleById?: PeopleLookup) {
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

function friendlyMatchField(label: string) {
  const normalized = normalizeSearchText(label);
  if (normalized.includes("transcript")) return "Transcript";
  if (normalized.includes("ocr") || normalized.includes("caption") || normalized.includes("detected text")) return "Captions/OCR";
  if (
    normalized.includes("smart description") ||
    normalized.includes("ai description") ||
    normalized.includes("visual") ||
    normalized.includes("dominant subject") ||
    normalized.includes("search phrase") ||
    normalized.includes("asset type") ||
    normalized.includes("ai metadata")
  ) return "Visual analysis";
  if (normalized.includes("tag") || normalized.includes("keyword") || normalized.includes("label")) return "Tags";
  if (normalized.includes("metadata")) return "Metadata";
  if (normalized.includes("name") || normalized.includes("title")) return "Title";
  if (normalized.includes("description")) return "Description";
  if (normalized.includes("folder") || normalized.includes("path")) return "Folder/path";
  if (normalized.includes("assignee") || normalized.includes("owner") || normalized.includes("reviewer") || normalized.includes(" by")) return "People";
  if (normalized.includes("mime") || normalized.includes("type") || normalized.includes("extension")) return "File type";
  if (normalized.includes("created") || normalized.includes("updated") || normalized.includes("uploaded")) return "Date";
  if (normalized.includes("project")) return "Project";
  if (normalized.includes("status")) return "Status";
  return label.replace(/[_-]+/g, " ");
}

export function matchSummary(details: Array<{ label: string; value: string }>, semanticHit?: LibrarySemanticHit | null) {
  // A semantic hit and a lexical (keyword) match aren't mutually exclusive --
  // an asset can score well on both. Previously, any lexical detail silently
  // suppressed the "AI match" label even when the semantic score was the
  // main reason the asset ranked highly, which made it look like AI search
  // wasn't contributing at all. Surface both, with the similarity percentage
  // so the ranking basis is visible, not just a bare "AI match" label.
  const aiLabel = semanticHit && semanticHit.match_type === "semantic" && Number(semanticHit.score ?? 0) > 0
    ? (typeof semanticHit.similarity === "number"
        ? `AI match (${Math.round(semanticHit.similarity * 100)}%)`
        : "AI match")
    : null;

  if (details.length === 0) {
    if (aiLabel) return aiLabel;
    if (semanticHit && Number(semanticHit.score ?? 0) > 0) return "Text match";
    return null;
  }

  const labels = Array.from(new Set(details.map((detail) => friendlyMatchField(detail.label)))).slice(0, 4);
  const lexicalLabel = `Matched in: ${labels.join(", ")}`;
  return aiLabel ? `${aiLabel} · ${lexicalLabel}` : lexicalLabel;
}

export function formatRelativeFolderPath(folder: FolderRow | null | undefined, foldersById: Map<string, FolderRow>) {
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

export function highlightMatch(text: string, query: string) {
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

export function appendDuplicateSuffix(path: string, occurrence: number) {
  if (occurrence <= 0) return path;

  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  return `${directory}${base} (${occurrence + 1})${extension}`;
}

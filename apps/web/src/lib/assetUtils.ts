// Shared asset utilities used by Campaign pages/components

export function mimeKind(type?: string) {
  if (!type) return "other";
  const [major, minor] = type.split("/");
  if (!major) return "other";
  if (minor === "pdf") return "pdf";
  return major;
}

export function rootIdOf(asset: { id: string; parent_asset_id?: string | null } | any) {
  const p = asset?.parent_asset_id;
  if (p !== null && p !== undefined && String(p) !== "") return String(p);
  return asset.id;
}

export function groupByRoot<T extends { id: string; parent_asset_id?: string | null; version_no?: number | null; createdAt?: string | null }>(assets: T[]) {
  const byRoot = new Map<string, T[]>();
  for (const a of assets) {
    const rid = rootIdOf(a);
    if (!byRoot.has(rid)) byRoot.set(rid, []);
    byRoot.get(rid)!.push(a);
  }
  for (const [, arr] of byRoot) {
    arr.sort((A: any, B: any) => {
      const vA = typeof A.version_no === "number" ? A.version_no : -1;
      const vB = typeof B.version_no === "number" ? B.version_no : -1;
      if (vA !== vB) return vB - vA;
      const tA = A.createdAt ? new Date(A.createdAt).getTime() : 0;
      const tB = B.createdAt ? new Date(B.createdAt).getTime() : 0;
      return tB - tA;
    });
  }
  return byRoot;
}

export function normalizeAsset(a: any) {
  return {
    id: a.id,
    name: a.title ?? a.name ?? a.filename ?? "",
    type: a.mime_type ?? a.type ?? a.content_type ?? "",
    sizeBytes: a.size_bytes ?? a.sizeBytes ?? a.size ?? null,
    createdAt: a.created_at ?? a.createdAt ?? a.uploaded_at ?? null,
    updatedAt: a.updated_at ?? a.updatedAt ?? null,
    uploadedAt: a.uploaded_at ?? a.uploadedAt ?? null,
    created_by: a.created_by ?? a.createdBy ?? null,
    uploaded_by: a.uploaded_by ?? a.uploadedBy ?? null,
    updated_at: a.updated_at ?? a.updatedAt ?? null,
    updated_by: a.updated_by ?? a.updatedBy ?? null,
    description: a.description ?? null,
    ai_description: a.ai_description ?? a.aiDescription ?? null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    smart_tags: Array.isArray(a.smart_tags) ? a.smart_tags : [],
    smart_description: a.smart_description ?? null,
    coverUrl: a.cover_image_url ?? a.coverUrl ?? a.cover_image ?? undefined,
    url: a.url ?? a.path ?? a.storage_path ?? undefined,
    status: a.status ?? null,
    assigned_to: a.assigned_to ?? null, // Add the missing assigned_to field
    parent_asset_id:
      a.parent_asset_id !== undefined && a.parent_asset_id !== null
        ? String(a.parent_asset_id)
        : a.parentAssetId !== undefined && a.parentAssetId !== null
        ? String(a.parentAssetId)
        : null,
    folder_id:
      a.folder_id !== undefined && a.folder_id !== null
        ? String(a.folder_id)
        : a.folderId !== undefined && a.folderId !== null
        ? String(a.folderId)
        : null,
    project_id:
      a.project_id !== undefined && a.project_id !== null
        ? String(a.project_id)
        : a.projectId !== undefined && a.projectId !== null
        ? String(a.projectId)
        : null,
    version_no: a.version_no ?? a.versionNo ?? null,
    comments_count: a.comments_count ?? a.comment_count ?? a.comments ?? 0,
    __raw: a,
  } as any;
}

export function normalizeAssets(arr: any[] | undefined) {
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeAsset);
}

export function buildRecursiveFolderAssetCounts<
  TAsset extends { folder_id?: string | null },
  TFolder extends { id: string; parent_folder_id?: string | null }
>(assets: TAsset[], folders: TFolder[]) {
  const counts = new Map<string | null, number>();
  const parentById = new Map<string, string | null>(
    folders.map((folder) => [folder.id, folder.parent_folder_id ?? null]),
  );

  for (const asset of assets) {
    const folderId = asset.folder_id ?? null;
    counts.set(null, (counts.get(null) ?? 0) + 1);

    if (!folderId) continue;

    const visited = new Set<string>();
    let cursor: string | null = folderId;

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  return counts;
}

export const STATUS_ORDER: Record<string, number> = {
  none: 0,
  needs_review: 1,
  in_review: 2,
  approved: 3,
};

export function nextVersionForRootFromMap(rootId: string, stacksMap: Map<string, any[]>) {
  const stack = stacksMap.get(rootId) || [];
  const max = Math.max(
    0,
    ...stack.map((s: any) => (typeof s.version_no === "number" ? s.version_no : 0))
  );
  return max + 1;
}

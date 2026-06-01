import { admin } from "./supabaseAdmin.ts";

export function rootAssetIdOf(asset: { id: string; parent_asset_id?: string | null }) {
  return asset.parent_asset_id ?? asset.id;
}

type ProjectAssetLinkPlacement = {
  asset_root_id: string;
};

function dedupeById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export async function getProjectLinkedPlacements(projectId: string) {
  const { data, error } = await admin
    .from("project_asset_links")
    .select("asset_root_id")
    .eq("project_id", projectId);

  if (error) throw error;

  const placements = new Map<string, ProjectAssetLinkPlacement>();
  for (const row of data ?? []) {
    const assetRootId = String((row as any).asset_root_id ?? "").trim();
    if (!assetRootId) continue;
    placements.set(assetRootId, {
      asset_root_id: assetRootId,
    });
  }

  return Array.from(placements.values());
}

export async function getAssetStackRowsByRootIds(rootIds: string[]) {
  if (!rootIds.length) return [];

  const [rootsRes, childrenRes] = await Promise.all([
    admin.from("assets").select("*").in("id", rootIds),
    admin.from("assets").select("*").in("parent_asset_id", rootIds),
  ]);

  if (rootsRes.error) throw rootsRes.error;
  if (childrenRes.error) throw childrenRes.error;

  return dedupeById([...(rootsRes.data ?? []), ...(childrenRes.data ?? [])]);
}

export async function listProjectAssetRows(projectId: string) {
  const { data: primaryRows, error: primaryErr } = await admin
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .or(`status.neq.deleted,status.is.null`);

  if (primaryErr) throw primaryErr;

  const linkedPlacements = await getProjectLinkedPlacements(projectId);
  const linkedRootIds = linkedPlacements.map((placement) => placement.asset_root_id);
  const linkedRows = await getAssetStackRowsByRootIds(linkedRootIds);

  const merged = dedupeById([
    ...((primaryRows ?? []) as any[]),
    ...linkedRows.filter((row: any) => row.status !== "deleted"),
  ]);

  merged.sort((a: any, b: any) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });

  return merged;
}

export async function listProjectAssetIds(projectId: string) {
  const rows = await listProjectAssetRows(projectId);
  return rows.map((row: any) => row.id as string);
}

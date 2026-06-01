import { invokeEdgeFunction } from "@/api/edge";
import { normalizeAsset } from "@/lib/assetUtils";
import type { Asset } from "@/pages/Campaign/CampaignTypes";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function refreshAssetUntilCoverReady(assetId: string, options?: {
  workspaceId: string;
  projectId?: string | null;
  attempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
}): Promise<Asset | null> {
  const attempts = options?.attempts ?? 5;
  let delayMs = options?.initialDelayMs ?? 1200;
  const backoffMultiplier = options?.backoffMultiplier ?? 1.6;
  let latest: Asset | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const action = options?.projectId ? "list_project" : "list_library";
    const body = options?.projectId
      ? { action, project_id: options.projectId }
      : { action, workspace_id: options.workspaceId };

    const { data, error } = await invokeEdgeFunction<any>("asset", { method: "POST", body });
    if (error) throw error;

    const rows = Array.isArray(data?.data?.assets)
      ? data.data.assets
      : Array.isArray(data?.data)
        ? data.data
        : [];

    const row = rows.find((candidate: any) => String(candidate.id) === String(assetId));
    latest = row ? (normalizeAsset(row) as Asset) : null;
    if (!latest) return null;
    if (latest.coverUrl) return latest;
    if (attempt < attempts - 1) {
      await sleep(delayMs);
      delayMs = Math.round(delayMs * backoffMultiplier);
    }
  }

  return latest;
}

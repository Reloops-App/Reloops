import { invokeEdgeFunction } from "@/api/edge";

const LAST_ACTIVE_WORKSPACE_KEY = "last-active-workspace-id";

type WorkspaceListItem = {
  ws?: {
    id?: string | null;
  } | null;
};

export function rememberActiveWorkspace(workspaceId: string | null | undefined) {
  if (!workspaceId || typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ACTIVE_WORKSPACE_KEY, workspaceId);
}

export function getRememberedWorkspaceId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_ACTIVE_WORKSPACE_KEY);
}

export async function getDefaultWorkspacePath() {
  try {
    const { data, error } = await invokeEdgeFunction<{ data?: WorkspaceListItem[] }>("workspace", {
      body: { action: "list" },
    });

    if (error) throw error;

    const rows = Array.isArray((data as any)?.data) ? ((data as any).data as WorkspaceListItem[]) : [];
    const workspaceIds = rows
      .map((row) => row.ws?.id)
      .filter((id): id is string => Boolean(id));

    if (workspaceIds.length === 0) return "/workspaces";

    const rememberedWorkspaceId = getRememberedWorkspaceId();
    const workspaceId = rememberedWorkspaceId && workspaceIds.includes(rememberedWorkspaceId)
      ? rememberedWorkspaceId
      : workspaceIds[0];

    rememberActiveWorkspace(workspaceId);
    return `/workspace/${workspaceId}/projects`;
  } catch (error) {
    console.error("Failed to resolve default workspace route", error);
    return "/workspaces";
  }
}

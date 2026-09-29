// deno run --allow-env --allow-net
//
// Public REST API (API-key authenticated) surface for project share links.
// Deliberately separate from functions/api-shares/index.ts so this feature
// never touches that already-shipping code path.
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth, notfound } from "../../shared/apiAuth.ts";
import { listProjectAssetIds } from "../../shared/dam.ts";

const FRONTEND_URL = (Deno.env.get("FRONTEND_URL") ?? "https://reloops.app").replace(/\/+$/, "");

type ApiKeyContext = Awaited<ReturnType<typeof verifyApiKey>>;

function routePartsFor(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const index = segments.indexOf("api-project-shares");
  return index !== -1 ? segments.slice(index + 1) : segments;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadProjectForApiKey(apiKey: NonNullable<ApiKeyContext>, projectId: string) {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === "deleted") return null;
  if (!apiKey.workspace_ids.includes(String(data.workspace_id))) return null;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = await verifyApiKey(req);
    if (!apiKey) return unauth();

    const url = new URL(req.url);
    const routeParts = routePartsFor(url);

    if (routeParts.length === 0 && req.method === "POST") {
      let body: any = {};
      try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

      const { project_id, folder_id = null, folder_ids = null, asset_root_ids = null, expires_at, allow_upload = false } = body;
      if (!project_id) return bad("Missing project_id");

      const project = await loadProjectForApiKey(apiKey, String(project_id));
      if (!project) return notfound("Project not found");

      if (folder_id) {
        const { data: folder, error: folderError } = await admin
          .from("folders")
          .select("id, project_id, deleted_at")
          .eq("id", folder_id)
          .maybeSingle();
        if (folderError || !folder || folder.deleted_at) return notfound("Folder not found");
        if (String(folder.project_id) !== String(project_id)) return bad("Folder does not belong to this project");
      }

      const selectedFolderIds: string[] = Array.isArray(folder_ids) ? folder_ids.filter((id: unknown) => typeof id === "string" && id) : [];
      const selectedAssetRootIds: string[] = Array.isArray(asset_root_ids) ? asset_root_ids.filter((id: unknown) => typeof id === "string" && id) : [];
      const isSelectionShare = selectedFolderIds.length > 0 || selectedAssetRootIds.length > 0;

      if (isSelectionShare) {
        if (selectedFolderIds.length + selectedAssetRootIds.length > 200) {
          return bad("A share can include at most 200 folders/files");
        }
        if (selectedFolderIds.length > 0) {
          const { data: folderRows, error: folderRowsError } = await admin
            .from("folders")
            .select("id, project_id, deleted_at")
            .in("id", selectedFolderIds);
          if (folderRowsError) return bad("Failed to verify selected folders", 500);
          const validIds = new Set((folderRows ?? []).filter((f) => !f.deleted_at && String(f.project_id) === String(project_id)).map((f) => String(f.id)));
          if (validIds.size !== selectedFolderIds.length) return bad("One or more selected folders were not found in this project");
        }
        if (selectedAssetRootIds.length > 0) {
          // A project's real asset set isn't just rows with assets.project_id
          // === project_id -- it also includes cross-linked placements (e.g.
          // a workspace-library asset placed into this project via
          // project_asset_links). A naive direct-only query here would
          // falsely reject a legitimately-selected linked asset.
          const projectAssetIds = new Set(await listProjectAssetIds(String(project_id)));
          const validIds = selectedAssetRootIds.filter((id: string) => projectAssetIds.has(id));
          if (validIds.length !== selectedAssetRootIds.length) return bad("One or more selected files were not found in this project");
        }
      }

      const token = crypto.randomUUID().replace(/-/g, "");
      const tokenHash = await hashToken(token);

      const { data: shareLink, error } = await admin
        .from("share_links")
        .insert({
          workspace_id: project.workspace_id,
          subject_type: "project",
          subject_id: project_id,
          token,
          project_id,
          folder_id: folder_id || null,
          folder_ids: selectedFolderIds.length > 0 ? selectedFolderIds : null,
          asset_root_ids: selectedAssetRootIds.length > 0 ? selectedAssetRootIds : null,
          token_hash: tokenHash,
          expires_at: expires_at ? new Date(expires_at).toISOString() : null,
          allow_download: true,
          allow_comments: true,
          allow_upload: isSelectionShare ? false : Boolean(allow_upload),
          created_by: apiKey.created_by,
        })
        .select()
        .single();

      if (error || !shareLink) return bad("Failed to create share link", 500);
      const { token: _token, ...created } = shareLink;
      return json({ data: { ...created, share_url: `${FRONTEND_URL}/share/project/${shareLink.id}` } }, 201);
    }

    if (routeParts.length === 0 && req.method === "GET") {
      const projectId = url.searchParams.get("project_id");
      if (!projectId) return bad("Missing project_id parameter");

      const project = await loadProjectForApiKey(apiKey, projectId);
      if (!project) return notfound();

      const { data, error } = await admin
        .from("share_links")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) return bad("Error listing share links", 500);
      // OSS share_links also stores the raw token; never hand it back.
      return json({ data: (data ?? []).map(({ token: _token, ...row }) => row) });
    }

    if (routeParts.length === 1 && req.method === "DELETE") {
      const shareLinkId = routeParts[0];
      const { data: share, error } = await admin
        .from("share_links")
        .select("id, project_id")
        .eq("id", shareLinkId)
        .maybeSingle();

      if (error || !share || !share.project_id) return notfound();

      const project = await loadProjectForApiKey(apiKey, String(share.project_id));
      if (!project) return unauth("Unauthorized access to this share link");

      const { error: revokeError } = await admin
        .from("share_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", shareLinkId);

      if (revokeError) return bad("Failed to revoke share link", 500);
      return json({ success: true });
    }

    return notfound();
  } catch (error: any) {
    console.error("api-project-shares error:", error);
    return bad(error.message || "Server error", 500);
  }
});

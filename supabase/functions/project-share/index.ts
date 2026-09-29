// deno run --allow-env --allow-net
//
// Standalone edge function for "share this whole project with a guest" links.
// Deliberately separate from functions/share/index.ts (asset/collection shares)
// so this feature never touches that already-shipping code path.
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";
import { canAccessProject, isMemberOfWorkspace } from "../../shared/utils.ts";
import { listProjectAssetIds, listProjectAssetRows, rootAssetIdOf } from "../../shared/dam.ts";
import { activeWorkspaceUserIds, createNotifications, projectMemberUserIds } from "../../shared/notifications.ts";
import { resolvePublicSupabaseUrl, toPublicStorageUrl } from "../../shared/publicStorageUrl.ts";

const FRONTEND_URL = (Deno.env.get("FRONTEND_URL") ?? "http://127.0.0.1:6173").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const bad = (msg: string, status = 400) => json({ error: msg }, status);
const unauth = (msg = "Unauthorized") => json({ error: msg }, 401);
const forbid = (msg = "Forbidden") => json({ error: msg }, 403);
const notfound = (msg = "Not found") => json({ error: msg }, 404);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUser(req: Request) {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// OSS: the `assets` bucket is private and there is no CDN, so every file a
// guest can see gets a signed Storage URL (cloud signs only video, via Bunny).
// Covers fall back to the signed original for images that have no thumbnail.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

function shareMediaExpiresIn(share: { expires_at?: string | null }) {
  if (!share.expires_at) return SIGNED_URL_TTL_SECONDS;
  const secondsLeft = Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000);
  return Number.isFinite(secondsLeft) ? Math.max(60, Math.min(SIGNED_URL_TTL_SECONDS, secondsLeft)) : SIGNED_URL_TTL_SECONDS;
}

function publicStorageUrl(req: Request, url: string | null | undefined) {
  const publicBase = resolvePublicSupabaseUrl({ explicit: Deno.env.get("PUBLIC_SUPABASE_URL"), internalUrl: supabaseUrl, headers: req.headers });
  return toPublicStorageUrl(url, supabaseUrl, publicBase);
}

async function withDeliveryUrls<T extends Record<string, any>>(req: Request, assets: T[], share: { expires_at?: string | null }): Promise<T[]> {
  const paths = Array.from(new Set(assets.map((asset) => asset.storage_path).filter((path): path is string => typeof path === "string" && path.length > 0)));
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await admin.storage.from("assets").createSignedUrls(paths, shareMediaExpiresIn(share));
    for (const row of data ?? []) {
      const url = publicStorageUrl(req, row.signedUrl);
      if (row.path && url) signedByPath.set(row.path, url);
    }
  }

  return assets.map((asset) => {
    const url = typeof asset.storage_path === "string" ? signedByPath.get(asset.storage_path) : undefined;
    if (!url) return asset;
    const mimeType = typeof asset.mime_type === "string" ? asset.mime_type : "";
    return {
      ...asset,
      cover_image_url: asset.cover_image_url ?? (mimeType.startsWith("image/") ? url : null),
      signed_url: url,
      delivery_url: url,
      cdn_url: url,
    };
  });
}

// Local, deliberately duplicated folder loader — asset/index.ts owns its own
// private copy of this query and is not touched or shared with by this feature.
async function loadProjectFolders(workspaceId: string, projectId: string) {
  const { data, error } = await admin
    .from("folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// Resolves a folder id plus every one of its descendant folder ids (BFS over
// parent_folder_id), so a folder-scoped share can be checked against the
// whole subtree it covers, not just the exact folder it was created on.
function collectFolderDescendantIds(folderId: string, folders: Array<{ id: string; parent_folder_id: string | null }>) {
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

async function findShareByToken(token: string) {
  let query = admin.from("share_links").select("*").not("project_id", "is", null);
  query = UUID_RE.test(token) ? query.eq("id", token) : query.eq("token_hash", await hashToken(token));

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data;
}

// The real member-facing "list_project" asset function decorates rows with a
// comments_count for the card UI; mirror that here (local, not shared) so the
// guest grid shows accurate counts instead of always "0".
async function withCommentCounts<T extends { id: string }>(assets: T[]): Promise<Array<T & { comments_count: number }>> {
  if (!assets.length) return [];

  const { data: comments } = await admin
    .from("asset_comments")
    .select("asset_id")
    .in("asset_id", assets.map((a) => a.id))
    .neq("status", "deleted");

  const countByAsset = new Map<string, number>();
  for (const row of comments ?? []) {
    const id = String((row as any).asset_id);
    countByAsset.set(id, (countByAsset.get(id) ?? 0) + 1);
  }

  return assets.map((asset) => ({ ...asset, comments_count: countByAsset.get(asset.id) ?? 0 }));
}

function shareValidityError(share: { revoked_at: string | null; expires_at: string | null }) {
  if (share.revoked_at) return "Share link revoked";
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return "Share link expired";
  return null;
}

// Password protection is optional per link (share_links.password_hash is
// null unless the owner set one at create time). Hashed with the same
// SHA-256 convention already used for tokens/API keys in this codebase —
// this is a lightweight access gate, not a login credential.
async function passwordCheckError(share: { password_hash: string | null }, providedPassword: unknown) {
  if (!share.password_hash) return null;
  if (typeof providedPassword !== "string" || !providedPassword) return unauth("Password required");
  if ((await hashToken(providedPassword)) !== share.password_hash) return forbid("Incorrect password");
  return null;
}

function omitPasswordHash<T extends { password_hash?: unknown }>(row: T): Omit<T, "password_hash"> {
  // OSS share_links also stores the raw token; never hand it back.
  const { password_hash, token: _token, ...rest } = row as T & { token?: unknown };
  return rest;
}

async function handleCreate(req: Request, body: any) {
  const user = await getUser(req);
  if (!user) return unauth();

  const {
    project_id,
    folder_id = null,
    folder_ids = null,
    asset_root_ids = null,
    expires_at,
    allow_upload = false,
    allow_download = true,
    password,
  } = body ?? {};
  if (!project_id) return bad("project_id required");
  if (!(await canAccessProject(project_id, user.id))) return forbid();

  const { data: projectRow } = await admin.from("projects").select("workspace_id").eq("id", project_id).maybeSingle();
  if (!projectRow?.workspace_id) return notfound("Project not found");

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
      // A project's real asset set isn't just rows with assets.project_id ===
      // project_id -- it also includes cross-linked placements (e.g. a
      // workspace-library asset placed into this project via
      // project_asset_links, per listProjectAssetIds/listProjectAssetRows in
      // shared/dam.ts, already used elsewhere in this file for the identical
      // boundary check). A naive direct-only query here would falsely reject
      // a legitimately-selected linked asset.
      const projectAssetIds = new Set(await listProjectAssetIds(project_id));
      const validIds = selectedAssetRootIds.filter((id) => projectAssetIds.has(id));
      if (validIds.length !== selectedAssetRootIds.length) return bad("One or more selected files were not found in this project");
    }
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(token);
  const trimmedPassword = typeof password === "string" ? password.trim() : "";
  const passwordHash = trimmedPassword ? await hashToken(trimmedPassword) : null;

  const { data: shareLink, error } = await admin
    .from("share_links")
    .insert({
      workspace_id: projectRow.workspace_id,
      subject_type: "project",
      subject_id: project_id,
      token,
      project_id,
      folder_id: folder_id || null,
      folder_ids: selectedFolderIds.length > 0 ? selectedFolderIds : null,
      asset_root_ids: selectedAssetRootIds.length > 0 ? selectedAssetRootIds : null,
      token_hash: tokenHash,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      allow_download: Boolean(allow_download),
      allow_comments: true,
      // No coherent "upload into a mixed selection" target -- force off
      // regardless of what was requested, same as the legacy allow_upload
      // param is respected only for whole-project/single-folder shares.
      allow_upload: isSelectionShare ? false : Boolean(allow_upload),
      password_hash: passwordHash,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !shareLink) return bad("Failed to create share link", 500);
  return json({ data: { ...omitPasswordHash(shareLink), share_url: `${FRONTEND_URL}/share/project/${shareLink.id}` } });
}

async function handleGet(req: Request, body: any) {
  const { token, password } = body ?? {};
  if (!token) return bad("token required");

  const share = await findShareByToken(token);
  if (!share) return notfound("Share link not found");

  const validityError = shareValidityError(share);
  if (validityError) return forbid(validityError);

  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, name, workspace_id, status")
    .eq("id", share.project_id)
    .maybeSingle();

  if (projectError || !project || project.status === "deleted") return notfound("Project not found");

  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("id", project.workspace_id)
    .maybeSingle();

  const [allAssetRows, allFolders] = await Promise.all([
    listProjectAssetRows(share.project_id),
    loadProjectFolders(project.workspace_id, share.project_id),
  ]);

  // A folder-scoped share only exposes that folder's subtree -- both the
  // assets returned to the guest and the folder tree used for breadcrumb/
  // navigation must be narrowed here, since the frontend renders whatever
  // this endpoint hands back with no further access checks of its own.
  let sharedFolder: (typeof allFolders)[number] | null = null;
  let assetRows = allAssetRows;
  let folders = allFolders;
  if (share.folder_id) {
    sharedFolder = allFolders.find((folder: any) => folder.id === share.folder_id) ?? null;
    if (!sharedFolder) return notfound("Shared folder not found");
    const allowedFolderIds = collectFolderDescendantIds(share.folder_id, allFolders as any);
    assetRows = allAssetRows.filter((asset: any) => asset.folder_id && allowedFolderIds.has(asset.folder_id));
    folders = allFolders.filter((folder: any) => allowedFolderIds.has(folder.id));
  } else if ((share.folder_ids && share.folder_ids.length) || (share.asset_root_ids && share.asset_root_ids.length)) {
    // A multi-select share exposes the union of every selected folder's full
    // subtree plus every directly-selected file -- both the "top level"
    // (the directly-selected items themselves, rendered by the frontend when
    // browsing at the selection root) and any nested content reached by
    // drilling into one of the selected folders.
    const selectedFolderIds: string[] = share.folder_ids ?? [];
    const selectedRootIds = new Set<string>(share.asset_root_ids ?? []);
    const allowedFolderIds = new Set<string>();
    for (const id of selectedFolderIds) {
      for (const descendant of collectFolderDescendantIds(id, allFolders as any)) allowedFolderIds.add(descendant);
    }
    assetRows = allAssetRows.filter((asset: any) =>
      (asset.folder_id && allowedFolderIds.has(asset.folder_id)) || selectedRootIds.has(rootAssetIdOf(asset)));
    folders = allFolders.filter((folder: any) => allowedFolderIds.has(folder.id));
  }

  const assetsWithCounts = await withCommentCounts(assetRows);
  const assets = await withDeliveryUrls(req, assetsWithCounts, share);

  // Being logged in only changes identity (real name/avatar instead of the
  // guest form) — it never grants access on its own. Access stays governed
  // purely by the link; only an already-legitimate member (org membership or
  // a prior real invite) gets redirected into the full authenticated app.
  let isMember = false;
  const user = await getUser(req);
  if (user) {
    isMember = await isMemberOfWorkspace(project.workspace_id, user.id);
  }

  await admin
    .from("share_links")
    .update({ access_count: (share.access_count ?? 0) + 1, last_accessed_at: new Date().toISOString() })
    .eq("id", share.id);

  return json({ data: { ...omitPasswordHash(share), project, workspace: workspace ?? null, assets, folders, shared_folder: sharedFolder, is_member: isMember } });
}

const ASSET_STATUSES = new Set(["needs_review", "in_review", "approved"]);
const STATUS_ACTION_LABEL: Record<string, string> = {
  approved: "Approved this asset",
  needs_review: "Requested changes on this asset",
  in_review: "Marked this asset as in review",
};

// review.* is the existing notification vocabulary (see shared/notifications.ts);
// "in_review" reads as a review request, so it maps to review.requested.
const STATUS_NOTIFICATION_TYPE: Record<string, "review.approved" | "review.changes_requested" | "review.requested"> = {
  approved: "review.approved",
  needs_review: "review.changes_requested",
  in_review: "review.requested",
};

// Nobody previously found out when a guest approved/requested changes on an
// asset — this tells the project's team via the existing in-app notification
// inbox. Best-effort: a failure here must never block the status change itself.
async function notifyProjectTeamOfStatusChange(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  guestName: string;
  status: string;
}) {
  try {
    const recipientIds = new Set([
      ...(await activeWorkspaceUserIds(input.workspaceId)),
      ...(await projectMemberUserIds(input.projectId)),
    ]);

    const notificationType = STATUS_NOTIFICATION_TYPE[input.status];
    if (!notificationType) return;

    await createNotifications(
      Array.from(recipientIds).map((recipientUserId) => ({
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        asset_id: input.assetId,
        recipient_user_id: recipientUserId,
        actor_guest_name: input.guestName,
        notification_type: notificationType,
        title: `${input.guestName} ${STATUS_ACTION_LABEL[input.status]?.toLowerCase() ?? `changed status to ${input.status}`}`,
        target_url: `/workspace/${input.workspaceId}/projects/${input.projectId}/assets/${input.assetId}`,
      })),
    );
  } catch (error) {
    console.error("project-share: failed to notify project team of status change", error);
  }
}

// Guests (and logged-in-but-unrelated visitors) can approve/request changes
// on assets within a shared project — this is the actual point of a client
// review link. Attribution lives entirely in the asset_history Activity feed
// (via updated_by_guest_name/email below, read by the existing trigger) —
// deliberately not also inserted as an asset_comments row, which would
// misleadingly render as if the guest had personally typed "Approved this
// asset" as a real comment.
async function handleUpdateStatus(req: Request, body: any) {
  const { token, asset_id, status, guest_name, guest_email, password } = body ?? {};
  if (!token || !asset_id || !status) return bad("token, asset_id and status required");
  if (!ASSET_STATUSES.has(status)) return bad("Invalid status");

  const share = await findShareByToken(token);
  if (!share) return notfound("Share link not found");
  const validityError = shareValidityError(share);
  if (validityError) return forbid(validityError);

  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;

  const assetIds = await listProjectAssetIds(share.project_id);
  if (!assetIds.includes(asset_id)) return forbid("Share link does not grant access to this asset");

  // A folder-scoped link must not let a guest touch an asset elsewhere in
  // the project by calling this endpoint directly with a different asset_id
  // -- narrow the project-wide check above to the shared folder's subtree.
  if (share.folder_id) {
    const { data: folders, error: foldersError } = await admin
      .from("folders")
      .select("id, parent_folder_id")
      .eq("project_id", share.project_id)
      .is("deleted_at", null);
    if (foldersError) return bad("Failed to verify folder access", 500);

    const allowedFolderIds = collectFolderDescendantIds(share.folder_id, folders ?? []);
    const { data: assetRow } = await admin.from("assets").select("folder_id").eq("id", asset_id).maybeSingle();
    if (!assetRow?.folder_id || !allowedFolderIds.has(assetRow.folder_id)) {
      return forbid("Share link does not grant access to this asset");
    }
  } else if ((share.folder_ids && share.folder_ids.length) || (share.asset_root_ids && share.asset_root_ids.length)) {
    // Same boundary as the single-folder case above, but the asset is
    // allowed via EITHER path: inside one of the selected folders' subtrees,
    // or directly selected by its own root id.
    const { data: folders, error: foldersError } = await admin
      .from("folders")
      .select("id, parent_folder_id")
      .eq("project_id", share.project_id)
      .is("deleted_at", null);
    if (foldersError) return bad("Failed to verify folder access", 500);

    const allowedFolderIds = new Set<string>();
    for (const id of (share.folder_ids ?? [])) {
      for (const descendant of collectFolderDescendantIds(id, folders ?? [])) allowedFolderIds.add(descendant);
    }
    const selectedRootIds = new Set<string>(share.asset_root_ids ?? []);

    const { data: assetRow } = await admin.from("assets").select("folder_id, parent_asset_id").eq("id", asset_id).maybeSingle();
    const allowedByFolder = Boolean(assetRow?.folder_id && allowedFolderIds.has(assetRow.folder_id));
    const allowedByRootId = Boolean(assetRow && selectedRootIds.has(rootAssetIdOf({ id: asset_id, parent_asset_id: assetRow.parent_asset_id })));
    if (!allowedByFolder && !allowedByRootId) {
      return forbid("Share link does not grant access to this asset");
    }
  }

  const user = await getUser(req);
  const trimmedGuestName = typeof guest_name === "string" ? guest_name.trim() : "";
  if (!user && !trimmedGuestName) return bad("guest_name and guest_email required");

  const { error: updateError } = await admin
    .from("assets")
    .update({
      status,
      updated_at: new Date().toISOString(),
      updated_by: user ? user.id : null,
      // Read by the log_asset_history_from_assets() trigger so a guest's
      // status change is attributed by name in the Activity tab instead of
      // showing up as "System".
      updated_by_guest_name: user ? null : trimmedGuestName,
      updated_by_guest_email: user ? null : (typeof guest_email === "string" ? guest_email.trim() || null : null),
    })
    .eq("id", asset_id);

  if (updateError) return bad("Failed to update status", 500);

  if (!user) {
    const { data: project } = await admin
      .from("projects")
      .select("id, workspace_id")
      .eq("id", share.project_id)
      .maybeSingle();

    if (project?.workspace_id) {
      await notifyProjectTeamOfStatusChange({
        workspaceId: String(project.workspace_id),
        projectId: String(project.id),
        assetId: String(asset_id),
        guestName: trimmedGuestName,
        status,
      });
    }
  }

  return json({ success: true, status });
}

async function handleRevoke(req: Request, body: any) {
  const user = await getUser(req);
  if (!user) return unauth();

  const { share_link_id } = body ?? {};
  if (!share_link_id) return bad("share_link_id required");

  const { data: share, error } = await admin
    .from("share_links")
    .select("id, project_id")
    .eq("id", share_link_id)
    .maybeSingle();

  if (error || !share || !share.project_id) return notfound("Share link not found");
  if (!(await canAccessProject(share.project_id, user.id))) return forbid();

  const { error: updateError } = await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", share_link_id);

  if (updateError) return bad("Failed to revoke share link", 500);
  return json({ success: true });
}

async function handleList(req: Request, body: any) {
  const user = await getUser(req);
  if (!user) return unauth();

  const { project_id } = body ?? {};
  if (!project_id) return bad("project_id required");
  if (!(await canAccessProject(project_id, user.id))) return forbid();

  const { data, error } = await admin
    .from("share_links")
    .select("id, project_id, folder_id, folder_ids, asset_root_ids, allow_upload, allow_download, allow_comments, expires_at, revoked_at, created_at, access_count, last_accessed_at, password_hash")
    .eq("project_id", project_id)
    .order("created_at", { ascending: false });

  if (error) return bad("Failed to list share links", 500);

  // Resolve folder names for the management table ("Whole project" vs
  // "Shared folder: <name>") in one batched lookup rather than N+1 queries.
  // Covers both the legacy singular folder_id and every id inside every
  // row's plural folder_ids (multi-select shares).
  const folderIds = Array.from(new Set(
    (data ?? []).flatMap((row) => [row.folder_id, ...(row.folder_ids ?? [])]).filter((id): id is string => Boolean(id)),
  ));
  const folderNameById = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folderRows } = await admin.from("folders").select("id, name").in("id", folderIds);
    for (const folder of folderRows ?? []) {
      folderNameById.set(String(folder.id), String(folder.name));
    }
  }

  // Same batched-lookup pattern for asset titles, used by multi-select
  // shares' Links-tab summary ("VEYRANT Logo, Renders +2 more").
  const assetRootIds = Array.from(new Set((data ?? []).flatMap((row) => row.asset_root_ids ?? [])));
  const assetTitleById = new Map<string, string>();
  if (assetRootIds.length > 0) {
    const { data: assetRows } = await admin.from("assets").select("id, title").in("id", assetRootIds);
    for (const asset of assetRows ?? []) {
      assetTitleById.set(String(asset.id), String(asset.title ?? "Untitled"));
    }
  }

  const sanitized = (data ?? []).map((row) => ({
    ...omitPasswordHash(row),
    has_password: Boolean(row.password_hash),
    folder_name: row.folder_id ? folderNameById.get(row.folder_id) ?? null : null,
    folder_names: (row.folder_ids ?? []).map((id: string) => folderNameById.get(id) ?? "Unknown folder"),
    asset_titles: (row.asset_root_ids ?? []).map((id: string) => assetTitleById.get(id) ?? "Untitled"),
  }));
  return json({ data: sanitized });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Invalid JSON body");

  try {
    switch (body.action) {
      case "create":
        return await handleCreate(req, body);
      case "get":
        return await handleGet(req, body);
      case "update-status":
        return await handleUpdateStatus(req, body);
      case "revoke":
        return await handleRevoke(req, body);
      case "list":
        return await handleList(req, body);
      default:
        return bad("Unknown action");
    }
  } catch (error: any) {
    console.error("project-share error:", error);
    return json({ error: "Server error", details: String(error?.message ?? error) }, 500);
  }
});

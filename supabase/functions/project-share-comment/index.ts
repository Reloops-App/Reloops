// deno run --allow-env --allow-net
//
// Standalone comment CRUD for guests viewing a project shared via
// functions/project-share. Deliberately separate from functions/comment/index.ts
// so this feature never touches that already-shipping code path.
//
// Scope cut (intentional): no editing, no @mentions, no email notifications
// (in-app only for now — see notifyProjectTeam below). Visitors (guest or
// logged-in) can list, add, and delete their own comments; that covers the
// review/approve loop this feature needs. Comments inserted here still show
// up in the existing Reviewers tab automatically, since that reads
// asset_comments directly.
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";
import { listProjectAssetIds, rootAssetIdOf } from "../../shared/dam.ts";
import { activeWorkspaceUserIds, createNotifications, projectMemberUserIds } from "../../shared/notifications.ts";
import { isOrgAdminOfWorkspace } from "../../shared/utils.ts";

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
const COMMENT_FIELDS = [
  "id",
  "asset_id",
  "parent_id",
  "author_user_id",
  "guest_name",
  "guest_email",
  "body",
  "ms_offset",
  "drawing_json",
  "created_at",
  "status",
].join(", ");

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function getUser(req: Request) {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function loadAuthorProfiles(comments: Array<{ author_user_id?: string | null }>) {
  const ids = Array.from(new Set(comments.map((c) => c.author_user_id).filter((id): id is string => Boolean(id))));
  if (!ids.length) return {};

  const { data, error } = await admin.from("profiles").select("id, display_name, avatar_url").in("id", ids);
  if (error) return {};

  return Object.fromEntries((data ?? []).map((p: any) => [String(p.id), { id: String(p.id), display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null }]));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeGuestAuthorToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 32 && token.length <= 256 ? token : null;
}

// Resolves a folder id plus every one of its descendant folder ids (BFS over
// parent_folder_id), so a folder-scoped share can be checked against the
// whole subtree it covers, not just the exact folder it was created on.
// Duplicated from project-share/index.ts per this file's isolation
// convention (see header comment).
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

async function resolveProjectShare(token: string) {
  let query = admin.from("share_links").select("id, project_id, folder_id, folder_ids, asset_root_ids, allow_comments, revoked_at, expires_at, password_hash").not("project_id", "is", null);
  query = isUuid(token) ? query.eq("id", token) : query.eq("token_hash", await sha256(token));

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

// Password protection is optional per link (set at create time in
// project-share/index.ts). Duplicated here rather than shared, per this
// feature's isolation convention — same SHA-256 hashing already used for
// tokens in this file.
async function passwordCheckError(share: { password_hash: string | null }, providedPassword: unknown) {
  if (!share.password_hash) return null;
  if (typeof providedPassword !== "string" || !providedPassword) return unauth("Password required");
  if ((await sha256(providedPassword)) !== share.password_hash) return forbid("Incorrect password");
  return null;
}

async function assertAssetInShare(
  share: { project_id: string; folder_id?: string | null; folder_ids?: string[] | null; asset_root_ids?: string[] | null },
  assetId: string,
) {
  const assetIds = await listProjectAssetIds(share.project_id);
  if (!assetIds.includes(assetId)) return false;

  // A folder-scoped link must not grant access to comments on an asset
  // elsewhere in the project -- narrow the project-wide check above to the
  // shared folder's subtree.
  if (share.folder_id) {
    const { data: folders, error: foldersError } = await admin
      .from("folders")
      .select("id, parent_folder_id")
      .eq("project_id", share.project_id)
      .is("deleted_at", null);
    if (foldersError) return false;

    const allowedFolderIds = collectFolderDescendantIds(share.folder_id, folders ?? []);
    const { data: assetRow } = await admin.from("assets").select("folder_id").eq("id", assetId).maybeSingle();
    return Boolean(assetRow?.folder_id && allowedFolderIds.has(assetRow.folder_id));
  }

  if ((share.folder_ids && share.folder_ids.length) || (share.asset_root_ids && share.asset_root_ids.length)) {
    // Multi-select share: allowed via EITHER path -- inside one of the
    // selected folders' subtrees, or directly selected by its own root id.
    const { data: folders, error: foldersError } = await admin
      .from("folders")
      .select("id, parent_folder_id")
      .eq("project_id", share.project_id)
      .is("deleted_at", null);
    if (foldersError) return false;

    const allowedFolderIds = new Set<string>();
    for (const id of (share.folder_ids ?? [])) {
      for (const descendant of collectFolderDescendantIds(id, folders ?? [])) allowedFolderIds.add(descendant);
    }
    const selectedRootIds = new Set<string>(share.asset_root_ids ?? []);

    const { data: assetRow } = await admin.from("assets").select("folder_id, parent_asset_id").eq("id", assetId).maybeSingle();
    if (!assetRow) return false;
    const allowedByFolder = Boolean(assetRow.folder_id && allowedFolderIds.has(assetRow.folder_id));
    const allowedByRootId = selectedRootIds.has(rootAssetIdOf({ id: assetId, parent_asset_id: assetRow.parent_asset_id }));
    return allowedByFolder || allowedByRootId;
  }

  return true;
}

// Workspace admins/owners can delete (not edit) any comment on the project,
// mirroring the admin override functions/comment/index.ts already has.
// This function has no other workspace-role awareness by design (see file
// header) — this is the one deliberate, narrow addition to that isolation.
async function resolveWorkspaceId(projectId: string): Promise<string | null> {
  const { data } = await admin.from("projects").select("workspace_id").eq("id", projectId).maybeSingle();
  return data?.workspace_id ? String(data.workspace_id) : null;
}

// Nobody previously found out when a guest left feedback — this tells the
// project's team (workspace members + any authenticated project guests) via
// the existing in-app notification inbox. Best-effort: a failure here must
// never block the comment itself from succeeding.
async function notifyProjectTeam(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  guestName: string;
  title: string;
  message: string;
  targetUrl: string;
}) {
  try {
    const recipientIds = new Set([
      ...(await activeWorkspaceUserIds(input.workspaceId)),
      ...(await projectMemberUserIds(input.projectId)),
    ]);

    await createNotifications(
      Array.from(recipientIds).map((recipientUserId) => ({
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        asset_id: input.assetId,
        recipient_user_id: recipientUserId,
        actor_guest_name: input.guestName,
        notification_type: "guest.feedback" as const,
        title: input.title,
        message: input.message,
        target_url: input.targetUrl,
      })),
    );
  } catch (error) {
    console.error("project-share-comment: failed to notify project team", error);
  }
}

async function handleList(req: Request, body: any) {
  const { token, asset_id, guest_author_token, password } = body ?? {};
  if (!token || !asset_id) return bad("token and asset_id required");

  const share = await resolveProjectShare(token);
  if (!share) return forbid("Invalid or expired share link");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!(await assertAssetInShare(share, asset_id))) return forbid("Share link does not grant access to this asset");
  if (!share.allow_comments) return json({ data: [], profiles: {} });

  const { data, error } = await admin
    .from("asset_comments")
    .select(`${COMMENT_FIELDS}, guest_author_token_hash`)
    .eq("asset_id", asset_id)
    .neq("status", "deleted")
    .order("created_at", { ascending: true });

  if (error) return bad("Failed to load comments", 500);

  const user = await getUser(req);
  const guestToken = normalizeGuestAuthorToken(guest_author_token);
  const guestTokenHash = guestToken ? await sha256(guestToken) : null;
  const workspaceId = user ? await resolveWorkspaceId(share.project_id) : null;
  const callerIsAdmin = Boolean(user && workspaceId && await isOrgAdminOfWorkspace(workspaceId, user.id));

  const comments = (data ?? []).map((comment: any) => {
    const { guest_author_token_hash, ...rest } = comment;
    const ownsAsUser = Boolean(user && comment.author_user_id === user.id);
    const ownsAsGuest = Boolean(!user && guestTokenHash != null && guest_author_token_hash === guestTokenHash);
    const owns = ownsAsUser || ownsAsGuest;
    // can_manage stays ownership-only (still gates edit). can_delete
    // additionally widens to workspace admins/owners.
    return { ...rest, can_manage: owns, can_delete: owns || callerIsAdmin };
  });

  const profiles = await loadAuthorProfiles(comments);
  return json({ data: comments, profiles });
}

async function handleCreate(req: Request, body: any) {
  const {
    token,
    asset_id,
    body: commentBody,
    guest_name,
    guest_email,
    guest_author_token,
    ms_offset,
    drawing_json,
    parent_id,
    client_id,
    password,
  } = body ?? {};

  if (!token || !asset_id) return bad("token and asset_id required");
  if (!commentBody) return bad("Comment body required");

  const user = await getUser(req);
  if (!user && (!guest_name || !guest_email)) return bad("guest_name and guest_email required");

  const share = await resolveProjectShare(token);
  if (!share) return forbid("Invalid or expired share link");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!share.allow_comments) return forbid("Comments disabled for this share link");
  if (!(await assertAssetInShare(share, asset_id))) return forbid("Share link does not grant access to this asset");

  const guestToken = normalizeGuestAuthorToken(guest_author_token);
  const clientCommentId = isUuid(client_id) ? client_id : null;

  const { data, error } = await admin
    .from("asset_comments")
    .insert({
      ...(clientCommentId ? { id: clientCommentId } : {}),
      asset_id,
      author_user_id: user ? user.id : null,
      guest_name: user ? null : String(guest_name),
      guest_email: user ? null : String(guest_email),
      body: commentBody,
      ms_offset: ms_offset ?? null,
      drawing_json: drawing_json ?? null,
      parent_id: parent_id ?? null,
      guest_author_token_hash: user ? null : (guestToken ? await sha256(guestToken) : null),
    })
    .select(COMMENT_FIELDS)
    .single();

  if (error) return bad("Failed to add comment", 500);

  if (!user) {
    const { data: project } = await admin
      .from("projects")
      .select("id, name, workspace_id")
      .eq("id", share.project_id)
      .maybeSingle();

    if (project?.workspace_id) {
      const guestDisplayName = String(guest_name);
      await notifyProjectTeam({
        workspaceId: String(project.workspace_id),
        projectId: String(project.id),
        assetId: String(asset_id),
        guestName: guestDisplayName,
        title: `${guestDisplayName} left feedback`,
        message: String(commentBody).slice(0, 240),
        targetUrl: `/workspace/${project.workspace_id}/projects/${project.id}/assets/${asset_id}`,
      });
    }
  }

  return json({ data: { ...data, can_manage: true, can_delete: true } });
}

// Shared by delete/edit/toggle-complete below — a caller owns a comment if
// they're the authenticated account that wrote it, or (for guest-authored
// comments only) they present the matching guest_author_token.
async function assertCommentOwnership(
  req: Request,
  comment: { author_user_id: string | null; guest_author_token_hash: string | null },
  guestAuthorTokenRaw: unknown,
): Promise<boolean> {
  const user = await getUser(req);
  if (user) return comment.author_user_id === user.id;

  const guestToken = normalizeGuestAuthorToken(guestAuthorTokenRaw);
  const expectedHash = typeof comment.guest_author_token_hash === "string" ? comment.guest_author_token_hash : "";
  if (!guestToken || !expectedHash) return false;
  return expectedHash === (await sha256(guestToken));
}

async function loadOwnedComment(token: string, password: unknown, assetId: string, id: string) {
  const share = await resolveProjectShare(token);
  if (!share) return { error: forbid("Invalid or expired share link") } as const;
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return { error: passwordError } as const;
  if (!(await assertAssetInShare(share, assetId))) return { error: forbid("Share link does not grant access to this asset") } as const;

  const { data: comment, error: fetchError } = await admin
    .from("asset_comments")
    .select("id, asset_id, author_user_id, guest_author_token_hash")
    .eq("id", id)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (fetchError || !comment) return { error: notfound("Comment not found") } as const;
  return { comment, share } as const;
}

async function handleDelete(req: Request, body: any) {
  const { token, asset_id, id, guest_author_token, password } = body ?? {};
  if (!token || !asset_id || !id) return bad("token, asset_id and id required");

  const loaded = await loadOwnedComment(token, password, asset_id, id);
  if (loaded.error) return loaded.error;

  const isOwner = await assertCommentOwnership(req, loaded.comment, guest_author_token);
  if (!isOwner) {
    const user = await getUser(req);
    const workspaceId = user ? await resolveWorkspaceId(loaded.share.project_id) : null;
    const isAdmin = Boolean(user && workspaceId && await isOrgAdminOfWorkspace(workspaceId, user.id));
    if (!isAdmin) return forbid("Only the comment's author or a workspace admin can delete it");
  }

  const { error: deleteError } = await admin.from("asset_comments").delete().eq("id", id);
  if (deleteError) return bad("Failed to delete comment", 500);
  return json({ success: true });
}

async function handleEdit(req: Request, body: any) {
  const { token, asset_id, id, guest_author_token, password, body: newBody } = body ?? {};
  if (!token || !asset_id || !id) return bad("token, asset_id and id required");
  if (typeof newBody !== "string" || !newBody.trim()) return bad("Comment body required");

  const loaded = await loadOwnedComment(token, password, asset_id, id);
  if (loaded.error) return loaded.error;

  if (!(await assertCommentOwnership(req, loaded.comment, guest_author_token))) {
    return forbid("Only the comment's author can edit it");
  }

  const { data, error: updateError } = await admin
    .from("asset_comments")
    .update({ body: newBody, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COMMENT_FIELDS)
    .single();

  if (updateError) return bad("Failed to edit comment", 500);
  return json({ data: { ...data, can_manage: true, can_delete: true } });
}

// No toggle-complete action here on purpose: video.tsx's own
// `canCompleteComments = !commentMutationContext?.share_token` already
// disables that control for every share flow (regular or project) — it's
// an authenticated-in-app-only capability, not a guest one, so there's no
// gap to close and no reason to build a server action nothing will call.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Invalid JSON body");

  try {
    switch (body.action) {
      case "list":
        return await handleList(req, body);
      case "create":
        return await handleCreate(req, body);
      case "edit":
        return await handleEdit(req, body);
      case "delete":
        return await handleDelete(req, body);
      default:
        return bad("Unknown action");
    }
  } catch (error: any) {
    console.error("project-share-comment error:", error);
    return json({ error: "Server error", details: String(error?.message ?? error) }, 500);
  }
});

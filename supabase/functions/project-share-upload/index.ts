// deno run --allow-env --allow-net
//
// Standalone guest-upload endpoint for projects shared via functions/project-share
// with allow_upload = true. Ported from Reloops cloud; this file stays separate
// from the member upload path, exactly like cloud's.
//
// OSS adaptations (everything else mirrors cloud):
// - Files go to the Supabase Storage `assets` bucket through a signed upload URL
//   (cloud presigns a B2 PUT). One signed PUT covers every size up to the bucket
//   limit, so the multipart actions answer with a clear error instead of B2 parts.
// - No thumbnail worker in OSS: the guest's browser makes the cover and sends it to
//   `set-preview`, which stores it in the public `thumbnails` bucket.
// - AI tagging is queued by the assets insert trigger, so there is no explicit enqueue.
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";
import { resolvePublicSupabaseUrl, toPublicStorageUrl } from "../../shared/publicStorageUrl.ts";

const GUEST_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

function publicSupabaseBase(req: Request) {
  return resolvePublicSupabaseUrl({ explicit: Deno.env.get("PUBLIC_SUPABASE_URL"), internalUrl: supabaseUrl, headers: req.headers }) || supabaseUrl;
}

function publicStorageUrl(req: Request, url: string | null | undefined) {
  return toPublicStorageUrl(url, supabaseUrl, publicSupabaseBase(req));
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storagePrefixForShare(share: { workspaceId: string; projectId: string }) {
  return `${share.workspaceId}/${share.projectId}`;
}

function buildObjectKey(share: { workspaceId: string; projectId: string }, fileName: string, clientNonce?: string) {
  const safeName = String(fileName).replace(/[^\w.-]+/g, "_").slice(0, 180) || "unnamed";
  const safeNonce = typeof clientNonce === "string" ? clientNonce.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
  return `${storagePrefixForShare(share)}/${safeNonce || crypto.randomUUID()}_${safeName}`;
}

// Stateless ownership check for actions that only receive an objectKey back
// from the client -- the key must sit under this share's project prefix.
function objectKeyBelongsToShare(objectKey: unknown, share: ProjectShareForUpload) {
  return typeof objectKey === "string" && objectKey.startsWith(`${storagePrefixForShare(share)}/`) && !objectKey.includes("..");
}

function normalizeContentType(contentType: unknown, fileName?: unknown) {
  const raw = typeof contentType === "string" && contentType.length <= 100 ? contentType.trim().toLowerCase() : "";
  return raw || "application/octet-stream";
}

type ProjectShareForUpload = { id: string; workspaceId: string; projectId: string; folderId: string | null; passwordHash: string | null };

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

// Re-reads share_links fresh on every call — no caching — so a revoke or
// expiry takes effect on the guest's very next request.
async function resolveProjectShareForUpload(token: string): Promise<ProjectShareForUpload | null> {
  let query = admin
    .from("share_links")
    .select("id, project_id, folder_id, revoked_at, expires_at, allow_upload, password_hash")
    .not("project_id", "is", null);
  query = isUuid(token) ? query.eq("id", token) : query.eq("token_hash", await sha256(token));

  const { data: share, error } = await query.maybeSingle();
  if (error || !share || !share.project_id) return null;
  if (share.revoked_at) return null;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return null;
  if (!share.allow_upload) return null;

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, status")
    .eq("id", share.project_id)
    .maybeSingle();
  if (projectError || !project || project.status === "deleted") return null;

  return {
    id: String(share.id),
    workspaceId: String(project.workspace_id),
    projectId: String(share.project_id),
    folderId: share.folder_id ? String(share.folder_id) : null,
    passwordHash: share.password_hash ?? null,
  };
}

// Password protection is optional per link (set at create time in
// project-share/index.ts). Duplicated here rather than shared, per this
// feature's isolation convention — same SHA-256 hashing already used for
// token hashing above.
async function passwordCheckError(share: { passwordHash: string | null }, providedPassword: unknown) {
  if (!share.passwordHash) return null;
  if (typeof providedPassword !== "string" || !providedPassword) return unauth("Password required");
  if ((await sha256(providedPassword)) !== share.passwordHash) return forbid("Incorrect password");
  return null;
}

const rateLimitBuckets = new Map<string, number[]>();
function withinRateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  return true;
}

async function handlePresign(req: Request, body: any) {
  const { token, fileName, contentType, sizeBytes, clientNonce, password } = body ?? {};
  if (!token || !fileName) return bad("token and fileName required");

  const share = await resolveProjectShareForUpload(token);
  if (!share) return forbid("This share link does not allow uploads, or has expired/been revoked");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!withinRateLimit(share.id)) return forbid("Rate limit exceeded");

  if (typeof sizeBytes === "number" && sizeBytes > GUEST_UPLOAD_MAX_BYTES) {
    return bad(`File too large for guest upload (max ${GUEST_UPLOAD_MAX_BYTES / (1024 * 1024 * 1024)}GB)`, 413);
  }

  const objectKey = buildObjectKey(share, fileName, clientNonce);
  const assetId = crypto.randomUUID();
  const { data, error } = await admin.storage.from("assets").createSignedUploadUrl(objectKey);
  if (error || !data?.signedUrl) return bad("Failed to start upload", 500);

  return json({ url: publicStorageUrl(req, data.signedUrl), assetId, objectKey });
}

// Resolve + validate the folder a guest action (upload completion OR a move)
// wants to place an asset in. Used by both finalizeGuestAsset and
// handleMoveAsset so the two paths can never diverge on scope enforcement:
//  - a supplied folderId must be a live folder in this shared project;
//  - a folder-scoped link with no folderId defaults into the shared folder
//    (never the true project root);
//  - a folder-scoped link's target must sit inside the shared folder's subtree.
async function resolveGuestTargetFolder(
  share: ProjectShareForUpload,
  folderId: unknown,
): Promise<{ folderId: string | null } | { error: Response }> {
  let resolvedFolderId: string | null = null;
  if (folderId) {
    const { data: folder } = await admin
      .from("folders")
      .select("id, project_id")
      .eq("id", folderId)
      .eq("workspace_id", share.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!folder || String(folder.project_id) !== share.projectId) {
      return { error: bad("Folder not found or does not belong to this project") };
    }
    resolvedFolderId = String(folder.id);
  } else if (share.folderId) {
    resolvedFolderId = share.folderId;
  }

  if (share.folderId) {
    const { data: folders } = await admin
      .from("folders")
      .select("id, parent_folder_id")
      .eq("project_id", share.projectId)
      .is("deleted_at", null);
    const allowedFolderIds = collectFolderDescendantIds(share.folderId, folders ?? []);
    if (!resolvedFolderId || !allowedFolderIds.has(resolvedFolderId)) {
      return { error: bad("This share link only allows changes inside its shared folder") };
    }
  }

  return { folderId: resolvedFolderId };
}

// Shared by both completion paths (single-PUT and multipart) -- folder
// resolution/validation and the assets insert are identical either way,
// the only difference is how the caller already proved the object exists
// in storage (HeadObjectCommand vs. CompleteMultipartUploadCommand).
async function finalizeGuestAsset(
  req: Request,
  share: ProjectShareForUpload,
  params: {
    assetId: string;
    fileName: string;
    contentType: unknown;
    sizeBytes: unknown;
    objectKey: string;
    folderId: unknown;
    guestNameRaw: unknown;
    guestEmailRaw: unknown;
  },
) {
  const { assetId, fileName, contentType, sizeBytes, objectKey, folderId, guestNameRaw, guestEmailRaw } = params;

  const folderResult = await resolveGuestTargetFolder(share, folderId);
  if ("error" in folderResult) return folderResult.error;
  const resolvedFolderId = folderResult.folderId;

  const user = await getUser(req);
  const guestName = user ? null : (typeof guestNameRaw === "string" ? guestNameRaw.trim().slice(0, 200) || null : null);
  const guestEmail = user ? null : (typeof guestEmailRaw === "string" ? guestEmailRaw.trim().slice(0, 320) || null : null);

  const { data, error } = await admin
    .from("assets")
    .insert({
      id: assetId,
      workspace_id: share.workspaceId,
      project_id: share.projectId,
      folder_id: resolvedFolderId,
      title: fileName,
      // OSS assets record the uploader in uploaded_by only (no created_by column).
      uploaded_by: user ? user.id : null,
      uploaded_by_guest_name: guestName,
      uploaded_by_guest_email: guestEmail,
      uploaded_via_share_link_id: share.id,
      storage_path: objectKey,
      mime_type: normalizeContentType(contentType, fileName),
      size_bytes: typeof sizeBytes === "number" ? sizeBytes : null,
    })
    .select("id")
    .single();

  if (error) return bad("Failed to create asset record", 500);

  return json({ asset: data.id });
}

// A guest with an upload-enabled link can re-file the assets THEY uploaded
// through that link -- nothing else. The member `asset` function's move
// actions are Supabase-JWT + workspace-membership gated and a share token is
// neither, so this mirrors just the slice a guest needs, reusing the exact
// same share-resolution / password / rate-limit / folder-scope guards as the
// upload actions.
const MAX_GUEST_MOVE_BATCH = 200;

async function handleMoveAsset(req: Request, body: any) {
  const { token, assetId, assetIds, folderId, guest_name, guest_email, password } = body ?? {};
  const ids = Array.from(
    new Set(
      (Array.isArray(assetIds) ? assetIds : assetId ? [assetId] : []).filter(
        (value: unknown): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );
  if (!token || ids.length === 0) return bad("token and assetId(s) required");
  if (ids.length > MAX_GUEST_MOVE_BATCH) return bad(`Cannot move more than ${MAX_GUEST_MOVE_BATCH} files at once`);

  const share = await resolveProjectShareForUpload(token);
  if (!share) return forbid("This share link does not allow changes, or has expired/been revoked");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!withinRateLimit(share.id)) return forbid("Rate limit exceeded");

  const user = await getUser(req);
  const trimmedGuestName = typeof guest_name === "string" ? guest_name.trim() : "";
  if (!user && !trimmedGuestName) return bad("guest_name required");

  const { data: assets } = await admin
    .from("assets")
    .select("id, workspace_id, project_id, parent_asset_id, uploaded_via_share_link_id")
    .in("id", ids);
  if (!assets || assets.length !== ids.length) return bad("One or more files were not found", 404);
  for (const asset of assets) {
    if (String(asset.uploaded_via_share_link_id ?? "") !== share.id) {
      return forbid("You can only move files you uploaded through this link");
    }
    if (String(asset.workspace_id) !== share.workspaceId || String(asset.project_id ?? "") !== share.projectId) {
      return forbid("A file does not belong to this shared project");
    }
  }

  const folderResult = await resolveGuestTargetFolder(share, folderId);
  if ("error" in folderResult) return folderResult.error;

  // Move the whole version stack for each selected file. Guest uploads are
  // always fresh roots, but this stays correct if that ever changes.
  const rootIds = Array.from(new Set(assets.map((asset) => asset.parent_asset_id ?? asset.id)));
  const inList = rootIds.join(",");
  const { error } = await admin
    .from("assets")
    .update({
      folder_id: folderResult.folderId,
      updated_at: new Date().toISOString(),
      updated_by: user ? user.id : null,
      updated_by_guest_name: user ? null : trimmedGuestName,
      updated_by_guest_email: user ? null : (typeof guest_email === "string" ? guest_email.trim().slice(0, 320) || null : null),
    })
    .or(`id.in.(${inList}),parent_asset_id.in.(${inList})`);
  if (error) return bad("Failed to move files", 500);

  return json({ ok: true, folder_id: folderResult.folderId, moved: rootIds.length });
}

// OSS has no thumbnail worker, so the guest's browser makes a JPEG cover while the
// file uploads and sends it here once the asset exists (cloud uses this action for
// camera RAW previews). Same guards as move-asset: valid link, password, rate limit,
// and the asset must be one THIS link uploaded.
const GUEST_COVER_MAX_BYTES = 600 * 1024;

function decodeJpeg(value: unknown, maxBytes: number): Uint8Array | null {
  if (typeof value !== "string" || !value) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 4 || bytes.length > maxBytes) return null;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

async function handleSetPreview(req: Request, body: any) {
  const { token, assetId, password } = body ?? {};
  if (!token || !assetId) return bad("token and assetId required");

  const share = await resolveProjectShareForUpload(token);
  if (!share) return forbid("This share link does not allow changes, or has expired/been revoked");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!withinRateLimit(share.id)) return forbid("Rate limit exceeded");

  const { data: asset } = await admin.from("assets").select("id, workspace_id, project_id, uploaded_via_share_link_id").eq("id", String(assetId)).maybeSingle();
  if (!asset) return bad("File not found", 404);
  if (String(asset.uploaded_via_share_link_id ?? "") !== share.id) return forbid("You can only add a preview to files you uploaded through this link");
  if (String(asset.workspace_id) !== share.workspaceId || String(asset.project_id ?? "") !== share.projectId) return forbid("This file does not belong to this shared project");

  const cover = decodeJpeg(body.cover_b64, GUEST_COVER_MAX_BYTES);
  if (!cover) return bad("cover_b64 must be a JPEG image within the size limit");

  // Same thumbnails path the member upload uses: <workspace>/<asset>.jpg
  const thumbnailPath = `${asset.workspace_id}/${asset.id}.jpg`;
  const { error: uploadError } = await admin.storage.from("thumbnails").upload(thumbnailPath, cover, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    console.error("set-preview storage upload failed:", uploadError);
    return bad("Failed to store preview", 500);
  }

  const coverUrl = `${publicSupabaseBase(req).replace(/\/+$/, "")}/storage/v1/object/public/thumbnails/${thumbnailPath}`;
  const { error } = await admin
    .from("assets")
    .update({ cover_image_url: coverUrl, thumbnail_path: thumbnailPath, updated_at: new Date().toISOString() })
    .eq("id", asset.id);
  if (error) return bad("Failed to save preview", 500);
  return json({ ok: true, updated: true, cover_image_url: coverUrl });
}

async function handleComplete(req: Request, body: any) {
  const { token, assetId, fileName, contentType, sizeBytes, objectKey, folderId, guest_name, guest_email, password } = body ?? {};
  if (!token || !assetId || !fileName || !objectKey) return bad("Missing required fields for completion");

  const share = await resolveProjectShareForUpload(token);
  if (!share) return forbid("This share link does not allow uploads, or has expired/been revoked");
  const passwordError = await passwordCheckError(share, password);
  if (passwordError) return passwordError;
  if (!withinRateLimit(share.id)) return forbid("Rate limit exceeded");

  if (!objectKeyBelongsToShare(objectKey, share)) return forbid("Object key does not belong to this share");
  const { error: existsError } = await admin.storage.from("assets").createSignedUrl(objectKey, 60);
  if (existsError) return bad("File not found in storage (upload failed or incomplete)", 404);

  return finalizeGuestAsset(req, share, {
    assetId,
    fileName,
    contentType,
    sizeBytes,
    objectKey,
    folderId,
    guestNameRaw: guest_name,
    guestEmailRaw: guest_email,
  });
}

// Cloud splits large files into B2 multipart parts. Supabase Storage takes every
// guest file (up to the bucket limit) as one signed PUT, and the OSS portal always
// uses `presign`, so these actions only explain that to an outdated client.
function multipartUnavailable() {
  return bad(`Multipart uploads are not used in Reloops OSS; use the presign action for files up to ${GUEST_UPLOAD_MAX_BYTES / (1024 * 1024 * 1024)}GB`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Invalid JSON body");

  try {
    switch (body.action) {
      case "presign":
        return await handlePresign(req, body);
      case "complete":
        return await handleComplete(req, body);
      case "multipart-start":
      case "multipart-sign-batch":
      case "multipart-complete":
      case "multipart-abort":
        return multipartUnavailable();
      case "move-asset":
        return await handleMoveAsset(req, body);
      case "set-preview":
        return await handleSetPreview(req, body);
      default:
        return bad("Unknown action");
    }
  } catch (error: any) {
    console.error("project-share-upload error:", error);
    return json({ error: "Server error", details: String(error?.message ?? error) }, 500);
  }
});

import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, getUser, isWorkspaceMember } from "../_shared/admin.ts";
import { resolveSharedCollectionRows } from "../../shared/collectionShare.ts";

type ShareLink = {
  id: string;
  workspace_id: string;
  subject_type: "asset" | "collection";
  subject_id: string;
  allow_download: boolean;
  allow_comments: boolean;
  can_comment: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_by?: string | null;
};

const FRONTEND_URL = Deno.env.get("FRONTEND_URL") ?? "http://127.0.0.1:6173";

function shareUrl(path: string) {
  return `${FRONTEND_URL.replace(/\/$/, "")}${path}`;
}

async function requireMember(req: Request, workspaceId: string) {
  const user = await getUser(req);
  if (!user) return { response: json({ error: "Unauthorized" }, { status: 401 }) };
  if (!await isWorkspaceMember(workspaceId, user.id)) {
    return { response: json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

async function getValidShare(token: string): Promise<ShareLink | null> {
  const { data, error } = await admin
    .from("share_links")
    .select("id, workspace_id, subject_type, subject_id, allow_download, allow_comments, can_comment, expires_at, revoked_at, created_by")
    .or(`token.eq.${token},id.eq.${token}`)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as ShareLink;
}

async function getAsset(assetId: string) {
  const { data, error } = await admin.from("assets").select("*").eq("id", assetId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getCollection(collectionId: string) {
  const { data, error } = await admin.from("collections").select("*").eq("id", collectionId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function assetPayload(assetId: string) {
  const asset = await getAsset(assetId);
  if (!asset) return null;

  const rootId = asset.parent_asset_id ?? asset.id;
  const { data: versions } = await admin
    .from("assets")
    .select("*")
    .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`)
    .order("version_no", { ascending: false });

  const { data: comments } = await admin
    .from("asset_comments")
    .select("*")
    .eq("asset_id", asset.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: true });

  const { data: signed } = await admin.storage
    .from("assets")
    .createSignedUrl(asset.storage_path, 60 * 60);

  const thumbnailUrl = asset.thumbnail_path
    ? admin.storage.from("thumbnails").getPublicUrl(asset.thumbnail_path).data.publicUrl
    : null;

  return {
    assets: { ...asset, file_url: signed?.signedUrl ?? null, signed_url: signed?.signedUrl ?? null },
    versions: versions ?? [asset],
    comments: comments ?? [],
    file_url: signed?.signedUrl ?? null,
    fileUrl: signed?.signedUrl ?? null,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
  };
}

async function isAssetAllowedByShare(share: ShareLink, assetId: string) {
  if (share.subject_type === "asset") return assetId === share.subject_id;

  const collection = await getCollection(share.subject_id);
  if (!collection) return false;
  const { rows } = await resolveSharedCollectionRows(collection);
  return rows.some((row) => row.asset.id === assetId);
}

async function listAssetShares(req: Request, body: any) {
  const assetId = String(body.asset_id ?? body.assetId ?? "").trim();
  if (!assetId) return json({ error: "asset_id required" }, { status: 400 });

  const asset = await getAsset(assetId);
  if (!asset) return json({ error: "Asset not found" }, { status: 404 });
  const member = await requireMember(req, asset.workspace_id);
  if (member.response) return member.response;

  const { data, error } = await admin
    .from("share_links")
    .select("*")
    .eq("subject_type", "asset")
    .eq("subject_id", assetId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ data: (data ?? []).map((row: any) => ({ ...row, share_url: shareUrl(`/share/${row.id}`) })) });
}

async function listCollectionShares(req: Request, body: any) {
  const collectionId = String(body.collection_id ?? body.collectionId ?? "").trim();
  if (!collectionId) return json({ error: "collection_id required" }, { status: 400 });

  const collection = await getCollection(collectionId);
  if (!collection) return json({ error: "Collection not found" }, { status: 404 });
  const member = await requireMember(req, collection.workspace_id);
  if (member.response) return member.response;

  const { data, error } = await admin
    .from("share_links")
    .select("*")
    .eq("subject_type", "collection")
    .eq("subject_id", collectionId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ data: (data ?? []).map((row: any) => ({ ...row, share_url: shareUrl(`/share/collection/${row.id}`) })) });
}

async function createShare(req: Request, body: any) {
  const subjectType = body.subject_type ?? (body.collection_id ? "collection" : "asset");
  const subjectId = String(body.subject_id ?? body.asset_id ?? body.assetId ?? body.collection_id ?? "").trim();
  if ((subjectType !== "asset" && subjectType !== "collection") || !subjectId) {
    return json({ error: "valid subject required" }, { status: 400 });
  }

  const subject = subjectType === "asset" ? await getAsset(subjectId) : await getCollection(subjectId);
  if (!subject) return json({ error: `${subjectType} not found` }, { status: 404 });

  const member = await requireMember(req, subject.workspace_id);
  if (member.response) return member.response;

  const newToken = crypto.randomUUID().replaceAll("-", "");
  const allowComments = body.can_comment ?? body.allow_comments ?? true;
  const { data, error } = await admin.from("share_links").insert({
    workspace_id: subject.workspace_id,
    subject_type: subjectType,
    subject_id: subjectId,
    asset_id: subjectType === "asset" ? subjectId : null,
    parent_asset_id: subjectType === "asset" ? (subject.parent_asset_id ?? subjectId) : null,
    token: newToken,
    can_comment: allowComments,
    allow_comments: allowComments,
    allow_download: body.allow_download ?? true,
    expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
    created_by: member.user.id,
  }).select("*").single();
  if (error) return json({ error: error.message }, { status: 500 });

  const path = subjectType === "collection" ? `/share/collection/${data.id}` : `/share/${data.id}`;
  return json({ data: { ...data, share_url: shareUrl(path), url: shareUrl(path) } });
}

async function revokeShare(req: Request, body: any) {
  const id = String(body.share_link_id ?? body.id ?? "").trim();
  if (!id) return json({ error: "share_link_id required" }, { status: 400 });

  const { data: share, error: shareError } = await admin
    .from("share_links")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (shareError) return json({ error: shareError.message }, { status: 500 });
  if (!share) return json({ error: "Share link not found" }, { status: 404 });

  const member = await requireMember(req, share.workspace_id);
  if (member.response) return member.response;

  const { error } = await admin.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ data: true });
}

async function getAssetShare(req: Request, body: any) {
  const token = String(body.token ?? "").trim();
  if (!token) return json({ error: "token required" }, { status: 400 });

  const share = await getValidShare(token);
  if (!share || share.subject_type !== "asset") return json({ error: "Share link not found" }, { status: 404 });
  const payload = await assetPayload(share.subject_id);
  if (!payload) return json({ error: "Asset not found" }, { status: 404 });

  const user = await getUser(req);
  const isMember = user ? Boolean(await isWorkspaceMember(share.workspace_id, user.id)) : false;
  return json({ data: { ...share, allow_comments: share.allow_comments ?? share.can_comment, is_member: isMember, ...payload } });
}

async function getCollectionShare(req: Request, body: any) {
  const token = String(body.token ?? "").trim();
  if (!token) return json({ error: "token required" }, { status: 400 });

  const share = await getValidShare(token);
  if (!share || share.subject_type !== "collection") return json({ error: "Share link not found" }, { status: 404 });
  const collection = await getCollection(share.subject_id);
  if (!collection) return json({ error: "Collection not found" }, { status: 404 });

  const [{ rows, folders }, user] = await Promise.all([
    resolveSharedCollectionRows(collection),
    getUser(req),
  ]);
  const signedRows = await Promise.all(rows.map(async (row) => {
    const path = typeof row.asset.storage_path === "string" ? row.asset.storage_path : "";
    if (!path) return row;
    const { data } = await admin.storage.from("assets").createSignedUrl(path, 60 * 60);
    return {
      ...row,
      asset: {
        ...row.asset,
        file_url: data?.signedUrl ?? null,
        signed_url: data?.signedUrl ?? null,
      },
    };
  }));
  const isMember = user ? Boolean(await isWorkspaceMember(share.workspace_id, user.id)) : false;
  return json({
    data: {
      ...share,
      allow_comments: share.allow_comments ?? share.can_comment,
      collections: collection,
      collection,
      rows: signedRows,
      folders,
      is_member: isMember,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const urlToken = url.searchParams.get("token") ?? "";
  if (!urlToken && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "create";
    if (action === "list-asset-share-links") return await listAssetShares(req, body);
    if (action === "list-collection-share-links") return await listCollectionShares(req, body);
    if (action?.startsWith?.("revoke")) return await revokeShare(req, body);
    if (action?.startsWith?.("create")) return await createShare(req, body);
    if (action === "get-asset-share-link") return await getAssetShare(req, body);
    if (action === "get-collection-share-link") return await getCollectionShare(req, body);
    return json({ error: "Unknown action" }, { status: 400 });
  }
  if (!urlToken) return json({ error: "Missing share token" }, { status: 400 });

  const share = await getValidShare(urlToken);
  if (!share) return json({ error: "Share link not found" }, { status: 404 });

  if (req.method === "GET") {
    if (share.subject_type === "collection") {
      const { data: collection, error } = await admin.from("collections").select("*").eq("id", share.subject_id).maybeSingle();
      if (error || !collection) return json({ error: "Collection not found" }, { status: 404 });
      const { rows, folders } = await resolveSharedCollectionRows(collection);
      return json({ share, collection, rows, folders });
    }

    const payload = await assetPayload(share.subject_id);
    if (!payload) return json({ error: "Asset not found" }, { status: 404 });
    return json({ share, ...payload });
  }

  if (req.method === "POST") {
    if (!(share.allow_comments ?? share.can_comment)) return json({ error: "Comments are disabled for this link" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const assetId = String(body.asset_id ?? share.subject_id);
    if (!await isAssetAllowedByShare(share, assetId)) return json({ error: "Forbidden" }, { status: 403 });
    const commentBody = String(body.body ?? "").trim();
    if (!commentBody) return json({ error: "Comment body is required" }, { status: 400 });

    const { data, error } = await admin
      .from("asset_comments")
      .insert({
        asset_id: assetId,
        body: commentBody,
        guest_name: String(body.guest_name ?? "").trim() || null,
        guest_email: String(body.guest_email ?? "").trim() || null,
        media_ms: Number.isFinite(Number(body.media_ms)) ? Number(body.media_ms) : null,
        marker: body.marker ?? null,
      })
      .select("*")
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ comment: data }, { status: 201 });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
});

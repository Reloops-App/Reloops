import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, getUser, isWorkspaceMember, readBody, requireUser } from "../_shared/admin.ts";
import { resolveSharedCollectionRows } from "../../shared/collectionShare.ts";

async function getAssetWorkspace(assetId: string) {
  const { data, error } = await admin.from("assets").select("id, workspace_id").eq("id", assetId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getValidShare(token: string) {
  const { data, error } = await admin
    .from("share_links")
    .select("id, workspace_id, subject_type, subject_id, allow_comments, can_comment, expires_at, revoked_at")
    .or(`token.eq.${token},id.eq.${token}`)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

async function shareAllowsAsset(share: any, assetId: string) {
  if (share.subject_type === "asset") return share.subject_id === assetId;
  const { data: collection, error } = await admin.from("collections").select("*").eq("id", share.subject_id).maybeSingle();
  if (error || !collection) return false;
  const { rows } = await resolveSharedCollectionRows(collection);
  return rows.some((row) => row.asset.id === assetId);
}

async function canReadOrComment(req: Request, assetId: string, shareToken?: string | null) {
  if (shareToken) {
    const share = await getValidShare(shareToken);
    if (!share || !await shareAllowsAsset(share, assetId)) return { ok: false, status: 403 };
    return { ok: true, share };
  }

  const user = await getUser(req);
  if (!user) return { ok: false, status: 401 };
  const asset = await getAssetWorkspace(assetId);
  if (!asset) return { ok: false, status: 404 };
  if (!await isWorkspaceMember(asset.workspace_id, user.id)) return { ok: false, status: 403 };
  return { ok: true, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const assetId = url.searchParams.get("asset_id") ?? url.searchParams.get("assetId");
      if (!assetId) return json({ error: "asset_id required" }, { status: 400 });
      const access = await canReadOrComment(req, assetId, url.searchParams.get("share_token"));
      if (!access.ok) return json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
      const { data, error } = await admin.from("asset_comments").select("*").eq("asset_id", assetId).neq("status", "deleted").order("created_at");
      if (error) throw error;
      return json({ data });
    }
    const body = await readBody(req);
    if (req.method === "PATCH") {
      const user = await requireUser(req);
      const { data: existing } = await admin
        .from("asset_comments")
        .select("id, asset_id")
        .eq("id", body.id ?? body.comment_id)
        .maybeSingle();
      if (!existing) return json({ error: "Comment not found" }, { status: 404 });
      const asset = await getAssetWorkspace(existing.asset_id);
      if (!asset || !await isWorkspaceMember(asset.workspace_id, user.id)) {
        return json({ error: "Forbidden" }, { status: 403 });
      }
      const patch: Record<string, unknown> = {};
      for (const key of ["body", "status", "media_ms", "marker"]) {
        if (key in body) patch[key] = body[key];
      }
      const { data, error } = await admin
        .from("asset_comments")
        .update(patch)
        .eq("id", body.id ?? body.comment_id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ data });
    }
    const assetId = body.asset_id ?? body.assetId;
    if (!assetId) return json({ error: "asset_id required" }, { status: 400 });
    const access = await canReadOrComment(req, assetId, body.share_token ?? body.shareToken);
    if (!access.ok) return json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
    if (access.share && !(access.share.allow_comments ?? access.share.can_comment)) {
      return json({ error: "Comments are disabled for this link" }, { status: 403 });
    }
    const user = "user" in access ? access.user : await getUser(req);
    const { data, error } = await admin.from("asset_comments").insert({
      asset_id: assetId,
      body: body.body ?? body.text ?? "",
      author_user_id: user?.id ?? null,
      guest_name: body.guest_name ?? body.guestName ?? null,
      guest_email: body.guest_email ?? body.guestEmail ?? null,
      author_api_key_id: body.author_api_key_id ?? null,
      media_ms: body.media_ms ?? body.ms_offset ?? null,
      marker: body.marker ?? body.drawing_json ?? null,
    }).select("*").single();
    if (error) throw error;
    return json({ data });
  } catch (e) {
    return json({ error: e?.message ?? "Comment failed" }, { status: 500 });
  }
});

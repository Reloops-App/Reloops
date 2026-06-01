import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const srcId = String(body.srcId ?? body.src_id ?? "");
    const targetTopId = String(body.targetTopId ?? body.target_top_id ?? "");
    if (!srcId || !targetTopId) return json({ error: "Missing asset ids" }, { status: 400 });

    const { data: rows, error: fetchError } = await admin.from("assets").select("*").in("id", [srcId, targetTopId]);
    if (fetchError) throw fetchError;
    const src = (rows ?? []).find((row: any) => row.id === srcId);
    const target = (rows ?? []).find((row: any) => row.id === targetTopId);
    if (!src || !target) return json({ error: "Asset not found" }, { status: 404 });
    if (!await isWorkspaceMember(src.workspace_id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

    const rootId = target.parent_asset_id ?? target.id;
    const { data: versions } = await admin
      .from("assets")
      .select("version_no")
      .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);
    const nextVersion = Math.max(1, ...(versions ?? []).map((row: any) => Number(row.version_no) || 1)) + 1;

    const { data, error } = await admin
      .from("assets")
      .update({ parent_asset_id: rootId, version_no: nextVersion, updated_by: user.id })
      .eq("id", srcId)
      .select("*")
      .single();
    if (error) throw error;
    await admin.from("asset_history").insert({ asset_id: srcId, event_type: "version_stacked", actor_user_id: user.id, metadata: { rootId, version_no: nextVersion } });
    return json({ ok: true, data });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Stack asset failed" }, { status: 500 });
  }
});

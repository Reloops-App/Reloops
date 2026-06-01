import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const orderedIds = Array.isArray(body.orderedIds ?? body.ordered_ids) ? (body.orderedIds ?? body.ordered_ids) : [];
    const removedIds = Array.isArray(body.removedIds ?? body.removed_ids) ? (body.removedIds ?? body.removed_ids) : [];
    const ids = [...orderedIds, ...removedIds].filter(Boolean);
    if (!ids.length) return json({ ok: true });

    const { data: rows, error: fetchError } = await admin.from("assets").select("id,workspace_id").in("id", ids);
    if (fetchError) throw fetchError;
    const workspaceId = rows?.[0]?.workspace_id;
    if (workspaceId && !await isWorkspaceMember(workspaceId, user.id)) return json({ error: "Forbidden" }, { status: 403 });

    for (let index = 0; index < orderedIds.length; index += 1) {
      await admin.from("assets").update({ version_no: index + 1, updated_by: user.id }).eq("id", orderedIds[index]);
    }
    if (removedIds.length) {
      await admin.from("assets").update({ parent_asset_id: null, updated_by: user.id }).in("id", removedIds);
    }
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Reorder versions failed" }, { status: 500 });
  }
});

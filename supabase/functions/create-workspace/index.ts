import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, ensureWorkspaceMembership } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const name = String(body.name ?? "Untitled Workspace");
    let organizationId = body.organization_id ?? null;
    if (!organizationId) {
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .insert({ name, type: "team", created_by: user.id })
        .select("*")
        .single();
      if (orgErr) throw orgErr;
      organizationId = org.id;
      await admin.from("organization_members").insert({ organization_id: organizationId, user_id: user.id, role: "owner" });
    }
    const { data: ws, error } = await admin
      .from("workspaces")
      .insert({ organization_id: organizationId, name, created_by: user.id })
      .select("*")
      .single();
    if (error) throw error;
    await ensureWorkspaceMembership(ws.id, user.id, "owner");
    return json({ data: ws });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Create workspace failed" }, { status: 500 });
  }
});

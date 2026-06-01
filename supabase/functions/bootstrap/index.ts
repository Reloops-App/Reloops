import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, ensureWorkspaceMembership } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    await readBody(req);
    const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "User";

    await admin.from("profiles").upsert({
      id: user.id,
      email: user.email,
      display_name: name,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    });

    const { data: existing } = await admin
      .from("organization_members")
      .select("organization_id, role, organizations(id, name)")
      .eq("user_id", user.id)
      .limit(1);

    let organizationId = existing?.[0]?.organization_id as string | undefined;
    let workspaceId: string | undefined;

    if (organizationId) {
      const { data: workspace } = await admin
        .from("workspaces")
        .select("id")
        .eq("organization_id", organizationId)
        .neq("status", "deleted")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      workspaceId = workspace?.id;
    }

    if (!workspaceId) {
      if (!organizationId) {
        const { data: organization, error: orgErr } = await admin
          .from("organizations")
          .insert({ name: `${name}'s Organization`, type: "personal", created_by: user.id })
          .select("*")
          .single();
        if (orgErr) throw orgErr;
        organizationId = organization.id;
        await admin.from("organization_members").insert({ organization_id: organizationId, user_id: user.id, role: "owner" });
      }

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ organization_id: organizationId, name: `${name}'s Workspace`, created_by: user.id })
        .select("*")
        .single();
      if (wsErr) throw wsErr;
      workspaceId = workspace.id;
      await ensureWorkspaceMembership(workspaceId, user.id, "owner");
      await admin.from("projects").insert({ workspace_id: workspaceId, name: "First Project", description: "A starting point for reviews.", created_by: user.id });
    } else {
      await ensureWorkspaceMembership(workspaceId, user.id, existing?.[0]?.role ?? "owner");
    }

    return json({ data: { workspace_id: workspaceId, organization_id: organizationId } });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Bootstrap failed" }, { status: 500 });
  }
});

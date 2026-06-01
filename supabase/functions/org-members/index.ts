import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    let organizationId = String(body.organization_id ?? "");
    const workspaceId = String(body.workspace_id ?? body.workspaceId ?? "");
    if (!organizationId && workspaceId) {
      if (!await isWorkspaceMember(workspaceId, user.id)) return json({ error: "Forbidden" }, { status: 403 });
      const { data: workspace, error: wsErr } = await admin.from("workspaces").select("organization_id").eq("id", workspaceId).single();
      if (wsErr) throw wsErr;
      organizationId = workspace.organization_id;
    }
    if (!organizationId) return json({ error: "Missing organization_id" }, { status: 400 });
    const { data: currentMember } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!currentMember) return json({ error: "Forbidden" }, { status: 403 });

    if (body.action === "add-member") {
      if (currentMember.role !== "owner") return json({ error: "Only owners can add members" }, { status: 403 });
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email) return json({ error: "Missing email" }, { status: 400 });
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select("id,email,display_name,avatar_url")
        .eq("email", email)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) return json({ error: "That user has not signed up yet" }, { status: 404 });
      const role = body.role === "reviewer" ? "reviewer" : "member";
      const { data, error } = await admin
        .from("organization_members")
        .upsert({ organization_id: organizationId, user_id: profile.id, role })
        .select("organization_id,user_id,role")
        .single();
      if (error) throw error;

      const { data: workspaces } = await admin
        .from("workspaces")
        .select("id")
        .eq("organization_id", organizationId)
        .neq("status", "deleted");
      for (const workspace of workspaces ?? []) {
        await admin.from("workspace_members").upsert({ workspace_id: workspace.id, user_id: profile.id, role });
      }

      return json({ data: { ...data, profile, profiles: profile } });
    }

    if (body.action === "update-role") {
      const { data, error } = await admin
        .from("organization_members")
        .update({ role: body.role })
        .eq("organization_id", organizationId)
        .eq("user_id", body.user_id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (body.action === "remove-member") {
      const { error } = await admin
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", body.user_id);
      if (error) throw error;
      return json({ data: true });
    }

    const { data, error } = await admin
      .from("organization_members")
      .select("organization_id,user_id,role")
      .eq("organization_id", organizationId);
    if (error) throw error;
    const profiles = await admin
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .in("id", (data ?? []).map((row: any) => row.user_id));
    const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
    return json({ data: (data ?? []).map((row: any) => ({ ...row, profile: profileById.get(row.user_id) ?? null, profiles: profileById.get(row.user_id) ?? null })) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Members failed" }, { status: 500 });
  }
});

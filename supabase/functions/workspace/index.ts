import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember, ensureWorkspaceMembership } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const action = body.action ?? (req.method === "PATCH" ? "update" : req.method === "DELETE" ? "delete" : "list");

    if (action === "list") {
      const { data: memberships, error } = await admin
        .from("organization_members")
        .select("role, organizations(id, name, workspaces(*))")
        .eq("user_id", user.id);
      if (error) throw error;
      const workspaceRows = (memberships ?? []).flatMap((row: any) => {
        const workspaces = Array.isArray(row.organizations?.workspaces) ? row.organizations.workspaces : [];
        return workspaces
          .filter((ws: any) => ws.status !== "deleted")
          .map((ws: any) => ({ ws, org: row.organizations, role: row.role }));
      });
      const rows = await Promise.all(workspaceRows.map(async (row: any) => {
        const ws = row.ws;
        await ensureWorkspaceMembership(ws.id, user.id, row.role);
        const [{ count: projectsCount }, { count: assetsCount }] = await Promise.all([
          admin.from("projects").select("*", { count: "exact", head: true }).eq("workspace_id", ws.id),
          admin.from("assets").select("*", { count: "exact", head: true }).eq("workspace_id", ws.id),
        ]);
        return {
          ws,
          orgName: row.org?.name ?? ws.name,
          myOrgRole: row.role,
          isAdminLike: row.role === "owner",
          projectsCount: projectsCount ?? 0,
          assetsCount: assetsCount ?? 0,
          storageBytes: 0,
          sampleProjects: [],
          sampleAssets: [],
        };
      }));
      return json({ data: rows });
    }

    if (action === "create") {
      const name = String(body.name ?? "Untitled Workspace").trim();
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
      const { data: ws, error } = await admin.from("workspaces").insert({ organization_id: organizationId, name, created_by: user.id }).select("*").single();
      if (error) throw error;
      await ensureWorkspaceMembership(ws.id, user.id, "owner");
      return json({ data: ws });
    }

    if (action === "resolve") {
      const id = String(body.id ?? body.workspace_id ?? body.workspaceId ?? "");
      if (!id) return json({ error: "Missing workspace_id" }, { status: 400 });
      if (!await isWorkspaceMember(id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

      const { data: workspace, error } = await admin
        .from("workspaces")
        .select("id,name,organization_id,organizations(id,name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!workspace) return json({ error: "Workspace not found" }, { status: 404 });

      return json({
        data: {
          workspace,
          organization: workspace.organizations ?? null,
        },
      });
    }

    if (action === "admin-orgs") {
      const { data: memberships, error } = await admin
        .from("organization_members")
        .select("role, organizations(id,name)")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"]);
      if (error) throw error;
      return json({
        data: (memberships ?? [])
          .map((row: any) => row.organizations)
          .filter(Boolean),
      });
    }

    if (action === "settings" || action === "get") {
      const id = String(body.id ?? body.workspace_id ?? "");
      if (!id) return json({ error: "Missing workspace_id" }, { status: 400 });
      if (!await isWorkspaceMember(id, user.id)) return json({ error: "Forbidden" }, { status: 403 });
      const { data: workspace, error } = await admin
        .from("workspaces")
        .select("*, organizations(*)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!workspace) return json({ error: "Workspace not found" }, { status: 404 });

      const organization = workspace.organizations ?? null;
      const organizationId = workspace.organization_id;
      const [{ data: orgWorkspaces }, { count: orgUserCount }, { data: workspaceAssets }, { data: orgs }] = await Promise.all([
        admin.from("workspaces").select("id,name,logo_url,organization_id").eq("organization_id", organizationId).neq("status", "deleted"),
        admin.from("organization_members").select("*", { count: "exact", head: true }).eq("organization_id", organizationId),
        admin.from("assets").select("size_bytes").eq("workspace_id", id),
        admin.from("organization_members").select("organizations(id,name)").eq("user_id", user.id),
      ]);

      const orgWorkspaceIds = (orgWorkspaces ?? []).map((row: any) => row.id).filter(Boolean);
      const { data: orgAssets } = orgWorkspaceIds.length > 0
        ? await admin.from("assets").select("size_bytes").in("workspace_id", orgWorkspaceIds)
        : { data: [] };

      const wsStorageUsed = (workspaceAssets ?? []).reduce((sum: number, asset: any) => sum + Number(asset.size_bytes ?? 0), 0);
      const orgStorageUsed = (orgAssets ?? []).reduce((sum: number, asset: any) => sum + Number(asset.size_bytes ?? 0), 0);

      return json({
        data: {
          workspace: { ...workspace, organizations: undefined },
          organization,
          orgs: (orgs ?? []).map((row: any) => row.organizations).filter(Boolean),
          orgWorkspaces: orgWorkspaces ?? [],
          orgWorkspaceCount: (orgWorkspaces ?? []).length,
          orgUserCount: orgUserCount ?? 0,
          wsStorageUsed,
          orgStorageUsed,
        },
      });
    }

    if (action === "update") {
      const id = String(body.id ?? body.workspace_id ?? "");
      if (!await isWorkspaceMember(id, user.id)) return json({ error: "Forbidden" }, { status: 403 });
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "status", "logo_url"]) if (key in body) patch[key] = body[key];
      const { data, error } = await admin.from("workspaces").update(patch).eq("id", id).select("*").single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "delete") {
      const id = String(body.id ?? body.workspace_id ?? "");
      if (!await isWorkspaceMember(id, user.id)) return json({ error: "Forbidden" }, { status: 403 });
      const { data, error } = await admin
        .from("workspaces")
        .update({ status: "deleted" })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "subscription-check") {
      return json({ data: { hasSubscription: true, organizationId: body.organization_id ?? body.workspace_id ?? null } });
    }

    return json({ error: `Unsupported workspace action: ${action}` }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Workspace failed" }, { status: 500 });
  }
});

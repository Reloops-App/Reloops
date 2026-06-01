import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const action = body.action ?? "list";
    let workspaceId = String(body.workspace_id ?? body.workspaceId ?? "");
    if (!workspaceId && body.project_id) {
      const { data: project } = await admin.from("projects").select("workspace_id").eq("id", body.project_id).maybeSingle();
      workspaceId = project?.workspace_id ?? "";
    }
    if (!workspaceId && (body.id ?? body.asset_id)) {
      const { data: asset } = await admin.from("assets").select("workspace_id").eq("id", body.id ?? body.asset_id).maybeSingle();
      workspaceId = asset?.workspace_id ?? "";
    }
    if (workspaceId && !await isWorkspaceMember(workspaceId, user.id)) return json({ error: "Forbidden" }, { status: 403 });

    if (action === "list_folders" || action === "list_project_folders") {
      let q = admin.from("folders").select("*").eq("workspace_id", workspaceId).order("name");
      if (body.project_id) q = q.eq("project_id", body.project_id);
      const { data, error } = await q;
      if (error) throw error;
      return json({ data });
    }

    if (action === "create_folder") {
      const { data, error } = await admin.from("folders").insert({
        workspace_id: workspaceId,
        project_id: body.project_id ?? null,
        parent_folder_id: body.parent_folder_id ?? null,
        name: String(body.name ?? "Untitled Folder"),
        created_by: user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "rename_folder") {
      const { data, error } = await admin.from("folders").update({ name: body.name }).eq("id", body.folder_id ?? body.id).select("*").single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "delete_folder") {
      const { error } = await admin.from("folders").delete().eq("id", body.folder_id ?? body.id);
      if (error) throw error;
      return json({ data: true });
    }

    if (action === "list" || action === "list_library" || action === "list_project") {
      let q = admin.from("assets").select("*").order("created_at", { ascending: false });
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      if (body.project_id) q = q.eq("project_id", body.project_id);
      const { data, error } = await q;
      if (error) throw error;
      if (action === "list_project") {
        const { data: project, error: projectError } = await admin
          .from("projects")
          .select("*")
          .eq("id", body.project_id)
          .maybeSingle();
        if (projectError) throw projectError;
        if (!project) return json({ error: "Project not found" }, { status: 404 });
        if (!await isWorkspaceMember(project.workspace_id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

        const [{ data: workspace, error: workspaceError }, { data: folders, error: foldersError }] = await Promise.all([
          admin.from("workspaces").select("*").eq("id", project.workspace_id).single(),
          admin.from("folders").select("*").eq("workspace_id", project.workspace_id).eq("project_id", body.project_id).order("name"),
        ]);
        if (workspaceError) throw workspaceError;
        if (foldersError) throw foldersError;
        return json({ data: { project, workspace, assets: data ?? [], folders: folders ?? [] } });
      }
      return json({ data: { assets: data ?? [] } });
    }

    if (action === "project_counts") {
      const { data, error } = await admin
        .from("assets")
        .select("project_id,status")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      const byProject = new Map<string, { project_id: string; total: number; approved: number; pending: number }>();
      for (const asset of data ?? []) {
        if (!asset.project_id) continue;
        const row = byProject.get(asset.project_id) ?? { project_id: asset.project_id, total: 0, approved: 0, pending: 0 };
        row.total += 1;
        if (asset.status === "approved") row.approved += 1;
        else row.pending += 1;
        byProject.set(asset.project_id, row);
      }
      return json({ data: Array.from(byProject.values()) });
    }

    if (action === "update" || req.method === "PATCH") {
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "description", "tags", "smart_tags", "status", "assigned_to", "assigned_to_api_key_id", "folder_id", "project_id", "cover_image_url", "smart_description", "version_no", "updated_by"]) {
        if (key in body) patch[key] = body[key];
      }
      patch.updated_by = patch.updated_by ?? user.id;
      const { data, error } = await admin.from("assets").update(patch).eq("id", body.id ?? body.asset_id).select("*").single();
      if (error) throw error;
      await admin.from("asset_history").insert({
        asset_id: data.id,
        event_type: "asset_updated",
        actor_user_id: user.id,
        metadata: { after: patch },
      });
      return json({ data });
    }

    if (action === "request_revision") {
      const { data, error } = await admin
        .from("assets")
        .update({ status: "needs_review", updated_by: user.id })
        .eq("id", body.id ?? body.asset_id)
        .select("*")
        .single();
      if (error) throw error;
      await admin.from("asset_history").insert({ asset_id: data.id, event_type: "revision_requested", actor_user_id: user.id });
      return json({ data });
    }

    if (action === "delete") {
      const { error } = await admin.from("assets").delete().eq("id", body.id ?? body.asset_id);
      if (error) throw error;
      return json({ data: true });
    }

    return json({ error: `Unsupported asset action: ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Asset failed" }, { status: 500 });
  }
});

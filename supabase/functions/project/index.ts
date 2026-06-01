import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

async function requireProjectMember(projectId: string, userId: string) {
  const { data: project, error } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!project) return { response: json({ error: "Project not found" }, { status: 404 }) };
  if (!await isWorkspaceMember(project.workspace_id, userId)) {
    return { response: json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { project };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const action = body.action ?? (req.method === "GET" ? "list" : "create");
    const workspaceId = body.workspace_id ?? body.workspaceId;
    if (workspaceId && !await isWorkspaceMember(String(workspaceId), user.id)) return json({ error: "Forbidden" }, { status: 403 });

    if (action === "list") {
      if (!workspaceId) return json({ error: "workspace_id required" }, { status: 400 });
      const { data, error } = await admin.from("projects").select("*").eq("workspace_id", workspaceId).order("created_at");
      if (error) throw error;
      return json({ data });
    }
    if (action === "create") {
      if (!workspaceId) return json({ error: "workspace_id required" }, { status: 400 });
      const { data, error } = await admin.from("projects").insert({
        workspace_id: workspaceId,
        name: String(body.name ?? "Untitled Project"),
        description: body.description ?? null,
        created_by: user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ data });
    }
    if (action === "update") {
      const id = String(body.id ?? body.project_id ?? "");
      if (!id) return json({ error: "project_id required" }, { status: 400 });
      const access = await requireProjectMember(id, user.id);
      if (access.response) return access.response;
      const { data, error } = await admin.from("projects").update({
        name: body.name,
        description: body.description,
      }).eq("id", id).select("*").single();
      if (error) throw error;
      return json({ data });
    }
    if (action === "delete") {
      const id = String(body.id ?? body.project_id ?? "");
      if (!id) return json({ error: "project_id required" }, { status: 400 });
      const access = await requireProjectMember(id, user.id);
      if (access.response) return access.response;
      const { error } = await admin.from("projects").delete().eq("id", id);
      if (error) throw error;
      return json({ data: true });
    }
    return json({ error: `Unsupported project action: ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Project failed" }, { status: 500 });
  }
});

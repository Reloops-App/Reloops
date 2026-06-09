import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

function rootAssetIdOf(row: { id: string; parent_asset_id?: string | null }) {
  return row.parent_asset_id ?? row.id;
}

function copiedAssetPayload(row: any, input: {
  id: string;
  targetProjectId: string;
  destinationFolderId: string | null;
  parentAssetId: string | null;
  userId: string;
}) {
  return {
    id: input.id,
    workspace_id: row.workspace_id,
    project_id: input.targetProjectId,
    folder_id: input.destinationFolderId,
    parent_asset_id: input.parentAssetId,
    version_no: row.version_no ?? 1,
    title: row.title ?? "Untitled",
    description: row.description ?? null,
    tags: row.tags ?? [],
    smart_tags: row.smart_tags ?? [],
    status: row.status ?? "needs_review",
    storage_path: row.storage_path,
    cover_image_url: row.cover_image_url ?? null,
    thumbnail_path: row.thumbnail_path ?? null,
    mime_type: row.mime_type ?? "application/octet-stream",
    size_bytes: row.size_bytes ?? 0,
    width: row.width ?? null,
    height: row.height ?? null,
    duration_ms: row.duration_ms ?? null,
    upload_batch_id: row.upload_batch_id ?? null,
    upload_batch_total: row.upload_batch_total ?? 1,
    uploaded_by: row.uploaded_by ?? input.userId,
    updated_by: input.userId,
    assigned_to: row.assigned_to ?? null,
    smart_description: row.smart_description ?? null,
    ai_description: row.ai_description ?? null,
    ai_metadata: row.ai_metadata ?? null,
    usage_rights: row.usage_rights ?? null,
    approval_status: row.approval_status ?? null,
    created_by_api_key_id: row.created_by_api_key_id ?? null,
    uploaded_by_api_key_id: row.uploaded_by_api_key_id ?? null,
    assigned_to_api_key_id: row.assigned_to_api_key_id ?? null,
    updated_by_api_key_id: null,
  };
}

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
      const projectId = body.project_id ?? null;
      const parentFolderId = body.parent_folder_id ?? null;
      const name = String(body.name ?? "Untitled Folder").trim() || "Untitled Folder";

      const existingFolderQuery = () => {
        let q = admin
          .from("folders")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("name", name)
          .order("created_at", { ascending: true })
          .limit(1);
        q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
        q = parentFolderId ? q.eq("parent_folder_id", parentFolderId) : q.is("parent_folder_id", null);
        return q;
      };

      const { data: existing, error: existingError } = await existingFolderQuery().maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ data: existing });

      const { data, error } = await admin.from("folders").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        parent_folder_id: parentFolderId,
        name,
        created_by: user.id,
      }).select("*").single();
      if (error) {
        const { data: existingAfterRace, error: raceLookupError } = await existingFolderQuery().maybeSingle();
        if (raceLookupError) throw raceLookupError;
        if (existingAfterRace) return json({ data: existingAfterRace });
        throw error;
      }
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
      if (!body.include_deleted) q = q.or("status.neq.deleted,status.is.null");
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

    if (action === "delete_asset_stack") {
      const projectId = String(body.project_id ?? body.projectId ?? "");
      const assetId = String(body.asset_id ?? body.assetId ?? body.id ?? "");
      if (!projectId || !assetId) return json({ error: "project_id and asset_id required" }, { status: 400 });

      const { data: project, error: projectError } = await admin
        .from("projects")
        .select("id, workspace_id, status")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) throw projectError;
      if (!project || project.status === "deleted") return json({ error: "Project not found" }, { status: 404 });
      if (!await isWorkspaceMember(project.workspace_id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

      const { data: asset, error: assetError } = await admin
        .from("assets")
        .select("id, workspace_id, project_id, parent_asset_id")
        .eq("id", assetId)
        .maybeSingle();
      if (assetError) throw assetError;
      if (!asset) return json({ error: "Asset not found" }, { status: 404 });
      if (asset.workspace_id !== project.workspace_id || asset.project_id !== project.id) {
        return json({ error: "Asset does not belong to this project" }, { status: 400 });
      }

      const rootId = rootAssetIdOf(asset);
      const { data: stack, error: stackError } = await admin
        .from("assets")
        .select("id")
        .eq("workspace_id", project.workspace_id)
        .eq("project_id", project.id)
        .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);
      if (stackError) throw stackError;

      const stackIds = (stack ?? []).map((row) => row.id);
      if (stackIds.length === 0) return json({ data: { deleted_asset_ids: [], deleted_root_id: rootId } });

      const { error: updateError } = await admin
        .from("assets")
        .update({
          status: "deleted",
          updated_by: user.id,
          updated_by_api_key_id: null,
        })
        .in("id", stackIds);
      if (updateError) throw updateError;

      return json({ data: { deleted_asset_ids: stackIds, deleted_root_id: rootId } });
    }

    if (action === "copy_to_project_bulk") {
      const sourceProjectId = String(body.source_project_id ?? body.sourceProjectId ?? "");
      const targetProjectId = String(body.target_project_id ?? body.targetProjectId ?? "");
      const destinationFolderId = body.destination_folder_id ?? body.destinationFolderId ?? null;
      const rawRootIds = Array.isArray(body.asset_root_ids)
        ? body.asset_root_ids
        : Array.isArray(body.assetRootIds)
          ? body.assetRootIds
          : [];
      const rootIds: string[] = Array.from(
        new Set(rawRootIds.map((id: unknown) => String(id)).filter((id: string): id is string => Boolean(id))),
      );

      if (!sourceProjectId || !targetProjectId) {
        return json({ error: "source_project_id and target_project_id required" }, { status: 400 });
      }
      if (rootIds.length === 0) return json({ error: "asset_root_ids required" }, { status: 400 });

      const [{ data: sourceProject, error: sourceProjectError }, { data: targetProject, error: targetProjectError }] = await Promise.all([
        admin.from("projects").select("id, workspace_id, status").eq("id", sourceProjectId).maybeSingle(),
        admin.from("projects").select("id, workspace_id, status").eq("id", targetProjectId).maybeSingle(),
      ]);
      if (sourceProjectError) throw sourceProjectError;
      if (targetProjectError) throw targetProjectError;
      if (!sourceProject || sourceProject.status === "deleted") return json({ error: "Source project not found" }, { status: 404 });
      if (!targetProject || targetProject.status === "deleted") return json({ error: "Target project not found" }, { status: 404 });
      if (sourceProject.workspace_id !== targetProject.workspace_id) return json({ error: "Projects must belong to the same workspace" }, { status: 400 });
      if (!await isWorkspaceMember(sourceProject.workspace_id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

      if (destinationFolderId) {
        const { data: destinationFolder, error: folderError } = await admin
          .from("folders")
          .select("id, workspace_id, project_id")
          .eq("id", String(destinationFolderId))
          .maybeSingle();
        if (folderError) throw folderError;
        if (
          !destinationFolder ||
          destinationFolder.workspace_id !== targetProject.workspace_id ||
          destinationFolder.project_id !== targetProject.id
        ) {
          return json({ error: "Destination folder not found" }, { status: 404 });
        }
      }

      const copiedRootIds: string[] = [];
      const skippedRootIds: string[] = [];

      for (const rootId of rootIds) {
        const { data: rootAsset, error: rootError } = await admin
          .from("assets")
          .select("*")
          .eq("id", rootId)
          .maybeSingle();
        if (rootError) throw rootError;
        if (!rootAsset || rootAsset.workspace_id !== sourceProject.workspace_id || rootAsset.status === "deleted") {
          skippedRootIds.push(rootId);
          continue;
        }

        const actualRootId = rootAssetIdOf(rootAsset);
        if (actualRootId !== rootId) {
          skippedRootIds.push(rootId);
          continue;
        }

        const { data: link, error: linkError } = await admin
          .from("project_asset_links")
          .select("project_id")
          .eq("project_id", sourceProject.id)
          .eq("asset_root_id", rootId)
          .maybeSingle();
        if (linkError) throw linkError;
        const belongsToSource = rootAsset.project_id === sourceProject.id || Boolean(link);
        if (!belongsToSource) {
          skippedRootIds.push(rootId);
          continue;
        }

        const { data: stackRows, error: stackError } = await admin
          .from("assets")
          .select("*")
          .eq("workspace_id", sourceProject.workspace_id)
          .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);
        if (stackError) throw stackError;

        const activeStackRows = (stackRows ?? [])
          .filter((row) => row.status !== "deleted")
          .sort((a, b) => (a.version_no ?? 0) - (b.version_no ?? 0));
        const sourceRoot = activeStackRows.find((row) => row.id === rootId);
        if (!sourceRoot) {
          skippedRootIds.push(rootId);
          continue;
        }

        const copiedRootId = crypto.randomUUID();
        const targetFolderId = destinationFolderId ? String(destinationFolderId) : null;
        const payloads = activeStackRows.map((row) => copiedAssetPayload(row, {
          id: row.id === rootId ? copiedRootId : crypto.randomUUID(),
          targetProjectId: targetProject.id,
          destinationFolderId: targetFolderId,
          parentAssetId: row.id === rootId ? null : copiedRootId,
          userId: user.id,
        }));

        const { error: copyError } = await admin.from("assets").insert(payloads);
        if (copyError) throw copyError;

        copiedRootIds.push(copiedRootId);
      }

      return json({
        data: {
          source_project_id: sourceProject.id,
          target_project_id: targetProject.id,
          copied_root_ids: copiedRootIds,
          skipped_root_ids: skippedRootIds,
        },
      });
    }

    if (action === "detach_project") {
      const projectId = String(body.project_id ?? body.projectId ?? "");
      const assetId = String(body.asset_id ?? body.assetId ?? body.id ?? "");
      if (!projectId || !assetId) return json({ error: "project_id and asset_id required" }, { status: 400 });

      const { data: project, error: projectError } = await admin
        .from("projects")
        .select("id, workspace_id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) throw projectError;
      if (!project) return json({ error: "Project not found" }, { status: 404 });
      if (!await isWorkspaceMember(project.workspace_id, user.id)) return json({ error: "Forbidden" }, { status: 403 });

      const { data: target, error: targetError } = await admin
        .from("assets")
        .select("id, workspace_id, parent_asset_id")
        .eq("id", assetId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Asset not found" }, { status: 404 });
      if (target.workspace_id !== project.workspace_id) return json({ error: "Asset not found in project workspace" }, { status: 404 });

      const rootId = target.parent_asset_id ?? target.id;
      const { data: stack, error: stackError } = await admin
        .from("assets")
        .select("id")
        .eq("workspace_id", project.workspace_id)
        .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);
      if (stackError) throw stackError;

      const stackIds = (stack ?? []).map((row) => row.id);
      if (stackIds.length === 0) return json({ data: { removed_asset_ids: [] } });

      const { data: removed, error: updateError } = await admin
        .from("assets")
        .update({ project_id: null, folder_id: null, updated_by: user.id })
        .in("id", stackIds)
        .eq("project_id", projectId)
        .select("id");
      if (updateError) throw updateError;

      const removedIds = (removed ?? []).map((row) => row.id);

      const { error: linkError } = await admin
        .from("project_asset_links")
        .delete()
        .eq("project_id", projectId)
        .eq("asset_root_id", rootId);
      if (linkError) throw linkError;

      if (removedIds.length > 0) {
        await admin.from("asset_history").insert(
          removedIds.map((id) => ({
            asset_id: id,
            event_type: "asset_detached_from_project",
            workspace_id: project.workspace_id,
            project_id: projectId,
            actor_user_id: user.id,
            metadata: { project_id: projectId, root_asset_id: rootId },
          })),
        );
      }

      return json({ data: { removed_asset_ids: removedIds, root_asset_id: rootId } });
    }

    if (action === "delete") {
      const { error } = await admin.from("assets").delete().eq("id", body.id ?? body.asset_id);
      if (error) throw error;
      return json({ data: true });
    }

    return json({ error: `Unsupported asset action: ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e instanceof Error ? e.message : "Asset failed" }, { status: 500 });
  }
});

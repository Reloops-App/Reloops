// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth, notfound } from "../../shared/apiAuth.ts";
import { listProjectAssetRows } from "../../shared/dam.ts";

function extensionFor(fileName: string, contentType: string) {
    const ext = fileName.split(".").pop()?.trim();
    if (ext && ext !== fileName && /^[a-z0-9]{1,12}$/i.test(ext)) return ext;
    if (contentType === "image/jpeg") return "jpg";
    if (contentType === "image/png") return "png";
    if (contentType === "video/mp4") return "mp4";
    if (contentType === "video/quicktime") return "mov";
    if (contentType === "application/pdf") return "pdf";
    if (contentType.startsWith("text/")) return "txt";
    return "bin";
}

function formString(form: FormData, key: string) {
    const value = form.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTags(value: string | null) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const apiKey = await verifyApiKey(req);
        if (!apiKey) return unauth();

        const url = new URL(req.url);
        // Extracts the part of the URL after the function name if any
        const pathSegments = url.pathname.split('/').filter(Boolean);
        const funcIdx = pathSegments.indexOf("api-assets");
        const routeParts = funcIdx !== -1 ? pathSegments.slice(funcIdx + 1) : pathSegments;

        if (routeParts.length === 1 && routeParts[0] === "upload" && req.method === "POST") {
            const form = await req.formData().catch(() => null);
            if (!form) return bad("Expected multipart/form-data");

            const file = form.get("file");
            if (!(file instanceof File)) return bad("Missing file");

            const workspace_id = formString(form, "workspace_id");
            if (!workspace_id) return bad("Missing 'workspace_id'");
            if (!apiKey.workspace_ids.includes(workspace_id)) return notfound();

            const parentAssetId = formString(form, "parent_asset_id") ?? formString(form, "parentAssetId");
            let project_id = formString(form, "project_id");
            let folder_id = formString(form, "folder_id");
            let parent_asset_id: string | null = null;
            let version_no = 1;

            if (parentAssetId) {
                const { data: parentAsset, error: parentError } = await admin
                    .from("assets")
                    .select("id, workspace_id, parent_asset_id, version_no, project_id, folder_id")
                    .eq("id", parentAssetId)
                    .maybeSingle();
                if (parentError) return bad("Failed to load parent asset", 500);
                if (!parentAsset || parentAsset.workspace_id !== workspace_id) return bad("Parent asset not found or inaccessible");

                const rootId = parentAsset.parent_asset_id ?? parentAsset.id;
                const { data: versions, error: versionError } = await admin
                    .from("assets")
                    .select("version_no")
                    .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);
                if (versionError) return bad("Failed to load versions", 500);

                parent_asset_id = rootId;
                version_no = Math.max(1, ...(versions ?? []).map((row: any) => Number(row.version_no) || 1)) + 1;
                project_id = project_id ?? parentAsset.project_id ?? null;
                folder_id = folder_id ?? parentAsset.folder_id ?? null;
            }

            if (project_id) {
                const { data: project } = await admin
                    .from("projects")
                    .select("id")
                    .eq("id", project_id)
                    .eq("workspace_id", workspace_id)
                    .neq("status", "deleted")
                    .maybeSingle();
                if (!project) return bad("Project not found or inaccessible");
            }

            if (folder_id) {
                const { data: folder } = await admin
                    .from("folders")
                    .select("id, project_id")
                    .eq("id", folder_id)
                    .eq("workspace_id", workspace_id)
                    .is("deleted_at", null)
                    .maybeSingle();
                const folderProjectId = folder?.project_id ? String(folder.project_id) : null;
                if (!folder || folderProjectId !== (project_id ? String(project_id) : null)) {
                    return bad("Folder not found or inaccessible");
                }
            }

            const assetId = crypto.randomUUID();
            const contentType = (formString(form, "mime_type") ?? file.type) || "application/octet-stream";
            const title = formString(form, "title") ?? file.name;
            const objectKey = `${workspace_id}/${project_id ?? "library"}/${assetId}.${extensionFor(file.name, contentType)}`;

            const { error: uploadError } = await admin.storage
                .from("assets")
                .upload(objectKey, file, {
                    contentType,
                    upsert: false,
                });
            if (uploadError) {
                console.error("api-assets upload storage error:", uploadError);
                return bad("Failed to upload file", 500);
            }

            const { data: created, error: createErr } = await admin
                .from("assets")
                .insert({
                    id: assetId,
                    workspace_id,
                    project_id: project_id ?? null,
                    folder_id: folder_id ?? null,
                    parent_asset_id,
                    version_no,
                    title,
                    description: formString(form, "description"),
                    tags: parseTags(formString(form, "tags")),
                    storage_path: objectKey,
                    cover_image_url: formString(form, "cover_image_url"),
                    thumbnail_path: formString(form, "thumbnail_path"),
                    mime_type: contentType,
                    size_bytes: file.size,
                    uploaded_by: apiKey.created_by,
                    created_by_api_key_id: apiKey.id,
                    uploaded_by_api_key_id: apiKey.id,
                })
                .select("*")
                .single();

            if (createErr) {
                await admin.storage.from("assets").remove([objectKey]).catch(() => undefined);
                console.error("api-assets upload asset create error:", createErr);
                return bad("Failed to create uploaded asset", 500);
            }

            const { data: pubData } = admin.storage.from("assets").getPublicUrl(objectKey);
            return json({ data: { ...created, download_url: pubData?.publicUrl ?? null } }, 201);
        }

        if (routeParts.length === 0 && req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const {
                id,
                workspace_id,
                project_id,
                folder_id,
                title,
                storage_path,
                cover_image_url,
                thumbnail_path,
                mime_type,
                size_bytes,
                upload_batch_id,
                upload_batch_total,
                description,
                tags,
            } = body;

            if (!workspace_id || typeof workspace_id !== "string") return bad("Missing 'workspace_id'");
            if (!apiKey.workspace_ids.includes(workspace_id)) return notfound();
            if (!title || typeof title !== "string" || !title.trim()) return bad("Missing 'title'");
            if (!storage_path || typeof storage_path !== "string" || !storage_path.trim()) return bad("Missing 'storage_path'");

            if (project_id) {
                const { data: project } = await admin
                    .from("projects")
                    .select("id")
                    .eq("id", project_id)
                    .eq("workspace_id", workspace_id)
                    .neq("status", "deleted")
                    .maybeSingle();
                if (!project) return bad("Project not found or inaccessible");
            }

            if (folder_id) {
                const { data: folder } = await admin
                    .from("folders")
                    .select("id, project_id")
                    .eq("id", folder_id)
                    .eq("workspace_id", workspace_id)
                    .is("deleted_at", null)
                    .maybeSingle();
                const folderProjectId = folder?.project_id ? String(folder.project_id) : null;
                if (!folder || folderProjectId !== (project_id ? String(project_id) : null)) {
                    return bad("Folder not found or inaccessible");
                }
            }

            const { data: created, error: createErr } = await admin
                .from("assets")
                .insert({
                    ...(id ? { id } : {}),
                    workspace_id,
                    project_id: project_id ?? null,
                    folder_id: folder_id ?? null,
                    title: title.trim(),
                    description: typeof description === "string" ? description : null,
                    tags: Array.isArray(tags) ? tags.map(String) : [],
                    storage_path: storage_path.trim(),
                    cover_image_url: typeof cover_image_url === "string" ? cover_image_url : null,
                    thumbnail_path: typeof thumbnail_path === "string" ? thumbnail_path : null,
                    mime_type: typeof mime_type === "string" ? mime_type : "application/octet-stream",
                    size_bytes: Number.isFinite(size_bytes) ? Number(size_bytes) : 0,
                    upload_batch_id: upload_batch_id ?? null,
                    upload_batch_total: Number.isFinite(upload_batch_total) ? Number(upload_batch_total) : null,
                    uploaded_by: apiKey.created_by,
                    created_by_api_key_id: apiKey.id,
                    uploaded_by_api_key_id: apiKey.id,
                })
                .select("*")
                .single();

            if (createErr) {
                console.error("api-assets create error:", createErr);
                return bad("Failed to create asset", 500);
            }

            return json({ data: created }, 201);
        }

        // Stacking route
        if (routeParts.length === 1 && routeParts[0] === "stack" && req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const { src_id, target_id } = body;
            if (!src_id || !target_id) return bad("Missing 'src_id' or 'target_id'");

            // Load both assets to verify ownership and compute root
            const { data: assets, error: loadErr } = await admin
                .from("assets")
                .select("id, workspace_id, parent_asset_id, version_no, project_id, folder_id")
                .in("id", [src_id, target_id]);

            if (loadErr || !assets || assets.length < 2) {
                // If one ID is the same as the other, assets.length will be 1
                if (src_id === target_id) return bad("src_id and target_id must be different");
                return bad("One or both assets not found or inaccessible");
            }

            const srcAsset = assets.find(a => a.id === src_id);
            const targetAsset = assets.find(a => a.id === target_id);

            if (!srcAsset || !targetAsset) return bad("One or both assets not found");
            if (!apiKey.workspace_ids.includes(srcAsset.workspace_id) || !apiKey.workspace_ids.includes(targetAsset.workspace_id)) {
                return unauth("Unauthorized access to these assets");
            }

            const rootId = targetAsset.parent_asset_id || targetAsset.id;

            // Compute next version number
            const { data: versions, error: versErr } = await admin
                .from("assets")
                .select("version_no")
                .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`);

            if (versErr) return bad("Failed to load versions", 500);

            const maxVer = Math.max(0, ...(versions?.map((v: any) => v.version_no || 0) ?? [0]));
            const newVer = maxVer + 1;

            const { data: updated, error: updErr } = await admin
                .from("assets")
                .update({
                    parent_asset_id: rootId,
                    version_no: newVer,
                    project_id: targetAsset.project_id ?? null,
                    folder_id: (targetAsset as any).folder_id ?? null,
                    updated_at: new Date().toISOString(),
                    updated_by: apiKey.created_by,
                    updated_by_api_key_id: apiKey.id,
                })
                .eq("id", src_id)
                .select()
                .single();

            if (updErr) return bad("Failed to stack asset", 500);

            const { error: historyErr } = await admin.from("asset_history").insert({
                asset_id: updated.id,
                workspace_id: updated.workspace_id,
                project_id: updated.project_id ?? null,
                event_type: "version_stacked",
                actor_user_id: apiKey.created_by,
                actor_api_key_id: apiKey.id,
                metadata: {
                    root_asset_id: rootId,
                    previous_parent_asset_id: srcAsset.parent_asset_id ?? null,
                    previous_version_no: srcAsset.version_no ?? null,
                    version_no: updated.version_no ?? newVer,
                },
            });
            if (historyErr) {
                console.error("Failed to write asset history for version_stacked:", historyErr);
            }

            return json({ data: updated });
        }

        // Base URL route (list by project_id)
        if (routeParts.length === 0 && req.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const workspaceId = url.searchParams.get("workspace_id");

            if (!projectId && !workspaceId) return bad("Missing project_id or workspace_id parameter");

            if (projectId) {
                // Verify project belongs to org
                const { data: projData } = await admin.from("projects").select("id").eq("id", projectId).in("workspace_id", apiKey.workspace_ids).single();
                if (!projData) return notfound();

                const assets = await listProjectAssetRows(projectId);
                const mapped = assets.map((asset: any) => ({
                    id: asset.id,
                    title: asset.title,
                    cover_image_url: asset.cover_image_url,
                    status: asset.status,
                    created_at: asset.created_at,
                    storage_path: asset.storage_path,
                    version_no: asset.version_no,
                    mime_type: asset.mime_type,
                    size_bytes: asset.size_bytes,
                    folder_id: asset.folder_id ?? null,
                    project_id: asset.project_id ?? null,
                    parent_asset_id: asset.parent_asset_id ?? null,
                }));

                return json({ data: mapped, count: mapped.length });
            }

            if (!workspaceId || !apiKey.workspace_ids.includes(workspaceId)) return notfound();

            const { data: assets, error: assetErr, count } = await admin
                .from("assets")
                .select("id, title, cover_image_url, status, created_at, storage_path, version_no, mime_type, size_bytes, folder_id, project_id, parent_asset_id", { count: 'exact' })
                .eq("workspace_id", workspaceId)
                .or(`status.neq.deleted,status.is.null`);

            if (assetErr) return bad("Error fetching assets", 500);
            return json({ data: assets, count });
        }

        // Single asset URL route
        if (routeParts.length >= 1) {
            const assetId = routeParts[0];

            // Validate asset scoping
            const { data: assetData } = await admin.from("assets").select("id, workspace_id, storage_path, parent_asset_id").eq("id", assetId).single();
            if (!assetData || !apiKey.workspace_ids.includes(assetData.workspace_id)) {
                return notfound(); 
            }

            // Versions sub-route
            if (routeParts.length === 2 && routeParts[1] === "versions") {
                if (req.method === "GET") {
                    const rootId = assetData.parent_asset_id || assetId;
                    const { data: versions, error: vErr } = await admin
                        .from("assets")
                        .select("*")
                        .or(`id.eq.${rootId},parent_asset_id.eq.${rootId}`)
                        .order("version_no", { ascending: false });
                    
                    if (vErr) return bad("Error fetching versions", 500);

                    // Add download_urls
                    const withUrls = versions.map(v => {
                        let downloadUrl = null;
                        if (v.storage_path) {
                            const { data: pubData } = admin.storage.from("assets").getPublicUrl(v.storage_path);
                            downloadUrl = pubData?.publicUrl;
                        }
                        return { ...v, download_url: downloadUrl };
                    });

                    return json({ data: withUrls });
                }
                return bad("Method not allowed", 405);
            }

            if (routeParts.length === 1) {
                if (req.method === "GET") {
                    const { data: assetInfo } = await admin.from("assets").select("*").eq("id", assetId).single();
                    let downloadUrl = null;
                    if (assetInfo?.storage_path) {
                        const { data: pubData } = admin.storage.from("assets").getPublicUrl(assetInfo.storage_path);
                        downloadUrl = pubData?.publicUrl;
                    }
                    return json({ data: { ...assetInfo, download_url: downloadUrl } });
                }

                if (req.method === "PATCH") {
                    let body: any = {};
                    try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

                    const { status } = body;
                    if (!status) return bad("Missing 'status'");
                    const allowedStatuses = ['needs_review', 'in_review', 'approved'];
                    if (!allowedStatuses.includes(status)) return bad(`Status must be one of: ${allowedStatuses.join(', ')}`);

                    const { data: updated, error: updErr } = await admin
                        .from("assets")
                        .update({
                            status,
                            updated_at: new Date().toISOString(),
                            updated_by: apiKey.created_by,
                            updated_by_api_key_id: apiKey.id,
                        })
                        .eq("id", assetId)
                        .select()
                        .single();
                    
                    if (updErr) return bad("Error updating asset status", 500);
                    return json({ data: updated });
                }
            }
        }

        return notfound();
    } catch (e: any) {
        console.error("api-assets error:", e);
        return bad(e.message || "Server error", 500);
    }
});

// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth, notfound } from "../../shared/apiAuth.ts";
import { listProjectAssetIds } from "../../shared/dam.ts";

const FRONTEND_URL = Deno.env.get("FRONTEND_URL") ?? "https://reloops.app";

async function hashToken(token: string): Promise<string> {
    const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(tokenHash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const apiKey = await verifyApiKey(req);
        if (!apiKey) return unauth();

        const url = new URL(req.url);
        const pathSegments = url.pathname.split('/').filter(Boolean);
        const funcIdx = pathSegments.indexOf("api-shares");
        const routeParts = funcIdx !== -1 ? pathSegments.slice(funcIdx + 1) : pathSegments;

        // POST /api-shares - Create a share link
        if (routeParts.length === 0 && req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const { asset_id, expires_at, allow_download = true, allow_comments = true } = body;
            if (!asset_id) return bad("Missing asset_id");

            // Verify asset access
            const { data: asset, error: assetErr } = await admin
                .from("assets")
                .select("id, workspace_id, parent_asset_id")
                .eq("id", asset_id)
                .single();
            
            if (assetErr || !asset || !apiKey.workspace_ids.includes(asset.workspace_id)) {
                return bad("Asset not found or inaccessible");
            }

            const token = crypto.randomUUID().replace(/-/g, "");
            const tokenHash = await hashToken(token);

            const { data: shareLink, error: insertErr } = await admin
                .from("share_links")
                .insert({
                    workspace_id: asset.workspace_id,
                    subject_type: "asset",
                    subject_id: asset_id,
                    asset_id,
                    parent_asset_id: asset.parent_asset_id ?? asset_id,
                    token,
                    token_hash: tokenHash,
                    expires_at: expires_at ? new Date(expires_at).toISOString() : null,
                    allow_download,
                    allow_comments,
                    created_by: apiKey.created_by,
                })
                .select()
                .single();

            if (insertErr || !shareLink) {
                console.error("Share link insert error:", insertErr);
                return bad("Failed to create share link", 500);
            }

            const shareUrl = `${FRONTEND_URL.replace(/\/$/, "")}/share/${shareLink.id}`;
            return json({ data: { ...shareLink, share_url: shareUrl } }, 201);
        }

        // GET /api-shares - List share links (by asset_id or project_id)
        if (req.method === "GET") {
            const assetId = url.searchParams.get("asset_id");
            const projectId = url.searchParams.get("project_id");

            if (projectId) {
                // Verify project belongs to org
                const { data: projData } = await admin.from("projects").select("id").eq("id", projectId).in("workspace_id", apiKey.workspace_ids).single();
                if (!projData) return notfound();

                const assetIds = await listProjectAssetIds(projectId);
                if (!assetIds.length) return json({ data: [] });

                const { data: links, error: listErr } = await admin
                    .from("share_links")
                    .select("*, assets!share_links_asset_id_fkey!inner(project_id)")
                    .in("asset_id", assetIds)
                    .order("created_at", { ascending: false });

                if (listErr) return bad("Error listing share links", 500);
                return json({ data: links });
            }

            if (!assetId) return bad("Missing asset_id or project_id parameter");

            // Verify asset access
            const { data: asset } = await admin.from("assets").select("id, workspace_id").eq("id", assetId).single();
            if (!asset || !apiKey.workspace_ids.includes(asset.workspace_id)) {
                return notfound();
            }

            const { data: links, error: listErr } = await admin
                .from("share_links")
                .select("*")
                .eq("asset_id", assetId)
                .order("created_at", { ascending: false });

            if (listErr) return bad("Error listing share links", 500);
            return json({ data: links });
        }

        // DELETE /api-shares/:id - Revoke share link
        if (routeParts.length === 1 && req.method === "DELETE") {
            const shareLinkId = routeParts[0];

            // Verify access to the share link's asset
            const { data: share, error: fetchErr } = await admin
                .from("share_links")
                .select("id, asset_id, assets!share_links_asset_id_fkey(workspace_id)")
                .eq("id", shareLinkId)
                .single();
            
            if (fetchErr || !share) return notfound();
            const workspaceId = (share.assets as any)?.workspace_id;
            if (!workspaceId || !apiKey.workspace_ids.includes(workspaceId)) {
                return unauth("Unauthorized access to this share link");
            }

            const { error: revErr } = await admin
                .from("share_links")
                .update({ revoked_at: new Date().toISOString() })
                .eq("id", shareLinkId);
            
            if (revErr) return bad("Failed to revoke share link", 500);
            return json({ success: true });
        }

        return notfound();
    } catch (e: any) {
        console.error("api-shares error:", e);
        return bad(e.message || "Server error", 500);
    }
});

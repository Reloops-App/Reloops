// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth, notfound } from "../../shared/apiAuth.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const apiKey = await verifyApiKey(req);
        if (!apiKey) return unauth();

        const url = new URL(req.url);
        const assetId = url.searchParams.get("asset_id");
        if (!assetId) return bad("Missing asset_id parameter");

        // Validate asset scoping
        const { data: assetData } = await admin
            .from("assets")
            .select("id, workspace_id")
            .eq("id", assetId)
            .single();
        if (!assetData || !apiKey.workspace_ids.includes(assetData.workspace_id)) {
            return notfound(); 
        }

        if (req.method === "GET") {
            const { data: comments, error: commErr } = await admin
                .from("asset_comments")
                .select("*")
                .eq("asset_id", assetId)
                .neq("status", "deleted")
                .order("created_at", { ascending: true });
            
            if (commErr) return bad("Error fetching comments", 500);
            return json({ data: comments });
        }

        if (req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const {
                body: commentBody,
                ms_offset,
                drawing_json,
                parent_id,
                media_ms_start,
                media_ms_end,
            } = body;

            if (!commentBody || !String(commentBody).trim()) {
                return bad("Missing 'body' text for comment");
            }

            const bodyOnlyComment =
                ms_offset === undefined &&
                drawing_json === undefined &&
                parent_id === undefined &&
                media_ms_start === undefined &&
                media_ms_end === undefined;

            const defaultMsOffset =
                bodyOnlyComment ? 0 : null;

            const normalizedMsOffset =
                Number.isFinite(ms_offset) ? Number(ms_offset) : defaultMsOffset;

            const normalizedMediaStart =
                Number.isFinite(media_ms_start) ? Number(media_ms_start) : null;

            const normalizedMediaEnd =
                Number.isFinite(media_ms_end) ? Number(media_ms_end) : null;

            const newComment = {
                asset_id: assetId,
                body: String(commentBody).trim(),
                author_user_id: apiKey.created_by, // attribute to key creator
                author_api_key_id: apiKey.id,
                ms_offset: normalizedMsOffset,
                drawing_json: drawing_json ?? (bodyOnlyComment ? [] : null),
                parent_id: parent_id ?? null,
                media_ms_start: normalizedMediaStart,
                media_ms_end: normalizedMediaEnd,
            };

            const { data: inserted, error: insErr } = await admin
                .from("asset_comments")
                .insert(newComment)
                .select()
                .single();
            
            if (insErr) {
                console.error("Comment Insert Error:", insErr);
                return bad("Failed to create comment", 500);
            }
            return json({ data: inserted }, 201);
        }

        return bad("Method not allowed", 405);
    } catch (e: any) {
        console.error("api-comments error:", e);
        return bad(e.message || "Server error", 500);
    }
});

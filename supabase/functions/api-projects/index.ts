// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth, notfound } from "../../shared/apiAuth.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const apiKey = await verifyApiKey(req);
        if (!apiKey) return unauth();

        if (req.method === "GET") {
            const { data: projects, error: projErr } = await admin
                .from("projects")
                .select("*")
                .in("workspace_id", apiKey.workspace_ids)
                .neq("status", "deleted")
                .order("created_at", { ascending: true });
            
            if (projErr) return bad("Error fetching projects", 500);
            return json({ data: projects });
        }

        if (req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const { name, workspace_id } = body;
            if (!name || typeof name !== "string") return bad("Missing 'name'");
            if (!workspace_id || typeof workspace_id !== "string") return bad("Missing 'workspace_id'");
            const trimmedName = name.trim();
            if (!trimmedName) return bad("Missing 'name'");
            if (!apiKey.workspace_ids.includes(workspace_id)) return notfound();

            const { data: workspace } = await admin
                .from("workspaces")
                .select("id, status")
                .eq("id", workspace_id)
                .maybeSingle();

            if (!workspace || workspace.status === "deleted") return notfound();

            const { data: project, error: projErr } = await admin
                .from("projects")
                .insert({
                    name: trimmedName,
                    workspace_id,
                    created_by: apiKey.created_by,
                    created_by_api_key_id: apiKey.id,
                    status: "active",
                })
                .select("*")
                .single();

            if (projErr) return bad("Error creating project", 500);
            return json({ data: project }, 201);
        }

        return bad("Method not allowed", 405);
    } catch (e: any) {
        console.error("api-projects error:", e);
        return bad(e.message || "Server error", 500);
    }
});

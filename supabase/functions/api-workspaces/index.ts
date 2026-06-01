// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { verifyApiKey, corsHeaders, json, bad, unauth } from "../../shared/apiAuth.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const apiKey = await verifyApiKey(req);
        if (!apiKey) return unauth();

        if (req.method === "GET") {
            const { data: workspaces, error: wsErr } = await admin
                .from("workspaces")
                .select("id, organization_id, name, status, logo_url, created_by, created_by_api_key_id, created_at, updated_at, updated_by, updated_by_api_key_id")
                .eq("organization_id", apiKey.organization_id)
                .neq("status", "deleted")
                .order("created_at", { ascending: true });

            if (wsErr) return bad("Error fetching workspaces", 500);
            return json({ data: workspaces });
        }

        if (req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { return bad("Invalid JSON body"); }

            const { name, logo_url } = body;
            if (!name || typeof name !== "string") return bad("Missing 'name'");
            const trimmedName = name.trim();
            if (!trimmedName) return bad("Missing 'name'");

            const { data: workspace, error: wsErr } = await admin
                .from("workspaces")
                .insert({
                    organization_id: apiKey.organization_id,
                    name: trimmedName,
                    logo_url: typeof logo_url === "string" ? logo_url : null,
                    created_by: apiKey.created_by,
                    created_by_api_key_id: apiKey.id,
                    status: "active",
                })
                .select("id, organization_id, name, status, logo_url, created_by, created_by_api_key_id, created_at, updated_at, updated_by, updated_by_api_key_id")
                .single();

            if (wsErr) return bad("Error creating workspace", 500);
            return json({ data: workspace }, 201);
        }

        return bad("Method not allowed", 405);
    } catch (e: any) {
        console.error("api-workspaces error:", e);
        return bad(e.message || "Server error", 500);
    }
});

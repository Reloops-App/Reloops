// deno run --allow-env --allow-net
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const bad = (msg: string, code = 400) => json({ error: msg }, code);
const unauth = (msg = "Unauthorized") => json({ error: msg }, 401);
const forbid = (msg = "Forbidden") => json({ error: msg }, 403);

async function getUser(req: Request) {
    const h = req.headers.get("authorization");
    if (!h) return null;
    const token = h.replace(/^Bearer\s+/i, "");
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const user = await getUser(req);
        if (!user) return unauth();

        if (req.method === "POST") {
            let body: any = {};
            try { body = await req.json(); } catch { /* ignore */ }

            const { action, organization_id, name, id } = body;

            if (action === "list") {
                if (!organization_id) return bad("organization_id required");

                const { data: membership } = await admin
                    .from("organization_members")
                    .select("role")
                    .eq("organization_id", organization_id)
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
                    return forbid("Only organization owners and admins can view API keys");
                }

                const { data: keys, error } = await admin
                    .from("api_keys")
                    .select("id, name, provider, icon_url, prefix, created_at, last_used_at")
                    .eq("organization_id", organization_id)
                    .order("created_at", { ascending: false });

                if (error) {
                    console.error("API key list error:", error);
                    return bad("Failed to list API keys", 500);
                }

                return json({ data: keys ?? [] });
            }

            if (action === "delete") {
                const apiKeyId = id || body.api_key_id;
                if (!apiKeyId) return bad("id required");

                const { data: keyRow, error: keyErr } = await admin
                    .from("api_keys")
                    .select("id, organization_id")
                    .eq("id", apiKeyId)
                    .maybeSingle();

                if (keyErr) {
                    console.error("API key lookup error:", keyErr);
                    return bad("Failed to delete API key", 500);
                }
                if (!keyRow) return bad("API key not found", 404);

                const { data: membership } = await admin
                    .from("organization_members")
                    .select("role")
                    .eq("organization_id", (keyRow as any).organization_id)
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
                    return forbid("Only organization owners and admins can delete API keys");
                }

                const { error: delErr } = await admin.from("api_keys").delete().eq("id", apiKeyId);
                if (delErr) {
                    console.error("API key delete error:", delErr);
                    return bad("Failed to delete API key", 500);
                }

                return json({ success: true });
            }

            if (action === "create") {
                if (!organization_id || !name) return bad("organization_id and name required");

                const trimmedName = String(name).trim();
                const provider = typeof body.provider === "string" ? body.provider.trim() : null;
                const iconUrl = typeof body.icon_url === "string" ? body.icon_url.trim() : null;

                if (!trimmedName) return bad("name required");
                if (trimmedName.length > 120) return bad("name too long");
                if (provider && provider.length > 64) return bad("provider too long");
                if (iconUrl && iconUrl.length > 2048) return bad("icon_url too long");

                // Check permissions (must be org admin or owner)
                // We'll query organization_members using admin client for the user
                const { data: membership } = await admin
                    .from("organization_members")
                    .select("role")
                    .eq("organization_id", organization_id)
                    .eq("user_id", user.id)
                    .single();

                if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
                    return forbid("Only organization owners and admins can create API keys");
                }

                // Generate secure key
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                const randomHex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
                const rawKey = `reloops_live_${randomHex}`;
                const prefix = `reloops_live_${randomHex.substring(0, 8)}...`;

                // Hash the key using SHA-256
                const encoder = new TextEncoder();
                const dataToHash = encoder.encode(rawKey);
                const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                // Insert into db using admin (to bypass RLS if needed, though RLS allows it now)
                const { data: newKey, error: insertErr } = await admin
                    .from("api_keys")
                    .insert({
                        organization_id,
                        name: trimmedName,
                        provider: provider || null,
                        icon_url: iconUrl || null,
                        key_hash: keyHash,
                        prefix,
                        created_by: user.id
                    })
                    .select()
                    .single();

                if (insertErr) {
                    console.error("API key insert error:", insertErr);
                    return bad("Failed to create API key", 500);
                }

                // Return the rawKey strictly parsing ONCE
                return json({ data: { ...newKey, raw_key: rawKey } });
            }

            return bad("Unknown action");
        }

        return bad("Method not allowed", 405);
    } catch (e: any) {
        console.error("API Keys function error:", e);
        return bad(e.message || "Server error", 500);
    }
});

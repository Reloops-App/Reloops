import { admin } from "./supabaseAdmin.ts";

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

export const bad = (msg: string, code = 400) => json({ error: msg }, code);
export const unauth = (msg = "Invalid API Key") => json({ error: msg }, 401);
export const notfound = () => json({ error: "Not found" }, 404);

export type ApiKeyContext = {
    id: string;
    organization_id: string;
    created_by: string;
    name: string | null;
    provider: string | null;
    icon_url: string | null;
    workspace_ids: string[];
};

export async function verifyApiKey(req: Request): Promise<ApiKeyContext | null> {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;

    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token.startsWith("reloops_live_")) return null;

    // Hash token
    const encoder = new TextEncoder();
    const dataToHash = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Find API Key in DB
    const { data: apiKey, error: dbErr } = await admin
        .from("api_keys")
        .select("id, organization_id, created_by, name, provider, icon_url")
        .eq("key_hash", keyHash)
        .single();

    if (dbErr || !apiKey) return null;

    // Background update for last_used_at
    admin.from("api_keys").update({ last_used_at: new Date() }).eq("id", apiKey.id).then();

    const { data: workspaces } = await admin
        .from("workspaces")
        .select("id")
        .eq("organization_id", apiKey.organization_id);

    return {
        ...apiKey,
        workspace_ids: workspaces?.map((w: any) => w.id) || []
    };
}

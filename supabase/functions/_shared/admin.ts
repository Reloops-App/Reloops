import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("URL_SUPABASE") ?? "";
export const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
export const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export async function getUser(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}

export async function requireUser(req: Request) {
  const user = await getUser(req);
  if (!user) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  return user;
}

export async function isWorkspaceMember(workspaceId: string, userId: string) {
  const { data: workspaceMember } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMember) return workspaceMember;

  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace?.organization_id) return null;

  const { data: organizationMember } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  return organizationMember;
}

export async function getWorkspaceByOrganization(organizationId: string) {
  const { data } = await admin
    .from("workspaces")
    .select("*")
    .eq("organization_id", organizationId)
    .neq("status", "deleted")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function ensureWorkspaceMembership(workspaceId: string, userId: string, role = "owner") {
  await admin.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: userId, role });
}

export async function readBody(req: Request) {
  return await req.json().catch(() => ({}));
}

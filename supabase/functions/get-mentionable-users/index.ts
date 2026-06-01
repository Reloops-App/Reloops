import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireUser(req);
    const body = await readBody(req);
    const organizationId = body.organizationId ?? body.organization_id;
    if (!organizationId) return json({ data: [] });

    const { data: members, error } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId);
    if (error) throw error;

    const userIds = (members ?? []).map((row: any) => row.user_id);
    const { data: profiles } = userIds.length
      ? await admin.from("profiles").select("id,email,display_name,avatar_url").in("id", userIds)
      : { data: [] as any[] };
    const profileById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));

    return json({
      data: (members ?? []).map((row: any) => ({
        id: row.user_id,
        user_id: row.user_id,
        role: row.role,
        profile: profileById.get(row.user_id) ?? null,
        profiles: profileById.get(row.user_id) ?? null,
        kind: "user",
      })),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Mentionable users failed" }, { status: 500 });
  }
});

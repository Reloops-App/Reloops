import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

async function listProjectReviewers(projectId: string, userId: string) {
  if (!projectId) return json({ error: "Missing projectId" }, { status: 400 });

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project?.workspace_id) return json({ error: "Invalid projectId" }, { status: 400 });

  if (!await isWorkspaceMember(project.workspace_id, userId)) return json({ error: "Forbidden" }, { status: 403 });

  const { data: memberships, error: membershipError } = await admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", project.workspace_id)
    .eq("role", "reviewer");
  if (membershipError) throw membershipError;

  const profileIds = (memberships ?? []).map((row: any) => row.user_id).filter(Boolean);
  let profilesData: any[] = [];
  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .in("id", profileIds);
    if (profilesError) console.warn("review function: failed to load profiles", profilesError);
    profilesData = profiles ?? [];
  }

  const profileById = new Map(profilesData.map((profile: any) => [profile.id, profile]));
  const memberReviewers = (memberships ?? []).map((row: any) => {
    const profile = profileById.get(row.user_id) ?? null;
    return {
      type: "member",
      user_id: row.user_id,
      role: row.role,
      email: profile?.email ?? null,
      profile,
    };
  });

  let guestReviewers: any[] = [];
  const { data: projectAssets, error: assetsError } = await admin
    .from("assets")
    .select("id")
    .eq("project_id", projectId);
  if (assetsError) {
    console.warn("review function: failed to load project assets", assetsError);
  } else {
    const assetIds = (projectAssets ?? []).map((asset: any) => asset.id).filter(Boolean);
    if (assetIds.length > 0) {
      const { data: guestComments, error: guestError } = await admin
        .from("asset_comments")
        .select("asset_id, guest_name, guest_email, created_at")
        .in("asset_id", assetIds)
        .not("guest_email", "is", null)
        .neq("status", "deleted")
        .order("created_at", { ascending: false });

      if (guestError) {
        console.warn("review function: failed to load guest reviewers", guestError);
      } else {
        const guestsByEmail = new Map<string, any>();
        for (const comment of guestComments ?? []) {
          const email = String((comment as any).guest_email ?? "").trim();
          if (!email) continue;
          const key = email.toLowerCase();
          const name = String((comment as any).guest_name ?? "").trim();
          const assetId = (comment as any).asset_id;
          const existing = guestsByEmail.get(key);
          if (existing) {
            existing.comment_count += 1;
            if (assetId && !existing.asset_ids.includes(assetId)) existing.asset_ids.push(assetId);
            continue;
          }
          guestsByEmail.set(key, {
            type: "guest",
            role: "guest reviewer",
            email,
            user_id: null,
            comment_count: 1,
            asset_ids: assetId ? [assetId] : [],
            last_seen_at: (comment as any).created_at ?? null,
            profile: {
              id: `guest:${key}`,
              display_name: name || "Guest reviewer",
              avatar_url: null,
            },
          });
        }
        guestReviewers = Array.from(guestsByEmail.values());
      }
    }
  }

  return json([...memberReviewers, ...guestReviewers]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const action = body.action ?? "list-project-reviewers";
    if (action === "list") {
      return await listProjectReviewers(String(body.projectId ?? body.project_id ?? ""), user.id);
    }
    if (action === "list-project-reviewers") {
      const workspaceId = String(body.workspace_id ?? body.workspaceId ?? "");
      if (workspaceId && !await isWorkspaceMember(workspaceId, user.id)) return json({ error: "Forbidden" }, { status: 403 });
      const { data, error } = await admin
        .from("workspace_members")
        .select("user_id,role")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      const profiles = await admin
        .from("profiles")
        .select("id,email,display_name,avatar_url")
        .in("id", (data ?? []).map((row: any) => row.user_id));
      const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
      return json({ data: (data ?? []).map((row: any) => ({ ...row, profile: profileById.get(row.user_id) ?? null, profiles: profileById.get(row.user_id) ?? null })) });
    }
    return json({ data: [] });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Review failed" }, { status: 500 });
  }
});

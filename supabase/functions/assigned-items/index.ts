import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";
import { verifyApiKey, corsHeaders, json, unauth } from "../../shared/apiAuth.ts";

type ActorContext =
  | {
      kind: "user";
      userId: string;
      organizationIds: string[];
    }
  | {
      kind: "api_key";
      userId: string;
      apiKeyId: string;
      workspaceIds: string[];
    };

function bad(msg: string, code = 400) {
  return json({ error: msg }, code);
}

async function getActor(req: Request): Promise<ActorContext | null> {
  const apiKey = await verifyApiKey(req);
  if (apiKey) {
    return {
      kind: "api_key",
      userId: apiKey.created_by,
      apiKeyId: apiKey.id,
      workspaceIds: apiKey.workspace_ids,
    };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;

  const accessToken = authHeader.split(" ")[1];
  const { data: authData, error: authErr } = await supabaseClient.auth.getUser(accessToken);
  if (authErr || !authData?.user) return null;

  const { data: memberships, error: membershipErr } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .in("role", ["owner", "admin", "member", "billing"]);

  if (membershipErr) {
    console.error("assigned-items membership lookup error:", membershipErr);
    return null;
  }

  return {
    kind: "user",
    userId: authData.user.id,
    organizationIds: (memberships ?? []).map((row: { organization_id: string }) => row.organization_id),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "GET") return bad("Method not allowed", 405);

    const actor = await getActor(req);
    if (!actor) return unauth("Unauthorized");

    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const funcIdx = pathSegments.indexOf("assigned-items");
    const routeParts = funcIdx !== -1 ? pathSegments.slice(funcIdx + 1) : pathSegments;

    const onlyRequestedReview =
      routeParts.length === 1 && routeParts[0] === "requested-review";
    if (routeParts.length > 1 || (routeParts.length === 1 && !onlyRequestedReview)) {
      return bad("Not found", 404);
    }

    const limitRaw = url.searchParams.get("limit");
    const limit = Math.max(1, Math.min(500, Number(limitRaw ?? 100) || 100));

    let workspaceIds: string[] = [];
    if (actor.kind === "api_key") {
      workspaceIds = actor.workspaceIds;
    } else if (actor.organizationIds.length > 0) {
      const { data: workspaces, error: workspaceErr } = await admin
        .from("workspaces")
        .select("id")
        .in("organization_id", actor.organizationIds);

      if (workspaceErr) {
        console.error("assigned-items workspace lookup error:", workspaceErr);
        return bad("Failed to load workspaces", 500);
      }

      workspaceIds = (workspaces ?? []).map((row: { id: string }) => row.id);
    }

    if (workspaceIds.length === 0) return json({ data: [] });

    const assetQuery = admin
      .from("assets")
      .select(`
        id,
        workspace_id,
        project_id,
        parent_asset_id,
        version_no,
        title,
        cover_image_url,
        storage_path,
        mime_type,
        size_bytes,
        status,
        created_at,
        updated_at,
        uploaded_at,
        assigned_to,
        assigned_to_api_key_id,
        workspaces:workspaces!assets_workspace_id_fkey(name),
        projects:projects!assets_project_id_fkey(name)
      `)
      .in("workspace_id", workspaceIds)
      .neq("status", "deleted");

    if (actor.kind === "api_key") {
      assetQuery.eq("assigned_to_api_key_id", actor.apiKeyId);
    } else {
      assetQuery.eq("assigned_to", actor.userId);
    }

    if (onlyRequestedReview) {
      assetQuery.eq("status", "needs_review");
    }

    const { data: assets, error: assetErr } = await assetQuery
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (assetErr) {
      console.error("assigned-items fetch error:", assetErr);
      return bad("Failed to load assigned items", 500);
    }

    const mapped = (assets ?? []).map((asset: any) => ({
      ...asset,
      workspace_name:
        asset?.workspaces?.name ??
        asset?.workspaces?.[0]?.name ??
        null,
      project_name:
        asset?.projects?.name ??
        asset?.projects?.[0]?.name ??
        null,
    }));

    return json({
      data: mapped,
      scope: {
        actor: actor.kind,
        requested_review_only: onlyRequestedReview,
      },
    });
  } catch (e: any) {
    console.error("assigned-items error:", e);
    return bad(e.message || "Server error", 500);
  }
});

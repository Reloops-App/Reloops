import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { admin } from "../../shared/supabaseAdmin.ts";
import { supabaseClient } from "../../shared/supabaseClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

const bad = (msg: string, code = 400) => json({ error: msg }, code);
const unauth = () => json({ error: "Unauthorized" }, 401);
const forbid = () => json({ error: "Forbidden" }, 403);

const NOTIFICATION_TYPES = [
  "workspace.added",
  "project.added",
  "file.uploaded",
  "file.version_uploaded",
  "review.requested",
  "review.approved",
  "review.changes_requested",
  "review.overdue",
  "comment.mention",
  "comment.reply",
  "guest.feedback",
  "asset.intelligence_ready",
  "asset.intelligence_completed",
  "asset.intelligence_failed",
  "search.index_failed",
] as const;

type NotificationType = typeof NOTIFICATION_TYPES[number];

const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationType, { email_enabled: boolean; in_app_enabled: boolean }> = {
  "workspace.added": { email_enabled: true, in_app_enabled: true },
  "project.added": { email_enabled: true, in_app_enabled: true },
  "file.uploaded": { email_enabled: false, in_app_enabled: true },
  "file.version_uploaded": { email_enabled: false, in_app_enabled: true },
  "review.requested": { email_enabled: true, in_app_enabled: true },
  "review.approved": { email_enabled: true, in_app_enabled: true },
  "review.changes_requested": { email_enabled: true, in_app_enabled: true },
  "review.overdue": { email_enabled: true, in_app_enabled: true },
  "comment.mention": { email_enabled: true, in_app_enabled: true },
  "comment.reply": { email_enabled: true, in_app_enabled: true },
  "guest.feedback": { email_enabled: true, in_app_enabled: true },
  "asset.intelligence_ready": { email_enabled: false, in_app_enabled: true },
  "asset.intelligence_completed": { email_enabled: false, in_app_enabled: true },
  "asset.intelligence_failed": { email_enabled: false, in_app_enabled: true },
  "search.index_failed": { email_enabled: false, in_app_enabled: true },
};

async function getUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function numberParam(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function requireWorkspaceAccess(workspaceId: string, userId: string) {
  const { data: workspaceMember } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMember) return true;

  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace?.organization_id) return false;

  const { data: organizationMember } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .in("role", ["owner", "admin", "member", "billing"])
    .maybeSingle();
  return Boolean(organizationMember);
}

function defaultPreferences() {
  return NOTIFICATION_TYPES.map((notification_type) => ({
    notification_type,
    email_enabled: DEFAULT_NOTIFICATION_PREFERENCES[notification_type].email_enabled,
    in_app_enabled: DEFAULT_NOTIFICATION_PREFERENCES[notification_type].in_app_enabled,
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  try {
    const user = await getUser(req);
    if (!user) return unauth();

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
    if (!workspaceId) return bad("workspace_id required");
    if (!(await requireWorkspaceAccess(workspaceId, user.id))) return forbid();

    if (action === "list") {
      const limit = numberParam(body.limit, 80, 1, 200);
      const status = typeof body.status === "string" ? body.status : "all";
      const type = typeof body.type === "string" ? body.type : null;

      const query = admin
        .from("notifications")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("recipient_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status === "unread") query.is("read_at", null);
      if (status === "read") query.not("read_at", "is", null);
      if (type) query.eq("notification_type", type);

      const { data, error } = await query;
      if (error) {
        console.error("notifications list error:", error);
        return bad("Failed to list notifications", 500);
      }
      return json({ data: data ?? [] });
    }

    if (action === "unread-count") {
      const { count, error } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("recipient_user_id", user.id)
        .is("read_at", null);
      if (error) {
        console.error("notifications count error:", error);
        return bad("Failed to count notifications", 500);
      }
      return json({ data: { count: count ?? 0 } });
    }

    if (action === "mark-read" || action === "mark-unread") {
      const notificationId = typeof body.notification_id === "string" ? body.notification_id : "";
      if (!notificationId) return bad("notification_id required");

      const { data, error } = await admin
        .from("notifications")
        .update({ read_at: action === "mark-read" ? new Date().toISOString() : null })
        .eq("id", notificationId)
        .eq("workspace_id", workspaceId)
        .eq("recipient_user_id", user.id)
        .select("*")
        .maybeSingle();
      if (error) {
        console.error("notifications mark error:", error);
        return bad("Failed to update notification", 500);
      }
      if (!data) return bad("Notification not found", 404);
      return json({ data });
    }

    if (action === "mark-all-read") {
      const { error } = await admin
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("recipient_user_id", user.id)
        .is("read_at", null);
      if (error) {
        console.error("notifications mark all error:", error);
        return bad("Failed to mark notifications read", 500);
      }
      return json({ data: { ok: true } });
    }

    if (action === "get-preferences") {
      const { data: saved, error } = await admin
        .from("notification_preferences")
        .select("notification_type,email_enabled,in_app_enabled")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id);
      if (error) {
        console.error("notification preferences list error:", error);
        return bad("Failed to load preferences", 500);
      }

      const byType = new Map((saved ?? []).map((row: any) => [row.notification_type, row]));
      const preferences = defaultPreferences().map((item) => byType.get(item.notification_type) ?? item);

      const { data: digest, error: digestError } = await admin
        .from("notification_digest_preferences")
        .select("digest_enabled,digest_frequency")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (digestError) {
        console.error("notification digest preference error:", digestError);
        return bad("Failed to load digest preference", 500);
      }

      return json({
        data: {
          preferences,
          digest_enabled: digest?.digest_enabled ?? true,
          digest_frequency: digest?.digest_frequency ?? "daily",
        },
      });
    }

    if (action === "update-preference") {
      const notificationType = typeof body.notification_type === "string" ? body.notification_type : "";
      if (!NOTIFICATION_TYPES.includes(notificationType as NotificationType)) return bad("Invalid notification_type");

      const emailEnabled = typeof body.email_enabled === "boolean"
        ? body.email_enabled
        : DEFAULT_NOTIFICATION_PREFERENCES[notificationType as NotificationType].email_enabled;
      const inAppEnabled = typeof body.in_app_enabled === "boolean"
        ? body.in_app_enabled
        : DEFAULT_NOTIFICATION_PREFERENCES[notificationType as NotificationType].in_app_enabled;

      const { data, error } = await admin
        .from("notification_preferences")
        .upsert({
          workspace_id: workspaceId,
          user_id: user.id,
          notification_type: notificationType,
          email_enabled: emailEnabled,
          in_app_enabled: inAppEnabled,
        })
        .select("notification_type,email_enabled,in_app_enabled")
        .single();
      if (error) {
        console.error("notification preference update error:", error);
        return bad("Failed to update preference", 500);
      }
      return json({ data });
    }

    if (action === "update-digest") {
      const digestEnabled = typeof body.digest_enabled === "boolean" ? body.digest_enabled : true;
      const digestFrequency = typeof body.digest_frequency === "string" ? body.digest_frequency : "daily";
      if (!["hourly", "daily", "weekly"].includes(digestFrequency)) return bad("Invalid digest_frequency");

      const { data, error } = await admin
        .from("notification_digest_preferences")
        .upsert({
          workspace_id: workspaceId,
          user_id: user.id,
          digest_enabled: digestEnabled,
          digest_frequency: digestFrequency,
        })
        .select("digest_enabled,digest_frequency")
        .single();
      if (error) {
        console.error("notification digest update error:", error);
        return bad("Failed to update digest preference", 500);
      }
      return json({ data });
    }

    return bad("Unsupported notification action");
  } catch (error) {
    console.error("notifications function error:", error);
    return bad("Internal error", 500);
  }
});

import { admin } from "./supabaseAdmin.ts";
import { canAccessProject, isMemberOfWorkspace } from "./utils.ts";

export const NOTIFICATION_TYPES = [
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

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationType, { email_enabled: boolean; in_app_enabled: boolean }> = {
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

export type NotificationInput = {
  workspace_id: string;
  project_id?: string | null;
  asset_id?: string | null;
  collection_id?: string | null;
  recipient_user_id: string;
  actor_user_id?: string | null;
  actor_guest_name?: string | null;
  actor_guest_email?: string | null;
  notification_type: NotificationType;
  title: string;
  message?: string | null;
  target_url?: string | null;
  metadata?: Record<string, unknown>;
};

export function mentionUserIds(text: string) {
  const ids = new Set<string>();
  const mentionRegex = /@\[([^:\]]+):([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return ids;
}

export async function activeWorkspaceUserIds(workspaceId: string) {
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceError || !workspace?.organization_id) return [];

  const { data, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", workspace.organization_id)
    .in("role", ["owner", "admin", "member", "billing"]);

  if (error) {
    console.warn("notifications: failed to load workspace users", error);
    return [];
  }

  return Array.from(new Set((data ?? []).map((row: any) => String(row.user_id)).filter(Boolean)));
}

export async function projectMemberUserIds(projectId: string) {
  const { data, error } = await admin
    .from("project_memberships")
    .select("user_id")
    .eq("project_id", projectId);

  if (error) {
    console.warn("notifications: failed to load project memberships", error);
    return [];
  }

  return Array.from(new Set((data ?? []).map((row: any) => String(row.user_id)).filter(Boolean)));
}

export async function commentParticipantUserIds(assetId: string) {
  const { data, error } = await admin
    .from("asset_comments")
    .select("author_user_id")
    .eq("asset_id", assetId)
    .neq("status", "deleted");

  if (error) {
    console.warn("notifications: failed to load comment participants", error);
    return [];
  }

  return Array.from(new Set((data ?? []).map((row: any) => row.author_user_id ? String(row.author_user_id) : null).filter(Boolean)));
}

async function hasNotificationAccess(input: NotificationInput) {
  if (!(await isMemberOfWorkspace(input.workspace_id, input.recipient_user_id))) return false;
  if (input.project_id && !(await canAccessProject(input.project_id, input.recipient_user_id))) return false;
  return true;
}

async function preferenceAllows(input: NotificationInput) {
  const fallback = DEFAULT_NOTIFICATION_PREFERENCES[input.notification_type] ?? { in_app_enabled: true };
  const { data, error } = await admin
    .from("notification_preferences")
    .select("in_app_enabled")
    .eq("workspace_id", input.workspace_id)
    .eq("user_id", input.recipient_user_id)
    .eq("notification_type", input.notification_type)
    .maybeSingle();

  if (error) {
    console.warn("notifications: failed to load preference", error);
    return fallback.in_app_enabled;
  }

  return data?.in_app_enabled ?? fallback.in_app_enabled;
}

export async function createNotification(input: NotificationInput) {
  if (!input.recipient_user_id) return null;
  if (input.actor_user_id && input.actor_user_id === input.recipient_user_id) return null;
  if (!(await hasNotificationAccess(input))) return null;
  if (!(await preferenceAllows(input))) return null;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const dedupeQuery = admin
    .from("notifications")
    .select("id")
    .eq("workspace_id", input.workspace_id)
    .eq("recipient_user_id", input.recipient_user_id)
    .eq("notification_type", input.notification_type)
    .is("read_at", null)
    .gte("created_at", since)
    .limit(1);

  if (input.asset_id) dedupeQuery.eq("asset_id", input.asset_id);
  else dedupeQuery.is("asset_id", null);

  if (input.project_id) dedupeQuery.eq("project_id", input.project_id);
  else dedupeQuery.is("project_id", null);

  if (input.actor_user_id) dedupeQuery.eq("actor_user_id", input.actor_user_id);
  else dedupeQuery.is("actor_user_id", null);

  const { data: existing, error: existingError } = await dedupeQuery.maybeSingle();
  if (existingError) console.warn("notifications: dedupe lookup failed", existingError);
  if (existing?.id) return existing;

  const { data, error } = await admin
    .from("notifications")
    .insert({
      workspace_id: input.workspace_id,
      project_id: input.project_id ?? null,
      asset_id: input.asset_id ?? null,
      collection_id: input.collection_id ?? null,
      recipient_user_id: input.recipient_user_id,
      actor_user_id: input.actor_user_id ?? null,
      actor_guest_name: input.actor_guest_name ?? null,
      actor_guest_email: input.actor_guest_email ?? null,
      notification_type: input.notification_type,
      title: input.title,
      message: input.message ?? null,
      target_url: input.target_url ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.warn("notifications: insert failed", error);
    return null;
  }

  return data;
}

export async function createNotifications(inputs: NotificationInput[]) {
  const results = await Promise.allSettled(inputs.map((input) => createNotification(input)));
  return results.filter((result) => result.status === "fulfilled" && result.value).length;
}

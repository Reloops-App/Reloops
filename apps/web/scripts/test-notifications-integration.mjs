import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:56321";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const password = "Password123!";
const createdUsers = [];
const checks = [];

let orgId;
let workspaceId;
let projectId;

function assertCheck(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function createTestUser(label) {
  const email = `notif-${label}-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Notif ${label}` },
  });

  if (error) throw new Error(`createUser ${label}: ${error.message}`);

  createdUsers.push(data.user.id);

  const { data: sessionData, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);

  return { id: data.user.id, token: sessionData.session.access_token };
}

async function invokeNotifications(token, body) {
  const response = await fetch(`${supabaseUrl}/functions/v1/notifications`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { status: response.status, payload, text };
}

async function cleanup() {
  if (workspaceId) await admin.from("notification_digest_preferences").delete().eq("workspace_id", workspaceId);
  if (workspaceId) await admin.from("notification_preferences").delete().eq("workspace_id", workspaceId);
  if (workspaceId) await admin.from("notifications").delete().eq("workspace_id", workspaceId);
  if (projectId) await admin.from("project_memberships").delete().eq("project_id", projectId);
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (orgId) await admin.from("organization_members").delete().eq("organization_id", orgId);
  if (orgId) await admin.from("organizations").delete().eq("id", orgId);

  for (const userId of createdUsers.reverse()) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

async function run() {
  const owner = await createTestUser("owner");
  const recipient = await createTestUser("recipient");
  const outsider = await createTestUser("outsider");

  let result = await admin
    .from("organizations")
    .insert({ name: `Notif Test Org ${stamp}`, type: "team", created_by: owner.id })
    .select("id")
    .single();
  if (result.error) throw result.error;
  orgId = result.data.id;

  result = await admin
    .from("workspaces")
    .insert({ name: `Notif Test Workspace ${stamp}`, organization_id: orgId, created_by: owner.id })
    .select("id")
    .single();
  if (result.error) throw result.error;
  workspaceId = result.data.id;

  result = await admin
    .from("projects")
    .insert({ name: `Notif Test Project ${stamp}`, workspace_id: workspaceId, created_by: owner.id })
    .select("id")
    .single();
  if (result.error) throw result.error;
  projectId = result.data.id;

  result = await admin.from("organization_members").insert([
    { organization_id: orgId, user_id: owner.id, role: "owner" },
    { organization_id: orgId, user_id: recipient.id, role: "member" },
  ]);
  if (result.error) throw result.error;

  result = await admin
    .from("notifications")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      recipient_user_id: recipient.id,
      actor_user_id: owner.id,
      notification_type: "comment.mention",
      title: "Integration mention",
      message: "Owner mentioned recipient in a test file",
      target_url: `/workspace/${workspaceId}/projects/${projectId}`,
      metadata: { project_name: "Integration Project" },
    })
    .select("id")
    .single();
  if (result.error) throw result.error;
  const notificationId = result.data.id;

  let response = await invokeNotifications(recipient.token, {
    action: "unread-count",
    workspace_id: workspaceId,
  });
  assertCheck("unread-count status", response.status === 200, response.text);
  assertCheck("unread-count value", response.payload?.data?.count === 1, JSON.stringify(response.payload));

  response = await invokeNotifications(recipient.token, {
    action: "list",
    workspace_id: workspaceId,
    status: "unread",
    type: "comment.mention",
  });
  assertCheck("list unread status", response.status === 200, response.text);
  assertCheck(
    "list unread contains seeded notification",
    response.payload?.data?.length === 1 && response.payload.data[0].id === notificationId,
    JSON.stringify(response.payload),
  );

  response = await invokeNotifications(recipient.token, {
    action: "mark-read",
    workspace_id: workspaceId,
    notification_id: notificationId,
  });
  assertCheck("mark-read status", response.status === 200, response.text);
  assertCheck("mark-read read_at set", Boolean(response.payload?.data?.read_at), JSON.stringify(response.payload));

  response = await invokeNotifications(recipient.token, {
    action: "unread-count",
    workspace_id: workspaceId,
  });
  assertCheck("unread-count after mark-read", response.payload?.data?.count === 0, JSON.stringify(response.payload));

  await admin.from("notifications").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    recipient_user_id: recipient.id,
    actor_user_id: owner.id,
    notification_type: "comment.reply",
    title: "Second notification",
  });

  response = await invokeNotifications(recipient.token, {
    action: "mark-all-read",
    workspace_id: workspaceId,
  });
  assertCheck("mark-all-read status", response.status === 200, response.text);

  response = await invokeNotifications(recipient.token, {
    action: "unread-count",
    workspace_id: workspaceId,
  });
  assertCheck("unread-count after mark-all-read", response.payload?.data?.count === 0, JSON.stringify(response.payload));

  response = await invokeNotifications(recipient.token, {
    action: "get-preferences",
    workspace_id: workspaceId,
  });
  assertCheck("get-preferences status", response.status === 200, response.text);
  assertCheck("get-preferences default types", response.payload?.data?.preferences?.length === 15, JSON.stringify(response.payload));
  assertCheck("get-preferences digest default", response.payload?.data?.digest_enabled === true, JSON.stringify(response.payload));

  response = await invokeNotifications(recipient.token, {
    action: "update-preference",
    workspace_id: workspaceId,
    notification_type: "file.uploaded",
    email_enabled: true,
    in_app_enabled: false,
  });
  assertCheck("update-preference status", response.status === 200, response.text);

  response = await invokeNotifications(recipient.token, {
    action: "get-preferences",
    workspace_id: workspaceId,
  });
  const fileUploadedPreference = response.payload?.data?.preferences?.find(
    (preference) => preference.notification_type === "file.uploaded",
  );
  assertCheck(
    "updated preference persisted",
    fileUploadedPreference?.email_enabled === true && fileUploadedPreference?.in_app_enabled === false,
    JSON.stringify(fileUploadedPreference),
  );

  response = await invokeNotifications(recipient.token, {
    action: "update-digest",
    workspace_id: workspaceId,
    digest_enabled: false,
  });
  assertCheck("update-digest status", response.status === 200, response.text);

  response = await invokeNotifications(recipient.token, {
    action: "get-preferences",
    workspace_id: workspaceId,
  });
  assertCheck("digest preference persisted", response.payload?.data?.digest_enabled === false, JSON.stringify(response.payload));

  response = await invokeNotifications(outsider.token, {
    action: "list",
    workspace_id: workspaceId,
  });
  assertCheck("outsider forbidden", response.status === 403, response.text);
}

try {
  await run();
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
  console.error("\nNotification integration test failed.");
  console.error("Make sure local Supabase is running and functions are served:");
  console.error("  npx supabase start");
  console.error("  npx supabase functions serve notifications --env-file ../../supabase/.env");
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}

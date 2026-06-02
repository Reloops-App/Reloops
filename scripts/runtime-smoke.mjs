import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv() {
  const env = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok ${message}`);
}

const env = readEnv();
const url = process.env.SUPABASE_URL || process.env.URL_SUPABASE || env.SUPABASE_URL || env.URL_SUPABASE;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || env.SUPABASE_ANON_KEY || env.ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;

assert(url && anonKey && serviceKey, "local Supabase env is present");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const email = `smoke-${Date.now()}@example.test`;
const password = "Smoke-test-password-1";

const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Smoke Tester" },
});
if (created.error) throw created.error;
assert(created.data.user?.id, "test user created");

const client = createClient(url, anonKey, { auth: { persistSession: false } });
const signedIn = await client.auth.signInWithPassword({ email, password });
if (signedIn.error) throw signedIn.error;
assert(signedIn.data.session?.access_token, "test user signed in");
const authHeaders = {
  "content-type": "application/json",
  apikey: anonKey,
  authorization: `Bearer ${signedIn.data.session.access_token}`,
};

async function assertBucketReady(id, expectedPublic) {
  const { data, error } = await admin.storage.getBucket(id);
  if (error) throw error;
  assert(data?.id === id, `${id} storage bucket exists`);
  if (typeof data?.public === "boolean") {
    assert(data.public === expectedPublic, `${id} storage bucket visibility is configured`);
  }
}

await assertBucketReady("assets", false);
await assertBucketReady("thumbnails", true);
await assertBucketReady("avatars", true);
await assertBucketReady("workspaces", true);

async function invokeFunction(name, body, method = "POST") {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method,
    headers: authHeaders,
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${name} failed: ${payload?.error ?? res.statusText}`);
  return payload;
}

const boot = await invokeFunction("bootstrap", {});
assert(boot.data?.workspace_id, "bootstrap function works");

const { data: workspaces, error: workspaceError } = await client
  .from("workspaces")
  .select("id,name")
  .limit(1);
if (workspaceError) throw workspaceError;
assert(workspaces?.[0]?.id, "bootstrap workspace exists");
const workspace = workspaces[0];

const sidebarWorkspaceSelect = "id,name,organization_id,status,created_at,logo_url,organizations:organization_id(organization_members(user_id,role))";
const sidebarWorkspaces = await fetch(`${url}/rest/v1/workspaces?select=${encodeURIComponent(sidebarWorkspaceSelect)}&status=neq.deleted&order=created_at.asc`, {
  headers: authHeaders,
});
const sidebarWorkspacePayload = await sidebarWorkspaces.json().catch(() => null);
assert(sidebarWorkspaces.ok && Array.isArray(sidebarWorkspacePayload), "production sidebar workspace query works");

const { data: projects, error: projectError } = await client
  .from("projects")
  .select("id,name,status")
  .eq("workspace_id", workspace.id)
  .limit(1);
if (projectError) throw projectError;
assert(projects?.[0]?.id, "bootstrap project exists");
const project = projects[0];

const homeProjectSelect = "id,name,workspace_id,status,created_at";
const homeProjects = await fetch(`${url}/rest/v1/projects?select=${encodeURIComponent(homeProjectSelect)}&workspace_id=eq.${workspace.id}&order=created_at.desc`, {
  headers: authHeaders,
});
const homeProjectPayload = await homeProjects.json().catch(() => null);
assert(homeProjects.ok && Array.isArray(homeProjectPayload), "production projects query works");

const workspaceList = await invokeFunction("workspace", { action: "list" });
assert(Array.isArray(workspaceList.data) && workspaceList.data.length > 0, "workspace list function works");

const projectList = await invokeFunction("project", { action: "list", workspace_id: workspace.id });
assert(Array.isArray(projectList.data), "project list function works");

const initialProjectCounts = await invokeFunction("asset", { action: "project_counts", workspace_id: workspace.id });
assert(Array.isArray(initialProjectCounts.data), "project counts function works");

const campaignProjectPayload = await invokeFunction("asset", { action: "list_project", project_id: project.id });
assert(campaignProjectPayload.data?.project?.id === project.id, "campaign project payload includes project");
assert(campaignProjectPayload.data?.workspace?.id === workspace.id, "campaign project payload includes workspace");
assert(Array.isArray(campaignProjectPayload.data?.assets), "campaign project payload includes assets");
assert(Array.isArray(campaignProjectPayload.data?.folders), "campaign project payload includes folders");

const folderCreate = await invokeFunction("asset", {
  action: "create_folder",
  workspace_id: workspace.id,
  project_id: project.id,
  name: "Runtime Smoke Folder",
});
assert(folderCreate.data?.id, "folder create function works");

const duplicateFolderCreate = await invokeFunction("asset", {
  action: "create_folder",
  workspace_id: workspace.id,
  project_id: project.id,
  name: "Runtime Smoke Folder",
});
assert(duplicateFolderCreate.data?.id === folderCreate.data.id, "folder create is idempotent");

const folderList = await invokeFunction("asset", {
  action: "list_folders",
  workspace_id: workspace.id,
  project_id: project.id,
});
assert(Array.isArray(folderList.data) && folderList.data.some((folder) => folder.id === folderCreate.data.id), "folder list function works");

const objectId = crypto.randomUUID();
const storagePath = `${workspace.id}/${project.id}/${objectId}.txt`;
const file = new Blob(["hello from runtime smoke"], { type: "text/plain" });
const upload = await client.storage.from("assets").upload(storagePath, file, {
  contentType: "text/plain",
});
if (upload.error) throw upload.error;
assert(upload.data?.path === storagePath, "authenticated storage upload works");

const { data: asset, error: assetError } = await client
  .from("assets")
  .insert({
    workspace_id: workspace.id,
    project_id: project.id,
    title: "runtime-smoke.txt",
    storage_path: storagePath,
    mime_type: "text/plain",
    size_bytes: file.size,
    tags: ["smoke"],
    description: "runtime smoke asset",
  })
  .select("*")
  .single();
if (assetError) throw assetError;
assert(asset?.id, "asset insert works");

const assetList = await invokeFunction("asset", {
  action: "list_project",
  workspace_id: workspace.id,
  project_id: project.id,
});
assert(Array.isArray(assetList.data?.assets), "asset list function works");

const assetUpdate = await invokeFunction("asset", {
  action: "update",
  workspace_id: workspace.id,
  id: asset.id,
  title: "runtime-smoke-renamed.txt",
});
assert(assetUpdate.data?.title === "runtime-smoke-renamed.txt", "asset update function works");

const detachObjectId = crypto.randomUUID();
const detachStoragePath = `${workspace.id}/${project.id}/${detachObjectId}.txt`;
const detachFile = new Blob(["detachable asset"], { type: "text/plain" });
const detachUpload = await client.storage.from("assets").upload(detachStoragePath, detachFile, {
  contentType: "text/plain",
});
if (detachUpload.error) throw detachUpload.error;
const { data: detachableAsset, error: detachableAssetError } = await client
  .from("assets")
  .insert({
    workspace_id: workspace.id,
    project_id: project.id,
    title: "runtime-smoke-detachable.txt",
    storage_path: detachStoragePath,
    mime_type: "text/plain",
    size_bytes: detachFile.size,
  })
  .select("*")
  .single();
if (detachableAssetError) throw detachableAssetError;
const detached = await invokeFunction("asset", {
  action: "detach_project",
  project_id: project.id,
  asset_id: detachableAsset.id,
});
assert(detached.data?.removed_asset_ids?.includes(detachableAsset.id), "asset detach project function works");
const { data: detachedRow, error: detachedRowError } = await client
  .from("assets")
  .select("project_id,folder_id")
  .eq("id", detachableAsset.id)
  .single();
if (detachedRowError) throw detachedRowError;
assert(detachedRow?.project_id === null && detachedRow?.folder_id === null, "asset detach clears project assignment");

const { data: comment, error: commentError } = await client
  .from("asset_comments")
  .insert({
    asset_id: asset.id,
    author_user_id: created.data.user.id,
    body: "member comment",
  })
  .select("*")
  .single();
if (commentError) throw commentError;
assert(comment?.id, "member comment insert works");

const commentPatch = await invokeFunction("comment", {
  id: comment.id,
  status: "completed",
}, "PATCH");
assert(commentPatch.data?.status === "completed", "comment patch function works");

async function uploadPublicBucket(bucket, path) {
  const blob = new Blob(["oss smoke"], { type: "text/plain" });
  const result = await client.storage.from(bucket).upload(path, blob, {
    contentType: "text/plain",
    upsert: true,
  });
  if (result.error) throw result.error;
  assert(result.data?.path === path, `${bucket} storage upload works`);
}

await uploadPublicBucket("thumbnails", `${workspace.id}/${asset.id}/thumbnail.txt`);
await uploadPublicBucket("avatars", `avatars/${created.data.user.id}/avatar.txt`);
await uploadPublicBucket("workspaces", `workspace_${workspace.id}/workspace.txt`);
await uploadPublicBucket("workspaces", `collection_headers/${workspace.id}/runtime-smoke/icon.txt`);

const mentionable = await invokeFunction("get-mentionable-users", {
  organizationId: boot.data.organization_id,
});
assert(Array.isArray(mentionable.data) && mentionable.data.length > 0, "mentionable users function works");

const { data: notification, error: notificationError } = await admin
  .from("notifications")
  .insert({
    workspace_id: workspace.id,
    project_id: project.id,
    asset_id: asset.id,
    recipient_user_id: created.data.user.id,
    notification_type: "asset.intelligence_completed",
    title: "Runtime intelligence completed",
    message: "Runtime smoke notification",
    target_url: `/workspace/${workspace.id}/projects/${project.id}/assets/${asset.id}`,
    metadata: { asset_title: asset.title },
  })
  .select("id")
  .single();
if (notificationError) throw notificationError;
assert(notification?.id, "notification insert works");

const notificationCount = await invokeFunction("notifications", {
  action: "unread-count",
  workspace_id: workspace.id,
});
assert(notificationCount.data?.count >= 1, "notifications unread count works");

const notificationList = await invokeFunction("notifications", {
  action: "list",
  workspace_id: workspace.id,
  status: "unread",
  type: "asset.intelligence_completed",
});
assert(
  Array.isArray(notificationList.data) && notificationList.data.some((row) => row.id === notification.id),
  "notifications list includes intelligence notification",
);

const notificationRead = await invokeFunction("notifications", {
  action: "mark-read",
  workspace_id: workspace.id,
  notification_id: notification.id,
});
assert(notificationRead.data?.read_at, "notifications mark read works");

const apiKeyCreate = await invokeFunction("api-keys", {
  action: "create",
  organization_id: boot.data.organization_id,
  name: "Runtime Smoke OpenClaw",
  provider: "openclaw",
});
assert(apiKeyCreate.data?.raw_key?.startsWith("reloops_live_"), "agent api key create works");

const agentUploadBody = new FormData();
const agentUploadFile = new Blob(["agent uploaded asset"], { type: "text/plain" });
agentUploadBody.append("workspace_id", workspace.id);
agentUploadBody.append("project_id", project.id);
agentUploadBody.append("title", "runtime-smoke-agent-upload.txt");
agentUploadBody.append("tags", JSON.stringify(["agent", "upload"]));
agentUploadBody.append("file", agentUploadFile, "runtime-smoke-agent-upload.txt");

const agentUploadRes = await fetch(`${url}/functions/v1/api-assets/upload`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${apiKeyCreate.data.raw_key}`,
  },
  body: agentUploadBody,
});
const agentUploadPayload = await agentUploadRes.json();
if (!agentUploadRes.ok || !agentUploadPayload.data?.id) {
  throw new Error(`agent api upload creates asset (${agentUploadRes.status}: ${JSON.stringify(agentUploadPayload)})`);
}
assert(true, "agent api upload creates asset");
assert(agentUploadPayload.data?.storage_path, "agent api upload returns storage path");
assert(agentUploadPayload.data?.download_url, "agent api upload returns download url");

const { data: agentUploadedObject, error: agentUploadedObjectError } = await admin.storage
  .from("assets")
  .download(agentUploadPayload.data.storage_path);
if (agentUploadedObjectError) throw agentUploadedObjectError;
assert(await agentUploadedObject.text() === "agent uploaded asset", "agent api upload writes Supabase storage object");

const secondObjectId = crypto.randomUUID();
const secondStoragePath = `${workspace.id}/${project.id}/${secondObjectId}.txt`;
const secondFile = new Blob(["second asset"], { type: "text/plain" });
const secondUpload = await client.storage.from("assets").upload(secondStoragePath, secondFile, {
  contentType: "text/plain",
});
if (secondUpload.error) throw secondUpload.error;
const { data: secondAsset, error: secondAssetError } = await client
  .from("assets")
  .insert({
    workspace_id: workspace.id,
    project_id: project.id,
    title: "runtime-smoke-second.txt",
    storage_path: secondStoragePath,
    mime_type: "text/plain",
    size_bytes: secondFile.size,
  })
  .select("*")
  .single();
if (secondAssetError) throw secondAssetError;

const stacked = await invokeFunction("stack-asset", {
  srcId: secondAsset.id,
  targetTopId: asset.id,
});
assert(stacked.ok === true, "stack asset function works");

const reordered = await invokeFunction("reorder-versions", {
  orderedIds: [asset.id, secondAsset.id],
  removedIds: [],
});
assert(reordered.ok === true, "reorder versions function works");

const token = crypto.randomUUID().replaceAll("-", "");
const { data: share, error: shareError } = await client
  .from("share_links")
  .insert({
    workspace_id: workspace.id,
    subject_type: "asset",
    subject_id: asset.id,
    token,
    can_comment: true,
  })
  .select("*")
  .single();
if (shareError) throw shareError;
assert(share?.token === token, "share link insert works");

const members = await invokeFunction("org-members", { workspace_id: workspace.id });
assert(Array.isArray(members.data) && members.data.length > 0, "members function works");

const reviewers = await invokeFunction("review", { action: "list-project-reviewers", workspace_id: workspace.id });
assert(Array.isArray(reviewers.data), "reviewers function works");

const collection = await invokeFunction("collections", {
  action: "create",
  workspace_id: workspace.id,
  name: "Runtime Smoke Collection",
  definition: {
    source: { type: "project", project_id: project.id, folder_id: null },
    fields: { visible: ["status", "file_extension"] },
    filters: { items: [{ id: "smoke-filter", field: "tags", operator: "contains", value: "smoke" }] },
    sort: { key: "uploaded_at", dir: "desc" },
    appearance: { mode: "grid", card_size: "small" },
    grouping: { mode: "folder" },
  },
});
assert(collection.data?.id, "collection create function works");

const collectionAppearanceUpdate = await invokeFunction("collections", {
  action: "update",
  collection_id: collection.data.id,
  definition: { appearance: { mode: "list", card_size: "large" } },
});
assert(collectionAppearanceUpdate.data?.definition?.source?.project_id === project.id, "collection appearance update preserves source");
assert(collectionAppearanceUpdate.data?.definition?.filters?.items?.[0]?.id === "smoke-filter", "collection appearance update preserves filters");
assert(collectionAppearanceUpdate.data?.definition?.sort?.key === "uploaded_at", "collection appearance update preserves sort");

const collectionFieldsUpdate = await invokeFunction("collections", {
  action: "update",
  collection_id: collection.data.id,
  visible_fields: ["status", "size_bytes", "uploaded_at"],
});
assert(collectionFieldsUpdate.data?.definition?.fields?.visible?.includes("size_bytes"), "collection visible fields update persists fields");
assert(collectionFieldsUpdate.data?.definition?.source?.project_id === project.id, "collection visible fields update preserves source");

const collectionSortUpdate = await invokeFunction("collections", {
  action: "update",
  collection_id: collection.data.id,
  sort_key: "name",
  sort_dir: "asc",
});
assert(collectionSortUpdate.data?.definition?.sort?.key === "name" && collectionSortUpdate.data?.definition?.sort?.dir === "asc", "collection sort update persists sort");
assert(collectionSortUpdate.data?.definition?.fields?.visible?.includes("size_bytes"), "collection sort update preserves fields");

const collectionShare = await invokeFunction("share", {
  action: "create",
  workspace_id: workspace.id,
  collection_id: collection.data.id,
  subject_type: "collection",
  subject_id: collection.data.id,
});
assert(collectionShare.data?.token, "collection share create works");

const shareGet = await fetch(`${url}/functions/v1/share?token=${token}`, {
  headers: { apikey: anonKey },
});
const sharePayload = await shareGet.json();
assert(shareGet.ok && sharePayload.assets?.id === asset.id, "share function reads shared asset");
assert(Boolean(sharePayload.fileUrl), "share function returns signed file URL");

const sharePost = await fetch(`${url}/functions/v1/share?token=${token}`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: anonKey },
  body: JSON.stringify({
    asset_id: asset.id,
    guest_name: "Guest Reviewer",
    body: "guest comment",
  }),
});
const sharePostPayload = await sharePost.json();
assert(sharePost.ok && sharePostPayload.comment?.id, "share function writes guest comment");

console.log("\nruntime smoke passed");

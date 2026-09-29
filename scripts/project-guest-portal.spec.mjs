import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Project sharing is a port of the cloud feature: standalone project-share*
// functions plus the cloud portal pages, adapted only where OSS differs
// (Supabase Storage instead of B2/Bunny, `folders` instead of `asset_folders`).
const read = (path) => readFileSync(path, "utf8");
const fn = (name) => read(`supabase/functions/${name}/index.ts`);
const migrations = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"));
const migration = read("supabase/migrations/20260527000000_init.sql");
const config = read("supabase/config.toml");

test("fresh installs get the full project-sharing schema from the base migration", () => {
  assert.match(migration, /share_subject_type as enum \('asset', 'collection', 'project'\)/);
  for (const column of ["folder_ids uuid\\[\\]", "asset_root_ids uuid\\[\\]", "access_count integer", "last_accessed_at timestamptz"]) {
    assert.match(migration, new RegExp(column), `share_links.${column}`);
  }
  for (const column of ["uploaded_via_share_link_id", "uploaded_by_guest_name", "uploaded_by_guest_email", "updated_by_guest_name", "updated_by_guest_email", "guest_author_token_hash"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /share_links_selection_requires_project_check/);
  assert.match(migration, /share_links_folder_id_selection_mutually_exclusive_check/);
});

test("existing installs upgrade without a reset: published migrations stay, and an idempotent migration adds project sharing", () => {
  // Every migration ever published must remain; removing one makes `supabase db push` fail,
  // and scripts/dev-all.sh + docker-start.sh then run `db reset`, wiping the user's data.
  for (const published of ["20260527000000_init.sql", "20260706000000_public_api_role_grants.sql"]) {
    assert.ok(migrations.includes(published), `published migration ${published} must not be removed`);
  }
  const upgrade = migrations.filter((name) => name > "20260706000000_public_api_role_grants.sql").map((name) => read(`supabase/migrations/${name}`)).join("\n");
  assert.match(upgrade, /alter type public\.share_subject_type add value if not exists 'project'/i);
  for (const [table, column] of [
    ["share_links", "project_id"], ["share_links", "folder_id"], ["share_links", "allow_upload"], ["share_links", "password_hash"],
    ["share_links", "folder_ids"], ["share_links", "asset_root_ids"], ["share_links", "access_count"], ["share_links", "last_accessed_at"],
    ["assets", "uploaded_via_share_link_id"], ["assets", "uploaded_by_guest_name"], ["assets", "uploaded_by_guest_email"],
    ["assets", "updated_by_guest_name"], ["assets", "updated_by_guest_email"], ["asset_comments", "guest_author_token_hash"],
  ]) {
    assert.match(upgrade, new RegExp(`alter table public\\.${table}[^;]*add column if not exists ${column}\\b`, "i"), `${table}.${column}`);
  }
  for (const constraint of ["share_links_project_scope_check", "share_links_selection_requires_project_check", "share_links_folder_id_selection_mutually_exclusive_check", "assets_uploaded_via_share_link_fkey"]) {
    assert.match(upgrade, new RegExp(`conname = '${constraint}'`), `${constraint} is added only when missing`);
  }
});

test("project sharing lives in its own functions, like cloud, with guest access enabled", () => {
  const actions = {
    "project-share": ["create", "get", "update-status", "revoke", "list"],
    "project-share-comment": ["list", "create", "edit", "delete"],
    "project-share-upload": ["presign", "complete", "multipart-start", "multipart-sign-batch", "multipart-complete", "multipart-abort", "move-asset", "set-preview"],
  };
  for (const [name, list] of Object.entries(actions)) {
    const source = fn(name);
    for (const action of list) assert.match(source, new RegExp(`case "${action}":`), `${name} ${action}`);
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\nverify_jwt = false`), `${name} verify_jwt`);
  }
  assert.ok(existsSync("supabase/functions/api-project-shares/index.ts"));
  assert.match(config, /\[functions\.api-project-shares\]\nverify_jwt = false/);
});

test("OSS adaptations: folders table, share subject columns, private-bucket signed URLs, Supabase Storage uploads", () => {
  for (const name of ["project-share", "project-share-comment", "project-share-upload", "api-project-shares"]) {
    assert.doesNotMatch(fn(name), /from\("asset_folders"\)/, `${name} uses OSS folders table`);
    assert.doesNotMatch(fn(name), /bunnyCdn|S3Client|@aws-sdk/, `${name} has no cloud-only storage`);
  }
  const share = fn("project-share");
  assert.match(share, /subject_type: "project"/);
  assert.match(share, /subject_id: project_id/);
  assert.match(share, /createSignedUrls?\(/, "every guest file is served through a signed URL");
  assert.match(share, /publicStorageUrl\(/);
  assert.match(fn("project-share-upload"), /createSignedUploadUrl\(/);
  assert.match(fn("api-project-shares"), /subject_type: "project"/);
});

test("the asset and collection share paths are untouched by project sharing (cloud isolation)", () => {
  assert.doesNotMatch(fn("share"), /project-share-link|create-guest-upload|update-guest-status/);
  assert.doesNotMatch(fn("comment"), /subject_type === "project"/);
  assert.doesNotMatch(read("apps/web/src/pages/Review/ShareAsset.tsx"), /get-project-share-asset|isProjectShare/);
});

test("the cloud portal pages and owner entry points are in place", () => {
  const routes = read("apps/web/src/main.tsx");
  assert.match(routes, /path="\/share\/project\/:token" element=\{<ShareProject \/>\}/);
  assert.match(routes, /path="\/share\/project\/:token\/asset\/:assetId" element=\{<ShareProjectAsset \/>\}/);
  for (const file of [
    "pages/Review/ShareProject.tsx",
    "pages/Review/ShareProjectAsset.tsx",
    "pages/Review/useGuestMoveDestination.ts",
    "pages/Campaign/components/ShareProjectEntryPoint.tsx",
    "pages/Campaign/components/ShareProjectDialog.tsx",
    "pages/Campaign/components/ProjectShareLinks.tsx",
    "lib/shareGuestIdentity.ts",
    "lib/shareLinkPassword.ts",
  ]) {
    assert.ok(existsSync(`apps/web/src/${file}`), file);
  }
  const project = read("apps/web/src/pages/Campaign/CampaignDetails.tsx");
  assert.match(project, /<ShareProjectEntryPoint project=\{project\} open=\{shareProjectOpen\}/);
  assert.match(project, /Share Project/);
  assert.match(project, /Share This Folder/);
  assert.match(project, /requestShareSelection/);
});

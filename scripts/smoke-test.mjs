import { readFileSync, existsSync } from "node:fs";

const checks = [];

function check(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
}

function file(path) {
  return readFileSync(path, "utf8");
}

const app = file("apps/web/src/main.tsx");
const sql = file("supabase/migrations/20260527000000_init.sql");
const share = file("supabase/functions/share/index.ts");
const rootPkg = file("package.json");
const webPkg = file("apps/web/package.json");

check("web app exists", existsSync("apps/web/src/main.tsx"));
check("share function exists", existsSync("supabase/functions/share/index.ts"));
check("env example exists", existsSync("apps/web/.env.local.example"));
check("root env example exists", existsSync(".env.example"));
check("single base migration", !existsSync("supabase/migrations/20260530000000_agent_api_and_asset_intelligence.sql"));
check("no production upload-b2 function", !existsSync("supabase/functions/upload-b2"));

for (const table of [
  "organizations",
  "organization_members",
  "profiles",
  "workspaces",
  "workspace_members",
  "projects",
  "folders",
  "assets",
  "asset_comments",
  "collections",
  "collection_asset_links",
  "project_asset_links",
  "share_links",
  "api_keys",
  "asset_history",
  "asset_intelligence_jobs",
  "invitations",
]) {
  check(`schema table ${table}`, sql.includes(`create table public.${table}`));
  check(`rls ${table}`, sql.includes(`alter table public.${table} enable row level security`));
}

check("assets storage bucket", sql.includes("'assets', 'assets'"));
check("thumbnails storage bucket", sql.includes("'thumbnails', 'thumbnails'"));
check("avatars storage bucket", sql.includes("'avatars', 'avatars'"));
check("workspaces storage bucket", sql.includes("'workspaces', 'workspaces'"));
check("auth bootstrap trigger", sql.includes("create trigger on_auth_user_created"));
check("share function validates token", share.includes("getValidShare"));
check("share function signs private asset URLs", share.includes("createSignedUrl"));
check("share function supports guest comments", share.includes("guest_name"));
check("agent api keys function exists", existsSync("supabase/functions/api-keys/index.ts"));
check("agent workspaces function exists", existsSync("supabase/functions/api-workspaces/index.ts"));
check("agent projects function exists", existsSync("supabase/functions/api-projects/index.ts"));
check("agent assets function exists", existsSync("supabase/functions/api-assets/index.ts"));
check("agent comments function exists", existsSync("supabase/functions/api-comments/index.ts"));
check("agent shares function exists", existsSync("supabase/functions/api-shares/index.ts"));
check("assigned items function exists", existsSync("supabase/functions/assigned-items/index.ts"));
check("asset intelligence worker exists", existsSync("apps/asset-intelligence-worker/src/index.ts"));
check("asset intelligence worker package exists", existsSync("apps/asset-intelligence-worker/package.json"));
check("asset intelligence worker Dockerfile exists", existsSync("apps/asset-intelligence-worker/Dockerfile"));
check("asset intelligence Docker compose exists", existsSync("docker-compose.asset-intelligence.yml"));
check("asset intelligence UAT checklist exists", existsSync("docs/asset-intelligence-worker-uat.md"));
check("agent api key hashing", sql.includes("key_hash text"));
check("asset intelligence queue", sql.includes("create table public.asset_intelligence_jobs"));
check("asset intelligence claim function", sql.includes("claim_asset_intelligence_job"));
check("asset intelligence insert trigger", sql.includes("assets_enqueue_asset_intelligence"));
check("no stripe schema", !sql.toLowerCase().includes("stripe_"));

for (const feature of [
  "Workspaces",
  "CampaignPage",
  "ReviewAsset",
  "ShareAsset",
  "CollectionsIndexPage",
  "CollectionDetailPage",
  "WorkspaceAssetSearchPage",
  "Teams",
  "CompareVersionsPage",
]) {
  check(`web feature ${feature}`, app.includes(feature));
}

for (const forbidden of ["@sentry/react", "@microsoft/clarity", "autumn-js", "@supabase/auth-helpers-nextjs"]) {
  check(`no package ${forbidden}`, !`${rootPkg}\n${webPkg}`.toLowerCase().includes(forbidden));
}

for (const forbidden of ["upload-b2", "qstash", "upstash", "thumbnail_worker", "cloudflare"]) {
  check(`no backend ${forbidden}`, !`${sql}\n${share}`.toLowerCase().includes(forbidden));
}

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  console.log(`${item.passed ? "ok" : "FAIL"} ${item.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} smoke checks failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} smoke checks passed.`);

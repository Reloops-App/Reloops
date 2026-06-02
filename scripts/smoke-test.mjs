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
const supabaseConfig = file("supabase/config.toml");
const share = file("supabase/functions/share/index.ts");
const notificationsFunction = file("supabase/functions/notifications/index.ts");
const assetIntelligenceWorker = file("apps/asset-intelligence-worker/src/index.ts");
const rootPkg = file("package.json");
const webPkg = file("apps/web/package.json");
const devAll = file("scripts/dev-all.sh");
const ensureStorage = file("scripts/ensure-storage-buckets.mjs");
const dockerCompose = file("docker-compose.yml");
const dockerfile = file("Dockerfile");
const openClawSkill = file("skills/openclaw-reloops-api/SKILL.md");
const openClawApiDocs = file("skills/openclaw-reloops-api/references/api_docs.md");
const openClawHelperEnv = file("skills/openclaw-reloops-api/scripts/local-api.env.example");
const openClawHelper = file("skills/openclaw-reloops-api/scripts/local-api.sh");
const openClawDocs = file("docs/openclaw-reloops-api.md");
const apiAssetsFunction = file("supabase/functions/api-assets/index.ts");

check("web app exists", existsSync("apps/web/src/main.tsx"));
check("share function exists", existsSync("supabase/functions/share/index.ts"));
check("env example exists", existsSync("apps/web/.env.local.example"));
check("root env example exists", existsSync(".env.example"));
check("single base migration", !existsSync("supabase/migrations/20260530000000_agent_api_and_asset_intelligence.sql"));
check("OpenClaw OSS skill exists", existsSync("skills/openclaw-reloops-api/SKILL.md"));
check("OpenClaw OSS API docs exist", existsSync("skills/openclaw-reloops-api/references/api_docs.md"));
check("OpenClaw OSS test prompts exist", existsSync("skills/openclaw-reloops-api/references/test_prompts.md"));
check("OpenClaw OSS helper script exists", existsSync("skills/openclaw-reloops-api/scripts/local-api.sh"));
check("OpenClaw OSS documentation exists", existsSync("docs/openclaw-reloops-api.md"));
check("OpenClaw skill uses OSS local port", openClawSkill.includes("127.0.0.1:56321"));
check("OpenClaw API docs use OSS local port", openClawApiDocs.includes("127.0.0.1:56321"));
check("OpenClaw skill promotes OSS upload route", openClawSkill.includes("api-assets/upload"));
check("OpenClaw API docs promote OSS upload route", openClawApiDocs.includes("api-assets/upload"));
check("OpenClaw helper promotes OSS upload route", openClawHelper.includes("api-assets/upload"));
check("OpenClaw helper env has no live key", !openClawHelperEnv.includes("reloops_live_"));
check("OpenClaw documentation links skill", openClawDocs.includes("skills/openclaw-reloops-api"));
check("agent upload route exists", apiAssetsFunction.includes('routeParts[0] === "upload"'));
check("agent upload writes assets bucket", apiAssetsFunction.includes('.from("assets")') && apiAssetsFunction.includes(".upload(objectKey"));
for (const fn of ["assigned-items", "api-workspaces", "api-projects", "api-assets", "api-comments", "api-shares"]) {
  check(`agent endpoint ${fn} accepts API keys`, supabaseConfig.includes(`[functions.${fn}]\nverify_jwt = false`));
}

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
  "notifications",
  "notification_preferences",
  "notification_digest_preferences",
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
check("storage ensure script exists", existsSync("scripts/ensure-storage-buckets.mjs"));
check("startup ensures storage buckets", devAll.includes("node scripts/ensure-storage-buckets.mjs"));
for (const bucket of ["assets", "thumbnails", "avatars", "workspaces"]) {
  check(`storage ensure ${bucket}`, ensureStorage.includes(`id: "${bucket}"`));
}
check("full stack Dockerfile exists", existsSync("Dockerfile"));
check("full stack Docker Compose exists", existsSync("docker-compose.yml"));
check("Docker Compose starts reloops service", dockerCompose.includes("reloops:"));
check("Docker Compose uses host networking for Supabase CLI", dockerCompose.includes("network_mode: host"));
check("Docker Compose mounts repo at host path", dockerCompose.includes(".:${RELOOPS_HOST_PATH:-${PWD}}"));
check("Docker Compose provides Docker socket for Supabase CLI", dockerCompose.includes("/var/run/docker.sock:/var/run/docker.sock"));
check("Docker image includes Supabase CLI", dockerfile.includes("npm install \"supabase@"));
check("Docker start script exists", existsSync("scripts/docker-start.sh"));
check("Docker stop script exists", existsSync("scripts/docker-stop.sh"));
check("package full stack Docker start script", rootPkg.includes("\"docker:start\": \"docker compose up --build\""));
check("auth bootstrap trigger", sql.includes("create trigger on_auth_user_created"));
check("share function validates token", share.includes("getValidShare"));
check("share function signs private asset URLs", share.includes("createSignedUrl"));
check("share function supports guest comments", share.includes("guest_name"));
check("notifications function lists rows", notificationsFunction.includes('action === "list"') && notificationsFunction.includes(".from(\"notifications\")"));
check("notifications function counts unread", notificationsFunction.includes('action === "unread-count"'));
check("notifications function updates preferences", notificationsFunction.includes('action === "update-preference"'));
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
check("asset intelligence completion notification", assetIntelligenceWorker.includes("notifyIntelligenceCompleted"));
check("asset intelligence failure notification", assetIntelligenceWorker.includes("notifyIntelligenceFailed"));
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

for (const forbidden of ["qstash", "upstash", "thumbnail_worker", "cloudflare"]) {
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

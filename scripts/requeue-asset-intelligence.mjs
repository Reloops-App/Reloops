import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

const env = {
  ...parseEnvFile(".env"),
  ...process.env,
};

const supabaseUrl = (env.SUPABASE_URL || env.URL_SUPABASE || "").replace(/\/+$/, "");
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "";
const workspaceId = process.argv.find((arg) => arg.startsWith("--workspace="))?.split("=")[1] ?? "";
const all = process.argv.includes("--all");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run pnpm start once, then retry.");
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

const assetUrl = new URL(`${supabaseUrl}/rest/v1/assets`);
assetUrl.searchParams.set("select", "id,workspace_id,project_id,upload_batch_id,upload_batch_total,uploaded_by,ai_description,smart_description");
assetUrl.searchParams.set("order", "created_at.asc");
if (workspaceId) assetUrl.searchParams.set("workspace_id", `eq.${workspaceId}`);
if (!all) assetUrl.searchParams.set("or", "(ai_description.is.null,smart_description.is.null)");

const assetsRes = await fetch(assetUrl, { headers });
if (!assetsRes.ok) {
  console.error(`Failed to load assets: ${assetsRes.status} ${await assetsRes.text()}`);
  process.exit(1);
}

const assets = await assetsRes.json();
if (!Array.isArray(assets) || assets.length === 0) {
  console.log("No assets need AI requeue.");
  process.exit(0);
}

const jobs = assets.map((asset) => ({
  asset_id: asset.id,
  workspace_id: asset.workspace_id,
  project_id: asset.project_id,
  upload_batch_id: randomUUID(),
  upload_batch_total: asset.upload_batch_total || 1,
  requested_by_user_id: asset.uploaded_by,
  status: "queued",
  attempts: 0,
  max_attempts: 3,
}));

const jobsRes = await fetch(`${supabaseUrl}/rest/v1/asset_intelligence_jobs`, {
  method: "POST",
  headers: {
    ...headers,
    Prefer: "return=minimal",
  },
  body: JSON.stringify(jobs),
});

if (!jobsRes.ok) {
  console.error(`Failed to requeue assets: ${jobsRes.status} ${await jobsRes.text()}`);
  process.exit(1);
}

console.log(`Queued ${jobs.length} asset intelligence job${jobs.length === 1 ? "" : "s"}.`);

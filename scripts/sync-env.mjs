import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function parseEnv(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8"));
}

function isPlaceholder(value) {
  return !value || value.includes("replace-with-local");
}

function upsertEnvFile(path, updates, shouldUpdate = () => true) {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = original ? original.split(/\r?\n/) : [];
  const seen = new Set();
  let changed = false;

  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return line;

    const key = match[1];
    if (!(key in updates)) return line;

    seen.add(key);
    const currentValue = match[2];
    if (!shouldUpdate(key, currentValue)) return line;

    const nextLine = `${key}=${updates[key]}`;
    if (nextLine !== line) changed = true;
    return nextLine;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(`${key}=${value}`);
    changed = true;
  }

  if (changed) {
    writeFileSync(path, `${nextLines.join("\n").replace(/\n+$/, "")}\n`);
  }

  return changed;
}

function setting(values, key, fallback) {
  const value = values[key];
  return value === undefined || value === "" ? fallback : value;
}

function runSupabase(args) {
  try {
    return execFileSync("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch {
    return execFileSync("npx", ["supabase", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  }
}

const output = runSupabase(["status", "-o", "env"]);

const values = parseEnv(output);
const existing = {
  ...parseEnvFile(".env"),
  ...parseEnvFile("apps/asset-intelligence-worker/.env.local"),
  ...process.env,
};

if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
  throw new Error("Could not read Supabase local keys. Is Supabase running?");
}

const publicApiUrl = setting(process.env, "SUPABASE_PUBLIC_URL", values.API_URL);
const serverApiUrl = setting(process.env, "SUPABASE_INTERNAL_URL", values.API_URL);

const assetAiProvider = setting(existing, "ASSET_AI_PROVIDER", "mock");
const assetAiModel = setting(existing, "ASSET_AI_MODEL", "gpt-4.1-mini");
const openAiApiKey = setting(existing, "OPENAI_API_KEY", "");
const assetAiWorkerId = setting(existing, "ASSET_AI_WORKER_ID", "asset-ai-local");
const assetAiPollIntervalMs = setting(existing, "ASSET_AI_POLL_INTERVAL_MS", "5000");
const assetAiLeaseSeconds = setting(existing, "ASSET_AI_LEASE_SECONDS", "300");
const assetAiMaxConcurrentJobs = setting(existing, "ASSET_AI_MAX_CONCURRENT_JOBS", "1");
const assetAiOpenAiTimeoutMs = setting(existing, "ASSET_AI_OPENAI_TIMEOUT_MS", "60000");
const assetAiFfmpegTimeoutMs = setting(existing, "ASSET_AI_FFMPEG_TIMEOUT_MS", "30000");
const assetAiFfprobeTimeoutMs = setting(existing, "ASSET_AI_FFPROBE_TIMEOUT_MS", "10000");
const assetAiMaxVideoFrames = setting(existing, "ASSET_AI_MAX_VIDEO_FRAMES", "3");
const assetAiVideoFrameWidth = setting(existing, "ASSET_AI_VIDEO_FRAME_WIDTH", "720");

const workerSettings = [
  `ASSET_SOURCE_BASE_URL=${serverApiUrl}/storage/v1/object/public/assets`,
  `ASSET_AI_PROVIDER=${assetAiProvider}`,
  `ASSET_AI_MODEL=${assetAiModel}`,
  `OPENAI_API_KEY=${openAiApiKey}`,
  `ASSET_AI_WORKER_ID=${assetAiWorkerId}`,
  `ASSET_AI_POLL_INTERVAL_MS=${assetAiPollIntervalMs}`,
  `ASSET_AI_LEASE_SECONDS=${assetAiLeaseSeconds}`,
  `ASSET_AI_MAX_CONCURRENT_JOBS=${assetAiMaxConcurrentJobs}`,
  `ASSET_AI_OPENAI_TIMEOUT_MS=${assetAiOpenAiTimeoutMs}`,
  `ASSET_AI_FFMPEG_TIMEOUT_MS=${assetAiFfmpegTimeoutMs}`,
  `ASSET_AI_FFPROBE_TIMEOUT_MS=${assetAiFfprobeTimeoutMs}`,
  `ASSET_AI_MAX_VIDEO_FRAMES=${assetAiMaxVideoFrames}`,
  `ASSET_AI_VIDEO_FRAME_WIDTH=${assetAiVideoFrameWidth}`,
];

const rootChanged = upsertEnvFile(
  ".env",
  {
    VITE_SUPABASE_URL: publicApiUrl,
    VITE_SUPABASE_ANON_KEY: values.ANON_KEY,
    VITE_ASSET_PUBLIC_BASE_URL: `${publicApiUrl}/storage/v1/object/public/assets/`,
    SUPABASE_URL: serverApiUrl,
    SUPABASE_PUBLIC_URL: publicApiUrl,
    SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    URL_SUPABASE: serverApiUrl,
    ANON_KEY: values.ANON_KEY,
    SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    ASSET_SOURCE_BASE_URL: `${serverApiUrl}/storage/v1/object/public/assets`,
  },
  (_key, currentValue) => isPlaceholder(currentValue),
);

const rootEnv = {
  ...parseEnvFile(".env"),
  ...process.env,
};

const runtimeAssetAiProvider = setting(rootEnv, "ASSET_AI_PROVIDER", assetAiProvider);
const runtimeAssetAiModel = setting(rootEnv, "ASSET_AI_MODEL", assetAiModel);
const runtimeOpenAiApiKey = setting(rootEnv, "OPENAI_API_KEY", openAiApiKey);
const runtimeAssetAiWorkerId = setting(rootEnv, "ASSET_AI_WORKER_ID", assetAiWorkerId);
const runtimeAssetAiPollIntervalMs = setting(rootEnv, "ASSET_AI_POLL_INTERVAL_MS", assetAiPollIntervalMs);
const runtimeAssetAiLeaseSeconds = setting(rootEnv, "ASSET_AI_LEASE_SECONDS", assetAiLeaseSeconds);
const runtimeAssetAiMaxConcurrentJobs = setting(rootEnv, "ASSET_AI_MAX_CONCURRENT_JOBS", assetAiMaxConcurrentJobs);
const runtimeAssetAiOpenAiTimeoutMs = setting(rootEnv, "ASSET_AI_OPENAI_TIMEOUT_MS", assetAiOpenAiTimeoutMs);
const runtimeAssetAiFfmpegTimeoutMs = setting(rootEnv, "ASSET_AI_FFMPEG_TIMEOUT_MS", assetAiFfmpegTimeoutMs);
const runtimeAssetAiFfprobeTimeoutMs = setting(rootEnv, "ASSET_AI_FFPROBE_TIMEOUT_MS", assetAiFfprobeTimeoutMs);
const runtimeAssetAiMaxVideoFrames = setting(rootEnv, "ASSET_AI_MAX_VIDEO_FRAMES", assetAiMaxVideoFrames);
const runtimeAssetAiVideoFrameWidth = setting(rootEnv, "ASSET_AI_VIDEO_FRAME_WIDTH", assetAiVideoFrameWidth);

writeFileSync(
  "apps/web/.env.local",
  [
    `VITE_SUPABASE_URL=${publicApiUrl}`,
    `VITE_SUPABASE_ANON_KEY=${values.ANON_KEY}`,
    `VITE_APP_URL=${setting(rootEnv, "VITE_APP_URL", setting(rootEnv, "FRONTEND_URL", "http://127.0.0.1:6173"))}`,
    `VITE_ASSET_PUBLIC_BASE_URL=${publicApiUrl}/storage/v1/object/public/assets/`,
    `VITE_RELOOPS_OSS=true`,
    "",
  ].join("\n"),
);

writeFileSync(
  "apps/asset-intelligence-worker/.env.local",
  [
    `SUPABASE_URL=${serverApiUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}`,
    `ASSET_SOURCE_BASE_URL=${serverApiUrl}/storage/v1/object/public/assets`,
    `ASSET_AI_PROVIDER=${runtimeAssetAiProvider}`,
    `ASSET_AI_MODEL=${runtimeAssetAiModel}`,
    `OPENAI_API_KEY=${runtimeOpenAiApiKey}`,
    `ASSET_AI_WORKER_ID=${runtimeAssetAiWorkerId}`,
    `ASSET_AI_POLL_INTERVAL_MS=${runtimeAssetAiPollIntervalMs}`,
    `ASSET_AI_LEASE_SECONDS=${runtimeAssetAiLeaseSeconds}`,
    `ASSET_AI_MAX_CONCURRENT_JOBS=${runtimeAssetAiMaxConcurrentJobs}`,
    `ASSET_AI_OPENAI_TIMEOUT_MS=${runtimeAssetAiOpenAiTimeoutMs}`,
    `ASSET_AI_FFMPEG_TIMEOUT_MS=${runtimeAssetAiFfmpegTimeoutMs}`,
    `ASSET_AI_FFPROBE_TIMEOUT_MS=${runtimeAssetAiFfprobeTimeoutMs}`,
    `ASSET_AI_MAX_VIDEO_FRAMES=${runtimeAssetAiMaxVideoFrames}`,
    `ASSET_AI_VIDEO_FRAME_WIDTH=${runtimeAssetAiVideoFrameWidth}`,
    "",
  ].join("\n"),
);

console.log(rootChanged ? "updated .env placeholders" : "kept .env unchanged");
console.log("wrote apps/web/.env.local");
console.log("wrote apps/asset-intelligence-worker/.env.local");

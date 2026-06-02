import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

type AssetRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  tags: string[] | null;
  smart_tags: string[] | null;
  smart_description: string | null;
  mime_type: string | null;
  storage_path: string | null;
  cover_image_url: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
};

type DbJob = {
  id: string;
  asset_id: string;
  workspace_id: string;
  project_id: string | null;
  upload_batch_id: string;
  upload_batch_total: number;
  requested_by_user_id: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
};

type NormalizedAsset = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  tags: string[];
  mimeType: string | null;
  storagePath: string | null;
  mediaUrl: string | null;
  coverImageUrl: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

type AnalysisResult = {
  description: string;
  tags: string[];
  ai_metadata: {
    asset_type: string;
    search_phrases: string[];
    detected_text: string[];
    dominant_subjects: string[];
    visual_style: string[];
    colors: string[];
    confidence: number;
    model: string;
    provider: string;
  };
};

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ASSET_SOURCE_BASE_URL = process.env.ASSET_SOURCE_BASE_URL || "";
const ASSET_AI_PROVIDER = (process.env.ASSET_AI_PROVIDER || "mock").toLowerCase();
const ASSET_AI_MODEL = process.env.ASSET_AI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WORKER_ID = process.env.ASSET_AI_WORKER_ID || `asset-ai-${randomUUID()}`;
const POLL_INTERVAL_MS = Number(process.env.ASSET_AI_POLL_INTERVAL_MS || 5_000);
const LEASE_SECONDS = Number(process.env.ASSET_AI_LEASE_SECONDS || 300);
const MAX_CONCURRENT_JOBS = Number(process.env.ASSET_AI_MAX_CONCURRENT_JOBS || 1);
const OPENAI_TIMEOUT_MS = Number(process.env.ASSET_AI_OPENAI_TIMEOUT_MS || 60_000);
const FFMPEG_TIMEOUT_MS = Number(process.env.ASSET_AI_FFMPEG_TIMEOUT_MS || 30_000);
const FFPROBE_TIMEOUT_MS = Number(process.env.ASSET_AI_FFPROBE_TIMEOUT_MS || 10_000);
const MAX_VIDEO_FRAMES = Number(process.env.ASSET_AI_MAX_VIDEO_FRAMES || 3);
const VIDEO_FRAME_WIDTH = Number(process.env.ASSET_AI_VIDEO_FRAME_WIDTH || 720);

let activeJobs = 0;
let shuttingDown = false;

function requireConfig() {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

function supabaseBaseUrl() {
  const value = SUPABASE_URL.trim().replace(/\/+$/, "");
  if (!value) return value;
  if (value === "localhost" || value === "127.0.0.1") return `http://${value}:56321`;
  if (/^(localhost|127\.0\.0\.1):\d+$/.test(value)) return `http://${value}`;
  return value;
}

function headers(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function supabaseJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireConfig();
  const requestHeaders = new Headers(init.headers);
  for (const [key, value] of Object.entries(headers())) requestHeaders.set(key, value);
  if (init.body && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");

  const res = await fetch(`${supabaseBaseUrl()}${path}`, { ...init, headers: requestHeaders });
  if (!res.ok) {
    throw new Error(`Supabase request failed ${path}: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

async function claimJob(): Promise<DbJob | null> {
  const rows = await supabaseJson<DbJob[]>("/rest/v1/rpc/claim_asset_intelligence_job", {
    method: "POST",
    body: JSON.stringify({
      worker_id: WORKER_ID,
      lease_seconds: LEASE_SECONDS,
    }),
  });
  return rows?.[0] ?? null;
}

async function patchJob(jobId: string, patch: Record<string, unknown>) {
  const url = new URL(`${supabaseBaseUrl()}/rest/v1/asset_intelligence_jobs`);
  url.searchParams.set("id", `eq.${jobId}`);
  await supabaseJson<void>(`${url.pathname}${url.search}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function fetchAsset(assetId: string): Promise<AssetRow> {
  const url = new URL(`${supabaseBaseUrl()}/rest/v1/assets`);
  url.searchParams.set(
    "select",
    "id,workspace_id,project_id,title,description,tags,smart_tags,smart_description,mime_type,storage_path,cover_image_url,size_bytes,duration_ms,width,height",
  );
  url.searchParams.set("id", `eq.${assetId}`);
  url.searchParams.set("limit", "1");

  const rows = await supabaseJson<AssetRow[]>(`${url.pathname}${url.search}`);
  if (!rows?.length) throw new Error(`Asset not found: ${assetId}`);
  return rows[0];
}

async function writeAssetMetadata(assetId: string, result: AnalysisResult) {
  const url = new URL(`${supabaseBaseUrl()}/rest/v1/assets`);
  url.searchParams.set("id", `eq.${assetId}`);
  await supabaseJson<void>(`${url.pathname}${url.search}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      smart_description: result.description,
      smart_tags: result.tags,
      ai_description: result.description,
      ai_metadata: result.ai_metadata,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function writeAssetHistory(asset: NormalizedAsset, result: AnalysisResult) {
  await supabaseJson<void>("/rest/v1/asset_history", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      asset_id: asset.id,
      workspace_id: asset.workspaceId,
      project_id: asset.projectId,
      event_type: "smart_metadata_updated",
      actor_user_id: null,
      actor_api_key_id: null,
      metadata: {
        smart_description: result.description,
        smart_tags: result.tags,
        ai_metadata: result.ai_metadata,
      },
    }),
  });
}

async function activeWorkspaceUserIds(workspaceId: string): Promise<string[]> {
  const workspaceUrl = new URL(`${supabaseBaseUrl()}/rest/v1/workspaces`);
  workspaceUrl.searchParams.set("select", "organization_id");
  workspaceUrl.searchParams.set("id", `eq.${workspaceId}`);
  workspaceUrl.searchParams.set("limit", "1");

  const workspaces = await supabaseJson<Array<{ organization_id: string }>>(`${workspaceUrl.pathname}${workspaceUrl.search}`);
  const organizationId = workspaces?.[0]?.organization_id;
  if (!organizationId) return [];

  const membersUrl = new URL(`${supabaseBaseUrl()}/rest/v1/organization_members`);
  membersUrl.searchParams.set("select", "user_id");
  membersUrl.searchParams.set("organization_id", `eq.${organizationId}`);
  membersUrl.searchParams.set("role", "in.(owner,admin,member,billing)");

  const members = await supabaseJson<Array<{ user_id: string | null }>>(`${membersUrl.pathname}${membersUrl.search}`);
  return Array.from(new Set((members ?? []).map((member) => member.user_id).filter((userId): userId is string => Boolean(userId))));
}

function assetTargetUrl(asset: NormalizedAsset) {
  if (asset.projectId) return `/workspace/${asset.workspaceId}/projects/${asset.projectId}/assets/${asset.id}`;
  return `/workspace/${asset.workspaceId}/assets/${asset.id}`;
}

async function writeNotifications(
  recipients: string[],
  payload: {
    workspace_id: string;
    project_id: string | null;
    asset_id: string;
    notification_type: "asset.intelligence_completed" | "asset.intelligence_failed";
    title: string;
    message: string;
    target_url: string;
    metadata: Record<string, unknown>;
  },
) {
  if (!recipients.length) return;
  await supabaseJson<void>("/rest/v1/notifications", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(recipients.map((recipient_user_id) => ({
      ...payload,
      recipient_user_id,
    }))),
  });
}

async function notifyIntelligenceCompleted(asset: NormalizedAsset, result: AnalysisResult) {
  const recipients = await activeWorkspaceUserIds(asset.workspaceId);
  await writeNotifications(recipients, {
    workspace_id: asset.workspaceId,
    project_id: asset.projectId,
    asset_id: asset.id,
    notification_type: "asset.intelligence_completed",
    title: "Asset intelligence completed",
    message: `${asset.title} has new smart metadata.`,
    target_url: assetTargetUrl(asset),
    metadata: {
      asset_title: asset.title,
      project_id: asset.projectId,
      smart_tags: result.tags,
      provider: result.ai_metadata.provider,
      model: result.ai_metadata.model,
    },
  });
}

async function notifyIntelligenceFailed(job: DbJob, message: string) {
  const recipients = await activeWorkspaceUserIds(job.workspace_id);
  const asset = await fetchAsset(job.asset_id).then(normalizeAsset).catch(() => null);
  const assetTitle = asset?.title ?? "Asset";
  await writeNotifications(recipients, {
    workspace_id: job.workspace_id,
    project_id: job.project_id,
    asset_id: job.asset_id,
    notification_type: "asset.intelligence_failed",
    title: "Asset intelligence failed",
    message: `${assetTitle} could not be analyzed.`,
    target_url: asset ? assetTargetUrl(asset) : `/workspace/${job.workspace_id}`,
    metadata: {
      asset_title: assetTitle,
      project_id: job.project_id,
      error: message,
    },
  });
}

function mimeFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".pdf":
      return "application/pdf";
    default:
      return null;
  }
}

function mimeKind(mime: string | null | undefined): string {
  const normalized = mime?.toLowerCase().split(";")[0].trim() ?? "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.startsWith("text/")) return "document";
  return "file";
}

function mediaUrl(storagePath: string | null): string | null {
  if (!storagePath || !ASSET_SOURCE_BASE_URL) return null;
  return `${ASSET_SOURCE_BASE_URL.replace(/\/+$/, "")}/${storagePath.replace(/^\/+/, "")}`;
}

function normalizeAsset(row: AssetRow): NormalizedAsset {
  const mimeType = row.mime_type ?? mimeFromPath(row.storage_path);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title || basename(row.storage_path ?? "untitled asset"),
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    mimeType,
    storagePath: row.storage_path,
    mediaUrl: mediaUrl(row.storage_path),
    coverImageUrl: row.cover_image_url,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
  };
}

function titleTokens(title: string): string[] {
  return title
    .replace(/\.[^.]+$/, "")
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

function uniqueTags(values: string[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const normalized = String(value).toLowerCase().replace(/[^a-z0-9 -]+/g, "").trim();
    if (normalized.length >= 2) tags.add(normalized);
    if (tags.size >= 20) break;
  }
  return [...tags];
}

function uniquePhrases(values: string[]): string[] {
  const phrases = new Set<string>();
  for (const value of values) {
    const normalized = String(value).replace(/\s+/g, " ").trim();
    if (normalized) phrases.add(normalized);
    if (phrases.size >= 20) break;
  }
  return [...phrases];
}

function mockAnalyze(asset: NormalizedAsset): AnalysisResult {
  const kind = mimeKind(asset.mimeType);
  const tokens = titleTokens(asset.title);
  const dimensionTag = asset.width && asset.height ? `${asset.width}x${asset.height}` : null;
  const tags = uniqueTags([
    kind,
    ...tokens,
    ...asset.tags,
    ...(dimensionTag ? [dimensionTag] : []),
    ...(asset.projectId ? ["project asset"] : []),
  ]);

  return {
    description: `${asset.title} is a ${kind} asset${asset.mimeType ? ` (${asset.mimeType})` : ""} prepared for DAM search enrichment.`,
    tags,
    ai_metadata: {
      asset_type: kind,
      search_phrases: uniquePhrases([
        `${asset.title.replace(/\.[^.]+$/, "")} ${kind}`,
        tokens.join(" "),
        asset.description ?? "",
        `${kind} asset`,
      ]),
      detected_text: [],
      dominant_subjects: tokens.slice(0, 5),
      visual_style: [],
      colors: [],
      confidence: 0.35,
      model: "mock",
      provider: "mock",
    },
  };
}

function analysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      ai_metadata: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_type: { type: "string" },
          search_phrases: { type: "array", items: { type: "string" } },
          detected_text: { type: "array", items: { type: "string" } },
          dominant_subjects: { type: "array", items: { type: "string" } },
          visual_style: { type: "array", items: { type: "string" } },
          colors: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          model: { type: "string" },
          provider: { type: "string" }
        },
        required: ["asset_type", "search_phrases", "detected_text", "dominant_subjects", "visual_style", "colors", "confidence", "model", "provider"]
      }
    },
    required: ["description", "tags", "ai_metadata"]
  };
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr}`));
    });
  });
}

async function imageDataUrlFromFile(path: string, mimeType: string): Promise<string> {
  const bytes = await readFile(path);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function imageDataUrlFromUrl(url: string, fallbackMimeType = "image/jpeg"): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download model image input: ${res.status} ${await res.text()}`);
  const contentType = res.headers.get("content-type")?.split(";")[0] || fallbackMimeType;
  const bytes = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function videoDurationSeconds(source: string): Promise<number | null> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      source,
    ], FFPROBE_TIMEOUT_MS);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch (error) {
    console.warn("[asset-intelligence-worker] ffprobe failed; using metadata-only fallback", error);
    return null;
  }
}

function videoSampleTimes(durationSeconds: number | null): number[] {
  const maxFrames = Math.max(1, Math.min(10, MAX_VIDEO_FRAMES));
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [1, 5, 10].slice(0, Math.min(3, maxFrames));
  const ratios = durationSeconds <= 5 ? [0.15, 0.5, 0.85] : durationSeconds <= 60 ? [0.08, 0.25, 0.5, 0.75, 0.92] : [0.04, 0.15, 0.32, 0.5, 0.68, 0.85, 0.96];
  return [...new Set(ratios.slice(0, maxFrames).map((ratio) => Number(Math.min(durationSeconds - 0.1, Math.max(0.1, durationSeconds * ratio)).toFixed(3))))];
}

async function videoFrameDataUrls(source: string): Promise<string[]> {
  const duration = await videoDurationSeconds(source);
  const sampleTimes = videoSampleTimes(duration);
  const workDir = await mkdtemp(join(tmpdir(), "reloops-asset-ai-"));
  try {
    const dataUrls: string[] = [];
    for (let index = 0; index < sampleTimes.length; index += 1) {
      const outputPath = join(workDir, `frame-${index}.jpg`);
      await runCommand("ffmpeg", [
        "-y",
        "-ss", String(sampleTimes[index]),
        "-i", source,
        "-frames:v", "1",
        "-vf", `scale=w=${VIDEO_FRAME_WIDTH}:h=${VIDEO_FRAME_WIDTH}:force_original_aspect_ratio=decrease`,
        "-q:v", "4",
        outputPath,
      ], FFMPEG_TIMEOUT_MS);
      dataUrls.push(await imageDataUrlFromFile(outputPath, "image/jpeg"));
    }
    return dataUrls;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function imageInputsFor(asset: NormalizedAsset): Promise<Array<{ type: "input_image"; image_url: string }>> {
  if (mimeKind(asset.mimeType) === "video" && asset.mediaUrl) {
    try {
      return (await videoFrameDataUrls(asset.mediaUrl)).map((image_url) => ({ type: "input_image", image_url }));
    } catch (error) {
      console.warn("[asset-intelligence-worker] video frame extraction failed; using cover image or metadata-only fallback", error);
    }
  }
  if (mimeKind(asset.mimeType) === "image" && asset.mediaUrl) return [{ type: "input_image", image_url: asset.mediaUrl }];
  if (asset.coverImageUrl) return [{ type: "input_image", image_url: await imageDataUrlFromUrl(asset.coverImageUrl) }];
  return [];
}

async function openAiAnalyze(asset: NormalizedAsset): Promise<AnalysisResult> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required when ASSET_AI_PROVIDER=openai");

  const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [{
    type: "input_text",
    text: [
      "Generate concise DAM metadata for semantic search.",
      "If video frames are provided, infer the asset from the sequence.",
      "Do not invent brand names, people, or visible text.",
      "Keep tags useful for creative operations search.",
      `Asset: ${JSON.stringify(asset)}`,
    ].join("\n"),
  }];
  content.push(...await imageInputsFor(asset));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ASSET_AI_MODEL,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "asset_intelligence",
            strict: true,
            schema: analysisSchema(),
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI analysis failed: ${res.status} ${await res.text()}`);
    const payload = await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OpenAI response did not include output_text");
    const parsed = JSON.parse(outputText) as AnalysisResult;
    return {
      ...parsed,
      tags: uniqueTags(parsed.tags ?? []),
      ai_metadata: {
        ...parsed.ai_metadata,
        model: ASSET_AI_MODEL,
        provider: "openai",
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`OpenAI analysis timed out after ${OPENAI_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyze(asset: NormalizedAsset): Promise<AnalysisResult> {
  if (ASSET_AI_PROVIDER === "openai") return await openAiAnalyze(asset);
  return mockAnalyze(asset);
}

async function processJob(job: DbJob) {
  try {
    const asset = normalizeAsset(await fetchAsset(job.asset_id));
    const result = await analyze(asset);
    await writeAssetMetadata(asset.id, result);
    await writeAssetHistory(asset, result);
    await notifyIntelligenceCompleted(asset, result).catch((notifyError) => {
      console.warn("[asset-intelligence-worker] completion notification failed", notifyError);
    });
    await patchJob(job.id, {
      status: "completed",
      result,
      error: null,
      completed_at: new Date().toISOString(),
      lease_expires_at: null,
    });
    console.log(`[asset-intelligence-worker] completed job=${job.id} asset=${asset.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const terminal = job.attempts >= job.max_attempts;
    if (terminal) {
      await notifyIntelligenceFailed(job, message).catch((notifyError) => {
        console.warn("[asset-intelligence-worker] failure notification failed", notifyError);
      });
    }
    await patchJob(job.id, {
      status: terminal ? "failed" : "queued",
      error: message,
      lease_expires_at: null,
      ...(terminal ? { completed_at: new Date().toISOString() } : {}),
    });
    console.error(`[asset-intelligence-worker] ${terminal ? "failed" : "requeued"} job=${job.id}`, error);
  }
}

async function poll() {
  if (shuttingDown) return;
  while (!shuttingDown && activeJobs < MAX_CONCURRENT_JOBS) {
    const job = await claimJob();
    if (!job) return;
    activeJobs += 1;
    void processJob(job).finally(() => {
      activeJobs -= 1;
      void poll();
    });
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

requireConfig();
console.log(`[asset-intelligence-worker] polling provider=${ASSET_AI_PROVIDER} model=${ASSET_AI_MODEL} worker=${WORKER_ID}`);
void poll();
setInterval(() => {
  void poll().catch((error) => {
    console.error("[asset-intelligence-worker] poll failed", error);
  });
}, POLL_INTERVAL_MS);

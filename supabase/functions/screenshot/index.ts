import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, isWorkspaceMember, readBody, requireUser } from "../_shared/admin.ts";

const SCREENSHOTONE_ACCESS_KEY = Deno.env.get("SCREENSHOTONE_ACCESS_KEY") ?? "";
const WEBSITE_REVIEW_TAG = "website-review";

const bad = (message: string, status = 400) => json({ error: message }, { status });

function normalizeTextArray(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeWebsiteUrl(rawUrl: unknown) {
  const input = String(rawUrl ?? "").trim();
  if (!input) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null;

    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function contentTypeFromUrlExtension(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".gif")) return "image/gif";
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  } catch {
    return null;
  }
  return null;
}

function contentTypeFromImageBytes(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (view.length >= 8 && view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return "image/png";
  if (view.length >= 6) {
    const header = new TextDecoder().decode(view.slice(0, 6));
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (view.length >= 12) {
    const riff = new TextDecoder().decode(view.slice(0, 4));
    const webp = new TextDecoder().decode(view.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  return null;
}

function normalizeScreenshotContentType(rawContentType: string | null, sourceUrl: string, bytes: ArrayBuffer) {
  const normalized = String(rawContentType ?? "").trim().toLowerCase().split(";")[0];
  if (normalized.startsWith("image/")) return normalized;
  return contentTypeFromUrlExtension(sourceUrl) ?? contentTypeFromImageBytes(bytes) ?? "image/jpeg";
}

async function resolveProjectIdForWorkspace(projectId: unknown, workspaceId: string) {
  const normalizedProjectId = String(projectId ?? "").trim();
  if (!normalizedProjectId) return { projectId: null as string | null, error: null as string | null };

  const { data, error } = await admin
    .from("projects")
    .select("id, status")
    .eq("id", normalizedProjectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("Failed to validate screenshot project", { projectId: normalizedProjectId, workspaceId, error });
    return { projectId: null, error: "Failed to validate project" };
  }

  if (!data || data.status === "deleted") {
    return { projectId: null, error: "projectId must belong to the workspace" };
  }

  return { projectId: String(data.id), error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const workspaceId = String(body.workspaceId ?? body.workspace_id ?? "").trim();

    if (!body.url || !workspaceId) return bad("url and workspaceId are required");

    const websiteUrl = normalizeWebsiteUrl(body.url);
    if (!websiteUrl) return bad("Enter a valid website URL");

    if (!await isWorkspaceMember(workspaceId, user.id)) return bad("Not a member of this workspace", 403);

    const projectResolution = await resolveProjectIdForWorkspace(body.projectId ?? body.project_id, workspaceId);
    if (projectResolution.error) {
      return bad(projectResolution.error, projectResolution.error.startsWith("Failed") ? 500 : 400);
    }

    if (!SCREENSHOTONE_ACCESS_KEY) return bad("ScreenshotOne API key not configured", 500);

    const screenshotUrl = new URL("https://api.screenshotone.com/take");
    screenshotUrl.searchParams.set("access_key", SCREENSHOTONE_ACCESS_KEY);
    screenshotUrl.searchParams.set("url", websiteUrl.href);
    screenshotUrl.searchParams.set("full_page", "true");
    screenshotUrl.searchParams.set("response_type", "json");
    screenshotUrl.searchParams.set("full_page_algorithm", "by_sections");
    screenshotUrl.searchParams.set("block_chats", "true");
    screenshotUrl.searchParams.set("block_ads", "true");
    screenshotUrl.searchParams.set("block_cookie_banners", "true");

    const screenshotResponse = await fetch(screenshotUrl.toString());
    if (!screenshotResponse.ok) {
      console.error("ScreenshotOne error:", await screenshotResponse.text());
      return bad("Failed to capture screenshot", 502);
    }

    const screenshotData = await screenshotResponse.json();
    const screenshotImageUrl = typeof screenshotData?.screenshot_url === "string" ? screenshotData.screenshot_url : null;
    if (!screenshotImageUrl) {
      console.error("ScreenshotOne returned no screenshot_url:", screenshotData);
      return bad("Screenshot service did not return an image URL", 502);
    }

    const imageResponse = await fetch(screenshotImageUrl);
    if (!imageResponse.ok) {
      console.error("Screenshot image download error:", await imageResponse.text());
      return bad("Failed to download screenshot image", 502);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = normalizeScreenshotContentType(imageResponse.headers.get("content-type"), screenshotImageUrl, imageBuffer);
    const extension = extensionFromContentType(contentType);
    const capturedAt = new Date().toISOString();
    const hostname = websiteUrl.hostname.toLowerCase();
    const displayHost = hostname.replace(/^www\./i, "");
    const assetTitle = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `Screenshot: ${displayHost}`;
    const tags = normalizeTextArray([WEBSITE_REVIEW_TAG, "website", displayHost]);
    const smartTags = normalizeTextArray(["website review", "full-page screenshot", "web page", displayHost]);
    const aiMetadata = {
      asset_type: "website_review",
      category: "website",
      workflow: "review",
      workflow_status: "needs_review",
      review_type: "website",
      source: "website_review",
      source_url: websiteUrl.href,
      website_url: websiteUrl.href,
      website: {
        url: websiteUrl.href,
        origin: websiteUrl.origin,
        hostname,
        path: `${websiteUrl.pathname}${websiteUrl.search}`,
      },
      capture: {
        provider: "screenshotone",
        captured_at: capturedAt,
        full_page: true,
        algorithm: "by_sections",
      },
    };

    const assetId = crypto.randomUUID();
    const objectKey = `${workspaceId}/${projectResolution.projectId ?? "library"}/${assetId}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from("assets")
      .upload(objectKey, new Uint8Array(imageBuffer), {
        contentType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Screenshot upload error:", uploadError);
      return bad("Failed to store screenshot image", 500);
    }

    const { data: publicUrlData } = admin.storage.from("assets").getPublicUrl(objectKey);
    const coverImageUrl = publicUrlData?.publicUrl ?? null;

    const { data: asset, error: assetError } = await admin
      .from("assets")
      .insert({
        id: assetId,
        workspace_id: workspaceId,
        project_id: projectResolution.projectId,
        title: assetTitle,
        description: `Website review capture for ${websiteUrl.href}`,
        tags,
        smart_tags: smartTags,
        smart_description: `Full-page website screenshot captured from ${websiteUrl.href}`,
        ai_metadata: aiMetadata,
        storage_path: objectKey,
        cover_image_url: coverImageUrl,
        mime_type: contentType,
        size_bytes: imageBuffer.byteLength,
        uploaded_by: user.id,
        status: "needs_review",
      })
      .select("id, workspace_id, project_id")
      .single();

    if (assetError) {
      console.error("Screenshot asset creation error:", assetError);
      await admin.storage.from("assets").remove([objectKey]);
      return bad("Failed to create asset record", 500);
    }

    const { error: historyError } = await admin.from("asset_history").insert({
      asset_id: asset.id,
      workspace_id: asset.workspace_id,
      project_id: asset.project_id ?? null,
      event_type: "website_review_created",
      actor_user_id: user.id,
      actor_api_key_id: null,
      metadata: {
        title: assetTitle,
        status: "needs_review",
        tags,
        smart_tags: smartTags,
        ai_metadata: aiMetadata,
      },
    });

    if (historyError) {
      console.error("Failed to write website review history:", historyError);
    }

    return json({ assetId: asset.id, data: { asset } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Screenshot function error:", error);
    return bad(error instanceof Error ? error.message : "Server error", 500);
  }
});

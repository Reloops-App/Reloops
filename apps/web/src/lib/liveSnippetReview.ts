// "Snippet" flavour of a live-url-review asset. Instead of re-serving the site
// through live-url-proxy inside an iframe, the site owner pastes one script tag
// into their own <head>; the review widget then runs on the real page.
//
// A snippet asset keeps asset_type "live-url-review" (so cards, media delivery
// and kanban keep treating it as a live page) and adds review_mode "snippet".
// Only the viewer branch differs. Proxy assets never carry review_mode, so
// everything here is inert for them.
//
// The snippet token is the id of a share_links row: the existing `comment`
// edge function already accepts that as `share_token`, so the widget needs no
// new comment backend.

import { isLiveUrlReviewAsset, type LiveUrlReviewAssetLike } from "./liveUrlReview.ts";

export type LiveSnippetReviewInfo = {
  url: string;
  origin: string;
  hostname: string;
  path: string;
  token: string;
};

// Stored on the first stroke of a comment's drawing_json. Anchoring to a CSS
// selector plus an offset inside that element survives reflow, unlike the
// document fractions the proxy viewer stores.
export type SnippetAnchor = {
  v: number;
  pageUrl: string;
  selector: string;
  offset: { x: number; y: number };
  tag?: string;
  // Which device preset the comment was made on ("responsive" = Desktop). Only that device's pins
  // are drawn, because the page reflows between devices.
  viewportId?: string;
  text?: string;
  viewport?: { width: number; height: number };
  scroll?: { x: number; y: number };
};

export const SNIPPET_ACTIVATION_KEY = "reloops-review:activation";
const HASH_TOKEN_PARAM = "reloops-review";
const HASH_COMMENT_PARAM = "reloops-comment";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMetadata(asset?: LiveUrlReviewAssetLike | null): Record<string, unknown> | null {
  const metadata = asset?.ai_metadata ?? asset?.metadata ?? null;
  return isRecord(metadata) ? metadata : null;
}

export function isLiveSnippetReviewAsset(asset?: LiveUrlReviewAssetLike | null): boolean {
  if (!isLiveUrlReviewAsset(asset)) return false;
  return readMetadata(asset)?.review_mode === "snippet";
}

export function getLiveSnippetReviewInfo(asset?: LiveUrlReviewAssetLike | null): LiveSnippetReviewInfo | null {
  if (!isLiveSnippetReviewAsset(asset)) return null;
  const metadata = readMetadata(asset)!;
  const website = metadata.website;
  const snippet = metadata.snippet;
  if (!isRecord(website) || !isRecord(snippet)) return null;

  const token = snippet.token;
  const { url, origin, hostname, path } = website;
  if (typeof token !== "string" || !token) return null;
  if (typeof url !== "string" || typeof origin !== "string" || typeof hostname !== "string" || typeof path !== "string") {
    return null;
  }
  return { url, origin, hostname, path, token };
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSnippetTag({ scriptUrl, token, assetId }: { scriptUrl: string; token: string; assetId: string }): string {
  return `<script async src="${escapeAttr(scriptUrl)}" data-reloops-token="${escapeAttr(token)}" data-reloops-asset="${escapeAttr(assetId)}"></script>`;
}

// The token goes in the hash so it is never sent to the reviewed site's server.
export function buildSnippetReviewLink(pageUrl: string, token: string, commentId?: string | null): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return pageUrl;
  }
  const params = new URLSearchParams({ [HASH_TOKEN_PARAM]: token });
  if (commentId) params.set(HASH_COMMENT_PARAM, commentId);
  url.hash = params.toString();
  return url.toString();
}

export function parseSnippetActivation(
  hash: string,
  search: string
): { token: string; commentId: string | null } | null {
  const sources = [hash.replace(/^#/, ""), search.replace(/^\?/, "")];
  for (const source of sources) {
    if (!source) continue;
    const params = new URLSearchParams(source);
    const token = params.get(HASH_TOKEN_PARAM);
    if (token) return { token, commentId: params.get(HASH_COMMENT_PARAM) || null };
  }
  return null;
}

export function getSnippetAnchor(drawing: unknown): SnippetAnchor | null {
  if (!Array.isArray(drawing)) return null;
  const first = drawing[0];
  if (!isRecord(first) || !isRecord(first.snippet)) return null;
  const { v, pageUrl, selector, offset } = first.snippet;
  if (typeof pageUrl !== "string" || typeof selector !== "string" || !selector) return null;
  if (!isRecord(offset) || typeof offset.x !== "number" || typeof offset.y !== "number") return null;
  return { ...(first.snippet as Record<string, unknown>), v: typeof v === "number" ? v : 1 } as SnippetAnchor;
}

// ---- Embedded mode ----------------------------------------------------------
// The review page loads the real site directly in an iframe (no proxy). The
// snippet inside that page detects the embed flag and, instead of drawing its
// own toolbar, talks to the app over postMessage: the app owns Browse/Comment,
// persistence and the logged-in identity; the widget owns picking elements and
// drawing pins/cards on the real page.

export const WIDGET_MESSAGE_SOURCE = "reloops-review-widget";
export const HOST_MESSAGE_SOURCE = "reloops-review-host";
const HASH_EMBED_PARAM = "reloops-embed";

export type WidgetComment = {
  id: string;
  body: string;
  guest_name?: string | null;
  // Same id the rest of the app uses to pick a person's avatar color.
  author_id?: string | null;
  status: "active" | "completed" | "deleted";
  created_at: string;
  drawing_json?: unknown;
};

export function buildSnippetEmbedUrl(pageUrl: string, token: string, commentId?: string | null): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return pageUrl;
  }
  const params = new URLSearchParams({ [HASH_TOKEN_PARAM]: token, [HASH_EMBED_PARAM]: "1" });
  if (commentId) params.set(HASH_COMMENT_PARAM, commentId);
  url.hash = params.toString();
  return url.toString();
}

export function isEmbedRequested(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, "")).get(HASH_EMBED_PARAM) === "1";
}

type AnnotationLike = {
  id: string;
  text?: string;
  author?: string;
  authorId?: string;
  isCompleted?: boolean;
  isDeleted?: boolean;
  createdAt?: string;
  drawing?: unknown;
};

export function toWidgetComment(annotation: AnnotationLike): WidgetComment {
  return {
    id: annotation.id,
    body: annotation.text ?? "",
    guest_name: annotation.author ?? null,
    author_id: annotation.authorId ?? null,
    status: annotation.isDeleted ? "deleted" : annotation.isCompleted ? "completed" : "active",
    created_at: annotation.createdAt ?? "",
    drawing_json: annotation.drawing,
  };
}

// ---- Mirror mode -------------------------------------------------------------
// The site is served through the review proxy on its own subdomain
// (https://<asset-id>.<proxy-host>/...), which strips the frame-blocking headers
// and injects the widget itself, so there is nothing to install on the site.

export type LiveMirrorReviewInfo = { url: string; origin: string; hostname: string; path: string };

export function isLiveMirrorReviewAsset(asset?: LiveUrlReviewAssetLike | null): boolean {
  if (!isLiveUrlReviewAsset(asset)) return false;
  return readMetadata(asset)?.review_mode === "mirror";
}

// Snippet and mirror assets share the in-canvas embedded viewer.
export function isLiveEmbeddedReviewAsset(asset?: LiveUrlReviewAssetLike | null): boolean {
  return isLiveSnippetReviewAsset(asset) || isLiveMirrorReviewAsset(asset);
}

export function getLiveMirrorReviewInfo(asset?: LiveUrlReviewAssetLike | null): LiveMirrorReviewInfo | null {
  if (!isLiveMirrorReviewAsset(asset)) return null;
  const website = readMetadata(asset)!.website;
  if (!isRecord(website)) return null;
  const { url, origin, hostname, path } = website;
  if (typeof url !== "string" || typeof origin !== "string" || typeof hostname !== "string" || typeof path !== "string") return null;
  return { url, origin, hostname, path };
}

// proxyBase is the proxy's own origin, e.g. "https://proxy.reloops.app" or "http://localhost:8787".
export function buildMirrorFrameUrl(proxyBase: string, assetId: string, pageUrl: string, commentId?: string | null): string {
  const base = new URL(proxyBase);
  let path = "/";
  try {
    const page = new URL(pageUrl);
    path = `${page.pathname}${page.search}`;
  } catch {
    /* fall back to the site root */
  }
  const hash = commentId ? `#${HASH_COMMENT_PARAM}=${encodeURIComponent(commentId)}` : "";
  return `${base.protocol}//${assetId}.${base.host}${path}${hash}`;
}

// Where to put a floating box (the comment composer) relative to a pin inside a frame: to the
// right and below by default, flipped left near the right edge, opened upward when there is
// room above, and always clamped into the frame. Same rules as the other live viewer's composer.
export function placeOverlay(input: {
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  width?: number;
  assumedHeight?: number;
  margin?: number;
}): { left: number; top: number; opensUpward: boolean } {
  const { x, y, frameWidth, frameHeight, width = 280, assumedHeight = 320, margin = 12 } = input;
  const opensLeft = x + margin + width > frameWidth;
  let left = opensLeft ? x - margin - width : x + margin;
  left = Math.min(Math.max(left, margin), Math.max(margin, frameWidth - width - margin));
  const opensUpward = y - assumedHeight > 0;
  let top = opensUpward ? y - margin : y + margin;
  top = Math.min(Math.max(top, margin), Math.max(margin, frameHeight - margin));
  return { left, top, opensUpward };
}

// Comments store mentions as "@[<user id>:<display name>]". Show them as "@Display Name".
export function plainMentions(text: string): string {
  return text.replace(/@\[[^:\]]+:([^\]]+)\]/g, "@$1");
}

// The page-fraction point saved with a comment: where to draw its pin when the element it was
// anchored to can no longer be found (dynamic pages, redesigns).
export function getSnippetFallbackPoint(drawing: unknown): { x: number; y: number } | null {
  if (!Array.isArray(drawing)) return null;
  const first = drawing[0];
  if (!isRecord(first) || !Array.isArray(first.points)) return null;
  const point = first.points[0];
  if (!isRecord(point) || typeof point.x !== "number" || typeof point.y !== "number") return null;
  return { x: point.x, y: point.y };
}

export function getAnchorViewportId(anchor: SnippetAnchor | null | undefined): string {
  return typeof anchor?.viewportId === "string" && anchor.viewportId ? anchor.viewportId : "responsive";
}

// A pinned comment stores its position as a one-point "anchor" stroke. That is not a drawing, so the
// panel must not label it one: only a stroke with an actual path counts.
export function hasRealDrawing(drawing: unknown): boolean {
  if (!Array.isArray(drawing)) return false;
  return drawing.some((stroke) => isRecord(stroke) && Array.isArray(stroke.points) && stroke.points.length > 1);
}

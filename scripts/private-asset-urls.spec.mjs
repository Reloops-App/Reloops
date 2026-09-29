import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The OSS `assets` bucket is private (members-only storage policy), so the public
// object route 400s. Owner-side views and downloads must use signed URLs instead.
const read = (path) => readFileSync(path, "utf8");
const web = (path) => read(`apps/web/src/${path}`);

test("public assets-bucket URLs are recognised and mapped back to their storage path", async () => {
  const { storagePathFromPublicAssetUrl } = await import("../apps/web/src/lib/privateAssetUrl.ts");
  const base = "http://127.0.0.1:56321/storage/v1/object/public/assets/";
  assert.equal(storagePathFromPublicAssetUrl(`${base}ws/proj/file.png`, base), "ws/proj/file.png");
  assert.equal(storagePathFromPublicAssetUrl("http://127.0.0.1:56321/storage/v1/object/public/assets//ws/a.png", base), "ws/a.png", "double slash from base + /path");
  assert.equal(storagePathFromPublicAssetUrl(`${base}ws/My%20File.png`, base), "ws/My File.png", "percent-encoded paths are decoded");
  assert.equal(storagePathFromPublicAssetUrl(`${base}ws/a.png`, base.slice(0, -1)), "ws/a.png", "base without trailing slash");
  assert.equal(storagePathFromPublicAssetUrl("http://127.0.0.1:56321/storage/v1/object/sign/assets/ws/a.png?token=x", base), null, "already signed");
  assert.equal(storagePathFromPublicAssetUrl("http://127.0.0.1:56321/storage/v1/object/public/thumbnails/ws/a.jpg", base), null, "public buckets stay public");
  assert.equal(storagePathFromPublicAssetUrl("blob:http://127.0.0.1:6173/x", base), null);
  assert.equal(storagePathFromPublicAssetUrl("", base), null);
  assert.equal(storagePathFromPublicAssetUrl(`${base}ws/a.png`, ""), null, "no base configured");
});

test("downloadFile signs private asset URLs before fetching, so every owner download works", () => {
  const utils = web("lib/utils.ts");
  // every candidate (the URL and cloud's optional fallbackUrl) is signed before it is fetched
  assert.match(utils, /const sourceUrl = await resolveAssetFileUrl\(candidate\)/);
  assert.match(utils, /for \(const candidate of candidates\)/);
});

test("zip downloads sign each file before fetching", () => {
  assert.match(web("lib/zip.ts"), /await resolveAssetFileUrl\(/);
  assert.match(web("lib/downloadArchive.ts"), /fetch\(withDownloadHint\(await resolveAssetFileUrl\(entry\.url\)\)/, "project/search bulk zip");
});

test("the owner review page shows the original through a signed URL (image, video, PDF, web capture)", () => {
  const review = web("pages/Review/ReviewAsset.tsx");
  assert.match(review, /const reviewImageUrl = useResolvedAssetFileUrl\(/);
});

test("version compare and transparent-original previews resolve signed URLs", () => {
  assert.match(web("pages/Review/CompareVersionsPage.tsx"), /await resolveAssetFileUrl\(/);
  for (const file of ["pages/Campaign/components/AssetCard.tsx", "components/versions/VersionsStackCard.tsx"]) {
    assert.match(web(file), /useResolvedAssetFileUrl\(transparentOriginalPreviewUrl\(asset\)\)/, file);
  }
});

test("collection guests download through the server-signed file URL", () => {
  const page = web("pages/Review/ShareCollectionAsset.tsx");
  assert.doesNotMatch(page, /const downloadUrl = `\$\{import\.meta\.env\.VITE_ASSET_PUBLIC_BASE_URL\}\$\{storagePath\}`/);
  assert.match(page, /downloadFile\(reviewAssetUrl, /);
});

test("the asset-intelligence worker reads originals with a service-role signed URL", () => {
  const worker = read("apps/asset-intelligence-worker/src/index.ts");
  assert.match(worker, /\/storage\/v1\/object\/sign\/assets\//);
  assert.match(worker, /asset\.mediaUrl = \(await signedMediaUrl\(row\.storage_path\)\) \?\? asset\.mediaUrl/);
});

test("guest portal cards carry the server-signed URL so downloads work without a login", () => {
  const portal = web("pages/Review/ShareProject.tsx");
  assert.match(portal, /signed_url: a\.signed_url \?\? undefined/);
});

test("the private-URL resolver only signs for a logged-in member (guests already get server-signed URLs)", () => {
  const resolver = web("lib/assetFileUrl.ts");
  assert.match(resolver, /await supabase\.auth\.getSession\(\)/);
});

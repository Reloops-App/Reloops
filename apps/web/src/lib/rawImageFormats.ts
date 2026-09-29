/**
 * Camera RAW image formats. Browsers can't decode these and most send an
 * empty `File.type` for them, so upload stores `application/octet-stream`;
 * the extension is the reliable signal.
 *
 * Kept dependency-free (no `@/` imports) so it can be unit-tested directly
 * under the plain Node test runner and copied verbatim to every consumer.
 * Identical copies live at:
 *   - apps/web/src/lib/rawImageFormats.ts (this file, source of truth)
 *   - supabase/shared/rawImageFormats.ts
 *   - apps/thumbnail-worker/src/rawImageFormats.ts
 *   - apps/asset-intelligence-worker/src/rawImageFormats.ts
 * supabase/tests/rawImageFormats.parity.test.ts fails if they drift.
 */

// extension (no dot) -> canonical mime type used when the browser sent none.
export const RAW_EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  crw: "image/x-canon-crw",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  arw: "image/x-sony-arw",
  srf: "image/x-sony-srf",
  sr2: "image/x-sony-sr2",
  dng: "image/x-adobe-dng",
  orf: "image/x-olympus-orf",
  rw2: "image/x-panasonic-rw2",
  raf: "image/x-fuji-raf",
  pef: "image/x-pentax-pef",
  srw: "image/x-samsung-srw",
  x3f: "image/x-sigma-x3f",
  "3fr": "image/x-hasselblad-3fr",
  fff: "image/x-hasselblad-fff",
  erf: "image/x-epson-erf",
  kdc: "image/x-kodak-kdc",
  dcr: "image/x-kodak-dcr",
  mrw: "image/x-minolta-mrw",
  rwl: "image/x-leica-rwl",
  iiq: "image/x-phaseone-iiq",
  mef: "image/x-mamiya-mef",
  mos: "image/x-leaf-mos",
};

// Extensions with a leading dot, e.g. ".cr2".
export const RAW_IMAGE_EXTENSIONS: readonly string[] = Object.keys(RAW_EXTENSION_MIME_TYPES).map((ext) => `.${ext}`);

export const RAW_IMAGE_MIME_RE =
  /^image\/(?:x-)?(?:canon|nikon|sony|olympus|panasonic|fuji|pentax|samsung|sigma|hasselblad|epson|kodak|minolta|leica|phaseone|mamiya|leaf|adobe-dng|dcraw|dng|raw)/;

export function isRawImageMime(mimeType: string | null | undefined): boolean {
  return RAW_IMAGE_MIME_RE.test(String(mimeType ?? "").trim().toLowerCase());
}

/** Extension (no dot, lowercased) of a file name / path / URL, or "" if none. */
export function fileExtensionOf(nameOrPath: string | null | undefined): string {
  const clean = String(nameOrPath ?? "").split(/[?#]/)[0].toLowerCase();
  const match = /\.([a-z0-9]+)$/.exec(clean);
  return match ? match[1] : "";
}

export function isRawImageFileName(nameOrPath: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(RAW_EXTENSION_MIME_TYPES, fileExtensionOf(nameOrPath));
}

/** Canonical mime for a RAW file name, or null when it isn't a RAW extension. */
export function rawMimeTypeFromFileName(nameOrPath: string | null | undefined): string | null {
  const ext = fileExtensionOf(nameOrPath);
  return Object.prototype.hasOwnProperty.call(RAW_EXTENSION_MIME_TYPES, ext) ? RAW_EXTENSION_MIME_TYPES[ext] : null;
}

export type RawAssetRecord = {
  mime_type: string | null;
  storage_path?: string | null;
  title?: string | null;
};

// Mime types under which a RAW file may still arrive: none/generic (browsers send
// no type for RAW), or TIFF (DNG and several vendor RAWs are TIFF containers and
// get sniffed as image/tiff).
const GENERIC_OR_SNIFFED_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "image/tiff",
  "image/x-tiff",
]);

// upload-b2 appends `_<nonce>` straight onto the sanitised file name, so a real
// storage_path looks like ".../IMG_1.CR2_1699999999999" and never ends in ".cr2".
function stripUploadNonce(path: string): string {
  return path.split(/[?#]/)[0].replace(/(\.[a-z0-9]+)_[\w-]+$/i, "$1");
}

/** True for a DB asset row that is a camera RAW file (workers and edge functions). */
export function isRawAssetRecord(asset: RawAssetRecord): boolean {
  const mime = String(asset.mime_type ?? "").trim().toLowerCase().split(";")[0] ?? "";
  if (isRawImageMime(mime)) return true;
  if (!GENERIC_OR_SNIFFED_MIME_TYPES.has(mime)) return false;
  if (isRawImageFileName(asset.title)) return true;
  return asset.storage_path ? isRawImageFileName(stripUploadNonce(asset.storage_path)) : false;
}

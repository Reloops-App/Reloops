import { RAW_IMAGE_EXTENSIONS, isRawImageMime } from "./rawImageFormats.ts";
import { rawPreviewFromAiMetadata, type RawPreviewInfo } from "./rawPreview.ts";

export type AssetFileLike = {
  mime_type?: string | null;
  type?: string | null;
  name?: string | null;
  title?: string | null;
  url?: string | null;
  storage_path?: string | null;
  ai_metadata?: unknown;
};

const AI_MIME_TYPES = new Set([
  "application/illustrator",
  "application/postscript",
  "application/vnd.adobe.illustrator",
]);

const UNSUPPORTED_BROWSER_IMAGE_PREVIEW_MIME_LABELS = new Map<string, string>([
  ["image/tiff", "TIFF"],
  ["image/x-tiff", "TIFF"],
  ["image/heic", "HEIC"],
  ["image/heic-sequence", "HEIC"],
  ["image/heif", "HEIF"],
  ["image/heif-sequence", "HEIF"],
  ["image/vnd.adobe.photoshop", "PSD"],
  ["application/vnd.adobe.photoshop", "PSD"],
  ["image/jp2", "JPEG 2000"],
  ["image/jpx", "JPEG 2000"],
  ["image/jpm", "JPEG 2000"],
  ["image/j2k", "JPEG 2000"],
  ["image/jxl", "JPEG XL"],
  ["image/x-tga", "TGA"],
  ["image/x-exr", "EXR"],
  ["application/x-exr", "EXR"],
  ["image/vnd.radiance", "HDR"],
  ["image/x-hdr", "HDR"],
]);

const UNSUPPORTED_BROWSER_IMAGE_PREVIEW_EXTENSION_LABELS = new Map<string, string>([
  [".tif", "TIFF"],
  [".tiff", "TIFF"],
  [".heic", "HEIC"],
  [".heif", "HEIF"],
  ...RAW_IMAGE_EXTENSIONS.map((extension): [string, string] => [extension, "RAW"]),
  [".psd", "PSD"],
  [".psb", "PSB"],
  [".jp2", "JPEG 2000"],
  [".j2k", "JPEG 2000"],
  [".jxl", "JPEG XL"],
  [".tga", "TGA"],
  [".exr", "EXR"],
  [".hdr", "HDR"],
]);

function normalizeMimeType(asset?: AssetFileLike | null) {
  return String(asset?.mime_type ?? asset?.type ?? "")
    .trim()
    .toLowerCase();
}

// Checked in this priority order, but as a LIST (not a `??` chain) -- a
// caller can pass `storage_path: asset.storage_path || ""`, which is a
// non-nullish empty string, so a `??` chain would stop there and never look
// at name/title. Real storage_path values also don't reliably end in the
// file's extension: upload-b2's buildKey() appends a `_<nonce>` suffix
// directly onto the sanitized filename (see
// supabase/functions/upload-b2/index.ts), so a real key looks like
// ".../assets.zip_1699999999999" and never matches `.endsWith(".zip")` --
// checking every candidate (not just the first non-empty one) lets these
// checks fall through to name/title, which do have the clean extension.
function fileReferenceCandidates(asset?: AssetFileLike | null): string[] {
  return [asset?.storage_path, asset?.url, asset?.name, asset?.title]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
}

function hasFileExtension(asset: AssetFileLike | null | undefined, extension: string) {
  return fileReferenceCandidates(asset).some(
    (value) => value.endsWith(extension) || value.includes(`${extension}?`),
  );
}

function findValueByExtension<T>(asset: AssetFileLike | null | undefined, extensionValues: Map<string, T>): T | null {
  for (const candidate of fileReferenceCandidates(asset)) {
    for (const [extension, value] of extensionValues) {
      if (candidate.endsWith(extension) || candidate.includes(`${extension}?`)) return value;
    }
  }
  return null;
}

export function isSvgDesignAsset(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  return mimeType.includes("svg") || hasFileExtension(asset, ".svg");
}

export function isAiDesignAsset(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  // .eps files commonly share AI's application/postscript mime type -- defer
  // to the extension when present so a .eps isn't mislabeled "AI".
  if (hasFileExtension(asset, ".eps")) return false;
  return AI_MIME_TYPES.has(mimeType) || hasFileExtension(asset, ".ai");
}

export function isEpsDesignAsset(asset?: AssetFileLike | null) {
  return hasFileExtension(asset, ".eps");
}

export function isDesignPreviewUnavailableAsset(asset?: AssetFileLike | null) {
  return isSvgDesignAsset(asset) || isAiDesignAsset(asset);
}

export function getDesignAssetLabel(asset?: AssetFileLike | null) {
  if (isAiDesignAsset(asset)) return "AI";
  if (isSvgDesignAsset(asset)) return "SVG";
  return "Design";
}

export function getBrowserUnsupportedImagePreviewLabel(asset?: AssetFileLike | null) {
  const mimeType = normalizeMimeType(asset);
  const mimeLabel = UNSUPPORTED_BROWSER_IMAGE_PREVIEW_MIME_LABELS.get(mimeType);
  if (mimeLabel) return mimeLabel;
  if (isRawImageMime(mimeType)) return "RAW";

  return findValueByExtension(asset, UNSUPPORTED_BROWSER_IMAGE_PREVIEW_EXTENSION_LABELS);
}

export function isBrowserUnsupportedImagePreviewAsset(asset?: AssetFileLike | null) {
  return getBrowserUnsupportedImagePreviewLabel(asset) !== null;
}

export function isRawImageAsset(asset?: AssetFileLike | null) {
  return getBrowserUnsupportedImagePreviewLabel(asset) === "RAW";
}

export type { RawPreviewInfo };

/** "CR2 (RAW)" for a camera RAW file (falls back to plain "RAW"), null for anything else. */
export function getRawFormatLabel(asset?: AssetFileLike | null): string | null {
  if (!isRawImageAsset(asset)) return null;
  for (const candidate of fileReferenceCandidates(asset)) {
    // Strip upload-b2's `_<nonce>` suffix so ".cr2_1699999999999" still reads as ".cr2".
    const cleaned = candidate.split(/[?#]/)[0].replace(/(\.[a-z0-9]+)_[\w-]+$/i, "$1");
    const extension = RAW_IMAGE_EXTENSIONS.find((ext) => cleaned.endsWith(ext));
    if (extension) return `${extension.slice(1).toUpperCase()} (RAW)`;
  }
  return "RAW";
}

/**
 * Web-safe preview the thumbnail worker writes for camera RAW files at
 * `ai_metadata.raw_preview`. Null until the worker has run, or for anything
 * that isn't a RAW file.
 */
export function getRawPreviewInfo(asset?: AssetFileLike | null): RawPreviewInfo | null {
  if (!isRawImageAsset(asset)) return null;
  return rawPreviewFromAiMetadata(asset?.ai_metadata);
}

export type FileTypeKind =
  | "design"
  | "archive"
  | "document-word"
  | "document-spreadsheet"
  | "document-presentation"
  | "ebook"
  | "text";

export type FileTypeVisual = { kind: FileTypeKind; label: string };

const EXTENDED_DESIGN_MIME_LABELS = new Map<string, string>([
  ["application/x-indesign", "INDD"],
  ["application/x-figma", "FIG"],
  ["application/vnd.adobe.xd", "XD"],
  ["application/x-sketch", "SKETCH"],
]);

const EXTENDED_DESIGN_EXTENSION_LABELS = new Map<string, string>([
  [".indd", "INDD"],
  [".fig", "FIG"],
  [".xd", "XD"],
  [".sketch", "SKETCH"],
]);

export function getExtendedDesignFileLabel(asset?: AssetFileLike | null): string | null {
  const mimeType = normalizeMimeType(asset);
  const mimeLabel = EXTENDED_DESIGN_MIME_LABELS.get(mimeType);
  if (mimeLabel) return mimeLabel;

  return findValueByExtension(asset, EXTENDED_DESIGN_EXTENSION_LABELS);
}

const ARCHIVE_MIME_LABELS = new Map<string, string>([
  ["application/zip", "ZIP"],
  ["application/x-zip-compressed", "ZIP"],
  ["application/x-zip", "ZIP"],
  ["application/x-rar-compressed", "RAR"],
  ["application/vnd.rar", "RAR"],
  ["application/x-7z-compressed", "7Z"],
  ["application/x-tar", "TAR"],
]);

const ARCHIVE_EXTENSION_LABELS = new Map<string, string>([
  [".zip", "ZIP"],
  [".rar", "RAR"],
  [".7z", "7Z"],
  [".tar", "TAR"],
]);

export function getArchiveFileLabel(asset?: AssetFileLike | null): string | null {
  const mimeType = normalizeMimeType(asset);
  const mimeLabel = ARCHIVE_MIME_LABELS.get(mimeType);
  if (mimeLabel) return mimeLabel;

  return findValueByExtension(asset, ARCHIVE_EXTENSION_LABELS);
}

export function isArchiveFileAsset(asset?: AssetFileLike | null): boolean {
  return getArchiveFileLabel(asset) !== null;
}

const OFFICE_DOCUMENT_MIME_KIND = new Map<string, FileTypeKind>([
  ["application/msword", "document-word"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document-word"],
  ["application/rtf", "document-word"],
  ["application/vnd.oasis.opendocument.text", "document-word"],
  ["application/vnd.ms-excel", "document-spreadsheet"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document-spreadsheet"],
  ["application/vnd.oasis.opendocument.spreadsheet", "document-spreadsheet"],
  ["application/vnd.ms-powerpoint", "document-presentation"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "document-presentation"],
  ["application/vnd.oasis.opendocument.presentation", "document-presentation"],
  ["application/epub+zip", "ebook"],
]);

const OFFICE_DOCUMENT_EXTENSION_KIND = new Map<string, FileTypeKind>([
  [".doc", "document-word"],
  [".docx", "document-word"],
  [".rtf", "document-word"],
  [".odt", "document-word"],
  [".xls", "document-spreadsheet"],
  [".xlsx", "document-spreadsheet"],
  [".ods", "document-spreadsheet"],
  [".ppt", "document-presentation"],
  [".pptx", "document-presentation"],
  [".odp", "document-presentation"],
  [".epub", "ebook"],
]);

export function getOfficeDocumentKind(asset?: AssetFileLike | null): FileTypeKind | null {
  const mimeType = normalizeMimeType(asset);
  const mimeKind = OFFICE_DOCUMENT_MIME_KIND.get(mimeType);
  if (mimeKind) return mimeKind;

  return findValueByExtension(asset, OFFICE_DOCUMENT_EXTENSION_KIND);
}

export function isOfficeDocumentAsset(asset?: AssetFileLike | null): boolean {
  return getOfficeDocumentKind(asset) !== null;
}

const OFFICE_DOCUMENT_EXTENSION_LABELS = new Map<string, string>(
  Array.from(OFFICE_DOCUMENT_EXTENSION_KIND.keys()).map((extension) => [extension, extension.slice(1).toUpperCase()]),
);

export function getOfficeDocumentLabel(asset?: AssetFileLike | null): string | null {
  const extensionLabel = findValueByExtension(asset, OFFICE_DOCUMENT_EXTENSION_LABELS);
  if (extensionLabel) return extensionLabel;

  // No filename extension available -- fall back to a label derived from
  // the mime type's kind so a bare mime_type still gets a sensible label.
  const kind = getOfficeDocumentKind(asset);
  if (!kind) return null;
  for (const [extension, extKind] of OFFICE_DOCUMENT_EXTENSION_KIND) {
    if (extKind === kind) return extension.slice(1).toUpperCase();
  }
  return null;
}

export type TextFilePreviewInfo = { lang: string; label: string };

const TEXT_FILE_MIME_INFO = new Map<string, TextFilePreviewInfo>([
  ["application/json", { lang: "json", label: "JSON" }],
  ["text/markdown", { lang: "markdown", label: "MD" }],
  ["text/x-markdown", { lang: "markdown", label: "MD" }],
  ["text/yaml", { lang: "yaml", label: "YAML" }],
  ["application/yaml", { lang: "yaml", label: "YAML" }],
  ["application/x-yaml", { lang: "yaml", label: "YAML" }],
  ["text/xml", { lang: "xml", label: "XML" }],
  ["application/xml", { lang: "xml", label: "XML" }],
  ["text/x-ini", { lang: "ini", label: "INI" }],
  ["application/toml", { lang: "toml", label: "TOML" }],
  ["text/csv", { lang: "csv", label: "CSV" }],
  ["text/plain", { lang: "text", label: "TXT" }],
]);

const TEXT_FILE_EXTENSION_INFO = new Map<string, TextFilePreviewInfo>([
  [".json", { lang: "json", label: "JSON" }],
  [".md", { lang: "markdown", label: "MD" }],
  [".markdown", { lang: "markdown", label: "MD" }],
  [".yaml", { lang: "yaml", label: "YAML" }],
  [".yml", { lang: "yaml", label: "YAML" }],
  [".xml", { lang: "xml", label: "XML" }],
  [".ini", { lang: "ini", label: "INI" }],
  [".toml", { lang: "toml", label: "TOML" }],
  [".log", { lang: "log", label: "LOG" }],
  [".csv", { lang: "csv", label: "CSV" }],
  [".txt", { lang: "text", label: "TXT" }],
]);

/**
 * Plain-text/data formats that can be shown as a real read-only,
 * syntax-highlighted preview (see components/review/TextFileView.tsx),
 * rather than routed to the generic "preview not supported" card. Returns
 * the Shiki language id to highlight with, plus the display label.
 */
export function getTextFilePreviewInfo(asset?: AssetFileLike | null): TextFilePreviewInfo | null {
  const mimeType = normalizeMimeType(asset);
  const mimeInfo = TEXT_FILE_MIME_INFO.get(mimeType);
  if (mimeInfo) return mimeInfo;

  return findValueByExtension(asset, TEXT_FILE_EXTENSION_INFO);
}

/**
 * Single entry point for "what kind of file is this, and how should its
 * icon/label look" -- covers everything designFiles.ts classifies (AI/SVG/
 * EPS/PSD/PSB/INDD/FIG/XD/SKETCH design formats, ZIP/RAR/7Z/TAR archives,
 * Word/Excel/PowerPoint/OpenDocument/EPUB documents, and JSON/Markdown/YAML/
 * XML/INI/TOML/LOG/CSV/plain-text files), returning null for anything
 * already handled elsewhere (real images/video/audio/pdf/html) or genuinely
 * unrecognized.
 *
 * PSD/PSB precedence is deliberate: they already have a dedicated label via
 * getBrowserUnsupportedImagePreviewLabel (existing, tested) -- this reuses
 * that exact string rather than introducing a second, possibly-different
 * PSD label, so callers with their own browser-image-preview priority chain
 * (ReviewAsset.tsx) see byte-identical behavior to before this function
 * existed.
 */
export function getFileTypeVisual(asset?: AssetFileLike | null): FileTypeVisual | null {
  if (isAiDesignAsset(asset)) return { kind: "design", label: "AI" };
  if (isSvgDesignAsset(asset)) return { kind: "design", label: "SVG" };
  if (isEpsDesignAsset(asset)) return { kind: "design", label: "EPS" };

  const psdLabel = getBrowserUnsupportedImagePreviewLabel(asset);
  if (psdLabel === "PSD" || psdLabel === "PSB") return { kind: "design", label: psdLabel };

  const extendedDesignLabel = getExtendedDesignFileLabel(asset);
  if (extendedDesignLabel) return { kind: "design", label: extendedDesignLabel };

  if (isArchiveFileAsset(asset)) return { kind: "archive", label: getArchiveFileLabel(asset)! };

  const officeKind = getOfficeDocumentKind(asset);
  if (officeKind) return { kind: officeKind, label: getOfficeDocumentLabel(asset)! };

  const textInfo = getTextFilePreviewInfo(asset);
  if (textInfo) return { kind: "text", label: textInfo.label };

  return null;
}

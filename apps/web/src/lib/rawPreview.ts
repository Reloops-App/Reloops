// Web-safe preview the thumbnail worker writes for camera RAW files at
// `ai_metadata.raw_preview`. Kept dependency-free (no "@/" imports) so it can
// be unit-tested under the plain Node test runner and imported from both
// designFiles.ts and mediaDelivery.ts.

export type RawPreviewInfo = {
  previewUrl: string;
  width: number | null;
  height: number | null;
  exif: Record<string, unknown> | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Only the RAW path ever writes `raw_preview`, so its presence is itself proof
 * the asset is a camera RAW file -- no mime/extension check needed here.
 */
export function rawPreviewFromAiMetadata(metadata: unknown): RawPreviewInfo | null {
  if (!isPlainRecord(metadata)) return null;
  const preview = metadata.raw_preview;
  if (!isPlainRecord(preview)) return null;
  const previewUrl = preview.preview_url;
  if (typeof previewUrl !== "string" || previewUrl.length === 0) return null;
  return {
    previewUrl,
    width: finiteNumberOrNull(preview.width),
    height: finiteNumberOrNull(preview.height),
    exif: isPlainRecord(preview.exif) ? preview.exif : null,
  };
}

export type RawCameraRow = { label: string; value: string };

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Labelled rows for the file-info panel, from `ai_metadata.raw_preview.exif`. Empty when there is nothing to show. */
export function describeRawCamera(exif: Record<string, unknown> | null | undefined): RawCameraRow[] {
  if (!isPlainRecord(exif)) return [];
  const rows: RawCameraRow[] = [];

  const make = nonEmptyString(exif.make);
  const model = nonEmptyString(exif.model);
  // "NIKON CORPORATION" + "NIKON D70" -> "NIKON D70": skip the make when the model already leads with it.
  const camera =
    make && model
      ? model.toLowerCase().startsWith(make.split(/\s+/)[0].toLowerCase()) ? model : `${make} ${model}`
      : (model ?? make);
  if (camera) rows.push({ label: "Camera", value: camera });

  const lens = nonEmptyString(exif.lens);
  if (lens) rows.push({ label: "Lens", value: lens });

  const iso = finiteNumber(exif.iso);
  const aperture = finiteNumber(exif.aperture);
  const shutter = nonEmptyString(exif.shutter);
  const focalLength = finiteNumber(exif.focal_length);
  const exposure = [
    iso !== null ? `ISO ${iso}` : null,
    aperture !== null ? `f/${aperture}` : null,
    shutter ? (shutter.endsWith("s") ? shutter : `${shutter}s`) : null,
    focalLength !== null ? `${focalLength}mm` : null,
  ].filter((part): part is string => part !== null);
  if (exposure.length > 0) rows.push({ label: "Exposure", value: exposure.join(" · ") });

  const captured = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(nonEmptyString(exif.captured_at) ?? "");
  if (captured) rows.push({ label: "Captured", value: `${captured[1]} ${captured[2]}` });

  return rows;
}

/**
 * For seeding another page from a list row: just `{ raw_preview }` when a usable preview exists, else undefined.
 * The review page draws from that seed before its own full fetch lands; without this marker a RAW briefly looks
 * preview-less ("not ready" card) and then flips to the image. Only this key is carried so nothing else that reads
 * ai_metadata (live-URL review detection, smart metadata) changes for any other asset.
 */
export function pickRawPreviewMetadata(metadata: unknown): { raw_preview: Record<string, unknown> } | undefined {
  if (!rawPreviewFromAiMetadata(metadata)) return undefined;
  return { raw_preview: (metadata as Record<string, unknown>).raw_preview as Record<string, unknown> };
}

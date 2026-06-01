export type PreviewBackground = "checker" | "dark";

type PreviewSource = {
  src?: string | null;
  mime_type?: string | null;
  type?: string | null;
};

const backgroundCache = new Map<string, PreviewBackground>();

function normalizeText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function fileExtensionHint(value: string) {
  if (value.endsWith(".png") || value.includes(".png?")) return "png";
  if (value.endsWith(".webp") || value.includes(".webp?")) return "webp";
  if (value.endsWith(".svg") || value.includes(".svg?")) return "svg";
  return "";
}

export function getFallbackPreviewBackground(asset?: PreviewSource | null): PreviewBackground {
  const mimeType = normalizeText(asset?.mime_type ?? asset?.type);
  const src = normalizeText(asset?.src);
  const ext = fileExtensionHint(src);

  if (mimeType === "image/svg+xml" || ext === "svg") return "checker";
  if (mimeType === "image/png" || mimeType === "image/webp" || ext === "png" || ext === "webp") return "checker";
  return "dark";
}

export function previewBackgroundClass(kind: PreviewBackground) {
  if (kind === "checker") {
    return "bg-[linear-gradient(45deg,#2c3444_25%,transparent_25%,transparent_75%,#2c3444_75%,#2c3444),linear-gradient(45deg,#232b39_25%,transparent_25%,transparent_75%,#232b39_75%,#232b39)] bg-[position:0_0,8px_8px] bg-[size:16px_16px] bg-[#1b2230]";
  }
  return "bg-black";
}

export async function analyzePreviewBackground(src: string, asset?: PreviewSource | null): Promise<PreviewBackground> {
  const key = `${src}|${normalizeText(asset?.mime_type ?? asset?.type)}`;
  const cached = backgroundCache.get(key);
  if (cached) return cached;

  const fallback = getFallbackPreviewBackground(asset ?? { src });
  if (fallback === "checker") {
    backgroundCache.set(key, fallback);
    return fallback;
  }

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });

    const width = loaded.naturalWidth || loaded.width;
    const height = loaded.naturalHeight || loaded.height;
    if (!width || !height) {
      backgroundCache.set(key, fallback);
      return fallback;
    }

    const canvas = document.createElement("canvas");
    const sampleWidth = Math.min(48, width);
    const sampleHeight = Math.min(48, height);
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      backgroundCache.set(key, fallback);
      return fallback;
    }

    ctx.drawImage(loaded, 0, 0, sampleWidth, sampleHeight);
    const pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;

    let hasAlpha = false;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha < 1) hasAlpha = true;
    }

    const resolved: PreviewBackground = hasAlpha ? "checker" : "dark";

    backgroundCache.set(key, resolved);
    return resolved;
  } catch {
    backgroundCache.set(key, fallback);
    return fallback;
  }
}

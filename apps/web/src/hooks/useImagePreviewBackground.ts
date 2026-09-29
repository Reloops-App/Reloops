import { useEffect, useState } from "react";
import { analyzePreviewBackground, getFallbackPreviewBackground, type PreviewBackground } from "@/lib/imagePreviewBackground";

type Args = {
  src?: string | null;
  mime_type?: string | null;
  type?: string | null;
  analyze?: boolean;
};

export function useImagePreviewBackground({ src, mime_type, type, analyze = true }: Args) {
  const [background, setBackground] = useState<PreviewBackground>(() => getFallbackPreviewBackground({ src, mime_type, type }));

  useEffect(() => {
    if (!src) {
      setBackground(getFallbackPreviewBackground({ src, mime_type, type }));
      return;
    }

    if (!analyze) {
      setBackground(getFallbackPreviewBackground({ src, mime_type, type }));
      return;
    }

    let cancelled = false;
    setBackground(getFallbackPreviewBackground({ src, mime_type, type }));

    void analyzePreviewBackground(src, { src, mime_type, type }).then((next) => {
      if (!cancelled) setBackground(next);
    });

    return () => {
      cancelled = true;
    };
  }, [analyze, mime_type, src, type]);

  return background;
}

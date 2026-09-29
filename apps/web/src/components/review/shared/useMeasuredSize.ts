import { useEffect, useRef, useState } from "react";

/**
 * Tracks an element's real rendered size via ResizeObserver. Used to clamp
 * an overlay (popover/composer) against the stage's edges using its actual
 * height -- comment text length and composer content vary, so a hardcoded
 * height estimate would either clip long content or leave excess margin on
 * short content.
 */
export function useMeasuredSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

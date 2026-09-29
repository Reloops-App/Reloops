import * as React from "react";
import { cn } from "@/lib/utils";

// A fresh Image() with its src set resolves `.complete` synchronously (no
// network round trip) when the browser already has that URL in its HTTP
// cache — the standard trick for detecting a cache hit without waiting for
// a load event. Used to skip the skeleton-then-fade-in entirely for images
// that are already cached, e.g. when re-sorting a grid just reorders cards
// whose thumbnails were already loaded a moment ago.
function isLikelyCached(url: string): boolean {
  if (typeof window === "undefined" || !url) return false;
  const probe = new window.Image();
  probe.src = url;
  return probe.complete && probe.naturalWidth > 0;
}

/**
 * Lazy-loaded <img> with a skeleton placeholder that fades into the real
 * image once it loads, and falls back to `fallback` on error. Shared across
 * asset grids/cards so thumbnail loading behaves consistently everywhere.
 *
 * If `fallbackSrc` is given and differs from `src`, a load error retries once
 * against `fallbackSrc` before giving up and rendering `fallback` — used to
 * fall back from a Cloudflare-resized original to the existing pre-generated
 * thumbnail rather than failing straight to the icon placeholder.
 */
export function AssetImageFrame({
  src,
  fallbackSrc,
  alt,
  className,
  fallback,
  draggable,
  reveal = false,
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  className: string;
  fallback: React.ReactNode;
  draggable?: boolean;
  /** A picture that just arrived for a tile that was waiting: scale and fade it in instead of the quick default fade. */
  reveal?: boolean;
}) {
  const [currentSrc, setCurrentSrc] = React.useState(src);
  const [ready, setReady] = React.useState(() => isLikelyCached(src));
  const [failed, setFailed] = React.useState(false);

  // useLayoutEffect (not useEffect) so a cache-hit re-check resolves before
  // the browser paints — otherwise the skeleton would still flash for one
  // frame even though the corrected "ready" state lands moments later.
  React.useLayoutEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
    setReady(isLikelyCached(src));
  }, [src]);

  if (failed) {
    return <>{fallback}</>;
  }

  return (
    <div className="relative h-full w-full">
      {!ready ? (
        <div className="absolute inset-0 overflow-hidden bg-muted/35">
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.24)_42%,transparent_72%)]" />
          <div className="absolute bottom-3 left-3 flex gap-1.5">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-foreground/20 animate-pulse"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            ))}
          </div>
        </div>
      ) : null}
      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          className,
          "ease-out",
          reveal ? "transition-[opacity,scale,filter]" : "transition-[opacity,transform]",
          reveal ? "duration-500" : "duration-300",
          reveal && !ready ? "opacity-0 scale-90 blur-sm" : null,
          reveal && ready ? "opacity-100 scale-100 blur-0" : null,
          !reveal ? (ready ? "opacity-100" : "opacity-0") : null,
        )}
        draggable={draggable}
        onLoad={() => setReady(true)}
        onError={() => {
          if (fallbackSrc && currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc);
            return;
          }
          setFailed(true);
          setReady(true);
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Viewer, ImageUrlSource, EquirectGeometry, RectilinearView } from "marzipano";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { withMediaCorsHint } from "@/lib/mediaDelivery";
import { Button } from "@/components/ui/button";

type Panorama360ViewerProps = {
  // The untransformed original -- deliberately not routed through
  // Cloudflare's /cdn-cgi/image/ resize transform. That transform is a
  // separate edge feature that bypasses the origin worker's own CORS header
  // wrapping (infra/cloudflare/b2-proxy's withCors() unconditionally adds
  // Access-Control-Allow-Origin for normal proxied requests, but never runs
  // for /cdn-cgi/image/ responses). WebGL -- which Marzipano needs to use
  // the image as a texture -- requires that header; a plain <img> tag (the
  // flat viewer) does not, which is why only this viewer ever hit the gap.
  imageUrl?: string;
  className?: string;
  onExit?: () => void;
};

// Backstop for a load that never resolves at all (network hang, or an
// unexpected library-internal edge case that never fires textureLoad or
// textureError). A real equirectangular panorama original can be tens of MB,
// and Marzipano loads it via a plain <img> element with no progress signal
// -- so this can't distinguish "still legitimately downloading on a slow
// connection" from "genuinely stuck." It must stay generous: firing early
// kills the in-flight download outright (destroyOnce() clears the <img>'s
// src), turning a load that was about to succeed into a guaranteed failure.
const LOAD_TIMEOUT_MS = 90000;

// Assumed pixel width for Marzipano's single-level equirectangular geometry
// math -- this doesn't need to exactly match the real image's dimensions;
// visual quality is determined purely by the actual image resolution, not
// this value.
const ASSUMED_PANORAMA_WIDTH = 6000;

export default function Panorama360Viewer({ imageUrl, className, onExit }: Panorama360ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!containerRef.current || !imageUrl) return;
    setStatus("loading");

    // Marzipano loads panoramas via a plain `new Image()` element (see its
    // HtmlImageLoader), the same mechanism the flat viewer's <img> tag
    // already uses successfully -- not fetch()/XHR+blob, which is what
    // caused every prior failure mode with the previous library.
    const viewer = new Viewer(containerRef.current);
    const source = ImageUrlSource.fromString(withMediaCorsHint(imageUrl));
    const geometry = new EquirectGeometry([{ width: ASSUMED_PANORAMA_WIDTH }]);
    const limiter = RectilinearView.limit.traditional(4096, (120 * Math.PI) / 180);
    const view = new RectilinearView({}, limiter);
    const scene = viewer.createScene({ source, geometry, view, pinFirstLevel: true });
    const layer = scene.layer();
    // Layer does NOT re-emit "textureLoad"/"textureError" under those names
    // itself -- it only listens to them internally (to emit an unrelated
    // "textureStoreChange" event). The real events live on the TextureStore.
    const textureStore = layer.textureStore();

    // Guarded so cleanup and a failure path never double-destroy the same
    // instance, and so a late-firing timeout/error can't override a load
    // that already succeeded (or already failed) moments earlier.
    let destroyed = false;
    const destroyOnce = () => {
      if (destroyed) return;
      destroyed = true;
      viewer.destroy();
    };
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      destroyOnce();
      setStatus("error");
    };

    const handleLoad = () => {
      settled = true;
      setStatus("ready");
    };
    const handleError = (_tile: unknown, err: unknown) => {
      console.error("Panorama360Viewer: failed to load panorama", err);
      fail();
    };
    textureStore.addEventListener("textureLoad", handleLoad);
    textureStore.addEventListener("textureError", handleError);

    scene.switchTo();

    const timeoutId = window.setTimeout(() => {
      fail();
    }, LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
      textureStore.removeEventListener("textureLoad", handleLoad);
      textureStore.removeEventListener("textureError", handleError);
      destroyOnce();
    };
  }, [imageUrl]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-white/90" />
          <p className="max-w-sm text-sm text-white/80">
            Loading 360° view… large panoramas can take a while.
          </p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <p className="max-w-sm text-sm text-white/90">
            Couldn't load 360° view. Check your connection, or switch back to the flat view.
          </p>
          {onExit && (
            <Button variant="secondary" size="sm" onClick={onExit}>
              Back to flat view
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

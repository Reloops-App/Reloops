import { useEffect, useRef, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import html from "@shikijs/langs/html";
import githubDark from "@shikijs/themes/github-dark";
import { Check, Copy, FileCode2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { withMediaCorsHint } from "@/lib/mediaDelivery";
import { fetchTextResource } from "@/lib/fetchTextResource";
import { Button } from "@/components/ui/button";

type Html5BannerCodeViewProps = {
  htmlUrl?: string;
  title?: string;
  className?: string;
  onExit?: () => void;
};

// A fine-grained Shiki bundle (just the HTML grammar + one theme + the JS
// regex engine, no wasm) instead of the full "shiki" entrypoint, which pulls
// in every bundled language/theme -- multiple MB for a feature that only
// ever needs to highlight one language. Built once and reused across every
// mount/toggle of this component, not recreated per open.
let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [html],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

function bannerFileName(htmlUrl?: string, title?: string) {
  if (htmlUrl) {
    try {
      const pathname = new URL(htmlUrl).pathname;
      const base = pathname.split("/").pop();
      if (base) return decodeURIComponent(base);
    } catch {
      // Not a parseable absolute URL -- fall through to title/default.
    }
  }
  return title || "index.html";
}

export default function Html5BannerCodeView({ htmlUrl, title, className, onExit }: Html5BannerCodeViewProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [highlightedHtml, setHighlightedHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const sourceRef = useRef("");

  useEffect(() => {
    if (!htmlUrl) return;
    setStatus("loading");
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const source = await fetchTextResource(withMediaCorsHint(htmlUrl), { signal: controller.signal });
        if (cancelled) return;
        const highlighter = await getHighlighter();
        if (cancelled) return;
        const highlighted = highlighter.codeToHtml(source, { lang: "html", theme: "github-dark" });
        if (cancelled) return;
        sourceRef.current = source;
        setHighlightedHtml(highlighted);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load HTML5 banner source", error);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [htmlUrl, retryToken]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sourceRef.current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy banner source", error);
    }
  };

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-2xl", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          </span>
          <FileCode2 className="ml-2 h-3.5 w-3.5" />
          <span className="font-mono">{bannerFileName(htmlUrl, title)}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={status !== "ready"}
          className="h-7 gap-1.5 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        <style>{`
          .html5-banner-code pre.shiki {
            margin: 0;
            padding: 1rem 1rem 1rem 0;
            background-color: transparent !important;
          }
          .html5-banner-code code {
            counter-reset: line;
          }
          .html5-banner-code .line {
            display: inline-block;
            width: 100%;
            padding-left: 0.5rem;
          }
          .html5-banner-code .line::before {
            counter-increment: line;
            content: counter(line);
            display: inline-block;
            width: 2.5rem;
            margin-right: 1rem;
            text-align: right;
            color: rgba(255, 255, 255, 0.3);
            user-select: none;
          }
        `}</style>
        <div className="html5-banner-code text-[13px] leading-6" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />

        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0d1117] text-white/70">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading source...</span>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0d1117] px-6 text-center text-white/80">
            <span className="text-sm">Couldn't load the banner source.</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRetryToken((t) => t + 1)}>
                Retry
              </Button>
              {onExit && (
                <Button variant="ghost" size="sm" onClick={onExit}>
                  Back to preview
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

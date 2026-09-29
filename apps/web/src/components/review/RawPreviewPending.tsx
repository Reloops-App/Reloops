import { Download, FileImage, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, downloadFile } from "@/lib/utils";

type Props = {
  title?: string | null;
  /** 640px cover, shown blurred behind the loader like other images do while the full picture loads. */
  coverUrl?: string | null;
  /** True only after the preview could not be made (polling gave up): an honest message instead of a spinner. */
  failed?: boolean;
  downloadUrl?: string | null;
  fallbackDownloadUrl?: string | null;
  downloadName?: string | null;
  className?: string;
};

/**
 * What a camera RAW shows while its web-safe preview is not available yet. It is an ordinary loading state (the picture
 * replaces it by itself), never an error-looking card telling the user to come back later.
 */
export default function RawPreviewPending({ title, coverUrl, failed = false, downloadUrl, fallbackDownloadUrl, downloadName, className }: Props) {
  return (
    <div className={cn("relative flex h-full w-full items-center justify-center overflow-hidden bg-background p-6", className)} aria-busy={!failed}>
      {!failed && coverUrl ? (
        <img src={coverUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-105 object-contain opacity-60 blur-md" />
      ) : null}
      <div
        role="status"
        className="relative z-10 flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/70 bg-card/85 px-8 py-8 text-center shadow-sm backdrop-blur"
      >
        {failed ? (
          <>
            <FileImage className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">We couldn't generate a preview for this RAW file</h2>
            <p className="text-sm text-muted-foreground">Download the original to open it in a compatible app.</p>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">Preparing preview</div>
          </>
        )}
        {title ? <div className="max-w-full truncate text-xs text-muted-foreground">{title}</div> : null}
        {downloadUrl ? (
          <Button
            className="mt-1"
            variant="outline"
            size="sm"
            onClick={() => void downloadFile(downloadUrl, downloadName || title || "asset", { fallbackUrl: fallbackDownloadUrl })}
          >
            <Download className="h-4 w-4" />
            Download file
          </Button>
        ) : null}
      </div>
    </div>
  );
}

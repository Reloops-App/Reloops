import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/utils";
import { Palette, Download } from "lucide-react";

type Props = {
  title?: string | null;
  fileTypeLabel?: string;
  downloadUrl?: string | null;
  downloadName?: string | null;
};

export default function UnsupportedAssetPreview({
  title,
  fileTypeLabel = "Design",
  downloadUrl,
  downloadName,
}: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="flex max-w-lg flex-col items-center rounded-2xl border border-border/70 bg-card px-8 py-10 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-foreground">
          <Palette className="h-7 w-7" />
        </div>
        <div className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          {fileTypeLabel}
        </div>
        <h2 className="mt-3 text-xl font-semibold text-foreground">Preview not available</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {fileTypeLabel} files do not render in the review page.
          {title ? ` You can still download ${title}.` : " You can still download this file."}
        </p>
        {downloadUrl ? (
          <Button
            className="mt-6"
            variant="outline"
            onClick={() => void downloadFile(downloadUrl, downloadName || title || "asset")}
          >
            <Download className="h-4 w-4" />
            Download file
          </Button>
        ) : null}
      </div>
    </div>
  );
}

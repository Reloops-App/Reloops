import type { ComponentType } from "react";

/**
 * What a grid tile shows while the server is still making its picture: a circle that shrinks and grows around the file-type
 * icon. The picture then fades in over it (AssetImageFrame `reveal`). Announced as a status so it is not just decoration.
 */
export function PendingCover({ icon: Icon, label = "Preparing preview" }: { icon: ComponentType<{ className?: string }>; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid h-full w-full place-items-center">
      <div className="relative grid h-16 w-16 place-items-center">
        <span className="absolute inset-0 rounded-full border border-foreground/15 bg-foreground/10 animate-tile-breathe" />
        <Icon className="relative h-5 w-5 text-muted-foreground" />
      </div>
    </div>
  );
}

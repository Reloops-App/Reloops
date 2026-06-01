import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, MoreHorizontal, Pencil, Trash } from "lucide-react";

type FolderActionsMenuProps = {
  folderName: string;
  onRename: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
};

export function FolderActionsMenu({
  folderName,
  onRename,
  onDelete,
  onDownload,
  downloadLabel = "Download as ZIP",
  trigger,
  align = "end",
  contentClassName,
}: FolderActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Folder actions</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName ?? "w-[220px]"}>
        <DropdownMenuLabel>{folderName}</DropdownMenuLabel>
        {onDownload ? (
          <>
            <DropdownMenuItem onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" />
              {downloadLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename folder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} variant="destructive">
          <Trash className="mr-2 h-4 w-4" />
          Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

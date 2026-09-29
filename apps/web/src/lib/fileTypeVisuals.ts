import { BookOpen, FileArchive, FileCode2, FileSpreadsheet, FileText, Palette, Presentation, type LucideIcon } from "lucide-react";
import type { FileTypeKind } from "./designFiles";

export const FILE_TYPE_KIND_ICONS: Record<FileTypeKind, LucideIcon> = {
  design: Palette,
  archive: FileArchive,
  "document-word": FileText,
  "document-spreadsheet": FileSpreadsheet,
  "document-presentation": Presentation,
  ebook: BookOpen,
  text: FileCode2,
};

export const FILE_TYPE_KIND_COLOR_CLASS: Record<FileTypeKind, string> = {
  design: "text-violet-700 dark:text-violet-300",
  archive: "text-amber-700 dark:text-amber-300",
  "document-word": "text-blue-700 dark:text-blue-300",
  "document-spreadsheet": "text-emerald-700 dark:text-emerald-300",
  "document-presentation": "text-orange-700 dark:text-orange-300",
  ebook: "text-teal-700 dark:text-teal-300",
  text: "text-rose-700 dark:text-rose-300",
};

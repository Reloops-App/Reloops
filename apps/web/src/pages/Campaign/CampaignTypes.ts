/* Shared types and constants for Campaign components */
import { Circle, PickaxeIcon, CheckCircle2 } from "lucide-react";

export type AssetStatus = "needs_review" | "in_review" | "approved";
export type ColumnKey = "none" | AssetStatus;

export type Asset = {
  id: string;
  name: string;
  type: string;
  project_id?: string | null;
  version_no?: number | null;
  parent_asset_id?: string | null;
  folder_id?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  coverUrl?: string | null;
  url?: string | null;
  status?: AssetStatus | null | string;
  assigned_to?: string | null;
  comments_count?: number;
  updated_at?: string | null;
  updated_by?: string | null;
  description?: string | null;
  ai_description?: string | null;
  tags?: string[];
  smart_tags?: string[];
  smart_description?: string | null;
};

export const STATUS_STYLES: Record<
  AssetStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  needs_review: {
    label: "Needs review",
    className: "bg-muted text-foreground",
    icon: Circle,
  },
  in_review: {
    label: "In review",
    className: "bg-orange-500 text-warning-foreground",
    icon: PickaxeIcon,
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-500 text-success-foreground",
    icon: CheckCircle2,
  },
};

export const COLUMN_STYLE: Record<
  ColumnKey,
  { colBg: string; colBorder: string; title: string; icon: React.ElementType }
> = {
  none: {
    colBg: "from-gray-950 to-gray-900",
    colBorder: "border-gray-800",
    title: "No status",
    icon: Circle,
  },
  needs_review: {
    colBg: "from-sky-950 to-sky-900",
    colBorder: "border-sky-800",
    title: "Needs review",
    icon: Circle
  },
  in_review: {
    colBg: "from-orange-950 to-orange-900",
    colBorder: "border-orange-800",
    title: "In Review",
    icon: PickaxeIcon
  },
  approved: {
    colBg: "from-emerald-950 to-emerald-900",
    colBorder: "border-emerald-800",
    title: "Approved",
    icon: CheckCircle2
  },
};

export function toColumnKey(status?: string | null): ColumnKey {
  return status === "needs_review" || status === "in_review" || status === "approved"
    ? (status as ColumnKey)
    : "none";
}

export function fromColumnKey(col: ColumnKey): AssetStatus | null {
  return col === "none" ? null : col;
}

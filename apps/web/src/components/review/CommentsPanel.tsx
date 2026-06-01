import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Pen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { DotSep, EmojiPill } from "../video-player/emoji";
import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { RoleBadge, type UserRole } from "@/components/ui/role-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SimpleMentionTextareaFinal } from "../ui/simple-mention-textarea-final";
import BottomCommentDock from "./shared/BottomCommentDock";
import type { Tool } from "./annotator-utils";
import { invokeEdgeFunction } from "@/api/edge";
import { AnimatePresence, motion } from "framer-motion";

import { Minus, AlertTriangle, RotateCcw, Check, Calendar, FileText, HardDrive, Edit2, Trash2, CheckCircle2, MessageSquare, History, Upload, UserRound, Tag, Layers, CircleDot, FolderOpen, Plus, X, Save, Sparkles, Loader2, ChevronDown } from "lucide-react";
import { formatTimetoDayMonth } from "@/lib/utils";
import { Card } from "../ui/card";
import { apiKeyActorProfileId, loadApiKeyActorProfiles } from "@/lib/api-key-actors";

type AssetProjectLocation = {
  id: string;
  name: string;
  is_primary?: boolean;
  linked_at?: string | null;
};

type AssetMetadataPatch = {
  description: string | null;
  tags: string[];
};

function normalizeManualTags(tags: unknown[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of tags) {
    const value = String(raw ?? "").trim().replace(/\s+/g, " ");
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized.slice(0, 50);
}

function splitTagInput(value: string) {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function displayTagLabel(tag: string) {
  return tag
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bui\b/gi, "UI")
    .replace(/\bux\b/gi, "UX")
    .replace(/\bapi\b/gi, "API")
    .replace(/\bai\b/gi, "AI");
}

function smartDescriptionLines(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return ["No smart description"];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentences.length > 1) return sentences.slice(0, 3);
  if (text.length <= 110) return [text];
  const midpoint = Math.floor(text.length / 2);
  const splitAt = text.indexOf(", ", midpoint) > -1
    ? text.indexOf(", ", midpoint) + 1
    : text.indexOf(" and ", midpoint) > -1
      ? text.indexOf(" and ", midpoint)
      : -1;
  if (splitAt === -1) return [text];
  return [text.slice(0, splitAt).trim(), text.slice(splitAt).trim()].filter(Boolean);
}

// Asset Fields Component for the Fields tab
function AssetFields({
  asset,
  profiles,
  projectLocations,
  loadingProjectLocations,
  onAssetMetadataSave,
}: {
  asset?: {
    id: string;
    title: string;
    description?: string | null;
    tags?: string[] | null;
    smart_tags?: string[] | null;
    smart_description?: string | null;
    project_id?: string | null;
    parent_asset_id?: string | null;
    status?: string | null;
    assigned_to?: string | null;
    uploaded_by?: string | null;
    created_at: string;
    updated_at?: string | null;
    uploaded_at?: string;
    mime_type?: string | null;
    size_bytes?: number | null;
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    version_no?: number | null;
    storage_path: string;
  } | null;
  profiles: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
  projectLocations: AssetProjectLocation[];
  loadingProjectLocations: boolean;
  onAssetMetadataSave?: (patch: AssetMetadataPatch) => Promise<void> | void;
}) {
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [tagDrafts, setTagDrafts] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [lastMetadataSavedAt, setLastMetadataSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    setDescriptionDraft(asset?.description ?? "");
    setTagDrafts(normalizeManualTags(asset?.tags ?? []));
    setTagInput("");
    setMetadataError(null);
  }, [asset?.id, asset?.description, asset?.tags]);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center px-4 mt-10">
        <div className="w-12 h-12 rounded-full bg-sidebar-accent/50 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-sidebar-foreground/40" />
        </div>
        <p className="text-sidebar-foreground/60 text-sm">No asset data</p>
        <p className="text-sidebar-foreground/40 text-xs mt-1">Asset information unavailable</p>
      </div>
    );
  }

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return "Unknown";
    const sizes = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < sizes.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(1)} ${sizes[i]}`;
  };

  const getResolution = () => {
    if (asset.width && asset.height) {
      return `${asset.width} × ${asset.height}`;
    }
    return "Unknown";
  };

  const getMimeTypeDisplay = (mimeType?: string | null) => {
    if (!mimeType) return "Unknown";
    const type = mimeType.split('/')[1]?.toUpperCase() || mimeType.toUpperCase();
    return type;
  };

  const formatDuration = (durationMs?: number | null) => {
    if (!durationMs) return "N/A";
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Status Badge Component for Fields tab
  const StatusBadge = ({ status }: { status?: string | null }) => {
    const NO_STATUS_LABEL = "No status";

    if (status == null || status === "") {
      return (
        <Badge className="gap-1.5 bg-muted text-muted-foreground">
          <Minus className="h-3.5 w-3.5" />
          {NO_STATUS_LABEL}
        </Badge>
      );
    }
    const map: Record<string, { cn: string; icon: React.ElementType; label: string }> = {
      needs_review: {
        cn: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
        icon: AlertTriangle,
        label: "Needs review",
      },
      in_review: {
        cn: "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100",
        icon: RotateCcw,
        label: "In review",
      },
      approved: {
        cn: "bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-100",
        icon: Check,
        label: "Approved",
      },
    };
    const def = map[String(status)] ?? {
      cn: "bg-muted text-muted-foreground",
      icon: Minus,
      label: String(status).replace(/_/g, " "),
    };
    const Icon = def.icon;
    return (
      <Badge className={`gap-1.5 ${def.cn}`}>
        <Icon className="h-3.5 w-3.5" />
        {def.label}
      </Badge>
    );
  };

  const assignedProfile = asset.assigned_to ? profiles[asset.assigned_to] : null;
  const uploaderProfile = asset.uploaded_by ? profiles[asset.uploaded_by] : null;
  const persistedTags = normalizeManualTags(asset.tags ?? []);
  const isMetadataDirty =
    descriptionDraft.trim() !== (asset.description ?? "").trim() ||
    tagDrafts.join("\n") !== persistedTags.join("\n");

  const addTags = (rawTags: string[]) => {
    setTagDrafts((current) => normalizeManualTags([...current, ...rawTags]));
  };

  const commitTagInput = () => {
    const next = splitTagInput(tagInput);
    if (next.length === 0) return;
    addTags(next);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTagDrafts((current) => current.filter((item) => item !== tag));
  };

  const hasManualTag = (tag: string) => {
    const key = tag.trim().toLocaleLowerCase();
    return tagDrafts.some((item) => item.trim().toLocaleLowerCase() === key);
  };

  const addSmartTag = (tag: string) => {
    addTags([tag]);
  };

  const resetMetadataDraft = () => {
    setDescriptionDraft(asset.description ?? "");
    setTagDrafts(persistedTags);
    setTagInput("");
    setMetadataError(null);
  };

  const saveMetadata = async () => {
    if (!onAssetMetadataSave || metadataSaving) return;
    setMetadataSaving(true);
    setMetadataError(null);

    try {
      await onAssetMetadataSave({
        description: descriptionDraft.trim() || null,
        tags: normalizeManualTags(tagDrafts),
      });
      setTagInput("");
      setLastMetadataSavedAt(new Date());
    } catch (error) {
      console.error("Failed to save asset metadata", error);
      setMetadataError(error instanceof Error ? error.message : "Could not save metadata");
    } finally {
      setMetadataSaving(false);
    }
  };
  const smartDescription = smartDescriptionLines(asset.smart_description);
  const rowClassName = "flex items-center justify-between gap-4 rounded-md px-2.5 py-2 transition hover:bg-sidebar-accent/18";
  const labelClassName = "text-[13px] font-semibold text-sidebar-foreground/82";
  const valueClassName = "min-w-0 text-right text-[13.5px] font-semibold text-sidebar-foreground";
  const helperClassName = "text-[12.5px] leading-5 text-sidebar-foreground/68";
  const metadataStateLabel = metadataSaving
    ? "Saving changes"
    : metadataError
      ? "Save failed"
      : isMetadataDirty
        ? "Unsaved changes"
        : lastMetadataSavedAt
          ? `Saved ${lastMetadataSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "No unsaved changes";

  const InfoSection = ({
    title,
    description,
    icon: Icon,
    children,
    defaultOpen = true,
    badge,
    tone = "neutral",
  }: {
    title: string;
    description?: string;
    icon: React.ElementType;
    children: React.ReactNode;
    defaultOpen?: boolean;
    badge?: React.ReactNode;
    tone?: "neutral" | "custom" | "smart";
  }) => (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn(
        "overflow-hidden rounded-lg border shadow-sm",
        tone === "custom" && "border-sky-400/16 bg-[linear-gradient(180deg,hsl(var(--card))_0%,rgba(14,165,233,0.055)_100%)]",
        tone === "smart" && "border-violet-300/24 bg-[linear-gradient(180deg,rgba(139,92,246,0.14)_0%,rgba(6,182,212,0.055)_52%,hsl(var(--card))_100%)] shadow-[0_18px_45px_rgba(88,28,135,0.16)]",
        tone === "neutral" && "border-sidebar-border/55 bg-card/95"
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-sidebar-accent/18"
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
              tone === "custom" && "border-sky-400/20 bg-sky-400/10 text-sky-100",
              tone === "smart" && "border-violet-300/28 bg-[linear-gradient(135deg,rgba(167,139,250,0.24),rgba(34,211,238,0.10))] text-violet-50 shadow-[0_0_18px_rgba(139,92,246,0.18)]",
              tone === "neutral" && "border-sidebar-border/45 bg-background/70 text-sidebar-foreground"
            )}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-5 text-sidebar-foreground">{title}</div>
              {description ? (
                <div className={cn("mt-0.5", helperClassName)}>{description}</div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {badge}
            <ChevronDown className="h-4 w-4 text-sidebar-foreground/45 transition-transform group-data-[state=open]:rotate-180" />
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-sidebar-border/35 px-4 py-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <div className="relative min-h-full">
      <div className="space-y-4 bg-[radial-gradient(circle_at_top,hsl(var(--sidebar-accent)/0.22),transparent_260px)] px-3 py-3 pb-28">
      <InfoSection
        title="Custom Metadata"
        description="Editable team metadata."
        icon={Tag}
        tone="custom"
        badge={(isMetadataDirty || metadataSaving || metadataError) ? (
          <Badge
            variant={metadataError ? "destructive" : "default"}
            className="h-6 px-2 text-[11px]"
          >
            {metadataSaving ? "Saving" : metadataError ? "Failed" : "Unsaved"}
          </Badge>
        ) : null}
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-sky-400/12 bg-sky-400/[0.045] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-sidebar-foreground">Manual fields</div>
              </div>
              <Badge variant="outline" className="h-6 border-sky-400/20 px-2 text-[11px] text-sky-100/80">
                Editable
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className={labelClassName}>Description</label>
              <span className="text-[12px] tabular-nums text-sidebar-foreground/58">
                {descriptionDraft.trim().length}/800
              </span>
            </div>
            <Textarea
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value.slice(0, 800))}
              placeholder="Describe campaign, product, usage rights, region, audience, or review context."
              className="mt-2 min-h-[124px] resize-none rounded-md border-sky-400/14 bg-background/95 px-3 py-2.5 text-[13.5px] leading-6 text-sidebar-foreground shadow-sm transition placeholder:text-sidebar-foreground/45 focus-visible:border-sky-300/45 focus-visible:ring-2 focus-visible:ring-sky-400/15"
            />
          </div>

          <div className="rounded-lg border border-sidebar-border/45 bg-background/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <label className={labelClassName}>Tags</label>
              <span className="text-[12px] tabular-nums text-sidebar-foreground/58">{tagDrafts.length}/50</span>
            </div>

            <div className="mt-2 rounded-md border border-sidebar-border/55 bg-background/95 shadow-sm transition focus-within:border-sky-300/45">
              <div className={cn("px-2.5 pt-2.5", tagDrafts.length === 0 && "pb-2.5")}>
                {tagDrafts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tagDrafts.map((tag) => (
                      <motion.span
                        key={tag}
                        layout
                        initial={{ opacity: 0, y: 2, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -2, scale: 0.98 }}
                        className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-sky-400/14 bg-sky-400/10 px-3 py-1 text-[12.5px] font-semibold text-sidebar-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                      >
                        <span className="truncate">{displayTagLabel(tag)}</span>
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="rounded-sm p-0.5 text-sidebar-foreground/60 transition hover:bg-background/70 hover:text-sidebar-foreground"
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-sidebar-border/55 bg-sidebar-accent/14 px-2.5 py-2 text-[13px] text-sidebar-foreground/62">
                    Add campaign, product, channel, rights, region, or audience tags.
                  </div>
                )}
              </div>

              <div className="flex border-t border-sidebar-border/45 bg-sidebar-accent/8">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onBlur={commitTagInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      commitTagInput();
                    }
                    if (event.key === "Backspace" && !tagInput && tagDrafts.length > 0) {
                      event.preventDefault();
                      setTagDrafts((current) => current.slice(0, -1));
                    }
                  }}
                  placeholder="Type your tag and press Enter"
                  className="h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-[13.5px] shadow-none placeholder:text-sidebar-foreground/48 focus-visible:ring-0"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 rounded-none border-l border-sidebar-border/45 text-sidebar-foreground/80 hover:bg-sky-400/10 hover:text-sidebar-foreground"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={commitTagInput}
                        disabled={!tagInput.trim()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add tag</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>

          {metadataError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/12 px-3 py-2 text-[13px] font-medium text-destructive">
              {metadataError}
            </div>
          ) : null}

        </div>
      </InfoSection>

      <InfoSection
        title="Smart Metadata"
        description="Generated insights."
        icon={Sparkles}
        tone="smart"
      >
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-lg border border-violet-300/26 bg-[linear-gradient(180deg,rgba(139,92,246,0.12),rgba(6,182,212,0.055))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-200/50 to-transparent" />
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-violet-300/24 bg-violet-300/12 text-violet-100">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="text-[13.5px] font-semibold text-sidebar-foreground">Description suggestion</div>
              </div>
              <Badge variant="outline" className="h-6 border-cyan-200/25 bg-cyan-300/10 px-2 text-[11px] font-semibold text-cyan-100">
                AI
              </Badge>
            </div>
            <div className="space-y-2 rounded-md border border-violet-200/12 bg-background/88 px-3.5 py-3 shadow-sm">
              {smartDescription.map((line, index) => (
                <p key={`${line}-${index}`} className="text-[14px] font-medium leading-6 text-sidebar-foreground/95">
                  {line}
                </p>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-lg border border-violet-300/18 bg-[linear-gradient(180deg,rgba(15,23,42,0.34),rgba(139,92,246,0.06))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-sidebar-foreground/90">Generated tags</span>
            </div>
            {Array.isArray(asset.smart_tags) && asset.smart_tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {asset.smart_tags.map((tag) => {
                  const alreadyAdded = hasManualTag(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addSmartTag(tag)}
                      disabled={alreadyAdded}
                      className={cn(
                        "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold leading-4 shadow-sm transition",
                        alreadyAdded
                          ? "border-cyan-200/16 bg-cyan-300/8 text-sidebar-foreground/62"
                          : "border-violet-200/24 bg-[linear-gradient(135deg,rgba(167,139,250,0.14),rgba(34,211,238,0.06))] text-sidebar-foreground hover:border-violet-200/40 hover:bg-violet-400/14 hover:text-sidebar-foreground"
                      )}
                    >
                      {alreadyAdded ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                      <span className="truncate">{displayTagLabel(tag)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[13px] text-sidebar-foreground/62">No smart tags</span>
            )}
          </div>
        </div>
      </InfoSection>

      <InfoSection title="File Info" description="Format, size, dates, owner." icon={HardDrive}>
        <div className="space-y-1 rounded-lg bg-background/45 p-1">
          <div className={rowClassName}>
            <span className={labelClassName}>Format</span>
            <span className={cn(valueClassName, "font-mono")}>{getMimeTypeDisplay(asset.mime_type)}</span>
          </div>
          <div className={rowClassName}>
            <span className={labelClassName}>Size</span>
            <span className={valueClassName}>{formatFileSize(asset.size_bytes)}</span>
          </div>
          <div className={rowClassName}>
            <span className={labelClassName}>Resolution</span>
            <span className={valueClassName}>{getResolution()}</span>
          </div>
          {asset.duration_ms ? (
            <div className={rowClassName}>
              <span className={labelClassName}>Duration</span>
              <span className={valueClassName}>{formatDuration(asset.duration_ms)}</span>
            </div>
          ) : null}
          <Separator className="my-1 bg-sidebar-border/35" />
          <div className={rowClassName}>
            <span className={labelClassName}>Uploaded</span>
            <span className={valueClassName}>
              {asset.uploaded_at ? formatTimetoDayMonth(asset.uploaded_at) : formatTimetoDayMonth(asset.created_at)}
            </span>
          </div>
          {asset.updated_at ? (
            <div className={rowClassName}>
              <span className={labelClassName}>Updated</span>
              <span className={valueClassName}>{formatTimetoDayMonth(asset.updated_at)}</span>
            </div>
          ) : null}
          <div className={rowClassName}>
            <span className={labelClassName}>Uploader</span>
            <div className="flex min-w-0 items-center gap-2">
              {uploaderProfile ? (
                <>
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarImage src={uploaderProfile.avatar_url || undefined} />
                    <AvatarFallback className={cn("text-xs", AVATAR_FALLBACK_CLASS)}>
                      {getAvatarInitials(uploaderProfile.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate text-[13.5px] font-semibold text-sidebar-foreground">{uploaderProfile.display_name || "Unknown User"}</span>
                </>
              ) : (
                <span className={valueClassName}>Unknown</span>
              )}
            </div>
          </div>
        </div>
      </InfoSection>

      <InfoSection title="Advanced" description="Review, version, placement." icon={FileText} defaultOpen={false}>
        <div className="space-y-1 rounded-lg bg-background/45 p-1">
          <div className={rowClassName}>
            <span className={labelClassName}>Status</span>
            <StatusBadge status={asset.status} />
          </div>
          <div className={rowClassName}>
            <span className={labelClassName}>Version</span>
            <span className={valueClassName}>v{asset.version_no || 1}</span>
          </div>
          <div className={rowClassName}>
            <span className={labelClassName}>Assignee</span>
            <div className="flex min-w-0 items-center gap-2">
              {assignedProfile ? (
                <>
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarImage src={assignedProfile.avatar_url || undefined} />
                    <AvatarFallback className={cn("text-xs", AVATAR_FALLBACK_CLASS)}>
                      {getAvatarInitials(assignedProfile.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate text-[13.5px] font-semibold text-sidebar-foreground">{assignedProfile.display_name || "Unknown User"}</span>
                </>
              ) : (
                <span className={valueClassName}>Unassigned</span>
              )}
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <div className={rowClassName}>
              <span className={labelClassName}>Projects</span>
              {loadingProjectLocations ? (
                <span className="text-[13px] text-sidebar-foreground/50">Loading...</span>
              ) : (
                <Badge variant="secondary" className="h-6 px-2 text-[11px]">{projectLocations.length}</Badge>
              )}
            </div>
            <div className="space-y-1.5">
              {loadingProjectLocations ? (
                <>
                  <div className="h-8 animate-pulse rounded-md bg-sidebar-accent/40" />
                  <div className="h-8 animate-pulse rounded-md bg-sidebar-accent/25" />
                </>
              ) : projectLocations.length > 0 ? (
                projectLocations.map((project) => (
                  <div key={project.id} className="flex min-w-0 items-center gap-2 rounded-md bg-sidebar-accent/24 px-2.5 py-2">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/68" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">{project.name}</span>
                    {project.is_primary ? (
                      <Badge variant="outline" className="h-6 shrink-0 px-2 text-[11px]">Primary</Badge>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-sidebar-border/50 bg-sidebar-accent/12 px-2.5 py-2 text-[13px] text-sidebar-foreground/62">
                  Not attached to a project
                </div>
              )}
            </div>
          </div>
        </div>
      </InfoSection>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border/70 bg-card/95 px-3 py-3 shadow-[0_-12px_28px_rgba(0,0,0,0.28)] backdrop-blur supports-[backdrop-filter]:bg-card/88 lg:left-auto lg:right-0 lg:w-[400px] lg:min-w-[320px] lg:max-w-[400px]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={cn(
              "truncate text-[13.5px]",
              isMetadataDirty || metadataSaving ? "font-semibold text-sidebar-foreground" : "font-medium text-sidebar-foreground/72",
              metadataError && "text-destructive"
            )}>
              {metadataStateLabel}
            </div>
            <div className="mt-0.5 text-[11.5px] text-sidebar-foreground/52">
              Custom description and tags only
            </div>
          </div>
          {isMetadataDirty || metadataSaving ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-3 text-[13px] font-medium"
                onClick={resetMetadataDraft}
                disabled={metadataSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 px-3 text-[13px] font-semibold"
                onClick={saveMetadata}
                disabled={metadataSaving || !onAssetMetadataSave}
              >
                {metadataSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type CommentItem = {
  id: string;
  author?: string;
  authorId?: string; // User ID for profile lookup
  authorProfile?: {
    display_name?: string | null;
    avatar_url?: string | null;
  };
  text: string;
  emoji?: { [k: string]: number };
  hasDrawing?: boolean;
  timeSec?: number; // optional media time for clients like video
  isCompleted?: boolean; // Mark comment as resolved/completed
  isDeleted?: boolean; // Soft delete flag
  createdAt?: string;
  versionLabel?: string;
  versionColor?: "default" | "secondary" | "destructive" | "outline";
  assetId?: string;
};

export function formatRelativeTime(dateStr?: string) {
  if (!dateStr) return "just now";
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export type CommentsPanelProps = {
  className?: string;
  titleLeft?: string;
  titleRight?: string;
  items: CommentItem[];
  onItemClick?: (id: string) => void;

  // Comment actions
  onEditComment?: (id: string, newText: string) => void;
  onDeleteComment?: (id: string) => void;
  onToggleCompleted?: (id: string) => void;

  // Context for enhanced mentions and role loading
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;

  // Asset data for Fields tab
  asset?: {
    id: string;
    title: string;
    description?: string | null;
    tags?: string[] | null;
    smart_tags?: string[] | null;
    smart_description?: string | null;
    project_id?: string | null;
    parent_asset_id?: string | null;
    status?: string | null;
    assigned_to?: string | null;
    uploaded_by?: string | null;
    created_at: string;
    updated_at?: string | null;
    uploaded_at?: string;
    mime_type?: string | null;
    size_bytes?: number | null;
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    version_no?: number | null;
    storage_path: string;
  } | null;
  onAssetMetadataSave?: (patch: AssetMetadataPatch) => Promise<void> | void;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;

  // Bottom comment dock props
  showCommentDock?: boolean;
  currentTime?: number;
  includeTimestamp?: boolean;
  onToggleTimestamp?: () => void;
  formatTime?: (seconds: number) => string;
  annotating?: boolean;
  onToggleAnnotating?: () => void;
  tool?: Tool;
  onToolChange?: (tool: Tool) => void;
  color?: string;
  onColorChange?: (color: string) => void;
  canUndo?: boolean;
  onUndo?: () => void;
  onClear?: () => void;
  onCommentSubmit?: (text: string) => void;
};

type ActivityProfile = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

type AssetHistoryRow = {
  id: string;
  asset_id: string;
  event_type: string;
  actor_user_id?: string | null;
  actor_api_key_id?: string | null;
  metadata?: Record<string, any> | null;
  created_at: string;
};

type ActivityItem = {
  id: string;
  eventType: string;
  title: string;
  detail?: string | null;
  meta?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  createdAt: string;
  kind: "comment" | "status" | "version" | "assignment" | "upload" | "metadata" | "smart" | "review" | "update";
};

function statusText(status: unknown) {
  const value = typeof status === "string" ? status : "";
  if (!value) return "No status";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableMimeType(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return value.split("/")[1]?.toUpperCase() ?? value.toUpperCase();
}

function changeValue(metadata: AssetHistoryRow["metadata"], field: string, side: "before" | "after") {
  return metadata?.changes?.[field]?.[side] ?? null;
}

function changedFields(metadata: AssetHistoryRow["metadata"]) {
  const changes = metadata?.changes;
  if (!changes || typeof changes !== "object") return [];
  return Object.keys(changes);
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    title: "Name",
    status: "Status",
    description: "Description",
    tags: "Tags",
    smart_description: "AI description",
    smart_tags: "AI tags",
    cover_image_url: "Preview",
    assigned_to: "Assignee",
    assigned_to_api_key_id: "Agent assignee",
    reviewer_ids: "Reviewers",
    project_id: "Project",
    mime_type: "Format",
    size_bytes: "File size",
    storage_path: "Storage file",
  };
  return labels[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const MANUAL_METADATA_FIELDS = ["description", "tags"];
const AI_METADATA_FIELDS = ["smart_description", "smart_tags"];
const ALL_METADATA_FIELDS = [...MANUAL_METADATA_FIELDS, ...AI_METADATA_FIELDS];

function hasNonEmptyActivityValue(value: unknown) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function formatValueForActivity(field: string, value: unknown, profiles: Record<string, ActivityProfile>) {
  if (value == null || value === "") return "empty";
  if (field === "status") return statusText(value);
  if ((field === "assigned_to" || field === "assigned_to_api_key_id") && typeof value === "string") {
    return profileName(field === "assigned_to_api_key_id" ? apiKeyActorProfileId(value) : value, profiles) ?? "assignee";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    return value.slice(0, 4).join(", ") + (value.length > 4 ? ` +${value.length - 4}` : "");
  }
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
  }
  if (typeof value === "number") return String(value);
  return "updated";
}

function changedFieldSummary(metadata: AssetHistoryRow["metadata"]) {
  const fields = changedFields(metadata);
  if (fields.length === 0) return null;
  const labels = fields.map(fieldLabel);
  return labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");
}

function changeDetail(metadata: AssetHistoryRow["metadata"], field: string, profiles: Record<string, ActivityProfile>) {
  const before = changeValue(metadata, field, "before");
  const after = changeValue(metadata, field, "after");
  if (before == null && after != null) return `Added ${formatValueForActivity(field, after, profiles)}`;
  if (before != null && after == null) return `Removed ${formatValueForActivity(field, before, profiles)}`;
  return `${formatValueForActivity(field, before, profiles)} to ${formatValueForActivity(field, after, profiles)}`;
}

function metadataChangeFields(metadata: AssetHistoryRow["metadata"], fields: string[]) {
  const changed = changedFields(metadata);
  return fields.filter((field) => changed.includes(field));
}

function metadataChangeDetail(metadata: AssetHistoryRow["metadata"], fields: string[], profiles: Record<string, ActivityProfile>) {
  const changed = metadataChangeFields(metadata, fields);
  if (!changed.length) return changedFieldSummary(metadata);

  return changed
    .map((field) => `${fieldLabel(field)}: ${changeDetail(metadata, field, profiles)}`)
    .join(" · ");
}

function metadataUploadSummary(metadata: AssetHistoryRow["metadata"]) {
  const fields = ALL_METADATA_FIELDS.filter((field) => hasNonEmptyActivityValue(metadata?.[field]));
  if (!fields.length) return null;
  return fields.map((field) => `${fieldLabel(field)}: ${formatValueForActivity(field, metadata?.[field], {})}`).join(" · ");
}

function profileName(id: unknown, profiles: Record<string, ActivityProfile>) {
  if (typeof id !== "string" || !id) return null;
  return profiles[id]?.display_name ?? null;
}

function activityFromHistory(row: AssetHistoryRow, profiles: Record<string, ActivityProfile>): ActivityItem {
  const metadata = row.metadata ?? {};
  const statusBefore = changeValue(metadata, "status", "before");
  const statusAfter = changeValue(metadata, "status", "after");
  const assignedUserAfter = changeValue(metadata, "assigned_to", "after");
  const assignedAgentAfter = changeValue(metadata, "assigned_to_api_key_id", "after");
  const assignedAfterId = typeof assignedAgentAfter === "string"
    ? apiKeyActorProfileId(assignedAgentAfter)
    : assignedUserAfter;
  const assignedAfterName = profileName(assignedAfterId, profiles);
  const actorId = row.actor_api_key_id ? apiKeyActorProfileId(row.actor_api_key_id) : row.actor_user_id;
  const base = { id: `history:${row.id}`, eventType: row.event_type, actorId, createdAt: row.created_at };

  switch (row.event_type) {
    case "uploaded": {
      const details = [
        metadata.version_no ? `v${metadata.version_no}` : null,
        readableMimeType(metadata.mime_type),
      ].filter(Boolean).join(" · ");
      return { ...base, title: "Uploaded asset", detail: details, meta: metadataUploadSummary(metadata), kind: "upload" };
    }
    case "approved":
      return {
        ...base,
        title: "Approved asset",
        detail: statusBefore ? `${statusText(statusBefore)} to Approved` : null,
        kind: "status",
      };
    case "revision_requested":
      return {
        ...base,
        title: "Requested changes",
        detail: metadata.repeated_request ? "Requested again" : statusBefore ? `${statusText(statusBefore)} to Needs Review` : null,
        kind: "review",
      };
    case "status_changed":
      return {
        ...base,
        title: "Changed status",
        detail: `${statusText(statusBefore)} to ${statusText(statusAfter)}`,
        kind: "status",
      };
    case "renamed": {
      const previousTitle = changeValue(metadata, "title", "before");
      const nextTitle = changeValue(metadata, "title", "after");
      return {
        ...base,
        title: "Renamed asset",
        detail: previousTitle && nextTitle ? `${previousTitle} to ${nextTitle}` : null,
        kind: "update",
      };
    }
    case "assignment_changed":
      return {
        ...base,
        title: assignedAfterId ? "Assigned asset" : "Removed assignment",
        detail: assignedAfterId ? assignedAfterName ?? "New assignee" : null,
        kind: "assignment",
      };
    case "metadata_updated": {
      const fields = metadataChangeFields(metadata, MANUAL_METADATA_FIELDS);
      const primary = fields.includes("description") && fields.includes("tags")
        ? "Updated description and tags"
        : fields.includes("description")
          ? "Updated description"
          : "Updated tags";
      return {
        ...base,
        title: primary,
        detail: metadataChangeDetail(metadata, MANUAL_METADATA_FIELDS, profiles),
        kind: "metadata",
      };
    }
    case "smart_metadata_updated":
      return {
        ...base,
        title: "Updated AI metadata",
        detail: metadataChangeDetail(metadata, AI_METADATA_FIELDS, profiles),
        kind: "smart",
      };
    case "version_stacked":
      return {
        ...base,
        title: "Added to version stack",
        detail: metadata.version_no ? `Version v${metadata.version_no}` : null,
        kind: "version",
      };
    case "version_detached":
      return {
        ...base,
        title: "Removed from version stack",
        detail: metadata.previous_version_no ? `Previously v${metadata.previous_version_no}` : null,
        kind: "version",
      };
    case "version_reordered":
      return {
        ...base,
        title: metadata.promoted_to_root ? "Promoted to primary version" : "Reordered version",
        detail: metadata.version_no ? `Now v${metadata.version_no}` : null,
        kind: "version",
      };
    default:
      if (metadata.changes?.reviewer_ids) {
        return {
          ...base,
          title: "Updated reviewers",
          detail: changeDetail(metadata, "reviewer_ids", profiles),
          kind: "review",
        };
      }
      if (metadata.changes?.project_id) {
        return {
          ...base,
          title: "Moved asset",
          detail: "Project changed",
          kind: "update",
        };
      }
      if (metadata.changes?.description || metadata.changes?.tags) {
        return {
          ...base,
          title: "Updated metadata",
          detail: metadataChangeDetail(metadata, MANUAL_METADATA_FIELDS, profiles),
          kind: "metadata",
        };
      }
      if (metadata.changes?.smart_description || metadata.changes?.smart_tags) {
        return {
          ...base,
          title: "Updated AI metadata",
          detail: metadataChangeDetail(metadata, AI_METADATA_FIELDS, profiles),
          kind: "smart",
        };
      }
      if (metadata.changes && ALL_METADATA_FIELDS.some((field) => metadata.changes?.[field])) {
        return {
          ...base,
          title: "Updated asset metadata",
          detail: metadataChangeDetail(metadata, ALL_METADATA_FIELDS, profiles),
          kind: "metadata",
        };
      }
      return {
        ...base,
        title: metadata.changes?.cover_image_url ? "Updated preview" : "Updated asset",
        detail: changedFieldSummary(metadata),
        kind: "update",
      };
  }
}

function ActivityTimeline({
  history,
  comments,
  loading,
  error,
  profiles,
}: {
  history: AssetHistoryRow[];
  comments: CommentItem[];
  loading: boolean;
  error: string | null;
  profiles: Record<string, ActivityProfile>;
}) {
  const activity = useMemo(() => {
    const historyItems = history.map((entry) => activityFromHistory(entry, profiles));
    const commentItems: ActivityItem[] = comments
      .filter((item) => !item.isDeleted && item.createdAt)
      .map((item) => ({
        id: `comment:${item.id}`,
        eventType: "comment",
        title: item.isCompleted ? "Comment resolved" : item.timeSec != null && Number.isFinite(item.timeSec) ? "Commented at timestamp" : "Commented",
        detail: item.text.replace(/@\[([^:]+):([^\]]+)\]/g, "@$2").replace(/\s+/g, " ").trim(),
        meta: item.hasDrawing ? "Includes annotation drawing" : item.timeSec != null && Number.isFinite(item.timeSec) ? "Timestamped note" : null,
        actorId: item.authorId ?? null,
        actorName: item.author ?? null,
        createdAt: item.createdAt!,
        kind: "comment",
      }));
    return [...historyItems, ...commentItems].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ));
  }, [comments, history, profiles]);

  const eventAppearance = (kind: ActivityItem["kind"]) => {
    switch (kind) {
      case "comment": return { Icon: MessageSquare, color: "border-sky-500/20 bg-sky-500/10 text-sky-300" };
      case "status": return { Icon: CheckCircle2, color: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" };
      case "review": return { Icon: CheckCircle2, color: "border-amber-500/20 bg-amber-500/10 text-amber-300" };
      case "version": return { Icon: Layers, color: "border-violet-500/20 bg-violet-500/10 text-violet-300" };
      case "assignment": return { Icon: UserRound, color: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300" };
      case "upload": return { Icon: Upload, color: "border-blue-500/20 bg-blue-500/10 text-blue-300" };
      case "metadata": return { Icon: Tag, color: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300" };
      case "smart": return { Icon: Sparkles, color: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300" };
      default: return { Icon: Tag, color: "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/70" };
    }
  };

  const counts = useMemo(() => {
    return activity.reduce<Record<ActivityItem["kind"], number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    }, {
      comment: 0,
      status: 0,
      version: 0,
      assignment: 0,
      upload: 0,
      metadata: 0,
      smart: 0,
      review: 0,
      update: 0,
    });
  }, [activity]);

  return (
    <div className="px-3 pb-5 pt-3">
      <div className="mb-4 rounded-lg border border-sidebar-border/55 bg-sidebar-accent/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-sidebar-foreground/70" />
            <span className="text-sm font-medium text-sidebar-foreground">Activity</span>
          </div>
          {!loading && activity.length > 0 ? (
            <Badge variant="secondary" className="h-5 px-2 text-[10px]">
              {activity.length}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-sidebar-foreground/55">Review decisions, comments, versions, assignments, and metadata changes.</p>
        {!loading && activity.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {[
              { label: "Comments", value: counts.comment },
              { label: "Review", value: counts.review + counts.status },
              { label: "Metadata", value: counts.metadata + counts.smart },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-sidebar-border/45 bg-background/45 px-2 py-1.5">
                <div className="text-sm font-semibold leading-none text-sidebar-foreground">{item.value}</div>
                <div className="mt-1 text-[10px] text-sidebar-foreground/45">{item.label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3 px-1">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-sidebar-accent/60" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 w-2/3 animate-pulse rounded bg-sidebar-accent/60" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-sidebar-accent/35" />
              </div>
            </div>
          ))}
        </div>
      ) : error && activity.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <History className="mb-3 h-8 w-8 text-sidebar-foreground/35" />
          <p className="text-sm text-sidebar-foreground/70">Activity unavailable</p>
          <p className="mt-1 text-xs text-sidebar-foreground/45">You do not have access to this asset's audit history.</p>
        </div>
      ) : activity.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <CircleDot className="mb-3 h-8 w-8 text-sidebar-foreground/35" />
          <p className="text-sm text-sidebar-foreground/70">No activity recorded</p>
          <p className="mt-1 text-xs text-sidebar-foreground/45">Changes to this asset will appear here.</p>
        </div>
      ) : (
        <div className="relative space-y-5">
          {error ? (
            <div className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-200/80">
              Audit events are unavailable for your access level. Showing visible discussion activity.
            </div>
          ) : null}
          <div className="space-y-0">
            {activity.map((entry, index) => {
              const appearance = eventAppearance(entry.kind);
              const Icon = appearance.Icon;
              const actor = entry.actorId ? profiles[entry.actorId] : null;
              const actorName = actor?.display_name ?? entry.actorName ?? "System";
              const detail = entry.detail && entry.detail.length > 104 ? `${entry.detail.slice(0, 104)}...` : entry.detail;
              const isLast = index === activity.length - 1;
              return (
                <div key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                  <div className="relative flex w-8 shrink-0 justify-center">
                    {!isLast ? (
                      <div className="absolute bottom-[-1.25rem] top-8 w-px bg-sidebar-border/65" />
                    ) : null}
                    <div className={cn("relative z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-sidebar-background", appearance.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-sidebar-foreground">{entry.title}</span>
                      <span className="shrink-0 text-[11px] text-sidebar-foreground/45" title={new Date(entry.createdAt).toLocaleString()}>
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-sidebar-foreground/55">
                      {actor ? (
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={actor.avatar_url ?? undefined} />
                          <AvatarFallback className={cn("text-[8px]", AVATAR_FALLBACK_CLASS)}>
                            {getAvatarInitials(actor.display_name)}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <span className="truncate">{actorName}</span>
                    </div>
                    {detail ? (
                      <p className="mt-1.5 rounded-md bg-sidebar-accent/25 px-2 py-1.5 text-xs leading-relaxed text-sidebar-foreground/72">
                        {detail}
                      </p>
                    ) : null}
                    {entry.meta ? (
                      <div className="mt-1.5 inline-flex rounded-md border border-sidebar-border/45 px-1.5 py-0.5 text-[10px] text-sidebar-foreground/48">
                        {entry.meta}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Single comment item component
function SingleCommentItem({
  item,
  isLast,
  onItemClick,
  onEditComment,
  onDeleteComment,
  onToggleCompleted,
  profiles,
  mentionedProfiles,
  projectId,
  organizationId,
  workspaceId,
  assetId,
  formatTime,
  canManageComment,
}: {
  item: CommentItem;
  isLast: boolean;
  onItemClick?: (id: string) => void;
  onEditComment?: (id: string, newText: string) => void;
  onDeleteComment?: (id: string) => void;
  onToggleCompleted?: (id: string) => void;
  profiles: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
  mentionedProfiles: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
    org_role?: string;
    project_role?: string;
  }>;
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
  formatTime?: (seconds: number) => string;
  canManageComment: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Convert mention tokens and timestamps to display-friendly format for editing
  const getEditableText = (text: string) => {
    let editableText = text;

    // Convert mention tokens @[id:Display Name] to @Display Name
    editableText = editableText.replace(/@\[([^:]+):([^\]]+)\]/g, '@$2');

    // Convert timestamp tokens (leave as-is since they're already readable)
    // Timestamps are in format like 00:01:23:45 which are human readable

    return editableText;
  };

  // Convert display names back to mention tokens 
  // Note: This is a simplified version. In a full implementation, you'd need:
  // 1. An autocomplete/mention picker during editing
  // 2. A way to resolve display names back to user IDs
  // 3. Proper validation of mentions
  const convertToMentionTokens = (text: string, profiles: typeof mentionedProfiles) => {
    let convertedText = text;

    // Only convert if we have profiles loaded
    if (profiles && Object.keys(profiles).length > 0) {
      // Try to preserve existing mention structure if the display name matches
      // This is a basic approach - ideally you'd have a proper mention system
      Object.entries(profiles).forEach(([userId, profile]) => {
        if (profile.display_name) {
          const displayMention = `@${profile.display_name}`;
          const tokenMention = `@[${userId}:${profile.display_name}]`;
          // Use word boundary to avoid partial matches
          const regex = new RegExp(`\\b${displayMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          convertedText = convertedText.replace(regex, tokenMention);
        }
      });
    }

    return convertedText;
  };

  // Time formatting function (available for future use)
  // const formatTime = (sec?: number) => {
  //   if (sec === undefined || sec === null) return null;
  //   const s = Math.floor(sec % 60);
  //   const m = Math.floor((sec / 60) % 60);
  //   const h = Math.floor(sec / 3600);
  //   const pad = (n: number) => n.toString().padStart(2, "0");
  //   return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  // };

  const handleSaveEdit = () => {
    if (editText.trim() && onEditComment) {
      // editText from SimpleMentionTextareaFinal already contains proper mention format
      onEditComment(item.id, editText.trim());
      setIsEditing(false);
    } else if (!editText.trim()) {
      // If text is empty, revert to original
      setEditText(item.text);
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditText(item.text);
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    // Pass the original text with mention format to SimpleMentionTextareaFinal
    // It will handle the display conversion internally
    setEditText(item.text);
    setIsEditing(true);
  };

  const renderCommentText = (text: string, profiles: typeof mentionedProfiles) => {
    const nodes: React.ReactNode[] = [];

    // Combined regex patterns
    const mentionRegex = /@\[([^:]+):([^\]]+)\]/g;
    const timestampRegex = /(\d{2}:\d{2}:\d{2}:\d{2})/g;
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    // Create an array of all matches with their types
    const allMatches: Array<{
      index: number;
      length: number;
      type: 'mention' | 'timestamp' | 'url';
      match: RegExpExecArray;
    }> = [];

    let match: RegExpExecArray | null;

    // Find all mentions
    mentionRegex.lastIndex = 0;
    while ((match = mentionRegex.exec(text))) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        type: 'mention',
        match
      });
    }

    // Find all timestamps
    timestampRegex.lastIndex = 0;
    while ((match = timestampRegex.exec(text))) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        type: 'timestamp',
        match
      });
    }

    // Find all URLs
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(text))) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        type: 'url',
        match
      });
    }

    // Sort matches by index
    allMatches.sort((a, b) => a.index - b.index);

    // Remove overlapping matches (keep the first one)
    const cleanMatches = [];
    let lastEnd = 0;
    for (const matchItem of allMatches) {
      if (matchItem.index >= lastEnd) {
        cleanMatches.push(matchItem);
        lastEnd = matchItem.index + matchItem.length;
      }
    }

    // Build the rendered nodes
    let currentIndex = 0;
    let keyIdx = 0;

    for (const matchItem of cleanMatches) {
      // Add text before this match
      if (matchItem.index > currentIndex) {
        nodes.push(text.slice(currentIndex, matchItem.index));
      }

      // Add the highlighted match
      const matchText = matchItem.match[0];

      switch (matchItem.type) {
        case 'mention':
          const id = matchItem.match[1];
          const label = matchItem.match[2];
          const mentionedUser = profiles[id];
          const displayRole = mentionedUser?.project_role || mentionedUser?.org_role;

          nodes.push(
            <TooltipProvider key={`mention-${id}-${keyIdx++}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium hover:opacity-80 transition-all duration-200 cursor-pointer ring-1 ring-inset ring-gray-200 dark:ring-gray-700 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:hover:bg-blue-900/50 dark:text-blue-300"
                  >
                    @{label}
                    {displayRole && (
                      <RoleBadge
                        role={displayRole as UserRole}
                        variant="compact"
                        className="ml-0.5"
                      />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={mentionedUser?.avatar_url || undefined} />
                      <AvatarFallback className={cn("text-xs", AVATAR_FALLBACK_CLASS)}>
                        {getAvatarInitials(mentionedUser?.display_name || label)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm">
                        {mentionedUser?.display_name || label}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        {mentionedUser?.org_role && (
                          <RoleBadge role={mentionedUser.org_role as UserRole} />
                        )}
                        {mentionedUser?.project_role && mentionedUser?.project_role !== mentionedUser?.org_role && (
                          <RoleBadge role={mentionedUser.project_role as UserRole} />
                        )}
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
          break;

        case 'timestamp':
          nodes.push(
            <span
              key={`timestamp-${keyIdx++}`}
              className="bg-yellow-400 text-black px-1 rounded font-mono text-sm font-medium"
            >
              {matchText}
            </span>
          );
          break;

        case 'url':
          nodes.push(
            <span
              key={`url-${keyIdx++}`}
              className="text-blue-400 underline cursor-pointer hover:text-blue-300"
              onClick={(e) => {
                e.stopPropagation();
                window.open(matchText, '_blank', 'noopener,noreferrer');
              }}
            >
              {matchText}
            </span>
          );
          break;
      }

      currentIndex = matchItem.index + matchItem.length;
    }

    // Add remaining text
    if (currentIndex < text.length) {
      nodes.push(text.slice(currentIndex));
    }

    return nodes.length > 0 ? nodes : text;
  };

  // const timeStr = formatTime(item.timeSec); // Currently unused, but could be used to show comment timestamps

  const authorProfile =
    item.authorProfile ||
    (item.authorId ? profiles[item.authorId] ?? mentionedProfiles[item.authorId] : null);
  const authorDisplayName = authorProfile?.display_name || item.author || "User";
  const authorAvatar = authorProfile?.avatar_url || "";
  const authorInitials = getAvatarInitials(authorDisplayName);

  const timeString = formatRelativeTime(item.createdAt);

  return (
    <div
      className={cn(
        "group relative mx-2 mb-2 flex gap-2 rounded-lg border border-sidebar-border/50 bg-sidebar-accent/5 px-3 py-2.5 shadow-sm transition-all hover:border-sidebar-border hover:bg-sidebar-accent/20 sm:mx-3 sm:mb-3 sm:gap-3 sm:px-4 sm:py-3",
        item.isCompleted && "opacity-60 hover:opacity-100 bg-sidebar-accent/10",
        !isLast && "mb-2 sm:mb-3"
      )}
      onClick={() => onItemClick?.(item.id)}
      role={onItemClick ? "button" : undefined}
      tabIndex={onItemClick ? 0 : undefined}
    >
      {/* Avatar Column */}
      <div className="shrink-0 pt-0.5">
        <Avatar className="h-7 w-7 ring-1 ring-sidebar-border/50 shadow-sm sm:h-8 sm:w-8">
          <AvatarImage src={authorAvatar} alt={authorDisplayName} />
          <AvatarFallback className={cn("text-[10px] font-medium", AVATAR_FALLBACK_CLASS)}>
            {authorInitials}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Content Column */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Header: Author, Time, Badges, Actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="truncate text-xs font-semibold text-sidebar-foreground sm:text-sm">
              {authorDisplayName}
            </span>

            <span className="whitespace-nowrap text-[11px] text-muted-foreground sm:text-xs">
              {timeString}
            </span>

            {/* Timestamp Badge */}
            {Number.isFinite(item.timeSec) && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 font-mono">
                {formatTime ? formatTime(item.timeSec!) : item.timeSec}
              </span>
            )}

            {/* Version Badge */}
            {item.versionLabel && (
              <Badge variant={item.versionColor as any || "secondary"} className="h-5 px-1.5 text-[10px] pointer-events-none">
                {item.versionLabel}
              </Badge>
            )}

            {/* Drawing Badge */}
            {item.hasDrawing && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <Pen className="h-3 w-3" />
                <span className="hidden sm:inline">Drawing</span>
              </span>
            )}
          </div>

          {/* Actions (visible on hover or if menu open) */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6",
                      item.isCompleted ? "text-green-600 dark:text-green-400" : "text-muted-foreground hover:text-green-600"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCompleted?.(item.id);

                    }}
                  >
                    <CheckCircle2 className={cn("h-4 w-4", item.isCompleted && "fill-current")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {item.isCompleted ? 'Mark incomplete' : 'Complete'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {canManageComment ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="19" cy="12" r="1" />
                      <circle cx="5" cy="12" r="1" />
                    </svg>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit();
                  }}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteComment?.(item.id);
                    }}
                    className="text-red-600 dark:text-red-400 focus:text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {/* Comment Body */}
        <div className="break-all whitespace-pre-wrap break-words text-xs leading-relaxed text-sidebar-foreground/90 sm:text-sm">
          {isEditing ? (
            <div className="space-y-2 mt-1" onClick={e => e.stopPropagation()}>
              <SimpleMentionTextareaFinal
                ref={textareaRef}
                value={editText}
                onChange={setEditText}
                placeholder="Edit comment..."
                projectId={projectId}
                organizationId={organizationId}
                workspaceId={workspaceId}
                assetId={assetId}
                placement="bottom"
                maxHeight="none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === 'Escape') {
                    handleCancelEdit();
                  }
                }}
                className={cn(
                  "w-full min-h-[4rem] resize-none placeholder:text-sidebar-foreground/50 focus:ring-1 relative z-20",
                  "text-sidebar-foreground bg-sidebar-accent/30 border-sidebar-border/50 focus:border-sidebar-ring focus:ring-sidebar-ring/20 rounded-md p-2"
                )}
                style={{
                  minHeight: '4rem',
                  lineHeight: '1.5',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word'
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="h-7 px-3 text-xs">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveEdit} className="h-7 px-3 text-xs">
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={cn(item.isCompleted && "line-through decoration-sidebar-foreground/40 text-sidebar-foreground/60")}>
                {renderCommentText(item.text, mentionedProfiles)}
              </div>

              {/* Footer: Reactions */}
              {!isEditing && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {Object.entries(item.emoji ?? {}).map(([k, v]) => (
                    <EmojiPill key={k} emoji={k} count={v as number} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>


      </div>
    </div>
  );
}

export default function CommentsPanel({
  className,
  titleLeft = "Comments",
  titleRight = "Info",
  items,
  onItemClick,

  // Comment actions
  onEditComment,
  onDeleteComment,
  onToggleCompleted,

  // Context for enhanced mentions and role loading
  projectId,
  organizationId,
  workspaceId,
  assetId,

  // Asset data for Fields tab
  asset,
  onAssetMetadataSave,
  profiles = {},

  // Bottom comment dock props
  showCommentDock = false,
  currentTime,
  includeTimestamp = true,
  onToggleTimestamp,
  formatTime,
  annotating = false,
  onToggleAnnotating,
  tool = "pen",
  onToolChange,
  color = "#ff7a00",
  onColorChange,
  canUndo = false,
  onUndo,
  onClear,
  onCommentSubmit,
}: CommentsPanelProps) {
  const [activeTab, setActiveTab] = useState<'comments' | 'fields' | 'activity'>('comments');
  const [mentionedProfiles, setMentionedProfiles] = useState<Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
    org_role?: string;
    project_role?: string;
  }>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activityHistory, setActivityHistory] = useState<AssetHistoryRow[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<Record<string, ActivityProfile>>({});
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityReloadToken, setActivityReloadToken] = useState(0);
  const [projectLocations, setProjectLocations] = useState<AssetProjectLocation[]>([]);
  const [projectLocationsLoading, setProjectLocationsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadedProfilesRef = useRef<Set<string>>(new Set());
  // Scan items for mention tokens AND author IDs
  useEffect(() => {
    let mounted = true;
    const ids = new Set<string>();

    // Add mention IDs from comment text @[id:Display Name]
    const re = /@\[([^:]+):([^\]]+)\]/g;
    for (const it of items) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(it.text))) {
        ids.add(m[1]);
      }

      // Add author IDs if available
      if (it.authorId && !it.authorId.startsWith("api-key:")) {
        ids.add(it.authorId);
      }
    }

    const fetchProfiles = async () => {
      try {
        const idList = Array.from(ids);
        if (idList.length === 0) return;

        // Use ref to track what's already loaded to avoid re-fetching
        const missing = idList.filter((i) => !loadedProfilesRef.current.has(i));
        if (missing.length === 0) return;

        // Mark as being loaded
        missing.forEach(id => loadedProfilesRef.current.add(id));

        // Fetch profiles
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", missing)
          .limit(200);

        if (!mounted) return;

        // Prepare enhanced profile data with roles
        const enhancedProfiles: typeof mentionedProfiles = {};

        if (profiles) {
          for (const profile of profiles) {
            enhancedProfiles[profile.id] = { ...profile };
            // Roles should ideally be passed down or fetched via edge function if needed.
            // Skipping direct table query to avoid RLS issues.
          }
        }

        setMentionedProfiles((prev) => ({
          ...prev,
          ...enhancedProfiles,
        }));
      } catch (e) {
        console.error("Failed to load mentioned profiles", e);
      }
    };
    void fetchProfiles();
    return () => {
      mounted = false;
    };
  }, [items, projectId, organizationId]); // Removed mentionedProfiles from deps to prevent infinite loop

  useEffect(() => {
    setActivityHistory([]);
    setActivityProfiles({});
    setActivityError(null);
    setActivityReloadToken(0);
    setProjectLocations([]);
  }, [assetId]);

  useEffect(() => {
    if (activeTab !== "fields" || !assetId) return;
    let cancelled = false;

    const loadProjectLocations = async () => {
      setProjectLocationsLoading(true);
      try {
        const { data, error } = await invokeEdgeFunction<{ data?: AssetProjectLocation[] }>("asset", {
          body: {
            action: "asset_projects",
            asset_id: assetId,
          },
        });

        if (cancelled) return;
        if (error) throw error;
        setProjectLocations(Array.isArray(data?.data) ? data.data : []);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load asset projects", error);
          setProjectLocations(asset?.project_id ? [{
            id: asset.project_id,
            name: "Current project",
            is_primary: true,
            linked_at: null,
          }] : []);
        }
      } finally {
        if (!cancelled) setProjectLocationsLoading(false);
      }
    };

    void loadProjectLocations();
    return () => {
      cancelled = true;
    };
  }, [activeTab, asset?.project_id, assetId]);

  useEffect(() => {
    if (activeTab !== "activity" || !assetId) return;
    let cancelled = false;

    const loadHistory = async () => {
      setActivityLoading(true);
      const { data, error } = await supabase
        .from("asset_history")
        .select("id, asset_id, event_type, actor_user_id, actor_api_key_id, metadata, created_at")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        setActivityHistory([]);
        setActivityError(error.message || "Unable to load activity");
        setActivityLoading(false);
        return;
      }

      const rows = (data ?? []) as AssetHistoryRow[];
      const userIds = new Set<string>();
      const apiKeyIds = new Set<string>();
      for (const row of rows) {
        if (row.actor_user_id) userIds.add(row.actor_user_id);
        if (row.actor_api_key_id) apiKeyIds.add(row.actor_api_key_id);

        for (const side of ["before", "after"] as const) {
          const assignedUser = changeValue(row.metadata, "assigned_to", side);
          const assignedAgent = changeValue(row.metadata, "assigned_to_api_key_id", side);
          if (typeof assignedUser === "string" && assignedUser) userIds.add(assignedUser);
          if (typeof assignedAgent === "string" && assignedAgent) apiKeyIds.add(assignedAgent);
        }
      }

      const [userResult, apiKeyActors] = await Promise.all([
        userIds.size
          ? supabase.from("profiles").select("id, display_name, avatar_url").in("id", Array.from(userIds))
          : Promise.resolve({ data: [], error: null }),
        loadApiKeyActorProfiles(Array.from(apiKeyIds)),
      ]);

      if (cancelled) return;
      const loadedProfiles: Record<string, ActivityProfile> = { ...apiKeyActors };
      for (const profile of (userResult.data ?? []) as ActivityProfile[]) {
        loadedProfiles[profile.id] = profile;
      }

      setActivityHistory(rows);
      setActivityProfiles(loadedProfiles);
      setActivityError(null);
      setActivityLoading(false);
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeTab, activityReloadToken, assetId]);

  useEffect(() => {
    if (activeTab !== "activity" || !assetId) return;
    const channel = supabase
      .channel(`asset-activity:${assetId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asset_history", filter: `asset_id=eq.${assetId}` },
        () => setActivityReloadToken((value) => value + 1),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeTab, assetId]);

  // Sort items by time
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      // If both have media time, sort by media time
      if (Number.isFinite(a.timeSec) && Number.isFinite(b.timeSec)) {
        return (a.timeSec || 0) - (b.timeSec || 0);
      }
      // Otherwise sort by creation time (oldest first)
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  }, [items]);
  const activityProfileMap = useMemo(
    () => ({ ...mentionedProfiles, ...profiles, ...activityProfiles }),
    [activityProfiles, mentionedProfiles, profiles],
  );

  return (
    <aside className={cn("flex h-full min-h-0 w-full flex-col overflow-hidden border-t border-sidebar-border bg-background/95 backdrop-blur lg:w-[400px] lg:min-w-[320px] lg:max-w-[400px] lg:border-l lg:border-t-0", className)}>
      {/* Header */}
      <div className="shrink-0 px-4 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <div className="grid w-full grid-cols-3 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab('comments')}
              className={cn(
                "h-8 rounded-md px-3 font-medium",
                activeTab === 'comments'
                  ? "text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent/80"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              {titleLeft}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab('fields')}
              className={cn(
                "h-8 rounded-md px-3 font-medium",
                activeTab === 'fields'
                  ? "text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent/80"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              {titleRight}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab('activity')}
              className={cn(
                "h-8 rounded-md px-2 font-medium",
                activeTab === 'activity'
                  ? "text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent/80"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              Activity
            </Button>
          </div>
          {/* <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <SortAsc className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <Search className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                    <circle cx="5" cy="12" r="1" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem>Mark all read</DropdownMenuItem>
                <DropdownMenuItem>Copy link</DropdownMenuItem>
                <DropdownMenuItem>Export…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div> */}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0">
        <ScrollArea className={cn("flex-1 min-h-0 w-full", showCommentDock && "pb-2")}>
          {activeTab === 'comments' ? (
            // Comments Tab Content
            sortedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4 mt-10">
                <div className="w-12 h-12 rounded-full bg-sidebar-accent/50 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-sidebar-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sidebar-foreground/60 text-sm">No comments yet</p>
                <p className="text-sidebar-foreground/40 text-xs mt-1">Start a conversation</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {sortedItems
                  .filter(item => !item.isDeleted)
                  .map((item, idx, filteredItems) => (
                    <motion.div
                      key={item.id}
                      layout="position"
                      initial={{ opacity: 0, y: 12, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.985 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <SingleCommentItem
                        item={item}
                        isLast={idx === filteredItems.length - 1}
                        onItemClick={onItemClick}
                        onEditComment={onEditComment}
                        onDeleteComment={onDeleteComment}
                        onToggleCompleted={onToggleCompleted}
                        profiles={profiles}
                        mentionedProfiles={mentionedProfiles}
                        projectId={projectId}
                        organizationId={organizationId}
                        workspaceId={workspaceId}
                        assetId={assetId}
                        formatTime={formatTime}
                        canManageComment={Boolean(currentUserId && item.authorId === currentUserId)}
                      />
                    </motion.div>
                  ))}
              </AnimatePresence>
            )
          ) : activeTab === 'fields' ? (
            <AssetFields
              asset={asset}
              profiles={profiles}
              projectLocations={projectLocations}
              loadingProjectLocations={projectLocationsLoading}
              onAssetMetadataSave={onAssetMetadataSave}
            />
          ) : (
            <ActivityTimeline
              history={activityHistory}
              comments={items}
              loading={activityLoading}
              error={activityError}
              profiles={activityProfileMap}
            />
          )}
        </ScrollArea>

        {/* Bottom Comment Dock - Fixed at bottom */}
        {showCommentDock && activeTab === 'comments' && (
          <div className="mt-auto shrink-0">
            <BottomCommentDock
              currentTime={currentTime}
              includeTimestamp={includeTimestamp}
              onToggleTimestamp={onToggleTimestamp || (() => { })}
              formatTime={formatTime}
              annotating={annotating}
              onToggleAnnotating={onToggleAnnotating || (() => { })}
              tool={tool}
              onToolChange={onToolChange || (() => { })}
              color={color}
              onColorChange={onColorChange || (() => { })}
              canUndo={canUndo}
              onUndo={onUndo || (() => { })}
              onClear={onClear || (() => { })}
              onSubmit={onCommentSubmit || (() => { })}
              projectId={projectId}
              organizationId={organizationId}
              workspaceId={workspaceId}
              assetId={assetId}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

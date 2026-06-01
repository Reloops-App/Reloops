import * as React from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Image as ImageIcon,
  Images,
  Move,
  Palette,
  Pencil,
  RotateCcw,
  SmilePlus,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabaseClient";
import {
  COLLECTION_HEADER_BACKGROUND_PRESETS,
  COLLECTION_HEADER_ICON_COLORS,
  COLLECTION_HEADER_ICON_EMOJIS,
  type CollectionHeaderDefinition,
  type CollectionRecord,
  getCollectionHeaderBackgroundPreset,
} from "@/lib/collections";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CollectionCreatorProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
} | null;

export type CollectionHeaderBackgroundAssetOption = {
  rootId: string;
  assetId: string;
  label: string;
  imageUrl: string;
  mimeType: string | null;
};

type Props = {
  workspaceId: string;
  collection: CollectionRecord;
  titleDraft: string;
  onTitleChange: (value: string) => void;
  onTitleCommit: () => Promise<void>;
  creatorProfile: CollectionCreatorProfile;
  assetCount: number;
  backgroundAssets: CollectionHeaderBackgroundAssetOption[];
  onPatchHeader: (patch: Partial<CollectionHeaderDefinition>) => Promise<void> | void;
  editable?: boolean;
};

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function creatorName(profile: CollectionCreatorProfile, createdBy: string | null | undefined) {
  if (profile?.display_name?.trim()) return profile.display_name.trim();
  if (createdBy) return "Workspace member";
  return "Unknown creator";
}

function initialsForName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CO";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function buildHeroBackgroundStyle(header: CollectionHeaderDefinition, resolvedUrl: string | null): React.CSSProperties {
  const position = `${header.background.position_x}% ${header.background.position_y}%`;
  if ((header.background.mode === "upload" || header.background.mode === "asset") && resolvedUrl) {
    return {
      backgroundImage: `url("${resolvedUrl}")`,
      backgroundPosition: position,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
    };
  }

  const preset = getCollectionHeaderBackgroundPreset(header.background.preset_id);
  return {
    backgroundImage: preset.backgroundImage,
    backgroundPosition: position,
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
  };
}

export function CollectionBrandHeader({
  workspaceId,
  collection,
  titleDraft,
  onTitleChange,
  onTitleCommit,
  creatorProfile,
  assetCount,
  backgroundAssets,
  onPatchHeader,
  editable = true,
}: Props) {
  const header = collection.header;
  const iconPreviewStyle = header.icon.mode === "image" ? undefined : { backgroundColor: header.icon.color };
  const [descriptionDraft, setDescriptionDraft] = React.useState(header.description);
  const [positionDraft, setPositionDraft] = React.useState<[number, number]>([
    header.background.position_x,
    header.background.position_y,
  ]);
  const [titleEditing, setTitleEditing] = React.useState(false);
  const [descriptionEditing, setDescriptionEditing] = React.useState(false);
  const [backgroundPickerOpen, setBackgroundPickerOpen] = React.useState(false);
  const [iconPickerOpen, setIconPickerOpen] = React.useState(false);
  const [backgroundUploading, setBackgroundUploading] = React.useState(false);
  const [iconUploading, setIconUploading] = React.useState(false);
  const [positionDragging, setPositionDragging] = React.useState(false);
  const backgroundUploadRef = React.useRef<HTMLInputElement | null>(null);
  const iconUploadRef = React.useRef<HTMLInputElement | null>(null);
  const titleInputRef = React.useRef<HTMLInputElement | null>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement | null>(null);
  const positionDraftRef = React.useRef<[number, number]>([
    header.background.position_x,
    header.background.position_y,
  ]);
  const dragStateRef = React.useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    width: number;
    height: number;
    startPosition: [number, number];
  } | null>(null);

  React.useEffect(() => {
    setDescriptionDraft(header.description);
  }, [header.description]);

  React.useEffect(() => {
    setPositionDraft([header.background.position_x, header.background.position_y]);
    positionDraftRef.current = [header.background.position_x, header.background.position_y];
  }, [header.background.position_x, header.background.position_y]);

  React.useEffect(() => {
    if (!titleEditing) return;
    const input = titleInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [titleEditing]);

  React.useEffect(() => {
    if (!descriptionEditing) return;
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
  }, [descriptionEditing]);

  const resolvedBackgroundUrl = React.useMemo(() => {
    if (header.background.mode === "asset") {
      return backgroundAssets.find((asset) => asset.rootId === header.background.asset_root_id)?.imageUrl
        ?? header.background.image_url
        ?? null;
    }
    return header.background.image_url ?? null;
  }, [backgroundAssets, header.background.asset_root_id, header.background.image_url, header.background.mode]);

  const heroStyle = React.useMemo(
    () => buildHeroBackgroundStyle({
      ...header,
      background: {
        ...header.background,
        position_x: positionDraft[0],
        position_y: positionDraft[1],
      },
    }, resolvedBackgroundUrl),
    [header, positionDraft, resolvedBackgroundUrl],
  );

  const currentIconLabel = React.useMemo(
    () => initialsForName(titleDraft || collection.name),
    [collection.name, titleDraft],
  );

  const setDraftPosition = React.useCallback((next: [number, number]) => {
    const normalized: [number, number] = [clampPercent(next[0]), clampPercent(next[1])];
    positionDraftRef.current = normalized;
    setPositionDraft(normalized);
    return normalized;
  }, []);

  const commitBackgroundPosition = React.useCallback(async (next: [number, number]) => {
    const normalized: [number, number] = [
      Math.round(clampPercent(next[0]) * 10) / 10,
      Math.round(clampPercent(next[1]) * 10) / 10,
    ];
    positionDraftRef.current = normalized;
    setPositionDraft(normalized);
    if (
      normalized[0] === header.background.position_x
      && normalized[1] === header.background.position_y
    ) {
      return;
    }
    await onPatchHeader({
      icon: header.icon,
      background: {
        ...header.background,
        position_x: normalized[0],
        position_y: normalized[1],
      },
    });
  }, [header.background, onPatchHeader]);

  const nudgeBackgroundPosition = React.useCallback((axis: "x" | "y", delta: number) => {
    const current = positionDraftRef.current;
    const next: [number, number] = axis === "x"
      ? [current[0] + delta, current[1]]
      : [current[0], current[1] + delta];
    void commitBackgroundPosition(next);
  }, [commitBackgroundPosition]);

  const handlePositionPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      width: rect.width,
      height: rect.height,
      startPosition: [positionDraftRef.current[0], positionDraftRef.current[1]],
    };
    setPositionDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePositionPointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = dragState.width > 0
      ? ((event.clientX - dragState.startClientX) / dragState.width) * 100
      : 0;
    const deltaY = dragState.height > 0
      ? ((event.clientY - dragState.startClientY) / dragState.height) * 100
      : 0;
    setDraftPosition([
      dragState.startPosition[0] + deltaX,
      dragState.startPosition[1] + deltaY,
    ]);
  }, [setDraftPosition]);

  const finishPositionDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setPositionDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void commitBackgroundPosition(positionDraftRef.current);
  }, [commitBackgroundPosition]);

  const handlePositionKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 8 : 3;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeBackgroundPosition("x", -step);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeBackgroundPosition("x", step);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      nudgeBackgroundPosition("y", -step);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      nudgeBackgroundPosition("y", step);
    }
  }, [nudgeBackgroundPosition]);

  const onDescriptionBlur = React.useCallback(async () => {
    const nextDescription = descriptionDraft.trim();
    if (nextDescription === header.description) return;
    await onPatchHeader({ description: nextDescription });
  }, [descriptionDraft, header.description, onPatchHeader]);

  const uploadToWorkspaceBucket = React.useCallback(async (file: File, kind: "background" | "icon") => {
    const safeName = sanitizeFileName(file.name || `${kind}.png`);
    const path = `collection_headers/${workspaceId}/${collection.id}/${kind}-${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("workspaces").upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    return supabase.storage.from("workspaces").getPublicUrl(path).data.publicUrl;
  }, [collection.id, workspaceId]);

  const handleBackgroundUpload = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackgroundUploading(true);
    try {
      const publicUrl = await uploadToWorkspaceBucket(file, "background");
      await onPatchHeader({
        icon: header.icon,
        background: {
          ...header.background,
          mode: "upload",
          image_url: publicUrl,
          asset_root_id: null,
        },
      });
      toast.success("Header background updated");
    } catch (error) {
      console.error("Background upload failed", error);
      toast.error("Failed to upload header background");
    } finally {
      setBackgroundUploading(false);
      event.currentTarget.value = "";
    }
  }, [header.background, onPatchHeader, uploadToWorkspaceBucket]);

  const handleIconUpload = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIconUploading(true);
    try {
      const publicUrl = await uploadToWorkspaceBucket(file, "icon");
      await onPatchHeader({
        icon: {
          ...header.icon,
          mode: "image",
          image_url: publicUrl,
        },
      });
      toast.success("Collection icon updated");
    } catch (error) {
      console.error("Icon upload failed", error);
      toast.error("Failed to upload collection icon");
    } finally {
      setIconUploading(false);
      event.currentTarget.value = "";
    }
  }, [header.icon, onPatchHeader, uploadToWorkspaceBucket]);

  const fileLabel = `${assetCount} ${assetCount === 1 ? "file" : "files"}`;

  return (
    <section className="group/hero relative -mx-6 overflow-hidden rounded-[34px] border border-white/6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.95)]">
      {editable ? (
        <>
          <input
            ref={backgroundUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleBackgroundUpload(event)}
          />
          <input
            ref={iconUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleIconUpload(event)}
          />
        </>
      ) : null}

      <div className="absolute inset-0" style={heroStyle} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,26,0.06)_0%,rgba(5,10,26,0.18)_28%,rgba(4,8,20,0.46)_66%,rgba(2,6,23,0.92)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent via-background/55 to-background" />
      {editable ? (
        <div className="absolute inset-x-0 top-5 z-30 flex justify-center px-4">
          <Popover open={backgroundPickerOpen} onOpenChange={setBackgroundPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className={cn(
                  "h-9 rounded-lg border border-white/12 bg-background/70 px-3.5 text-white shadow-[0_10px_24px_-20px_rgba(15,23,42,0.9)] backdrop-blur-md transition-opacity duration-200 hover:bg-background/80",
                  backgroundPickerOpen
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 group-hover/hero:pointer-events-auto group-hover/hero:opacity-100 group-focus-within/hero:pointer-events-auto group-focus-within/hero:opacity-100",
                )}
              >
                <Pencil className="h-4 w-4" />
                Select Background
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              side="bottom"
              sideOffset={12}
              className="w-[420px] max-w-[calc(100vw-2rem)] space-y-4 rounded-2xl border-border/70 bg-popover/95 p-4 shadow-2xl backdrop-blur-xl"
            >
              <Tabs defaultValue="presets">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="presets">Presets</TabsTrigger>
                  <TabsTrigger value="collection">Collection</TabsTrigger>
                  <TabsTrigger value="upload">Upload</TabsTrigger>
                </TabsList>
                <TabsContent value="presets" className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {COLLECTION_HEADER_BACKGROUND_PRESETS.map((preset) => {
                      const selected = header.background.mode === "preset" && header.background.preset_id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={cn(
                            "relative h-20 overflow-hidden rounded-xl border transition-transform hover:scale-[1.01]",
                            selected ? "border-primary ring-2 ring-primary/20" : "border-border/60",
                          )}
                          onClick={() => void onPatchHeader({
                            icon: header.icon,
                            background: {
                              ...header.background,
                              mode: "preset",
                              preset_id: preset.id,
                              image_url: null,
                              asset_root_id: null,
                            },
                          })}
                        >
                          <div className="absolute inset-0" style={{ backgroundImage: preset.backgroundImage }} />
                          <div className="absolute inset-0 bg-black/10" />
                          <span className="absolute bottom-2 left-2 text-xs font-medium text-white">{preset.label}</span>
                          {selected ? (
                            <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </TabsContent>
                <TabsContent value="collection" className="space-y-3">
                  {backgroundAssets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-sm text-muted-foreground">
                      No visual assets are available in this collection yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {backgroundAssets.slice(0, 9).map((asset) => {
                        const selected = header.background.mode === "asset" && header.background.asset_root_id === asset.rootId;
                        return (
                          <button
                            key={asset.rootId}
                            type="button"
                            className={cn(
                              "relative h-20 overflow-hidden rounded-xl border transition-transform hover:scale-[1.01]",
                              selected ? "border-primary ring-2 ring-primary/20" : "border-border/60",
                            )}
                            onClick={() => void onPatchHeader({
                              icon: header.icon,
                              background: {
                                ...header.background,
                                mode: "asset",
                                asset_root_id: asset.rootId,
                                image_url: asset.imageUrl,
                              },
                            })}
                          >
                            <img src={asset.imageUrl} alt={asset.label} className="h-full w-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2 text-left text-[11px] text-white">
                              <div className="truncate font-medium">{asset.label}</div>
                            </div>
                            {selected ? (
                              <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="upload" className="space-y-3">
                  <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    Upload a dedicated banner image for this collection header.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => backgroundUploadRef.current?.click()}
                    disabled={backgroundUploading}
                  >
                    <Upload className="h-4 w-4" />
                    {backgroundUploading ? "Uploading..." : "Upload background"}
                  </Button>
                </TabsContent>
              </Tabs>

              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">Adjust cover position</div>
                    <div className="text-xs text-muted-foreground">
                      Drag the preview like a cover image to choose the focal area.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => void commitBackgroundPosition([50, 50])}
                    disabled={positionDraft[0] === 50 && positionDraft[1] === 50}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>

                <button
                  type="button"
                  className={cn(
                    "group/position relative block aspect-[16/6] w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40 text-left outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    positionDragging ? "cursor-grabbing" : "cursor-grab",
                  )}
                  style={heroStyle}
                  onPointerDown={handlePositionPointerDown}
                  onPointerMove={handlePositionPointerMove}
                  onPointerUp={finishPositionDrag}
                  onPointerCancel={finishPositionDrag}
                  onKeyDown={handlePositionKeyDown}
                >
                  <div className="absolute inset-0 bg-black/10" />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.08)_0%,rgba(15,23,42,0.04)_46%,rgba(15,23,42,0.24)_100%)]" />
                  <div className="absolute inset-4 rounded-[18px] border border-white/18" />
                  <div className="absolute inset-x-6 top-5 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-md">
                      <Move className="h-3.5 w-3.5" />
                      Drag to reposition
                    </div>
                    <div className="rounded-full border border-white/12 bg-background/65 px-2.5 py-1 text-[11px] font-medium text-white/92 backdrop-blur-md">
                      X {Math.round(positionDraft[0])}% · Y {Math.round(positionDraft[1])}%
                    </div>
                  </div>
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/10 shadow-[0_0_0_6px_rgba(255,255,255,0.08)] backdrop-blur-sm" />
                  <div className="pointer-events-none absolute left-1/2 top-[calc(50%-26px)] h-[52px] w-px -translate-x-1/2 bg-white/50" />
                  <div className="pointer-events-none absolute left-[calc(50%-26px)] top-1/2 h-px w-[52px] -translate-y-1/2 bg-white/50" />
                </button>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    Use drag for coarse placement. Use arrow keys or nudges for fine tuning.
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 p-1 shadow-sm">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => nudgeBackgroundPosition("x", -4)}
                      aria-label="Move background left"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => nudgeBackgroundPosition("y", -4)}
                      aria-label="Move background up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => nudgeBackgroundPosition("y", 4)}
                      aria-label="Move background down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => nudgeBackgroundPosition("x", 4)}
                      aria-label="Move background right"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-[430px] items-end px-8 pb-24 pt-24 sm:px-10 sm:pb-28 sm:pt-28 lg:px-12">
        <div className="max-w-5xl">
          {editable ? (
            <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
              <PopoverTrigger asChild>
                  <button type="button" className="group relative mb-6 block w-fit">
                  <div
                    className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[16px] border border-white/12 bg-background/92 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.95)]"
                    style={iconPreviewStyle}
                  >
                    {header.icon.mode === "image" && header.icon.image_url ? (
                      <img src={header.icon.image_url} alt={collection.name} className="h-full w-full object-cover" />
                    ) : header.icon.mode === "emoji" ? (
                      <span className="text-3xl">{header.icon.emoji || "✨"}</span>
                    ) : (
                      <span className="text-2xl font-semibold text-white">{currentIconLabel}</span>
                    )}
                  </div>
                  <span className="absolute -bottom-2 -right-2 rounded-full border border-white/12 bg-background/92 p-1.5 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    <Pencil className="h-3.5 w-3.5" />
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[360px] space-y-4 rounded-2xl border-border/70 bg-popover/95 p-4 shadow-2xl backdrop-blur-xl">
                <Tabs defaultValue="initials">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="initials">
                      <Palette className="h-4 w-4" />
                      Initials
                    </TabsTrigger>
                    <TabsTrigger value="emoji">
                      <SmilePlus className="h-4 w-4" />
                      Emojis
                    </TabsTrigger>
                    <TabsTrigger value="upload">
                      <Upload className="h-4 w-4" />
                      Upload
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="initials" className="space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                      {COLLECTION_HEADER_ICON_COLORS.map((color) => {
                        const selected = header.icon.mode === "initials" && header.icon.color === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            className={cn(
                              "relative flex aspect-square items-center justify-center rounded-xl border text-sm font-semibold text-white shadow-sm",
                              selected ? "border-primary ring-2 ring-primary/20" : "border-transparent",
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => void onPatchHeader({
                              icon: {
                                ...header.icon,
                                mode: "initials",
                                color,
                              },
                            })}
                          >
                            {currentIconLabel}
                          </button>
                        );
                      })}
                    </div>
                  </TabsContent>
                  <TabsContent value="emoji" className="space-y-3">
                    <div className="grid grid-cols-6 gap-2">
                      {COLLECTION_HEADER_ICON_EMOJIS.map((emoji) => {
                        const selected = header.icon.mode === "emoji" && header.icon.emoji === emoji;
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={cn(
                              "flex h-12 items-center justify-center rounded-lg border bg-background text-2xl transition-colors hover:bg-accent",
                              selected ? "border-primary ring-2 ring-primary/20" : "border-border/60",
                            )}
                            onClick={() => void onPatchHeader({
                              icon: {
                                ...header.icon,
                                mode: "emoji",
                                emoji,
                              },
                            })}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Background Color
                      </div>
                      <div className="grid grid-cols-8 gap-2">
                        {COLLECTION_HEADER_ICON_COLORS.map((color) => {
                          const selected = header.icon.color === color;
                          return (
                            <button
                              key={color}
                              type="button"
                              className={cn(
                                "aspect-square rounded-lg border shadow-sm transition-transform hover:scale-[1.03]",
                                selected ? "border-primary ring-2 ring-primary/20" : "border-border/60",
                              )}
                              style={{ backgroundColor: color }}
                              onClick={() => void onPatchHeader({
                                icon: {
                                  ...header.icon,
                                  color,
                                },
                              })}
                              aria-label={`Set emoji background color to ${color}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="upload" className="space-y-3">
                    <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                      Upload a square mark for the collection icon.
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => iconUploadRef.current?.click()}
                      disabled={iconUploading}
                    >
                      <ImageIcon className="h-4 w-4" />
                      {iconUploading ? "Uploading..." : "Upload icon"}
                    </Button>
                  </TabsContent>
                </Tabs>
              </PopoverContent>
            </Popover>
          ) : (
              <div className="mb-6 w-fit">
                <div
                  className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[16px] border border-white/12 bg-background/92 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.95)]"
                  style={iconPreviewStyle}
                >
                  {header.icon.mode === "image" && header.icon.image_url ? (
                    <img src={header.icon.image_url} alt={collection.name} className="h-full w-full object-cover" />
                  ) : header.icon.mode === "emoji" ? (
                    <span className="text-3xl">{header.icon.emoji || "✨"}</span>
                  ) : (
                    <span className="text-2xl font-semibold text-white">{currentIconLabel}</span>
                  )}
                </div>
            </div>
          )}

          <div className="min-w-0 max-w-4xl">
              {editable && titleEditing ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(event) => onTitleChange(event.target.value)}
                  onBlur={async () => {
                    setTitleEditing(false);
                    await onTitleCommit();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setTitleEditing(false);
                      void onTitleCommit();
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onTitleChange(collection.name);
                      setTitleEditing(false);
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="block h-auto w-full max-w-4xl rounded-xl border border-white/14 bg-white/8 px-3 py-1 text-5xl font-semibold tracking-[-0.06em] text-white shadow-none outline-none placeholder:text-white/46 focus-visible:border-white/18 sm:text-6xl md:text-7xl"
                  placeholder="Untitled Collection"
                />
              ) : editable ? (
                <button
                  type="button"
                  className="group block max-w-4xl rounded-xl border border-transparent px-0 py-1 text-left transition-colors hover:border-white/10 hover:bg-white/4 hover:px-3"
                  onClick={() => setTitleEditing(true)}
                >
                  <div className="text-5xl font-semibold tracking-[-0.06em] text-white sm:text-6xl md:text-7xl">
                    {titleDraft.trim() || "Untitled Collection"}
                  </div>
                </button>
              ) : (
                <div className="block max-w-4xl rounded-xl px-0 py-1 text-left">
                  <div className="text-5xl font-semibold tracking-[-0.06em] text-white sm:text-6xl md:text-7xl">
                    {titleDraft.trim() || "Untitled Collection"}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-white/80">
                <span className="text-white/58">Created by</span>
                <Avatar className="size-6 border border-white/10">
                  <AvatarImage src={creatorProfile?.avatar_url ?? undefined} alt={creatorName(creatorProfile, collection.created_by ?? null)} />
                  <AvatarFallback>{initialsForName(creatorName(creatorProfile, collection.created_by ?? null))}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-white">{creatorName(creatorProfile, collection.created_by ?? null)}</span>
                <span className="text-white/35">•</span>
                <span>{fileLabel}</span>
              </div>

              {editable && descriptionEditing ? (
                <textarea
                  ref={descriptionRef}
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onBlur={async () => {
                    setDescriptionEditing(false);
                    await onDescriptionBlur();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDescriptionDraft(header.description);
                      setDescriptionEditing(false);
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Add a description..."
                  className="mt-3 block min-h-0 w-full max-w-2xl resize-none rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/82 outline-none placeholder:text-white/50 focus-visible:border-white/18"
                  rows={2}
                />
              ) : editable ? (
                <button
                  type="button"
                  className="group mt-3 block max-w-2xl rounded-xl border border-transparent px-0 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/4 hover:px-3"
                  onClick={() => setDescriptionEditing(true)}
                >
                  <div className="text-sm text-white/74">
                    {descriptionDraft.trim() || "Add a description..."}
                  </div>
                </button>
              ) : descriptionDraft.trim() ? (
                <div className="mt-3 block max-w-2xl rounded-xl px-0 py-2 text-left">
                  <div className="text-sm text-white/74">
                    {descriptionDraft.trim()}
                  </div>
                </div>
              ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, AudioWaveform, Download, Music, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { invokeEdgeFunction } from "@/api/edge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { cn, downloadFile } from "@/lib/utils";
import { resolveAssetDownloadUrl } from "@/lib/mediaDelivery";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { SeekBar } from "../video-player/seekbar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { MentionDisplayText } from "../ui/mention-display";
import { getAvatarInitials } from "@/lib/avatar-utils";
import CommentsPanel from "./CommentsPanel";
import AnnotationToast from "./shared/AnnotationToast";
import { useWaveformPeaks } from "./shared/useWaveformPeaks";
import { useDrawing } from "./shared/useDrawing";
import CanvasOverlay from "./shared/CanvasOverlay";
import { BubblePin } from "./shared/PinMarker";
import { ReviewModeBar, type ReviewMode } from "./shared/ReviewModeBar";
import { InlineNoteComposer } from "./shared/InlineNoteComposer";
import { getDrawingBounds, mergeAnnotationOverrides, type Annotation, type Stroke } from "./annotator-utils";

function createAnchorStroke(point: { x: number; y: number }, color: string): Stroke {
  return { tool: "pen", color, points: [point] };
}

type AudioReviewAsset = {
  id: string;
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  smart_tags?: string[] | null;
  smart_description?: string | null;
  coverUrl?: string | null;
  cover_image_url?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  uploaded_by?: string | null;
  created_at?: string;
  updated_at?: string | null;
  uploaded_at?: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  version_no?: number | null;
  storage_path?: string | null;
  signed_url?: string | null;
  delivery_url?: string | null;
  cdn_url?: string | null;
};

export type AudioReviewProps = {
  audioUrl: string;
  annotations?: Annotation[];
  className?: string;
  title?: string | null;
  onAddAnnotation?: (annotation: Annotation) => void | Promise<void>;
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
  asset?: AudioReviewAsset | null;
  onAssetMetadataSave?: (patch: { description: string | null; tags: string[] }) => Promise<void> | void;
  onRetagAsset?: () => void;
  retagStatus?: "idle" | "queued" | "error";
  commentsPanelOpen?: boolean;
  onCommentsPanelOpenChange?: (open: boolean) => void;
  commentMutationContext?: CommentMutationContext;
  // Which edge function edit/delete calls target — defaults to the shared
  // "comment" function used by every existing caller. A share flow with its
  // own isolated comment function can point this elsewhere without changing
  // behavior for anyone else.
  commentEndpoint?: string;
  onMediaError?: () => void;
  fallbackDownloadUrl?: string | null;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function commentItemFromAnnotation(annotation: Annotation) {
  return {
    id: annotation.id,
    author: annotation.author,
    authorId: annotation.authorId,
    text: annotation.text,
    emoji: annotation.emoji,
    timeSec: annotation.time,
    isCompleted: annotation.isCompleted,
    isDeleted: annotation.isDeleted,
    canManageComment: annotation.canManageComment,
    canDeleteComment: annotation.canDeleteComment,
    createdAt: annotation.createdAt,
  };
}

export default function AudioReview({
  audioUrl,
  annotations: annotationsProp = [],
  className,
  title,
  onAddAnnotation,
  projectId,
  organizationId,
  workspaceId,
  assetId,
  asset,
  onAssetMetadataSave,
  onRetagAsset,
  retagStatus,
  commentsPanelOpen,
  onCommentsPanelOpenChange,
  commentMutationContext,
  commentEndpoint = "comment",
  onMediaError,
  fallbackDownloadUrl,
  profiles = {},
}: AudioReviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const { peaks: waveform, loading: waveformLoading } = useWaveformPeaks(audioUrl);
  const {
    annotating,
    setAnnotating,
    tool,
    setTool,
    color,
    setColor,
    draftStrokes,
    activeStroke,
    allStrokes,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    clearStrokes,
    addStroke,
  } = useDrawing();
  const [reviewMode, setReviewMode] = useState<ReviewMode>("view");
  const [inlineComposerOpen, setInlineComposerOpen] = useState(false);
  const [inlineComposerText, setInlineComposerText] = useState("");
  // Holds only the fields the user has locally changed (delete/complete/
  // edit), keyed by annotation id, re-applied on every sync below -- see
  // mergeAnnotationOverrides for why: without it, deleting a comment and
  // then adding another one (or anything else that refreshes
  // annotationsProp) before the delete's own server round-trip/realtime
  // echo lands would silently resurrect it, since the next prop sync still
  // carries the pre-delete shape.
  const [annotationOverrides, setAnnotationOverrides] = useState<Record<string, Partial<Annotation>>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>(annotationsProp);
  const applyLocalAnnotationUpdate = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotationOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setAnnotations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const durationHackRef = useRef(false);
  const seekHackInFlightRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [playbackError, setPlaybackError] = useState(false);
  const [showToast, setShowToast] = useState<Annotation | null>(null);
  const panelOpen = commentsPanelOpen ?? true;
  const canCompleteComments = !commentMutationContext?.share_token;

  // Edit/delete target the "comment" function by default (unchanged for
  // every existing caller). A share flow with its own isolated comment
  // function passes commentEndpoint to route here instead — that function
  // takes an action-based POST body rather than comment's PATCH-with-status.
  const editOrDeleteComment = useCallback(async (action: "edit" | "delete", fields: { id: string; body?: string }) => {
    if (commentEndpoint === "comment") {
      const patchBody: Record<string, unknown> = { id: fields.id, ...(commentMutationContext ?? {}) };
      if (action === "edit") patchBody.body = fields.body;
      else patchBody.status = "deleted";
      return invokeEdgeFunction("comment", { method: "PATCH", body: patchBody });
    }
    return invokeEdgeFunction(commentEndpoint, {
      method: "POST",
      body: { action, id: fields.id, body: fields.body, ...(commentMutationContext ?? {}) },
    });
  }, [commentEndpoint, commentMutationContext]);

  useEffect(() => {
    setAnnotations(mergeAnnotationOverrides(annotationsProp, annotationOverrides));
  }, [annotationsProp, annotationOverrides]);

  useEffect(() => {
    setPlaybackError(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    durationHackRef.current = false;
  }, [audioUrl]);

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => !annotation.isDeleted),
    [annotations],
  );
  const timelineAnnotations = useMemo(
    () => visibleAnnotations.filter((annotation) => Number.isFinite(annotation.time) && (annotation.time as number) >= 0),
    [visibleAnnotations],
  );
  const commentItems = useMemo(
    () => visibleAnnotations.map(commentItemFromAnnotation),
    [visibleAnnotations],
  );

  // Persisted drawing strokes (waveform pins/regions) for every annotation,
  // shown all at once rather than only ones near the current playhead.
  // Stroke coordinates are stored as fractions of the waveform container
  // (see the comment-click handler below), and the waveform always shows the
  // full duration at a fixed size — it doesn't scroll or re-center on
  // playback — so every drawing already renders at its own correct position
  // along the timeline regardless of where currentTime is. Filtering by
  // proximity to currentTime only hid drawings you hadn't scrubbed to yet,
  // forcing a seek to each comment's timestamp just to see its sketch.
  const savedStrokes = useMemo<Stroke[]>(() => {
    return visibleAnnotations.flatMap((annotation) => annotation.drawing || []);
  }, [visibleAnnotations]);

  const draftAnchorBounds = useMemo(() => getDrawingBounds(draftStrokes), [draftStrokes]);
  const draftAnchorFocus = draftAnchorBounds
    ? { x: (draftAnchorBounds.minX + draftAnchorBounds.maxX) / 2, y: (draftAnchorBounds.minY + draftAnchorBounds.maxY) / 2 }
    : null;
  const hasStereoWaveform = !!waveform?.right?.length;

  const closeInlineComposer = useCallback(() => {
    setInlineComposerOpen(false);
    setInlineComposerText("");
    clearStrokes();
  }, [clearStrokes]);

  // Sync annotating with reviewMode + pause playback when entering comment/draw modes
  useEffect(() => {
    setAnnotating(reviewMode === "draw");
    if (reviewMode === "comment" || reviewMode === "draw") {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
        setPlaying(false);
      }
    }
  }, [reviewMode, setAnnotating]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    const near = timelineAnnotations.find((annotation) => Math.abs((annotation.time as number) - currentTime) < 0.6);
    setShowToast(near ?? null);
  }, [currentTime, timelineAnnotations]);

  // Audio served through the CDN proxy sometimes reports duration as
  // Infinity until the browser has walked the whole file, which normally
  // only happens once playback starts — that's why the waveform's duration
  // (and therefore seeking and pin positions, both driven by the `duration`
  // state) looked stuck at 0 until you pressed play. Forcing a seek past
  // the end resolves the real duration immediately, without playback.
  function resolveInfiniteDuration(audio: HTMLAudioElement) {
    if (durationHackRef.current) return;
    durationHackRef.current = true;
    seekHackInFlightRef.current = true;
    const resumeAt = audio.currentTime;
    audio.currentTime = 1e101;
    const onTimeUpdate = () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.currentTime = resumeAt;
      seekHackInFlightRef.current = false;
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
  }

  function handleDurationCandidate(audio: HTMLAudioElement) {
    const nextDuration = audio.duration;
    if (Number.isFinite(nextDuration)) {
      setDuration(nextDuration);
      return;
    }
    if (nextDuration === Infinity) resolveInfiniteDuration(audio);
  }

  function seekTo(time: number) {
    if (!audioRef.current || !Number.isFinite(time)) return;
    if (audioRef.current.duration === Infinity) resolveInfiniteDuration(audioRef.current);
    const maxTime = audioRef.current.duration || duration || 0;
    const nextTime = Math.max(0, Math.min(time, maxTime || time));
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seekToAnnotation(id: string) {
    const annotation = annotations.find((item) => item.id === id);
    if (!annotation || !Number.isFinite(annotation.time)) return;
    seekTo(annotation.time as number);
    void audioRef.current?.play().catch(() => undefined);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  async function submitComment(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const user = await getLoggedInUserProfile().catch(() => null);
    const payload: Annotation = {
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      time: includeTimestamp ? currentTime : Number.NaN,
      text: trimmed,
      author: user?.full_name,
      authorId: user?.sub,
      createdAt: new Date().toISOString(),
      emoji: {},
      drawing: [],
    };

    setCommentText("");
    if (!onAddAnnotation) {
      setAnnotations((prev) => prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]);
      return;
    }

    await onAddAnnotation(payload);
  }

  async function submitInlineComment() {
    const trimmed = inlineComposerText.trim();
    if (!trimmed) return;

    const anchorTime = draftAnchorFocus ? draftAnchorFocus.x * duration : currentTime;
    const user = await getLoggedInUserProfile().catch(() => null);
    const payload: Annotation = {
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      time: includeTimestamp ? anchorTime : Number.NaN,
      text: trimmed,
      author: user?.full_name,
      authorId: user?.sub,
      createdAt: new Date().toISOString(),
      emoji: {},
      drawing: [...allStrokes],
    };

    closeInlineComposer();
    setReviewMode("view");
    if (!onAddAnnotation) {
      setAnnotations((prev) => (prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]));
      return;
    }
    await onAddAnnotation(payload);
  }

  const displayTitle = title || asset?.title || "Audio asset";
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const coverImageUrl = asset?.cover_image_url ?? asset?.coverUrl ?? null;
  const panelAsset = asset
    ? {
      ...asset,
      title: displayTitle,
      created_at: asset.created_at ?? "",
      storage_path: asset.storage_path ?? "",
    }
    : null;
  const downloadUrl = audioUrl || (asset?.storage_path ? resolveAssetDownloadUrl(asset) : "");

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="relative flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden bg-black text-white">
          <ReviewModeBar
            mode={reviewMode}
            onModeChange={(mode) => {
              closeInlineComposer();
              setReviewMode(mode);
            }}
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            hidePreview
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Ambient glow — a blurred wash of the artwork itself behind the
                player, the way modern "now playing" surfaces (Apple Music,
                Spotify) make plain art feel alive instead of floating in flat black. */}
            {coverImageUrl ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 opacity-40"
                style={{
                  backgroundImage: `url(${coverImageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: "blur(80px) saturate(1.4)",
                  transform: "scale(1.25)",
                }}
              />
            ) : null}
            <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/10 via-black/50 to-black" />

            <audio
              ref={audioRef}
              preload="metadata"
              onLoadedMetadata={(event) => handleDurationCandidate(event.currentTarget)}
              onDurationChange={(event) => handleDurationCandidate(event.currentTarget)}
              onTimeUpdate={(event) => {
                if (seekHackInFlightRef.current) return;
                setCurrentTime(event.currentTarget.currentTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => {
                setPlaybackError(true);
                onMediaError?.();
              }}
            >
              <source src={audioUrl} type={asset?.mime_type ?? undefined} />
              Your browser cannot play this audio file.
            </audio>

            {/* Compact "now playing" header — art + title kept small and out of
                the way so the waveform below gets the room to be the hero. */}
            <div className="relative z-10 flex shrink-0 items-center gap-3 px-5 pb-3 pt-4">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                {coverImageUrl ? (
                  <img src={coverImageUrl} alt="" draggable={false} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_56%),linear-gradient(180deg,_rgba(255,255,255,0.08),_rgba(255,255,255,0.02))]">
                    <Music className="h-6 w-6 text-white/68" />
                  </div>
                )}
              </div>
              <div className="min-w-0 text-left">
                <h1 className="truncate text-sm font-semibold">{displayTitle}</h1>
                <div className="mt-0.5 text-xs text-white/50">
                  {hasDuration ? formatAudioTime(duration) : asset?.mime_type || "Audio"}
                </div>
              </div>
            </div>

            {playbackError ? (
              <div className="relative z-10 mx-5 mb-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Audio playback failed. Download the file to listen locally.</span>
              </div>
            ) : null}

            {/* HERO waveform — the primary visual/seek surface, filling the rest
                of the available space so it's unmistakable at a glance: this is
                an audio review screen, not a generic media player. */}
            <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-4">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-1.5 text-[#35c8d6]">
                  <AudioWaveform className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Waveform</span>
                </div>
                {reviewMode === "comment" ? (
                  <span className="text-[11px] font-medium text-[#35c8d6]">Click a spot to comment there</span>
                ) : null}
                {reviewMode === "draw" ? (
                  <span className="text-[11px] font-medium text-[#35c8d6]">Drag to mark a region</span>
                ) : null}
              </div>

              <div
                ref={waveformContainerRef}
                className="relative min-h-[140px] flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
              >
                <SeekBar
                  current={currentTime}
                  duration={duration}
                  annotations={timelineAnnotations}
                  onSeek={seekTo}
                  waveform={waveform}
                  waveformLoading={waveformLoading}
                  hideMarkers
                />

                {waveform && hasStereoWaveform ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/50 px-1 py-0.5 text-[10px] font-bold leading-none text-white/70">
                      L
                    </span>
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/50 px-1 py-0.5 text-[10px] font-bold leading-none text-white/70">
                      R
                    </span>
                  </>
                ) : null}

                {/* Comment pins — real avatars along the top edge instead of a
                    plain tick, so you can see at a glance who commented and when.
                    Kept to one row (not tied to the L/R divider) so pins never
                    collide with the waveform bars or each other. */}
                <TooltipProvider>
                  {duration > 0 ? timelineAnnotations.map((annotation) => {
                    // duration is only known once the audio's metadata has
                    // loaded — until then, positioning as a fraction of
                    // duration would divide by zero. Hiding every pin rather
                    // than falling back to a fixed 0% (which piled every pin
                    // into the left corner for the whole loading window,
                    // wherever their real timestamp actually was) matches the
                    // same guard the shared SeekBar/Markers component already
                    // uses for exactly this case.
                    const left = ((annotation.time as number) / duration) * 100;
                    return (
                      <Tooltip key={annotation.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="absolute top-3 z-20 -translate-x-1/2 -translate-y-1/2 transition-transform hover:z-30 hover:scale-110"
                            style={{ left: `${left}%` }}
                            onClick={(event) => {
                              event.stopPropagation();
                              seekToAnnotation(annotation.id);
                            }}
                            aria-label={`Jump to ${formatAudioTime(annotation.time as number)}`}
                          >
                            <BubblePin
                              size={20}
                              initials={getAvatarInitials(annotation.author || "?")}
                              userId={annotation.authorId}
                              userName={annotation.author}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-yellow-300 text-black">{formatAudioTime(annotation.time as number)}</Badge>
                            <MentionDisplayText className="font-medium" text={annotation.text} />
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }) : null}
                </TooltipProvider>

                {reviewMode === "comment" ? (
                  <div
                    className="absolute inset-0 z-10 cursor-copy"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const point = {
                        x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width) / rect.width,
                        y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) / rect.height,
                      };
                      addStroke(createAnchorStroke(point, color), true);
                      setInlineComposerText(commentText);
                      setInlineComposerOpen(true);
                    }}
                  />
                ) : null}

                <CanvasOverlay
                  targetRef={waveformContainerRef as unknown as React.RefObject<HTMLElement>}
                  annotating={annotating}
                  strokes={[...savedStrokes, ...allStrokes]}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={() => {
                    const hadActiveStroke = !!activeStroke;
                    pointerUp();
                    if (!hadActiveStroke) return;
                    setInlineComposerText(commentText);
                    setInlineComposerOpen(true);
                  }}
                  onPointerCancel={pointerCancel}
                />

                {(reviewMode === "comment" || reviewMode === "draw") && draftAnchorFocus ? (
                  <div
                    className="pointer-events-none absolute z-20 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#35c8d6]/70 bg-[#35c8d6] text-[9px] font-semibold text-slate-950 shadow-[0_12px_30px_rgba(53,200,214,0.28)] ring-4 ring-[#35c8d6]/20"
                    style={{ left: `${draftAnchorFocus.x * 100}%`, top: `${draftAnchorFocus.y * 100}%` }}
                  >
                    +
                  </div>
                ) : null}

                {/* Composer floats over the waveform, anchored near where you
                    clicked/drew — it never resizes the hero panel around it
                    the way a bottom-docked composer would. */}
                {inlineComposerOpen && draftAnchorFocus ? (
                  <div
                    className="absolute z-30 w-[280px] max-w-[calc(100%-24px)]"
                    style={{
                      left: `max(8px, min(calc(${draftAnchorFocus.x * 100}% + 18px), calc(100% - 296px)))`,
                      top: `max(16px, min(calc(${draftAnchorFocus.y * 100}% - 12px), calc(100% - 220px)))`,
                    }}
                  >
                    <InlineNoteComposer
                      value={inlineComposerText}
                      onChange={setInlineComposerText}
                      color={color}
                      label={
                        hasStereoWaveform
                          ? draftAnchorFocus.y < 0.5
                            ? "Add note (L channel)"
                            : "Add note (R channel)"
                          : "Add note at this position"
                      }
                      hint={`Timestamp: ${formatAudioTime(draftAnchorFocus.x * duration)}`}
                      projectId={projectId}
                      organizationId={organizationId}
                      workspaceId={workspaceId}
                      assetId={assetId}
                      onCancel={closeInlineComposer}
                      onSubmit={submitInlineComment}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <AnnotationToast
              show={!!showToast}
              author={showToast?.author}
              time={showToast?.time}
              text={showToast?.text ?? ""}
              emoji={showToast?.emoji}
            />
          </div>

          <div className="shrink-0 border-t border-white/10 bg-black/90 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition hover:scale-105 hover:bg-white"
                onClick={togglePlay}
                aria-label={playing ? "Pause audio" : "Play audio"}
              >
                {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
              </Button>
              <div className="whitespace-nowrap text-xs font-medium tabular-nums text-white/50">
                <span className="text-white">{formatAudioTime(currentTime)}</span>
                <span className="mx-1 text-white/30">/</span>
                <span>{formatAudioTime(duration)}</span>
              </div>

              <Separator orientation="vertical" className="hidden h-5 bg-white/15 sm:block" />

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setMuted((value) => !value)}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
              <div className="w-20 sm:w-24">
                <Slider
                  value={[muted ? 0 : Math.round(volume * 100)]}
                  onValueChange={([nextValue]) => {
                    setVolume(((nextValue ?? 0) as number) / 100);
                    if (nextValue && muted) setMuted(false);
                  }}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs text-white hover:bg-white/10 hover:text-white">
                    {rate.toFixed(1)}x
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-28">
                  <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((nextRate) => (
                    <DropdownMenuItem key={nextRate} onClick={() => setRate(nextRate)}>
                      {nextRate.toFixed(2).replace(/\.00$/, "")}x
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white"
                onClick={() => void downloadFile(downloadUrl, displayTitle, { fallbackUrl: fallbackDownloadUrl })}
                aria-label="Download audio"
              >
                <Download className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </main>

        {panelOpen ? (
          <div className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none">
            <CommentsPanel
              items={commentItems}
              onItemClick={seekToAnnotation}
              showCommentDock={true}
              currentTime={currentTime}
              includeTimestamp={includeTimestamp}
              onToggleTimestamp={() => setIncludeTimestamp((value) => !value)}
              formatTime={formatAudioTime}
              onCommentSubmit={submitComment}
              commentValue={commentText}
              onCommentChange={setCommentText}
              onEditComment={async (id, newText) => {
                applyLocalAnnotationUpdate(id, { text: newText });
                await editOrDeleteComment("edit", { id, body: newText });
              }}
              onDeleteComment={async (id) => {
                applyLocalAnnotationUpdate(id, { isDeleted: true });
                await editOrDeleteComment("delete", { id });
              }}
              onToggleCompleted={canCompleteComments ? async (id) => {
                const annotation = annotations.find((item) => item.id === id);
                const nextCompleted = !annotation?.isCompleted;
                applyLocalAnnotationUpdate(id, { isCompleted: nextCompleted });
                await invokeEdgeFunction("comment", {
                  method: "PATCH",
                  body: { id, status: nextCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) },
                });
              } : undefined}
              onCollapse={onCommentsPanelOpenChange ? () => onCommentsPanelOpenChange(false) : undefined}
              projectId={projectId}
              organizationId={organizationId}
              workspaceId={workspaceId}
              assetId={assetId}
              asset={panelAsset}
              onAssetMetadataSave={onAssetMetadataSave}
              onRetagAsset={onRetagAsset}
              retagStatus={retagStatus}
              profiles={profiles}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

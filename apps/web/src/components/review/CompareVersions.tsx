import { useEffect, useRef, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, fmtHMSF } from "@/lib/utils";
import { Play, Pause, Maximize2, Check, MessageSquare, ChevronDown } from "lucide-react";
import { SeekBar } from "../video-player/seekbar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CommentsPanel, { CommentItem } from "./CommentsPanel";
import { normalizeAnnotation } from "./annotator-utils";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";

type Version = {
  id: string;
  type: "image" | "video";
  coverUrl?: string; // thumbnail
  src: string; // actual media url
  title?: string;
  version_no?: number;
};

type CompareProps = {
  versions?: Version[];
  allComments?: any[];
  profiles?: Record<string, any>;
};

function VersionThumb({ src, alt }: { src?: string; alt: string }) {
  const background = useImagePreviewBackground({ src });
  return (
    <div className={previewBackgroundClass(background) + " w-10 h-6 rounded overflow-hidden shrink-0 border border-white/5 relative"}>
      {src ? <img src={src} alt={alt} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" /> : null}
    </div>
  );
}

export default function CompareVersions({ versions: versionsProp, allComments = [], profiles = {} }: CompareProps) {
  // Use provided versions; when missing or empty we're in a loading state
  const versions = versionsProp ?? [];
  const loading = !versionsProp || versions.length === 0;

  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(1);
  const [commentScope, setCommentScope] = useState<"all" | "left" | "right">("all");

  // Ensure indices remain valid when the versions array changes
  useEffect(() => {
    if (!versions || versions.length === 0) {
      setLeftIdx(0);
      setRightIdx(0);
      return;
    }

    setLeftIdx((prev) => (prev >= 0 && prev < versions.length ? prev : 0));

    setRightIdx((prev) => {
      // prefer an index different from leftIdx if possible
      if (versions.length === 1) return 0;
      if (prev >= 0 && prev < versions.length && prev !== leftIdx) return prev;
      // choose 1 if available, otherwise the last index
      return Math.min(1, versions.length - 1);
    });
  }, [versions.length, versions[0]?.id]);

  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const masterRef = useRef<HTMLVideoElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  // duration is the max duration of the two videos
  const [duration, setDuration] = useState(0);
  const [leftDuration, setLeftDuration] = useState(0);
  const [rightDuration, setRightDuration] = useState(0);

  const [rate, setRate] = useState(1);
  const leftThumbRef = useRef<HTMLDivElement | null>(null);
  const rightThumbRef = useRef<HTMLDivElement | null>(null);
  const [leftScrollPct, setLeftScrollPct] = useState(0);
  const [rightScrollPct, setRightScrollPct] = useState(0);
  const leftBackground = useImagePreviewBackground({ src: versions[leftIdx]?.src });
  const rightBackground = useImagePreviewBackground({ src: versions[rightIdx]?.src ?? versions[leftIdx]?.src });

  const getVideoElements = () => {
    const videos: HTMLVideoElement[] = [];
    if (versions[leftIdx]?.type === "video" && leftVideoRef.current) videos.push(leftVideoRef.current);
    if (versions[rightIdx]?.type === "video" && rightVideoRef.current) videos.push(rightVideoRef.current);
    return videos;
  };

  // Filter comments based on scope
  const filteredComments = useMemo(() => {
    if (loading || !versions.length) return [];

    const leftV = versions[leftIdx];
    const rightV = versions[rightIdx] ?? versions[leftIdx];

    let targetIds: string[] = [];
    if (commentScope === 'all') {
      targetIds = [leftV.id, rightV.id];
      // Unique check if left == right
      if (leftV.id === rightV.id) targetIds = [leftV.id];
    } else if (commentScope === 'left') {
      targetIds = [leftV.id];
    } else {
      targetIds = [rightV.id];
    }

    const filtered = allComments.filter(c => targetIds.includes(c.asset_id));

    // Map to CommentItem shape required by CommentsPanel
    return filtered.map(c => {
      const isLeft = c.asset_id === leftV.id;
      // Assign versions label if we are in 'all' mode and showing two different versions
      // If left == right, no need for badging difference
      const showBadge = commentScope === 'all' && leftV.id !== rightV.id;

      const versionLabel = showBadge ? (isLeft ? "Ver A" : "Ver B") : undefined;
      const versionColor = showBadge ? (isLeft ? "default" : "secondary") : undefined; // rudimentary color coding logic

      return {
        id: c.id,
        author: profiles[c.author_user_id]?.display_name || "Unknown",
        authorId: c.author_user_id,
        authorProfile: profiles[c.author_user_id],
        text: c.body,
        hasDrawing: !!c.drawing_json,
        timeSec: c.ms_offset ? c.ms_offset / 1000 : undefined,
        isCompleted: c.status === 'completed',
        isDeleted: c.status === 'deleted',
        createdAt: c.created_at,
        versionLabel, // New prop we'll add support for in CommentsPanel
        versionColor,
        assetId: c.asset_id
      };
    });
  }, [allComments, versions, loading, leftIdx, rightIdx, commentScope, profiles]);


  // When playing, pick a master video (left if video, otherwise right) and drive updates via RAF.
  const startMasterLoop = () => {
    cancelMasterLoop();
    const step = () => {
      let master = masterRef.current;
      // If we don't have a master (e.g. images), strictly we don't loop, but we might want to if we have a "play" state for slideshow? 
      // For now assume strictly video syncing.
      if (!master) return;

      const left = leftVideoRef.current;
      const right = rightVideoRef.current;
      const otherCandidate = master === left ? right : left;

      // If the current master has ended but the other video is still playing,
      // hand off control so the longer video can continue driving the UI.
      if (
        otherCandidate &&
        (master.ended || master.paused) &&
        !otherCandidate.paused &&
        !otherCandidate.ended
      ) {
        masterRef.current = otherCandidate;
        master = otherCandidate;
      }

      const videoEls = getVideoElements();
      const anyActive = videoEls.some((video) => !video.paused && !video.ended);
      if (!anyActive) {
        const furthestTime = videoEls.reduce((max, video) => Math.max(max, video.currentTime || 0), 0);
        setCurrent(furthestTime);
        setPlaying(false);
        cancelMasterLoop();
        return;
      }

      const t = master.currentTime || 0;
      setCurrent(t);

      // Safety: If duration is 0 but we are playing, force update duration from ref
      // This fixes cases where onLoadedMetadata didn't fire or state didn't update
      if (duration === 0 && master.duration > 0) {
        if (master === leftVideoRef.current) setLeftDuration(master.duration);
        else setRightDuration(master.duration);
      }

      // Update the other video
      const other = master === leftVideoRef.current ? rightVideoRef.current : leftVideoRef.current;
      const otherDuration = master === leftVideoRef.current ? rightDuration : leftDuration;

      if (other && !master.paused && !master.ended) {
        // Logic for duration mismatch:
        // If the master runs longer, keep the shorter video at its end frame.
        if (t >= otherDuration) {
          if (other.currentTime !== otherDuration) {
            try { other.currentTime = otherDuration; } catch { }
          }
        } else {
          // Sync
          if (Math.abs((other.currentTime || 0) - t) > 0.05) {
            try {
              if (Math.abs((other.currentTime || 0) - t) > 0.25) other.currentTime = t;
              else other.currentTime = t;
              // If master is playing, ensure other is playing (unless it reached end)
              if (!master.paused && other.paused) other.play();
            } catch { }
          }
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const cancelMasterLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const togglePlay = async () => {
    const left = leftVideoRef.current;
    const right = rightVideoRef.current;
    if (loading) return;

    const leftV = versions[leftIdx];
    const rightV = versions[rightIdx] ?? versions[leftIdx];

    masterRef.current = leftV?.type === "video" ? left : rightV?.type === "video" ? right : null;

    if (playing) {
      if (left && !left.paused) left.pause();
      if (right && !right.paused) right.pause();
      cancelMasterLoop();
      setPlaying(false);
      return;
    }

    // Start playback
    setPlaying(true); // Optimistic UI update

    const playPromise = (v: HTMLVideoElement | null) => {
      if (!v) return Promise.resolve();
      if (v.ended) v.currentTime = 0;
      v.playbackRate = rate;
      return v.play().catch(e => console.warn("Play interrupted", e));
    };

    if (leftV?.type === "video" && left) playPromise(left);
    if (rightV?.type === "video" && right) playPromise(right);

    if (masterRef.current) startMasterLoop();
  };

  useEffect(() => {
    // update playbackRate
    const l = leftVideoRef.current;
    const r = rightVideoRef.current;
    if (l) l.playbackRate = rate;
    if (r) r.playbackRate = rate;
  }, [rate]);

  // Reset durations when versions change to avoid stale seekbar
  useEffect(() => {
    setLeftDuration(0);
    setRightDuration(0);
    setCurrent(0);
    setPlaying(false);
    cancelMasterLoop();
  }, [versions[leftIdx]?.id, versions[rightIdx]?.id]);

  // Update master duration when individual durations change
  useEffect(() => {
    // If we have valid durations, use max. 
    // If one is 0 (loading/image), use the other.
    const max = Math.max(leftDuration || 0, rightDuration || 0);
    setDuration(max);
  }, [leftDuration, rightDuration]);

  const onSeek = (t: number) => {
    const l = leftVideoRef.current;
    const r = rightVideoRef.current;
    try {
      if (l && l.duration && l.readyState >= 1) {
        l.currentTime = Math.min(t, l.duration);
      }
      if (r && r.duration && r.readyState >= 1) {
        r.currentTime = Math.min(t, r.duration);
      }
    } catch (e) { console.error(e); }
    setCurrent(t);
  };

  const onLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>, isLeft: boolean) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d)) {
      if (isLeft) setLeftDuration(d);
      else setRightDuration(d);
    }
  };

  // Sync scroll for thumbnails
  useEffect(() => {
    const el = leftThumbRef.current;
    if (!el) return;
    const onScroll = () => {
      const pct = el.scrollWidth > el.clientWidth ? (el.scrollLeft / (el.scrollWidth - el.clientWidth)) * 100 : 0;
      setLeftScrollPct(Math.max(0, Math.min(100, pct)));
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [versions]);

  useEffect(() => {
    const el = rightThumbRef.current;
    if (!el) return;
    const onScroll = () => {
      const pct = el.scrollWidth > el.clientWidth ? (el.scrollLeft / (el.scrollWidth - el.clientWidth)) * 100 : 0;
      setRightScrollPct(Math.max(0, Math.min(100, pct)));
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [versions]);

  const hasVideo = versions[leftIdx]?.type === "video" || versions[rightIdx]?.type === "video";
  const leftV = versions[leftIdx];
  const rightV = versions[rightIdx] ?? versions[leftIdx];

  const handleCommentClick = (id: string) => {
    const comment = allComments.find(c => c.id === id);
    if (comment && comment.ms_offset != null) {
      const t = comment.ms_offset / 1000;
      onSeek(t);
    }
  };

  return (
    <div className="w-full flex h-[calc(100vh-3.5rem)] overflow-hidden bg-black text-white">
      {/* Main Stage */}
      <div className="flex-1 flex flex-col min-w-0 relative group/player">
        {/* Header Overlay (Floating - Always visible on top for clarity but subtle) */}
        <div className="absolute top-0 left-0 right-0 z-20 p-4 pointer-events-none">
          <div className="grid grid-cols-2 gap-4">

            {/* Left Selector Pill */}
            <div className="flex items-center gap-2 pointer-events-auto transition-opacity duration-300 opacity-0 group-hover/player:opacity-100 focus-within:opacity-100">
              <div className="bg-black/60 backdrop-blur-md rounded-lg p-1 flex items-center gap-2 border border-white/10 shadow-sm">
                <div className="px-2 py-1 bg-white/10 rounded text-[10px] font-bold tracking-wider text-white/90">
                  VER A
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-white hover:bg-white/20 hover:text-white font-medium pl-1 pr-2 gap-1.5 text-xs">
                      <span className="truncate max-w-[140px]">{leftV?.title}</span>
                      <span className="opacity-50 font-normal">{leftV?.version_no ? `v${leftV.version_no}` : ''}</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-72 max-h-[320px] overflow-y-auto bg-zinc-900 border-zinc-800" align="start">
                    <DropdownMenuLabel className="text-zinc-400 text-xs uppercase tracking-wider font-normal">Select Version A</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-zinc-800" />
                    {versions.map((v, i) => (
                      <DropdownMenuItem key={v.id} onClick={() => setLeftIdx(i)} className="gap-3 py-2 text-zinc-100 focus:bg-white/10 focus:text-white cursor-pointer group">
                        <VersionThumb src={v.coverUrl} alt={v.title || "Version"} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate text-sm font-medium">{v.title}</span>
                          <span className="text-[10px] text-zinc-500">Version {v.version_no}</span>
                        </div>
                        {i === leftIdx && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Right Selector Pill */}
            <div className="flex items-center gap-2 pointer-events-auto transition-opacity duration-300 opacity-0 group-hover/player:opacity-100 focus-within:opacity-100">
              <div className="bg-black/60 backdrop-blur-md rounded-lg p-1 flex items-center gap-2 border border-white/10 shadow-sm">
                <div className="px-2 py-1 bg-white/10 rounded text-[10px] font-bold tracking-wider text-white/90">
                  VER B
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-white hover:bg-white/20 hover:text-white font-medium pl-1 pr-2 gap-1.5 text-xs">
                      <span className="truncate max-w-[140px]">{rightV?.title}</span>
                      <span className="opacity-50 font-normal">{rightV?.version_no ? `v${rightV.version_no}` : ''}</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-72 max-h-[320px] overflow-y-auto bg-zinc-900 border-zinc-800" align="start">
                    <DropdownMenuLabel className="text-zinc-400 text-xs uppercase tracking-wider font-normal">Select Version B</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-zinc-800" />
                    {versions.map((v, i) => (
                      <DropdownMenuItem key={v.id} onClick={() => setRightIdx(i)} className="gap-3 py-2 text-zinc-100 focus:bg-white/10 focus:text-white cursor-pointer group">
                        <VersionThumb src={v.coverUrl} alt={v.title || "Version"} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate text-sm font-medium">{v.title}</span>
                          <span className="text-[10px] text-zinc-500">Version {v.version_no}</span>
                        </div>
                        {i === rightIdx && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

          </div>
        </div>

        {/* Video Comparison Grid */}
        <div className="flex-1 grid grid-cols-2 gap-[1px] bg-zinc-900 min-h-0 overflow-hidden">
          {/* Left Player Canvas */}
          <div
            className={previewBackgroundClass(leftBackground) + " relative w-full h-full flex items-center justify-end overflow-hidden group/left cursor-pointer"}
            onClick={togglePlay}
          >
            {loading ? <Skeleton className="w-full h-full bg-zinc-900/50" /> : (
              leftV?.type === "image" ? (
                <img src={leftV.src} className="max-w-full max-h-full w-auto h-auto object-contain" />
              ) : (
                <video
                  ref={leftVideoRef}
                  src={leftV?.src}
                  className="max-w-full max-h-full w-auto h-auto object-contain" // Re-add object-contain strictly
                  onLoadedMetadata={(e) => onLoadedMetadata(e, true)}
                  muted // Muted by default to allow autoplay policies if needed, though we trigger physically
                />
              )
            )}
          </div>

          {/* Right Player Canvas */}
          <div
            className={previewBackgroundClass(rightBackground) + " relative w-full h-full flex items-center justify-start overflow-hidden group/right cursor-pointer"}
            onClick={togglePlay}
          >
            {loading ? <Skeleton className="w-full h-full bg-zinc-900/50" /> : (
              rightV?.type === "image" ? (
                <img src={rightV.src} className="max-w-full max-h-full w-auto h-auto object-contain" />
              ) : (
                <video
                  ref={rightVideoRef}
                  src={rightV?.src}
                  className="max-w-full max-h-full w-auto h-auto object-contain"
                  onLoadedMetadata={(e) => onLoadedMetadata(e, false)}
                  muted
                />
              )
            )}
          </div>
        </div>

        {/* Unified Controls (Bottom Dock) - Hide if purely images */}
        {!loading && hasVideo && (
          <div className="h-14 flex-none bg-zinc-950 border-t border-white/10 px-4 flex items-center gap-4 shadow-2xl relative z-50">
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="h-8 w-8 text-white hover:bg-white/10 hover:text-white rounded-full shrink-0 transition-transform active:scale-95"
              disabled={loading}
            >
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
            </Button>

            <div className="flex-1 flex items-center gap-4">
              <span className="text-xs text-zinc-400 font-mono tracking-wide tabular-nums w-[70px] text-right shrink-0">{fmtHMSF(current)}</span>
              <div className="flex-1 h-8 flex items-center group/seekbar">
                <SeekBar
                  current={current}
                  duration={duration}
                  annotations={[]}
                  onSeek={onSeek}
                />
              </div>
              <span className="text-xs text-zinc-500 font-mono tracking-wide tabular-nums w-[70px] text-left shrink-0">{fmtHMSF(duration)}</span>
            </div>

            <div className="flex items-center gap-1 pl-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-zinc-400 hover:text-white hover:bg-white/10 gap-0.5 text-[11px] font-medium px-2 rounded-md">
                    {rate}x
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dark bg-zinc-900 border-zinc-800 text-zinc-200 min-w-[3rem]">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <DropdownMenuItem key={r} onClick={() => setRate(r)} className="focus:bg-white/10 justify-center text-xs">
                      {r}x
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md" onClick={() => {
                leftVideoRef.current?.parentElement?.parentElement?.requestFullscreen();
              }}>
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar: Comments */}
      <div className="w-96 bg-background border-l flex flex-col h-full shrink-0 z-30 shadow-xl">
        <div className="flex-none p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Comments</h2>
            </div>
            <Badge variant="outline" className="font-mono text-[10px] h-5 px-1.5">{filteredComments.length}</Badge>
          </div>

          {/* Tabs for Scope */}
          <div className="w-full">
            <div className="grid grid-cols-3 p-1 bg-muted rounded-lg gap-1">
              <button
                onClick={() => setCommentScope("all")}
                className={cn(
                  "text-[11px] font-semibold py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5",
                  commentScope === "all" ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                Combined
              </button>
              <button
                onClick={() => setCommentScope("left")}
                className={cn(
                  "text-[11px] font-medium py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5",
                  commentScope === "left" ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-primary/70" />
                Ver A
              </button>
              <button
                onClick={() => setCommentScope("right")}
                className={cn(
                  "text-[11px] font-medium py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5",
                  commentScope === "right" ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/70" />
                Ver B
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-muted/5">
          <CommentsPanel
            items={filteredComments}
            profiles={profiles}
            onItemClick={handleCommentClick}
            includeTimestamp={true}
            formatTime={fmtHMSF}
          />
        </div>
      </div>
    </div>
  );
}

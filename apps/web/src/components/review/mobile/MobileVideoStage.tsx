import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

function formatClock(totalSeconds: number) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

type Props = {
    /** Owned by the shell so `beginComment()` can read `currentTime` / call `pause()`. */
    videoRef: React.RefObject<HTMLVideoElement | null>;
    src: string | null | undefined;
    poster?: string | null;
    /** Comment timestamps (seconds) — rendered as dots on the scrubber. */
    markers: number[];
};

/**
 * The mobile video viewer: a lean `<video playsInline>` maximised in the region
 * between the header and the action bar, aspect-preserved (`object-contain`, no
 * crop). Tapping the frame toggles a touch-first control layer (≥ 44px targets)
 * that auto-fades after ~2.5s: centre play/pause, a scrubber with comment
 * markers, mute, and fullscreen (`requestFullscreen`, else the iOS-only
 * `video.webkitEnterFullscreen`). Speed / download / quality live in the
 * header's overflow menu, not here.
 */
export default function MobileVideoStage({ videoRef, src, poster, markers }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [controlsVisible, setControlsVisible] = useState(true);

    const scheduleHide = useCallback(() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
    }, []);

    const revealControls = useCallback(() => {
        setControlsVisible(true);
        scheduleHide();
    }, [scheduleHide]);

    useEffect(() => {
        scheduleHide();
        return () => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [scheduleHide]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onPlay = () => { setPlaying(true); scheduleHide(); };
        const onPause = () => { setPlaying(false); setControlsVisible(true); };
        const onTime = () => setCurrentTime(video.currentTime);
        const onMeta = () => setDuration(video.duration || 0);
        const onVolume = () => setMuted(video.muted);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("timeupdate", onTime);
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("volumechange", onVolume);
        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("timeupdate", onTime);
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("volumechange", onVolume);
        };
    }, [videoRef, scheduleHide]);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
        revealControls();
    }, [videoRef, revealControls]);

    const toggleMute = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        revealControls();
    }, [videoRef, revealControls]);

    const enterFullscreen = useCallback(() => {
        const el = containerRef.current;
        const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        if (el?.requestFullscreen) { void el.requestFullscreen().catch(() => {}); return; }
        if (video?.webkitEnterFullscreen) { try { video.webkitEnterFullscreen(); } catch { /* not ready */ } }
    }, [videoRef]);

    const onSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;
        const next = Number(event.target.value);
        video.currentTime = next;
        setCurrentTime(next);
        revealControls();
    }, [videoRef, revealControls]);

    return (
        <div
            ref={containerRef}
            className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
            onClick={() => (controlsVisible ? setControlsVisible(false) : revealControls())}
        >
            <video
                ref={videoRef}
                src={src ?? undefined}
                poster={poster ?? undefined}
                playsInline
                className="max-h-full max-w-full object-contain"
            />

            {/* Control layer — fades out while playing, back on tap/pause */}
            <div
                className={cn(
                    "pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-200",
                    controlsVisible ? "opacity-100" : "opacity-0",
                )}
            >
                <div className="flex-1" />

                <button
                    type="button"
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={(event) => { event.stopPropagation(); togglePlay(); }}
                    className="pointer-events-auto mx-auto flex size-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
                >
                    {playing ? <Pause className="size-7" /> : <Play className="size-7 translate-x-0.5" />}
                </button>

                <div className="flex-1" />

                <div
                    className="pointer-events-auto flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6 text-white"
                    onClick={(event) => event.stopPropagation()}
                >
                    <span className="shrink-0 text-xs tabular-nums">{formatClock(currentTime)}</span>
                    <div className="relative flex-1">
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.01}
                            value={Math.min(currentTime, duration || 0)}
                            onChange={onSeek}
                            aria-label="Seek"
                            className="h-11 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/30 [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        />
                        {duration > 0 && markers.map((time, index) => (
                            <span
                                key={`${time}-${index}`}
                                className="pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-1 ring-white/70"
                                style={{ left: `${Math.min(100, Math.max(0, (time / duration) * 100))}%` }}
                            />
                        ))}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums">{formatClock(duration)}</span>
                    <button
                        type="button"
                        aria-label={muted ? "Unmute" : "Mute"}
                        onClick={toggleMute}
                        className="flex size-11 items-center justify-center"
                    >
                        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                    </button>
                    <button
                        type="button"
                        aria-label="Fullscreen"
                        onClick={enterFullscreen}
                        className="flex size-11 items-center justify-center"
                    >
                        <Maximize2 className="size-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

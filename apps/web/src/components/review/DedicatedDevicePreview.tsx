import { useEffect, useRef, useState } from "react";
import { Signal, Wifi, Battery, ChevronDown, ShieldCheck, Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    DEVICE_FRAMES,
    PLATFORM_OPTIONS,
    type DeviceFrame,
    type PlatformPreview,
} from "./deviceFrameData";

// Reuse the existing, already-accurate overlay components
import { TikTokOverlay } from "./TikTokOverlay";
import { InstagramOverlay } from "./InstagramOverlay";
import { YouTubeShortsOverlay } from "./YouTubeShortsOverlay";
import { SafeZoneOverlay } from "./SafeZoneOverlay";
import { type SafeZoneAspectRatio } from "./safeZoneData";

interface DedicatedDevicePreviewProps {
    videoSrc?: string;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    visible: boolean;
}

// ─── Status Bar ────────────────────────────────────────────────
function StatusBar({ device, scale }: { device: DeviceFrame; scale: number }) {
    const h = device.statusBar.height * scale;
    const fontSize = Math.max(8, 12 * scale);
    const iconSize = 14 * scale;

    const isApple = device.brand === "Apple";
    const timePos = device.statusBar.timePosition;

    return (
        <div
            className={cn(
                "absolute top-0 left-0 right-0 flex items-center z-30 select-none px-[6%] text-white",
                timePos === "center" ? "justify-center" : "justify-between"
            )}
            style={{ height: h }}
        >
            {/* Left Section */}
            <div className={cn("flex items-center gap-1.5 flex-1", timePos === "center" && "justify-start")}>
                {timePos === "left" && <span className="font-bold tracking-tight" style={{ fontSize }}>9:41</span>}
                {!isApple && device.statusBar.showCarrier && <span className="opacity-80 text-[10px] font-medium" style={{ fontSize: fontSize * 0.8 }}>Reloops</span>}
            </div>

            {/* Center Section */}
            {timePos === "center" && (
                <div className="flex-none">
                    <span className="font-bold tracking-tight" style={{ fontSize }}>9:41</span>
                </div>
            )}

            {/* Right Section */}
            <div className="flex items-center justify-end gap-1.5 flex-1" style={{ gap: 4 * scale }}>
                <Signal style={{ width: iconSize, height: iconSize }} strokeWidth={2.5} />
                <Wifi style={{ width: iconSize, height: iconSize }} strokeWidth={2.5} />
                <Battery style={{ width: iconSize * 1.4, height: iconSize }} strokeWidth={2.5} />
            </div>
        </div>
    );
}

// ─── Dynamic Island / Punch Hole ───────────────────────────────
function NotchElement({ device, scale }: { device: DeviceFrame; scale: number }) {
    if (device.notch.type === "none") return null;

    if (device.notch.type === "dynamic-island") {
        const w = device.screenWidth * (device.notch.widthPct / 100) * scale;
        const h = device.notch.height * scale;
        const top = device.notch.topOffset * scale;
        return (
            <div
                className="absolute left-1/2 -translate-x-1/2 bg-black rounded-full z-40 flex items-center justify-between px-[10%] shadow-inner"
                style={{ width: w, height: h, top }}
            >
                {/* Camera/Sensor hints for realism */}
                <div className="w-1.5 h-1.5 rounded-full bg-white/5" />
                <div className="w-2 h-2 rounded-full bg-blue-500/10" />
            </div>
        );
    }

    // Punch hole
    const size = device.notch.height * scale;
    const top = device.notch.topOffset * scale;
    return (
        <div
            className="absolute left-1/2 -translate-x-1/2 bg-black rounded-full z-40 border border-white/5"
            style={{ width: size, height: size, top }}
        />
    );
}

// ─── Home Indicator ────────────────────────────────────────────
function HomeIndicator({ scale }: { scale: number }) {
    return (
        <div className="absolute bottom-[2%] left-1/2 -translate-x-1/2 z-30">
            <div
                className="bg-white/80 rounded-full"
                style={{ width: 120 * scale, height: 5 * scale }}
            />
        </div>
    );
}

// ─── Physical Buttons ──────────────────────────────────────────
function DeviceButtons({ device, scale }: { device: DeviceFrame; scale: number }) {
    if (!device.buttons) return null;

    return (
        <>
            {device.buttons.map((btn, idx) => {
                const w = 3 * scale;
                const h = (device.screenHeight * (btn.height / 100)) * scale;
                const top = (device.screenHeight * (btn.top / 100)) * scale;
                
                return (
                    <div
                        key={idx}
                        className="absolute bg-neutral-800 border border-white/10 rounded-sm z-0"
                        style={{
                            width: w,
                            height: h,
                            top: top + (device.bezelWidth * scale),
                            [btn.side === "left" ? "left" : "right"]: -w + 0.5,
                            borderTopRightRadius: btn.side === "left" ? 0 : 2,
                            borderBottomRightRadius: btn.side === "left" ? 0 : 2,
                            borderTopLeftRadius: btn.side === "left" ? 2 : 0,
                            borderBottomLeftRadius: btn.side === "left" ? 2 : 0,
                        }}
                    />
                );
            })}
        </>
    );
}

// ─── Platform Overlay Router ───────────────────────────────────
function PlatformOverlay({ platform, safeArea }: { platform: PlatformPreview, safeArea?: { top: number, bottom: number, left: number, right: number } }) {
    switch (platform) {
        case "tiktok":
            return <TikTokOverlay visible safeArea={safeArea} />;
        case "ig-reels":
            return <InstagramOverlay visible mode="reels" safeArea={safeArea} />;
        case "yt-shorts":
            return <YouTubeShortsOverlay visible safeArea={safeArea} />;
        default:
            return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export function DedicatedDevicePreview({ videoSrc, videoRef, visible }: DedicatedDevicePreviewProps) {
    const [selectedDevice, setSelectedDevice] = useState<DeviceFrame>(DEVICE_FRAMES[0]);
    const [selectedPlatform, setSelectedPlatform] = useState<PlatformPreview>("tiktok");
    const [showSafeZones, setShowSafeZones] = useState(false);
    const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");
    
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const syncIntervalRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Measure container to scale device frame
    useEffect(() => {
        if (!containerRef.current || !visible) return;

        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            setContainerSize({ width, height });
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [visible]);

    // Sync preview video with main video
    useEffect(() => {
        const mainVideo = videoRef.current;
        const previewVideo = previewVideoRef.current;
        if (!mainVideo || !previewVideo || !visible) return;

        const syncPlayState = () => {
            if (mainVideo.paused && !previewVideo.paused) {
                previewVideo.pause();
            } else if (!mainVideo.paused && previewVideo.paused) {
                void previewVideo.play();
            }
        };

        const syncTime = () => {
            if (!previewVideo || !mainVideo) return;
            const diff = Math.abs(previewVideo.currentTime - mainVideo.currentTime);
            // Very low threshold for near-perfect sync
            if (diff > 0.05) {
                previewVideo.currentTime = mainVideo.currentTime;
            }
        };

        mainVideo.addEventListener("play", syncPlayState);
        mainVideo.addEventListener("pause", syncPlayState);
        mainVideo.addEventListener("seeked", syncTime);
        mainVideo.addEventListener("timeupdate", syncTime);

        // Frequent sync for drift
        syncIntervalRef.current = window.setInterval(syncTime, 100);

        // Initial sync
        previewVideo.currentTime = mainVideo.currentTime;
        previewVideo.playbackRate = mainVideo.playbackRate;
        syncPlayState();

        return () => {
            mainVideo.removeEventListener("play", syncPlayState);
            mainVideo.removeEventListener("pause", syncPlayState);
            mainVideo.removeEventListener("seeked", syncTime);
            mainVideo.removeEventListener("timeupdate", syncTime);
            if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
        };
    }, [videoRef, visible]);

    if (!visible) return null;

    // Calculate scale: render device to fit within container with padding
    const PADDING = 48; // Increased padding for better aesthetic
    const totalDeviceWidth = selectedDevice.screenWidth + selectedDevice.bezelWidth * 2;
    const totalDeviceHeight = selectedDevice.screenHeight + selectedDevice.bezelWidth * 2;

    let scale = 1;
    if (containerSize.height > 0 && containerSize.width > 0) {
        const scaleH = (containerSize.height - PADDING) / totalDeviceHeight;
        const scaleW = (containerSize.width - PADDING) / totalDeviceWidth;
        scale = Math.min(scaleH, scaleW);
    }

    const renderW = totalDeviceWidth * scale;
    const renderH = totalDeviceHeight * scale;
    const screenW = selectedDevice.screenWidth * scale;
    const screenH = selectedDevice.screenHeight * scale;

    const currentPlatformOption = PLATFORM_OPTIONS.find(p => p.id === selectedPlatform);

    // Map platform to SafeZoneAspectRatio
    const safeZoneType: SafeZoneAspectRatio | null = 
        selectedPlatform === "tiktok" ? "tiktok" :
        selectedPlatform === "ig-reels" ? "ig-reels" :
        selectedPlatform === "yt-shorts" ? "yt-shorts" : 
        selectedPlatform === "none" ? "9:16" : null;

    return (
        <div className="absolute inset-0 z-20 flex flex-col pointer-events-auto overflow-hidden bg-[#0a0a0a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 to-black">
            {/* Header Region */}
            <div className="flex-shrink-0 h-20 w-full flex items-center justify-center z-30 px-4">
                <div className="flex items-center gap-2 bg-black/80 backdrop-blur-2xl px-4 py-2 rounded-full border border-white/[0.1] shadow-2xl">
                    {/* Device selector */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-9 text-sm gap-2 text-white hover:bg-white/10 hover:text-white rounded-full px-4">
                                <span>{selectedDevice.name}</span>
                                <ChevronDown className="h-4 w-4 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="w-56 bg-neutral-900 border-white/10 text-white">
                            {DEVICE_FRAMES.map((d) => (
                                <DropdownMenuItem
                                    key={d.id}
                                    onClick={() => setSelectedDevice(d)}
                                    className={cn("focus:bg-white/10 focus:text-white cursor-pointer", d.id === selectedDevice.id && "bg-white/5 font-bold")}
                                >
                                    {d.name}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="w-px h-5 bg-white/10 mx-1" />

                    {/* Platform selector */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-9 text-sm gap-2 text-white hover:bg-white/10 hover:text-white rounded-full px-4">
                                <div
                                    className="h-2.5 w-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                    style={{ backgroundColor: currentPlatformOption?.color }}
                                />
                                <span>{currentPlatformOption?.label ?? "Platform"}</span>
                                <ChevronDown className="h-4 w-4 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="w-56 bg-neutral-900 border-white/10 text-white">
                            {PLATFORM_OPTIONS.map((p) => (
                                <DropdownMenuItem
                                    key={p.id}
                                    onClick={() => setSelectedPlatform(p.id)}
                                    className={cn("focus:bg-white/10 focus:text-white cursor-pointer", p.id === selectedPlatform && "bg-white/5 font-bold")}
                                >
                                    <div
                                        className="h-2.5 w-2.5 rounded-full mr-3 shrink-0"
                                        style={{ backgroundColor: p.color }}
                                    />
                                    {p.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="w-px h-5 bg-white/10 mx-1" />

                    {/* Safe Zone Toggle */}
                    <Button 
                        variant="ghost"
                        onClick={() => setShowSafeZones(!showSafeZones)}
                        className={cn(
                            "h-9 text-sm gap-2 rounded-full transition-all duration-300 px-4",
                            showSafeZones ? "bg-green-600/30 text-green-400 border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]" : "text-white/60 hover:text-white hover:bg-white/10"
                        )}
                    >
                        <ShieldCheck className={cn("h-4 w-4", showSafeZones ? "text-green-400" : "opacity-50")} />
                        <span className="hidden sm:inline">Safe Zones</span>
                    </Button>

                    {/* Fit/Fill Toggle */}
                    <Button 
                        variant="ghost"
                        onClick={() => setFitMode(fitMode === "cover" ? "contain" : "cover")}
                        className="h-9 text-sm gap-2 rounded-full text-white/60 hover:text-white hover:bg-white/10 px-4"
                        title={fitMode === "cover" ? "Switch to Fit (Show whole video)" : "Switch to Fill (Crop to screen)"}
                    >
                        {fitMode === "cover" ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        <span className="hidden sm:inline">{fitMode === "cover" ? "Fill" : "Fit"}</span>
                    </Button>
                </div>
            </div>

            {/* Device Region - Flex fills remaining space */}
            <div ref={containerRef} className="flex-1 min-h-0 w-full flex items-center justify-center relative z-10 px-4 overflow-visible">
                {scale > 0 && (
                    <div
                        className="relative flex-shrink-0 transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]"
                        style={{
                            width: renderW,
                            height: renderH,
                        }}
                    >
                        {/* Hardware Buttons */}
                        <DeviceButtons device={selectedDevice} scale={scale} />

                        {/* Physical Frame Outer */}
                        <div 
                            className="absolute inset-0 bg-neutral-900 border border-white/10 overflow-hidden"
                            style={{
                                borderRadius: selectedDevice.outerCornerRadius * scale,
                                backgroundColor: selectedDevice.frameColor,
                                boxShadow: "inset 0 0 10px rgba(255,255,255,0.05), inset 0 0 2px rgba(255,255,255,0.2)"
                            }}
                        >
                            {/* Inner Bezel highlight */}
                            <div 
                                className="absolute inset-0 opacity-20 pointer-events-none"
                                style={{
                                    borderRadius: selectedDevice.outerCornerRadius * scale,
                                    border: `${scale}px solid white`,
                                }}
                            />
                        </div>

                        {/* Screen area container (Bezel) */}
                        <div
                            className="absolute bg-black overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,1)]"
                            style={{
                                top: selectedDevice.bezelWidth * scale,
                                left: selectedDevice.bezelWidth * scale,
                                width: screenW,
                                height: screenH,
                                borderRadius: selectedDevice.cornerRadius * scale,
                            }}
                        >
                            <video
                                ref={previewVideoRef}
                                src={videoSrc}
                                className={cn(
                                    "absolute inset-0 w-full h-full transition-all duration-300",
                                    fitMode === "cover" ? "object-cover" : "object-contain bg-black"
                                )}
                                muted
                                playsInline
                                loop
                            />

                            {/* Overlays Container (Scaled to logical points) */}
                            <div
                                className="absolute top-0 left-0 z-20 pointer-events-none"
                                style={{
                                    width: selectedDevice.screenWidth,
                                    height: selectedDevice.screenHeight,
                                    transform: `scale(${scale})`,
                                    transformOrigin: "top left",
                                }}
                            >
                                <PlatformOverlay platform={selectedPlatform} safeArea={selectedDevice.safeArea} />
                                {showSafeZones && safeZoneType && (
                                    <SafeZoneOverlay aspectRatio={safeZoneType} visible={true} />
                                )}
                            </div>

                            <NotchElement device={selectedDevice} scale={scale} />
                            <StatusBar device={selectedDevice} scale={scale} />
                            {selectedDevice.homeIndicator && <HomeIndicator scale={scale} />}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Region */}
            <div className="flex-shrink-0 h-24 w-full flex items-center justify-center z-30 px-4">
                <div className="px-6 py-3 bg-black/80 backdrop-blur-2xl rounded-full border border-white/[0.1] text-xs text-white/50 flex items-center gap-8 shadow-2xl whitespace-nowrap overflow-x-auto max-w-full no-scrollbar">
                    <div className="flex flex-col gap-0.5">
                        <span className="uppercase tracking-widest text-[9px] font-bold text-white/30">Viewport</span> 
                        <span className="text-white/90 font-medium font-mono tracking-tight">{selectedDevice.screenWidth}×{selectedDevice.screenHeight}</span>
                    </div>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex flex-col gap-0.5">
                        <span className="uppercase tracking-widest text-[9px] font-bold text-white/30">Safe Area</span> 
                        <span className="text-white/90 font-medium font-mono tracking-tight">
                            {selectedDevice.screenWidth - selectedDevice.safeArea.left - selectedDevice.safeArea.right}×
                            {selectedDevice.screenHeight - selectedDevice.safeArea.top - selectedDevice.safeArea.bottom}
                        </span>
                    </div>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex flex-col gap-0.5">
                        <span className="uppercase tracking-widest text-[9px] font-bold text-white/30">Fill Rate</span> 
                        <span className="text-white/90 font-medium font-mono tracking-tight">
                            {Math.round(
                                ((selectedDevice.screenWidth - selectedDevice.safeArea.left - selectedDevice.safeArea.right) *
                                    (selectedDevice.screenHeight - selectedDevice.safeArea.top - selectedDevice.safeArea.bottom)) /
                                (selectedDevice.screenWidth * selectedDevice.screenHeight) * 100
                            )}%
                        </span>
                    </div>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex flex-col gap-0.5">
                        <span className="uppercase tracking-widest text-[9px] font-bold text-white/30">Brand</span> 
                        <span className="text-white/90 font-medium">{selectedDevice.brand}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

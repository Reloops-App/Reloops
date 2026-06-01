import { ThumbsUp, ThumbsDown, MessageSquare, Share2, MoreVertical, Music2, Home, PlaySquare, PlusCircle, Youtube, Search, Camera, RotateCcw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SAFE_ZONES } from "./safeZoneData";

interface YouTubeShortsOverlayProps {
    visible: boolean;
    safeArea?: { top: number; bottom: number; left: number; right: number };
}

/**
 * YouTube Shorts UI Overlay - 2026 Reference Implementation
 * Citations:
 * - 9:16 Canvas (1080x1920)
 * - Safe Zones: Top 8-10%, Bottom 25%, Right 15%
 */
export function YouTubeShortsOverlay({ visible, safeArea = { top: 0, bottom: 0, left: 0, right: 0 } }: YouTubeShortsOverlayProps) {
    if (!visible) return null;

    const zone = SAFE_ZONES["yt-shorts"];

    return (
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between text-white select-none overflow-hidden font-sans tracking-tight">
            {/* Top Bar - Right Side Icons */}
            <div
                className="absolute top-0 right-0 flex items-center gap-[22px] px-5 pt-4 transition-all duration-300"
                style={{ marginTop: Math.max(safeArea.top, 0) }}
            >
                <Search className="h-[22px] w-[22px] text-white drop-shadow-lg" strokeWidth={2.5} />
                <Camera className="h-[22px] w-[22px] text-white drop-shadow-lg" strokeWidth={2.5} />
                <MoreVertical className="h-[22px] w-[22px] text-white drop-shadow-lg" strokeWidth={2.5} />
            </div>

            {/* Middle Section: Sidebar & Info */}
            <div className="relative w-full flex-1 min-h-0 pointer-events-none">
                {/* Right Interaction Sidebar - Stacked vertically */}
                <div 
                    className="absolute right-0 flex flex-col items-center gap-[24px] pb-6 transition-all duration-300" 
                    style={{ 
                        bottom: 0, 
                        width: `${zone.right}%`,
                        paddingRight: Math.max(safeArea.right, 4)
                    }}
                >
                    {/* Like */}
                    <div className="flex flex-col items-center gap-1.5">
                        <div className="bg-white/10 rounded-full p-2.5 backdrop-blur-md shadow-lg ring-1 ring-white/5">
                            <ThumbsUp className="h-[26px] w-[26px] text-white fill-white" />
                        </div>
                        <span className="text-[12px] font-bold drop-shadow-md">1.5M</span>
                    </div>

                    {/* Dislike */}
                    <div className="flex flex-col items-center gap-1.5">
                        <div className="bg-white/10 rounded-full p-2.5 backdrop-blur-md shadow-lg ring-1 ring-white/5">
                            <ThumbsDown className="h-[26px] w-[26px] text-white fill-white" />
                        </div>
                        <span className="text-[12px] font-bold drop-shadow-md">Dislike</span>
                    </div>

                    {/* Comments */}
                    <div className="flex flex-col items-center gap-1.5">
                        <div className="bg-white/10 rounded-full p-2.5 backdrop-blur-md shadow-lg ring-1 ring-white/5">
                            <MessageSquare className="h-[26px] w-[26px] text-white fill-white" />
                        </div>
                        <span className="text-[12px] font-bold drop-shadow-md">12K</span>
                    </div>

                    {/* Share */}
                    <div className="flex flex-col items-center gap-1.5">
                        <div className="bg-white/10 rounded-full p-2.5 backdrop-blur-md shadow-lg ring-1 ring-white/5">
                            <Share2 className="h-[26px] w-[26px] text-white fill-white" />
                        </div>
                        <span className="text-[12px] font-bold drop-shadow-md">Share</span>
                    </div>

                    {/* Remix */}
                    <div className="flex flex-col items-center gap-1.5">
                        <div className="bg-white/10 rounded-full p-2.5 backdrop-blur-md shadow-lg ring-1 ring-white/5">
                            <RotateCcw className="h-[26px] w-[26px] text-white" strokeWidth={3} />
                        </div>
                        <span className="text-[12px] font-bold drop-shadow-md">Remix</span>
                    </div>

                    {/* Sound Square (Album Art) */}
                    <div className="mt-2">
                        <div className="h-10 w-10 rounded-[8px] bg-neutral-800 border-[2px] border-white overflow-hidden shadow-2xl relative ring-1 ring-black/20">
                            <div className="w-full h-full bg-gradient-to-br from-red-600 to-purple-700 opacity-90"></div>
                            <div className="absolute inset-0 bg-[url('https://www.youtube.com/favicon.ico')] bg-center bg-no-repeat bg-[length:16px_16px] opacity-40 mix-blend-overlay" />
                        </div>
                    </div>
                </div>

                {/* Bottom Left Info - Channel & Title */}
                <div 
                    className="absolute left-0 flex flex-col gap-4 pb-6 transition-all duration-300" 
                    style={{ 
                        bottom: 0, 
                        right: `${zone.right}%`,
                        paddingLeft: Math.max(safeArea.left + 16, 16)
                    }}
                >
                    {/* Channel Row */}
                    <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border-2 border-white/20 shadow-md">
                            <AvatarFallback className="bg-red-600 text-white text-[10px] font-black">YT</AvatarFallback>
                        </Avatar>
                        <span className="font-bold text-[16px] drop-shadow-lg tracking-tight">@ChannelName</span>
                        <button className="bg-white text-black text-[13px] font-bold px-4 py-2 rounded-full hover:bg-neutral-200 transition-colors shadow-md ml-1">
                            Subscribe
                        </button>
                    </div>

                    {/* Title */}
                    <div className="text-[15px] font-medium leading-[1.3] line-clamp-2 drop-shadow-lg max-w-[95%] text-white/95">
                        Testing YouTube Shorts preview on Reloops. Pixel-perfect 2026 UI implementation! 🎬 #shorts #video
                    </div>

                    {/* Audio Info (Animated Marquee) */}
                    <div className="flex items-center gap-2 text-[14px] font-medium drop-shadow-lg bg-black/20 w-fit px-3 py-1 rounded-full backdrop-blur-md border border-white/5">
                        <Music2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                        <div className="overflow-hidden w-full max-w-[160px]">
                            <div className="whitespace-nowrap animate-marquee">
                                Original Sound - Channel Name • Original Sound - Channel Name
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Red Progress Bar */}
            <div className="w-full h-[2.5px] bg-white/20 relative shrink-0 overflow-hidden">
                <div className="absolute top-0 left-0 bottom-0 bg-[#FF0000] w-[45%] shadow-[0_0_8px_rgba(255,0,0,0.6)]"></div>
            </div>

            {/* YouTube Bottom Nav Bar */}
            <div
                className="shrink-0 w-full bg-[#0f0f0f] flex items-start justify-around px-1 pt-2.5 border-t border-white/10 pointer-events-auto transition-all duration-300 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]"
                style={{ 
                    height: Math.max(52 + safeArea.bottom, 52), 
                    paddingBottom: safeArea.bottom 
                }}
            >
                <div className="flex flex-col items-center gap-1 opacity-100 min-w-[50px]">
                    <Home className="h-[24px] w-[24px] fill-white" strokeWidth={0} />
                    <span className="text-[10px] font-medium text-white/90">Home</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-100 min-w-[50px]">
                    <PlaySquare className="h-[24px] w-[24px] fill-white" strokeWidth={0} />
                    <span className="text-[10px] font-medium text-white/90">Shorts</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-100 justify-center -mt-1 scale-110">
                    <PlusCircle className="h-[42px] w-[42px] text-white stroke-[1.2]" />
                </div>
                <div className="flex flex-col items-center gap-1 opacity-100 min-w-[50px]">
                    <Youtube className="h-[24px] w-[24px] text-white" strokeWidth={2.5} />
                    <span className="text-[10px] font-medium text-white/90">Following</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-100 min-w-[50px]">
                    <Avatar className="h-6 w-6 ring-1 ring-white/20 shadow-sm">
                        <AvatarFallback className="bg-gradient-to-br from-red-600 to-red-900 text-[8px] font-bold">You</AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] font-medium text-white/90">You</span>
                </div>
            </div>
        </div>
    );
}

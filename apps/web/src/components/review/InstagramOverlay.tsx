import { Heart, MessageCircle, Send, MoreHorizontal, Music2, Home, Search, PlusSquare, Video, Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SAFE_ZONES } from "./safeZoneData";

export type InstagramMode = "reels" | "story" | "post";

interface InstagramOverlayProps {
    visible: boolean;
    mode: InstagramMode;
    safeArea?: { top: number; bottom: number; left: number; right: number };
}

/**
 * Instagram Reels UI Overlay - 2026 Reference Implementation
 * Citations:
 * - Unified safe zone: Top 14% (~268px), Bottom 20-35% (~384-672px)
 * - 9:16 Aspect Ratio (1080x1920)
 */
export function InstagramOverlay({ visible, mode, safeArea = { top: 0, bottom: 0, left: 0, right: 0 } }: InstagramOverlayProps) {
    if (!visible) return null;

    const zone = SAFE_ZONES["ig-reels"];

    // Instagram Reels
    if (mode === "reels") {
        return (
            <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between text-white select-none overflow-hidden font-sans tracking-tight">
                {/* Top Bar - "Reels" Title & Camera */}
                <div
                    className="flex justify-between items-center px-4 pt-4 transition-all duration-300"
                    style={{ marginTop: Math.max(safeArea.top, 0) }}
                >
                    <span className="font-bold text-[22px] drop-shadow-lg tracking-tight">Reels</span>
                    <Camera className="h-6 w-6 text-white drop-shadow-lg" strokeWidth={2.5} />
                </div>

                {/* Middle Section: Info & Sidebar */}
                <div className="relative w-full flex-1 min-h-0 pointer-events-none">
                    {/* Right Sidebar - Interaction Rail */}
                    <div 
                        className="absolute right-0 flex flex-col items-center gap-[22px] pb-6 transition-all duration-300" 
                        style={{ 
                            bottom: 0, 
                            width: `${zone.right}%`,
                            paddingRight: Math.max(safeArea.right, 4)
                        }}
                    >
                        {/* Like */}
                        <div className="flex flex-col items-center gap-1">
                            <Heart className="h-[28px] w-[28px] text-white drop-shadow-lg" strokeWidth={2.5} />
                            <span className="text-[13px] font-semibold drop-shadow-md">1.2M</span>
                        </div>

                        {/* Comment */}
                        <div className="flex flex-col items-center gap-1">
                            <MessageCircle className="h-[28px] w-[28px] text-white drop-shadow-lg" strokeWidth={2.5} />
                            <span className="text-[13px] font-semibold drop-shadow-md">4,285</span>
                        </div>

                        {/* Share / Send */}
                        <div className="flex flex-col items-center gap-1">
                            <Send className="h-[26px] w-[26px] text-white drop-shadow-lg -rotate-[15deg] translate-x-0.5" strokeWidth={2.5} />
                            <span className="text-[13px] font-semibold drop-shadow-md">Share</span>
                        </div>

                        {/* More Options */}
                        <div className="flex flex-col items-center gap-1">
                            <MoreHorizontal className="h-6 w-6 text-white drop-shadow-lg" strokeWidth={2.5} />
                        </div>

                        {/* Audio Thumbnail (Small square) */}
                        <div className="mt-1">
                            <div className="h-7 w-7 rounded-[6px] border-[2px] border-white overflow-hidden shadow-lg">
                                <Avatar className="h-full w-full rounded-none">
                                    <AvatarFallback className="bg-gradient-to-br from-purple-600 to-pink-600 text-[6px] font-bold text-white">IG</AvatarFallback>
                                </Avatar>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Info Section - Account & Caption */}
                    <div 
                        className="absolute left-0 flex flex-col gap-3.5 text-left drop-shadow-2xl pb-6 transition-all duration-300" 
                        style={{ 
                            bottom: 0, 
                            right: `${zone.right}%`,
                            paddingLeft: Math.max(safeArea.left + 16, 16)
                        }}
                    >
                        {/* Profile Row */}
                        <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 border border-white/20 shadow-md">
                                <AvatarFallback className="bg-gradient-to-br from-purple-600 to-pink-600 text-white text-[10px] font-bold">IG</AvatarFallback>
                            </Avatar>
                            <span className="font-bold text-[15px] drop-shadow-md tracking-tight">username</span>
                            <button className="text-[13px] font-bold text-white border border-white/60 px-3 py-1 rounded-[8px] bg-white/10 backdrop-blur-md shadow-sm">Follow</button>
                        </div>

                        {/* Caption (Limited lines) */}
                        <div className="text-[15px] leading-[1.4] drop-shadow-lg max-w-[95%] font-normal">
                            <span className="line-clamp-2">The future of social content review is here. Check out how Reloops handles 9:16 safe zones! 🎬 #reels #review</span>
                        </div>

                        {/* Audio Pill */}
                        <div className="flex items-center gap-2 text-[13px] font-bold mt-1 max-w-[80%]">
                            <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-xl border border-white/10 shadow-lg">
                                <Music2 className="h-3.5 w-3.5" />
                                <span className="truncate">Original Audio • username</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Navigation Bar */}
                <div
                    className="shrink-0 w-full bg-black flex items-start justify-around px-2 pt-3 border-t border-white/10 pointer-events-auto transition-all duration-300"
                    style={{ 
                        height: Math.max(50 + safeArea.bottom, 50), 
                        paddingBottom: safeArea.bottom 
                    }}
                >
                    <Home className="h-[26px] w-[26px] text-white opacity-60" strokeWidth={2.5} />
                    <Search className="h-[26px] w-[26px] text-white opacity-60" strokeWidth={2.5} />
                    <PlusSquare className="h-[26px] w-[26px] text-white opacity-60" strokeWidth={2.5} />
                    <Video className="h-[26px] w-[26px] text-white" strokeWidth={3} />
                    <Avatar className="h-[26px] w-[26px] border border-white/40 ring-1 ring-white/10">
                        <AvatarFallback className="bg-neutral-800 text-[8px] font-bold">IG</AvatarFallback>
                    </Avatar>
                </div>
            </div>
        );
    }

    // Instagram Story (Keep simplified as it's less crowded)
    if (mode === "story") {
        return (
            <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between text-white select-none overflow-hidden font-sans tracking-tight">
                {/* Top Bars */}
                <div
                    className="px-2 pt-2 bg-gradient-to-b from-black/60 to-transparent pb-16 transition-all duration-300"
                    style={{ paddingTop: Math.max(safeArea.top, 10) }}
                >
                    <div className="flex gap-1 mb-4 px-1">
                        <div className="flex-1 h-0.5 bg-white rounded-full"></div>
                        <div className="flex-1 h-0.5 bg-white/40 rounded-full"></div>
                    </div>

                    <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 border border-white/30">
                                <AvatarFallback className="bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-bold">IG</AvatarFallback>
                            </Avatar>
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm drop-shadow-lg">username</span>
                                <span className="text-sm text-white/70 font-medium">3h</span>
                            </div>
                        </div>
                        <MoreHorizontal className="h-6 w-6 text-white drop-shadow-lg" />
                    </div>
                </div>

                {/* Bottom Reply Bar */}
                <div
                    className="px-4 flex items-center gap-4 bg-gradient-to-t from-black/60 to-transparent pt-16 transition-all duration-300"
                    style={{ paddingBottom: Math.max(safeArea.bottom + 12, 24) }}
                >
                    <div className="flex-1 border border-white/60 rounded-full px-5 py-3.5 bg-transparent backdrop-blur-md shadow-lg ring-1 ring-white/5">
                        <span className="text-[15px] text-white/90 font-semibold tracking-tight">Send message</span>
                    </div>
                    <Heart className="h-7 w-7 text-white drop-shadow-lg" strokeWidth={2.5} />
                    <Send className="h-7 w-7 text-white -rotate-[15deg] translate-y-[-2px] drop-shadow-lg" strokeWidth={2.5} />
                </div>
            </div>
        );
    }

    return null;
}

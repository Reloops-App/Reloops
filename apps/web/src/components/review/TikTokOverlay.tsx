import { Heart, MessageCircle, Reply, Music2, Plus, Bookmark, Home, Users, MessageSquare, User, Search, LivePhotoIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { SAFE_ZONES } from "./safeZoneData";

interface TikTokOverlayProps {
    visible: boolean;
    safeArea?: { top: number; bottom: number; left: number; right: number };
}

/**
 * TikTok UI Overlay - 2026 Reference Implementation
 * Citations: 
 * - Standard 9:16 Canvas (1080x1920)
 * - Safe Zones: Top 10-12%, Bottom 20-25%, Right 15%
 */
export function TikTokOverlay({ visible, safeArea = { top: 0, bottom: 0, left: 0, right: 0 } }: TikTokOverlayProps) {
    if (!visible) return null;

    const zone = SAFE_ZONES.tiktok;

    return (
        <div className="absolute inset-0 pointer-events-none z-20 font-sans text-white select-none overflow-hidden flex flex-col justify-between bg-transparent">
            {/* Top Bar - Following/For You & Search */}
            <div
                className="flex justify-between items-center px-4 pt-1 transition-all duration-300"
                style={{ marginTop: Math.max(safeArea.top, 10) }}
            >
                {/* Live Button (Top Left) */}
                <div className="flex items-center gap-1 opacity-90 drop-shadow-lg">
                    <div className="w-5 h-5 rounded-sm border border-white flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                    </div>
                    <span className="text-[13px] font-bold tracking-tight">LIVE</span>
                </div>

                {/* Tabs */}
                <div className="flex gap-4 text-[17px] font-bold drop-shadow-md">
                    <span className="text-white/60">Following</span>
                    <span className="relative text-white">
                        For You
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-white rounded-full"></div>
                    </span>
                </div>

                {/* Search (Top Right) */}
                <div className="flex items-center drop-shadow-lg">
                    <Search className="h-6 w-6 text-white" strokeWidth={2.5} />
                </div>
            </div>

            {/* Middle Section: Info & Sidebar */}
            <div className="relative w-full flex-1 min-h-0 pointer-events-none">
                {/* Right Interaction Sidebar */}
                <div 
                    className="absolute right-0 flex flex-col items-center gap-5 pb-6 transition-all duration-300" 
                    style={{ 
                        bottom: 0, 
                        width: `${zone.right}%`,
                        paddingRight: Math.max(safeArea.right, 8)
                    }}
                >
                    {/* Profile Avatar */}
                    <div className="relative mb-2">
                        <div className="h-[48px] w-[48px] rounded-full border-[1.5px] border-white p-0.5 shadow-xl">
                            <Avatar className="h-full w-full">
                                <AvatarImage src="" />
                                <AvatarFallback className={`${AVATAR_FALLBACK_CLASS} text-sm bg-neutral-800`}>U</AvatarFallback>
                            </Avatar>
                        </div>
                        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-[#FE2C55] rounded-full p-[3px] shadow-lg border-2 border-transparent">
                            <Plus className="h-3.5 w-3.5 text-white stroke-[4]" />
                        </div>
                    </div>

                    {/* Like */}
                    <div className="flex flex-col items-center gap-0.5">
                        <Heart className="h-[36px] w-[36px] text-white drop-shadow-lg fill-white" strokeWidth={0} />
                        <span className="text-[12px] font-bold drop-shadow-lg">1.2M</span>
                    </div>

                    {/* Comment */}
                    <div className="flex flex-col items-center gap-0.5">
                        <MessageCircle className="h-[36px] w-[36px] text-white drop-shadow-lg fill-white" strokeWidth={0} />
                        <span className="text-[12px] font-bold drop-shadow-lg">40.5K</span>
                    </div>

                    {/* Bookmark */}
                    <div className="flex flex-col items-center gap-0.5">
                        <Bookmark className="h-[36px] w-[36px] text-white drop-shadow-lg fill-white" strokeWidth={0} />
                        <span className="text-[12px] font-bold drop-shadow-lg">85.2K</span>
                    </div>

                    {/* Share */}
                    <div className="flex flex-col items-center gap-0.5">
                        <Reply className="h-[36px] w-[36px] text-white drop-shadow-lg fill-white scale-x-[-1]" strokeWidth={0} />
                        <span className="text-[12px] font-bold drop-shadow-lg">Share</span>
                    </div>

                    {/* Spinning Music Disc */}
                    <div className="mt-2 animate-spin-slow">
                        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-neutral-800 to-black border-[8px] border-neutral-900 flex items-center justify-center shadow-2xl relative">
                            <div className="absolute inset-0 rounded-full border border-white/10" />
                            <Avatar className="h-5 w-5 rounded-full overflow-hidden">
                                <AvatarImage src="" />
                                <AvatarFallback className="bg-neutral-700 text-[8px]">M</AvatarFallback>
                            </Avatar>
                        </div>
                    </div>
                </div>

                {/* Bottom Info Section */}
                <div 
                    className="absolute left-0 flex flex-col gap-2 pb-6 text-left drop-shadow-2xl transition-all duration-300" 
                    style={{ 
                        bottom: 0, 
                        right: `${zone.right}%`,
                        paddingLeft: Math.max(safeArea.left + 12, 12)
                    }}
                >
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-[17px] hover:underline cursor-pointer tracking-tight">@username</span>
                        <span className="text-[13px] opacity-80 text-white/90">• 2h ago</span>
                    </div>
                    
                    <div className="text-[15px] leading-[1.3] drop-shadow-lg max-w-[98%] font-medium">
                        Exploring the future of creative ops with Reloops! 🚀 #creative #ai #workflow
                    </div>
                    
                    <div className="flex items-center gap-2 text-[14px] font-semibold mt-1 bg-black/10 backdrop-blur-sm w-fit px-2 py-0.5 rounded-full">
                        <Music2 className="h-3.5 w-3.5 shrink-0" />
                        <div className="overflow-hidden w-full max-w-[180px]">
                            <div className="whitespace-nowrap animate-marquee">
                                Original Sound - username • Original Sound - username
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Tab Bar */}
            <div
                className="shrink-0 w-full bg-black/95 flex items-start justify-around px-1 pt-2 border-t border-white/5 pointer-events-auto transition-all duration-300"
                style={{ 
                    height: Math.max(50 + safeArea.bottom, 50), 
                    paddingBottom: safeArea.bottom 
                }}
            >
                <div className="flex flex-col items-center gap-1 opacity-100 min-w-[50px]">
                    <Home className="h-[24px] w-[24px] fill-white" strokeWidth={0} />
                    <span className="text-[10px] font-bold">Home</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-60 min-w-[50px]">
                    <Users className="h-[24px] w-[24px]" strokeWidth={2.5} />
                    <span className="text-[10px] font-bold">Friends</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-100 justify-center pt-[2px]">
                    <div className="h-7 w-11 bg-white rounded flex items-center justify-center relative shadow-[2.5px_0_0_#FE2C55,-2.5px_0_0_#44D9E6]">
                        <Plus className="h-5 w-5 text-black stroke-[3.5]" />
                    </div>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-60 min-w-[50px]">
                    <MessageSquare className="h-[24px] w-[24px]" strokeWidth={2.5} />
                    <span className="text-[10px] font-bold">Inbox</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-60 min-w-[50px]">
                    <User className="h-[24px] w-[24px]" strokeWidth={2.5} />
                    <span className="text-[10px] font-bold">Profile</span>
                </div>
            </div>
        </div>
    );
}

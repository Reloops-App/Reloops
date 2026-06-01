import {
    Settings2,
    Smartphone,
    Layout,
    Square,
    RectangleVertical,
    Music2,
    Instagram,
    Youtube
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SafeZoneAspectRatio } from "./SafeZoneOverlay";
import type { InstagramMode } from "./InstagramOverlay";

interface VideoToolbarProps {
    showTikTokPreview: boolean;
    onToggleTikTokPreview: () => void;
    showYouTubeShortsPreview: boolean;
    onToggleYouTubeShortsPreview: () => void;
    instagramMode: InstagramMode | null;
    onInstagramModeChange: (mode: InstagramMode | null) => void;
    safeZoneMode: SafeZoneAspectRatio | null;
    onSafeZoneChange: (mode: SafeZoneAspectRatio | null) => void;
}

export function VideoToolbar({
    showTikTokPreview,
    onToggleTikTokPreview,
    showYouTubeShortsPreview,
    onToggleYouTubeShortsPreview,
    instagramMode,
    onInstagramModeChange,
    safeZoneMode,
    onSafeZoneChange,
}: VideoToolbarProps) {
    const safeZoneLabels: Record<SafeZoneAspectRatio, string> = {
        "9:16": "Vertical (9:16)",
        "4:5": "Portrait (4:5)",
        "1:1": "Square (1:1)",
        "tiktok": "TikTok",
        "ig-reels": "IG Reels",
        "ig-story": "IG Story",
        "ig-post": "IG Post",
        "yt-shorts": "YT Shorts",
    };

    return (
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/80 p-1.5 shadow-xl backdrop-blur-sm md:gap-2">
            {/* TikTok Preview Toggle */}
            <Button
                variant={showTikTokPreview ? "secondary" : "ghost"}
                size="icon"
                className={cn("h-7 w-7 md:h-8 md:w-8", showTikTokPreview && "bg-white/20 text-white")}
                onClick={onToggleTikTokPreview}
                title="Toggle TikTok Preview"
            >
                <Music2 className="h-4 w-4" />
            </Button>

            {/* YouTube Shorts Preview Toggle */}
            <Button
                variant={showYouTubeShortsPreview ? "secondary" : "ghost"}
                size="icon"
                className={cn("h-7 w-7 md:h-8 md:w-8", showYouTubeShortsPreview && "bg-red-600/20 text-red-500")}
                onClick={onToggleYouTubeShortsPreview}
                title="Toggle YouTube Shorts Preview"
            >
                <Youtube className="h-4 w-4" />
            </Button>

            {/* Instagram Preview Dropdown */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant={instagramMode ? "secondary" : "ghost"}
                        size="icon"
                        className={cn("h-7 w-7 md:h-8 md:w-8", instagramMode && "bg-pink-600/20 text-pink-500")}
                        title="Instagram Preview"
                    >
                        <Instagram className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuLabel>Instagram Preview</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                        checked={instagramMode === null}
                        onCheckedChange={() => onInstagramModeChange(null)}
                    >
                        None
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={instagramMode === "reels"}
                        onCheckedChange={() => onInstagramModeChange("reels")}
                    >
                        Reels
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={instagramMode === "story"}
                        onCheckedChange={() => onInstagramModeChange("story")}
                    >
                        Story
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={instagramMode === "post"}
                        onCheckedChange={() => onInstagramModeChange("post")}
                    >
                        Post (4:5)
                    </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="mx-0.5 h-4 w-px bg-white/20 md:mx-1" />

            {/* Safe Zones Dropdown */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant={safeZoneMode ? "secondary" : "ghost"}
                        size="sm"
                        className={cn("h-7 min-w-0 gap-1 px-2 text-xs font-medium justify-between md:h-8 md:min-w-[110px] md:gap-2", safeZoneMode && "bg-white/20 text-white")}
                    >
                        <div className="flex items-center gap-1 md:gap-2">
                            <Layout className="h-3.5 w-3.5" />
                            <span className="max-w-[72px] truncate md:max-w-[100px]">
                                {safeZoneMode ? safeZoneLabels[safeZoneMode] : "Safe Zones"}
                            </span>
                        </div>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Safe Zones</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === null}
                        onCheckedChange={() => onSafeZoneChange(null)}
                    >
                        None
                    </DropdownMenuCheckboxItem>

                    <DropdownMenuLabel className="text-xs text-muted-foreground mt-2">Generic</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "9:16"}
                        onCheckedChange={() => onSafeZoneChange("9:16")}
                    >
                        <Smartphone className="mr-2 h-3.5 w-3.5" />
                        <span>Vertical (9:16)</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "4:5"}
                        onCheckedChange={() => onSafeZoneChange("4:5")}
                    >
                        <RectangleVertical className="mr-2 h-3.5 w-3.5" />
                        <span>Portrait (4:5)</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "1:1"}
                        onCheckedChange={() => onSafeZoneChange("1:1")}
                    >
                        <Square className="mr-2 h-3.5 w-3.5" />
                        <span>Square (1:1)</span>
                    </DropdownMenuCheckboxItem>

                    <DropdownMenuLabel className="text-xs text-muted-foreground mt-2">Social Media</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "tiktok"}
                        onCheckedChange={() => onSafeZoneChange("tiktok")}
                    >
                        <Music2 className="mr-2 h-3.5 w-3.5" />
                        <span>TikTok Safe Zone</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "ig-reels"}
                        onCheckedChange={() => onSafeZoneChange("ig-reels")}
                    >
                        <Instagram className="mr-2 h-3.5 w-3.5" />
                        <span>IG Reels Safe Zone</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "ig-story"}
                        onCheckedChange={() => onSafeZoneChange("ig-story")}
                    >
                        <Instagram className="mr-2 h-3.5 w-3.5" />
                        <span>IG Story Safe Zone</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={safeZoneMode === "yt-shorts"}
                        onCheckedChange={() => onSafeZoneChange("yt-shorts")}
                    >
                        <Youtube className="mr-2 h-3.5 w-3.5" />
                        <span>YT Shorts Safe Zone</span>
                    </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

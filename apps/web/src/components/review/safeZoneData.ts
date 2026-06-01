export type SafeZoneAspectRatio = "9:16" | "4:5" | "1:1" | "ig-reels" | "ig-story" | "ig-post" | "yt-shorts" | "tiktok";

export interface SafeZoneDimensions {
    top: number;      // Percentage (0-100)
    bottom: number;   // Percentage (0-100)
    left: number;     // Percentage (0-100)
    right: number;    // Percentage (0-100)
    label: string;
    color: string;    // CSS color for the overlay
}

export const SAFE_ZONES: Record<SafeZoneAspectRatio, SafeZoneDimensions> = {
    "9:16": {
        top: 5,
        bottom: 5,
        left: 5,
        right: 5,
        label: "Generic 9:16",
        color: "rgba(34, 197, 94, 0.5)", // Green
    },
    "4:5": {
        top: 10,
        bottom: 10,
        left: 5,
        right: 5,
        label: "Generic 4:5",
        color: "rgba(234, 179, 8, 0.5)", // Yellow
    },
    "1:1": {
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
        label: "Generic 1:1",
        color: "rgba(234, 179, 8, 0.5)", // Yellow
    },
    "tiktok": {
        top: 12,       // System UI & Search
        bottom: 25,    // Caption, Music, and Nav
        left: 4,       // Small margin
        right: 16,     // Interaction bar (Like, Comment, Share)
        label: "TikTok Safe Zone",
        color: "rgba(239, 68, 68, 0.5)", // Red
    },
    "ig-reels": {
        top: 12,       // Header & Camera
        bottom: 25,    // Caption & Nav
        left: 0,
        right: 16,     // Interaction bar
        label: "IG Reels Safe Zone",
        color: "rgba(168, 85, 247, 0.5)", // Purple
    },
    "ig-story": {
        top: 14,       // Progress bar & User info
        bottom: 12,    // Reply bar
        left: 0,
        right: 0,
        label: "IG Story Safe Zone",
        color: "rgba(168, 85, 247, 0.5)", // Purple
    },
    "ig-post": {
        top: 10,
        bottom: 20,
        left: 0,
        right: 0,
        label: "IG Post Safe Zone",
        color: "rgba(234, 179, 8, 0.5)", // Yellow
    },
    "yt-shorts": {
        top: 18,       // Channel info (sometimes at top) & Logo
        bottom: 25,    // Progress bar, Captions & Actions
        left: 4,
        right: 18,     // Action buttons
        label: "YT Shorts Safe Zone",
        color: "rgba(220, 38, 38, 0.5)", // Red
    }
};

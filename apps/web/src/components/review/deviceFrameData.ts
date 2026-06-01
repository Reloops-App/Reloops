// Device frame configurations for the Device Preview Panel
// All dimensions are in CSS pixels (logical pixels) for rendering

export interface DeviceFrame {
    id: string;
    name: string;
    brand: "Apple" | "Samsung" | "Google";
    /** Logical screen width in points/dp */
    screenWidth: number;
    /** Logical screen height in points/dp */
    screenHeight: number;
    /** Corner radius of the screen */
    cornerRadius: number;
    /** Bezel width around the screen */
    bezelWidth: number;
    /** Device outer corner radius */
    outerCornerRadius: number;
    /** Notch/island config */
    notch: {
        type: "dynamic-island" | "punch-hole" | "none";
        /** Width as percentage of screen width */
        widthPct: number;
        /** Height in CSS px */
        height: number;
        /** Top offset from screen edge */
        topOffset: number;
    };
    /** Safe area insets (in CSS px at render scale) */
    safeArea: {
        top: number;
        bottom: number;
        left: number;
        right: number;
    };
    /** Home indicator bar */
    homeIndicator: boolean;
    /** Device color */
    frameColor: string;
    /** Status bar style */
    statusBar: {
        height: number;
        timePosition: "left" | "center";
        showCarrier?: boolean;
    };
    /** Physical buttons configuration */
    buttons?: {
        side: "left" | "right";
        type: "volume" | "power";
        top: number; // Percentage from top
        height: number; // Percentage of device height
    }[];
}

export const DEVICE_FRAMES: DeviceFrame[] = [
    {
        id: "iphone-15-pro",
        name: "iPhone 15 Pro",
        brand: "Apple",
        screenWidth: 393,
        screenHeight: 852,
        cornerRadius: 50,
        bezelWidth: 12,
        outerCornerRadius: 62,
        notch: {
            type: "dynamic-island",
            widthPct: 32,
            height: 37,
            topOffset: 11,
        },
        safeArea: { top: 59, bottom: 34, left: 0, right: 0 },
        homeIndicator: true,
        frameColor: "#1a1a1a",
        statusBar: { height: 54, timePosition: "left" },
        buttons: [
            { side: "left", type: "power", top: 20, height: 4 }, // Action button
            { side: "left", type: "volume", top: 28, height: 8 }, // Volume Up
            { side: "left", type: "volume", top: 38, height: 8 }, // Volume Down
            { side: "right", type: "power", top: 30, height: 12 }, // Side button
        ]
    },
    {
        id: "samsung-s24",
        name: "Galaxy S24",
        brand: "Samsung",
        screenWidth: 360,
        screenHeight: 780,
        cornerRadius: 32,
        bezelWidth: 10,
        outerCornerRadius: 42,
        notch: {
            type: "punch-hole",
            widthPct: 4,
            height: 14,
            topOffset: 8,
        },
        safeArea: { top: 40, bottom: 48, left: 0, right: 0 },
        homeIndicator: false,
        frameColor: "#2a2a2a",
        statusBar: { height: 40, timePosition: "center", showCarrier: true },
        buttons: [
            { side: "right", type: "volume", top: 22, height: 10 },
            { side: "right", type: "power", top: 34, height: 8 },
        ]
    },
    {
        id: "pixel-8",
        name: "Pixel 8",
        brand: "Google",
        screenWidth: 412,
        screenHeight: 915,
        cornerRadius: 40,
        bezelWidth: 14,
        outerCornerRadius: 54,
        notch: {
            type: "punch-hole",
            widthPct: 3.5,
            height: 12,
            topOffset: 10,
        },
        safeArea: { top: 36, bottom: 48, left: 0, right: 0 },
        homeIndicator: false,
        frameColor: "#1f1f1f",
        statusBar: { height: 36, timePosition: "center" },
        buttons: [
            { side: "right", type: "power", top: 20, height: 6 },
            { side: "right", type: "volume", top: 30, height: 10 },
        ]
    },
];

export type PlatformPreview = "tiktok" | "ig-reels" | "yt-shorts" | "none";

export const PLATFORM_OPTIONS: { id: PlatformPreview; label: string; color: string }[] = [
    { id: "none", label: "No Overlay", color: "gray" },
    { id: "tiktok", label: "TikTok", color: "#00f2ea" },
    { id: "ig-reels", label: "IG Reels", color: "#E1306C" },
    { id: "yt-shorts", label: "YT Shorts", color: "#FF0000" },
];

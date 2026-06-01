import { SAFE_ZONES, type SafeZoneAspectRatio } from "./safeZoneData";

interface SafeZoneOverlayProps {
    aspectRatio: SafeZoneAspectRatio;
    visible: boolean;
}

export function SafeZoneOverlay({ aspectRatio, visible }: SafeZoneOverlayProps) {
    if (!visible) return null;

    const zone = SAFE_ZONES[aspectRatio];
    if (!zone) return null;

    return (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden flex items-center justify-center font-sans">
            <div className="relative w-full h-full">
                {/* Center Crosshair - Always useful */}
                <div className="absolute top-1/2 left-0 w-full h-px bg-cyan-400/40" />
                <div className="absolute top-0 left-1/2 w-px h-full bg-cyan-400/40" />

                {/* Top Zone */}
                {zone.top > 0 && (
                    <div 
                        className="absolute top-0 left-0 w-full border-b flex items-end pb-1 pl-2 transition-all duration-300"
                        style={{ 
                            height: `${zone.top}%`, 
                            backgroundColor: zone.color.replace("0.5", "0.15"),
                            borderColor: zone.color.replace("0.5", "0.5") 
                        }}
                    >
                        <span className="text-[10px] font-bold text-white drop-shadow-md opacity-80">Top System UI</span>
                    </div>
                )}

                {/* Bottom Zone */}
                {zone.bottom > 0 && (
                    <div 
                        className="absolute bottom-0 left-0 w-full border-t pt-1 pl-2 transition-all duration-300"
                        style={{ 
                            height: `${zone.bottom}%`, 
                            backgroundColor: zone.color.replace("0.5", "0.15"),
                            borderColor: zone.color.replace("0.5", "0.5") 
                        }}
                    >
                        <span className="text-[10px] font-bold text-white drop-shadow-md opacity-80">Captions & Controls</span>
                    </div>
                )}

                {/* Left Zone */}
                {zone.left > 0 && (
                    <div 
                        className="absolute left-0 border-r flex items-center justify-center transition-all duration-300"
                        style={{ 
                            top: `${zone.top}%`,
                            bottom: `${zone.bottom}%`,
                            width: `${zone.left}%`, 
                            backgroundColor: zone.color.replace("0.5", "0.15"),
                            borderColor: zone.color.replace("0.5", "0.5") 
                        }}
                    >
                        <span className="text-[10px] font-bold text-white drop-shadow-md -rotate-90 whitespace-nowrap opacity-60">Margin</span>
                    </div>
                )}

                {/* Right Zone */}
                {zone.right > 0 && (
                    <div 
                        className="absolute right-0 border-l flex items-center justify-center transition-all duration-300"
                        style={{ 
                            top: `${zone.top}%`,
                            bottom: `${zone.bottom}%`,
                            width: `${zone.right}%`, 
                            backgroundColor: zone.color.replace("0.5", "0.15"),
                            borderColor: zone.color.replace("0.5", "0.5") 
                        }}
                    >
                        <span className="text-[10px] font-bold text-white drop-shadow-md -rotate-90 whitespace-nowrap opacity-80">Interaction Bar</span>
                    </div>
                )}

                {/* Safe Area Border */}
                <div 
                    className="absolute border-2 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.2)] transition-all duration-300 ease-in-out"
                    style={{ 
                        top: `${zone.top}%`,
                        bottom: `${zone.bottom}%`,
                        left: `${zone.left}%`,
                        right: `${zone.right}%`,
                        borderColor: "rgba(34, 197, 94, 0.5)" // Standard green for safe zone
                    }}
                >
                    <div className="absolute top-2 left-2 text-[11px] text-white font-bold bg-green-500/40 px-2 py-0.5 rounded backdrop-blur-sm">
                        {zone.label}
                    </div>
                </div>

                {/* Aspect Ratio Specific crops (like 4:5 inside 9:16) */}
                {aspectRatio === "ig-reels" && (
                    <div className="absolute top-[14.84%] bottom-[14.84%] left-0 right-0 border border-yellow-400/30 border-dashed pointer-events-none">
                        <div className="absolute top-1 right-1 text-[9px] text-yellow-100 bg-yellow-500/30 px-1.5 py-0.5 rounded">Feed Crop (4:5)</div>
                    </div>
                )}
            </div>
        </div>
    );
}

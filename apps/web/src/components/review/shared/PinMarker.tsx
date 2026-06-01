import { cn } from "@/lib/utils";
import { getUserAvatarColor } from "@/lib/avatar-utils";

type BubblePinProps = {
  initials: string;
  color?: string;
  userId?: string | null;
  userName?: string | null;
  className?: string;
  size?: number;
};

export function BubblePin({ initials, color, userId, userName, className, size = 32 }: BubblePinProps) {
  const finalColor = color || getUserAvatarColor(userId, userName);
  
  return (
    <div 
      className={cn("relative flex items-center justify-center transition-all duration-300", className)}
      style={{ width: size, height: size }}
    >
      {/* Sleek Circular Background */}
      <div 
        className="absolute inset-0 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1 ring-black/5"
      />
      
      {/* The Colored Circle with Initials */}
      <div 
        className="relative z-10 flex items-center justify-center rounded-full font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
        style={{ 
          backgroundColor: finalColor,
          width: '82%',
          height: '82%',
          fontSize: `${size * 0.35}px`,
          lineHeight: 1,
        }}
      >
        <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.1)]">{initials}</span>
      </div>
    </div>
  );
}

export function PinIcon({ color, className }: { color?: string; className?: string }) {
  // A variant for the toolbar
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={cn("h-4 w-4", className)}
    >
      <path d="M12 2C7.582 2 4 5.582 4 10C4 11.933 4.688 13.704 5.835 15.078L4 18L7.078 16.165C8.452 17.312 10.223 18 12 18C16.418 18 20 14.418 20 10C20 5.582 16.418 2 -12 2Z" />
      <circle cx="12" cy="10" r="3" fill={color || "currentColor"} stroke="none" />
    </svg>
  );
}

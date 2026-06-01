/**
 * Generates exactly 2 letters for avatar fallback display
 * @param name - Display name or username
 * @returns Two uppercase letters
 */
export function getAvatarInitials(name?: string | null): string {
    if (!name) return "US"; // Default fallback for "User"

    const trimmed = name.trim();
    if (!trimmed) return "US";

    const words = trimmed.split(/\s+/);

    if (words.length >= 2) {
        // Use first letter of first two words (e.g., "John Doe" -> "JD")
        return (words[0][0] + words[1][0]).toUpperCase();
    } else if (trimmed.length >= 2) {
        // Use first two letters of single word (e.g., "Alice" -> "AL")
        return trimmed.slice(0, 2).toUpperCase();
    } else if (trimmed.length === 1) {
        // Pad single letter with same letter (e.g., "X" -> "XX")
        return (trimmed[0] + trimmed[0]).toUpperCase();
    }

    return "US"; // Fallback
}

/**
 * Standard avatar fallback className for consistent styling
 */
export const AVATAR_FALLBACK_CLASS = "text-white";

export const THEME_COLORS = ["#ff7a00", "#ffcf00", "#00ff7a", "#00cf7a", "#007aff", "#7a00ff", "#cf00ff", "#ff007a"];

/**
 * Generates a stable color for a user based on their ID or name
 */
export function getUserAvatarColor(userId?: string | null, name?: string | null): string {
    // Prioritize name for coloring to ensure "Dheeraj Bhatia" always gets the same color
    // regardless of whether the userId is present (e.g. Guest vs Logged-in).
    const seed = (name?.trim() || userId || "default").toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    return THEME_COLORS[Math.abs(hash) % THEME_COLORS.length];
}

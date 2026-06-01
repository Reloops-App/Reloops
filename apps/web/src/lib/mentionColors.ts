/**
 * Utility for consistent mention coloring across components
 */

// Predefined colors for mentions (cycling through them)
const MENTION_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', hover: 'hover:bg-blue-500/30' },
  { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', hover: 'hover:bg-green-500/30' },
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', hover: 'hover:bg-purple-500/30' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', hover: 'hover:bg-orange-500/30' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', hover: 'hover:bg-pink-500/30' },
  { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30', hover: 'hover:bg-indigo-500/30' },
  { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', hover: 'hover:bg-red-500/30' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30', hover: 'hover:bg-teal-500/30' },
];

// CSS custom properties for inline styles (for text overlays)
const MENTION_CSS_COLORS = [
  { bg: 'rgba(59, 130, 246, 0.2)', text: 'rgb(96, 165, 250)', border: 'rgba(59, 130, 246, 0.3)' }, // blue
  { bg: 'rgba(34, 197, 94, 0.2)', text: 'rgb(74, 222, 128)', border: 'rgba(34, 197, 94, 0.3)' }, // green
  { bg: 'rgba(168, 85, 247, 0.2)', text: 'rgb(196, 181, 253)', border: 'rgba(168, 85, 247, 0.3)' }, // purple
  { bg: 'rgba(249, 115, 22, 0.2)', text: 'rgb(251, 146, 60)', border: 'rgba(249, 115, 22, 0.3)' }, // orange
  { bg: 'rgba(236, 72, 153, 0.2)', text: 'rgb(244, 114, 182)', border: 'rgba(236, 72, 153, 0.3)' }, // pink
  { bg: 'rgba(99, 102, 241, 0.2)', text: 'rgb(129, 140, 248)', border: 'rgba(99, 102, 241, 0.3)' }, // indigo
  { bg: 'rgba(239, 68, 68, 0.2)', text: 'rgb(248, 113, 113)', border: 'rgba(239, 68, 68, 0.3)' }, // red
  { bg: 'rgba(20, 184, 166, 0.2)', text: 'rgb(94, 234, 212)', border: 'rgba(20, 184, 166, 0.3)' }, // teal
];

/**
 * Get color for a specific user ID (consistent across all components)
 */
export function getMentionColor(userId: string | null | undefined): typeof MENTION_COLORS[0] {
  const safeUserId = userId || 'unknown';
  // Simple hash function to get consistent color for same user
  let hash = 0;
  for (let i = 0; i < safeUserId.length; i++) {
    const char = safeUserId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % MENTION_COLORS.length;
  return MENTION_COLORS[index];
}

/**
 * Get CSS color values for inline styles (for text overlays)
 */
export function getMentionCSSColor(userId: string | null | undefined): typeof MENTION_CSS_COLORS[0] {
  const safeUserId = userId || 'unknown';
  let hash = 0;
  for (let i = 0; i < safeUserId.length; i++) {
    const char = safeUserId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const index = Math.abs(hash) % MENTION_CSS_COLORS.length;
  return MENTION_CSS_COLORS[index];
}

/**
 * Get all user IDs from text with mentions
 */
export function getUserIdsFromText(text: string): string[] {
  const mentionRegex = /@\[([^:]+):([^\]]+)\]/g;
  const userIds: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(text))) {
    if (!userIds.includes(match[1])) {
      userIds.push(match[1]);
    }
  }
  
  return userIds;
}

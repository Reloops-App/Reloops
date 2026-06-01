/**
 * Utility functions for handling mentions in text
 */

export interface ParsedMention {
  id: string;
  displayName: string;
  fullMatch: string;
}

/**
 * Parse mentions from text in the format @[id:displayName]
 */
export function parseMentions(text: string): ParsedMention[] {
  const mentionRegex = /@\[([^:]+):([^\]]+)\]/g;
  const mentions: ParsedMention[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text))) {
    mentions.push({
      id: match[1],
      displayName: match[2],
      fullMatch: match[0]
    });
  }

  return mentions;
}

/**
 * Convert internal mention format @[id:name] to display format @name
 * This is used in UI components where users should see readable mentions
 */
export function convertMentionsForDisplay(text: string): string {
  return text.replace(/@\[([^:]+):([^\]]+)\]/g, '@$2');
}

/**
 * Convert display format @name back to internal format @[id:name]
 * This would be used if we need to convert back (though typically not needed)
 */
export function convertMentionsToInternal(text: string, _userMap: Record<string, string>): string {
  // This is more complex and would require a user lookup map
  // For now, we'll implement when needed
  return text;
}

/**
 * Check if text contains any mentions
 */
export function hasMentions(text: string): boolean {
  return /@\[([^:]+):([^\]]+)\]/.test(text);
}

/**
 * Extract just the display names from mentions in text
 */
export function extractMentionNames(text: string): string[] {
  const mentions = parseMentions(text);
  return mentions.map(m => m.displayName);
}

/**
 * Extract user IDs from mentions in text
 */
export function extractMentionIds(text: string): string[] {
  const mentions = parseMentions(text);
  return mentions.map(m => m.id);
}
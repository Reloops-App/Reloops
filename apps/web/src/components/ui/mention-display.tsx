import { convertMentionsForDisplay, parseMentions } from '@/lib/mentionUtils';
import { getMentionCSSColor } from '@/lib/mentionColors';
import React from 'react';

interface MentionDisplayProps {
  text: string;
  className?: string;
}

/**
 * Component to display text with mentions converted from @[id:name] to @name format with colors
 * Use this anywhere you want to show user-friendly text without the internal mention format
 */
export function MentionDisplayText({ text, className }: MentionDisplayProps) {
  // Parse mentions from the original text to get IDs for coloring
  const mentions = parseMentions(text);
  
  if (mentions.length === 0) {
    // No mentions, just show converted text
    return (
      <span className={className}>
        {convertMentionsForDisplay(text)}
      </span>
    );
  }

  // Build colored display
  const displayText = convertMentionsForDisplay(text);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  mentions.forEach((mention, index) => {
    const mentionDisplayText = `@${mention.displayName}`;
    const mentionIndex = displayText.indexOf(mentionDisplayText, lastIndex);
    
    if (mentionIndex !== -1) {
      // Add text before mention
      if (mentionIndex > lastIndex) {
        parts.push(displayText.slice(lastIndex, mentionIndex));
      }

      // Add colored mention
      const colors = getMentionCSSColor(mention.id);
      parts.push(
        <span
          key={`mention-${index}`}
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: 'inherit',
            fontWeight: '600'
          }}
        >
          {mentionDisplayText}
        </span>
      );

      lastIndex = mentionIndex + mentionDisplayText.length;
    }
  });

  // Add remaining text
  if (lastIndex < displayText.length) {
    parts.push(displayText.slice(lastIndex));
  }

  return (
    <span className={className}>
      {parts}
    </span>
  );
}

interface MentionDisplayDivProps {
  text: string;
  className?: string;
}

/**
 * Div version for when you need block-level display with colored mentions
 */
export function MentionDisplayDiv({ text, className }: MentionDisplayDivProps) {
  // Parse mentions from the original text to get IDs for coloring
  const mentions = parseMentions(text);
  
  if (mentions.length === 0) {
    // No mentions, just show converted text
    return (
      <div className={className}>
        {convertMentionsForDisplay(text)}
      </div>
    );
  }

  // Build colored display
  const displayText = convertMentionsForDisplay(text);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  mentions.forEach((mention, index) => {
    const mentionDisplayText = `@${mention.displayName}`;
    const mentionIndex = displayText.indexOf(mentionDisplayText, lastIndex);
    
    if (mentionIndex !== -1) {
      // Add text before mention
      if (mentionIndex > lastIndex) {
        parts.push(displayText.slice(lastIndex, mentionIndex));
      }

      // Add colored mention
      const colors = getMentionCSSColor(mention.id);
      parts.push(
        <span
          key={`mention-${index}`}
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: 'inherit',
            fontWeight: '600'
          }}
        >
          {mentionDisplayText}
        </span>
      );

      lastIndex = mentionIndex + mentionDisplayText.length;
    }
  });

  // Add remaining text
  if (lastIndex < displayText.length) {
    parts.push(displayText.slice(lastIndex));
  }

  return (
    <div className={className}>
      {parts}
    </div>
  );
}
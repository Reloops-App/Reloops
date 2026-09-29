import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useMentionableUsers, type MentionableUser } from '@/hooks/useMentionableUsers';
import { convertMentionsForDisplay, parseMentions } from '@/lib/mentionUtils';
import { getMentionCSSColor } from '@/lib/mentionColors';
import { getAvatarInitials } from '@/lib/avatar-utils';

interface SimpleMentionTextareaFinalProps {
  value?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
  placement?: 'top' | 'bottom';
  maxHeight?: number | string; // New prop for controlling max height
  disabled?: boolean;
  /**
   * When provided, use this list of mentionable people verbatim instead of
   * loading via `useMentionableUsers`. Used by the guest share flow, where
   * there's no session to fetch the workspace member list — the pool is
   * "people already in this comment thread".
   */
  usersOverride?: MentionableUser[];
}

const SimpleMentionTextareaFinal = React.forwardRef<HTMLTextAreaElement, SimpleMentionTextareaFinalProps>(
  ({
    value = '',
    onChange,
    onKeyDown,
    placeholder,
    className,
    style,
    projectId,
    organizationId,
    workspaceId,
    assetId,
    placement = 'bottom',
    maxHeight,
    usersOverride,
    ...props
  }, ref) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

    // Store display value to show @name instead of @[id:name] to users
    const [displayValue, setDisplayValue] = useState(convertMentionsForDisplay(value));

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null); // Ref for the overlay

    // Update display value when the parent value changes
    useEffect(() => {
      const newDisplayValue = convertMentionsForDisplay(value);
      if (newDisplayValue !== displayValue) {
        setDisplayValue(newDisplayValue);
      }
    }, [displayValue, value]);

    // Load mentionable users (skipped when the caller supplies its own list).
    const hookResult = useMentionableUsers({
      projectId,
      organizationId,
      workspaceId,
      assetId,
    });
    const users = usersOverride ?? hookResult.users;
    const loading = usersOverride ? false : hookResult.loading;
    const error = usersOverride ? null : hookResult.error;

    // Filter users based on query
    const filteredUsers = mentionQuery
      ? users.filter(user => {
        const query = mentionQuery.toLowerCase();
        const displayName = user.display_name?.toLowerCase() || '';
        return displayName.includes(query);
      })
      : users;

    // Ultra-fast auto-resize function with better height calculation
    const adjustTextareaHeight = useCallback((forceShrink = false) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const ov = overlayRef.current;

      // 1. Measure content without resetting height if possible
      // to avoid layout thrashing.
      // We only reset to auto to measure the TRUE scrollHeight 
      // when deleting or clearing.
      if (forceShrink || textarea.value === "") {
        textarea.style.height = 'auto';
      }

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = parseInt(computedStyle.lineHeight) || 24;
      const paddingTop = parseInt(computedStyle.paddingTop) || 0;
      const paddingBottom = parseInt(computedStyle.paddingBottom) || 0;
      const borderTop = parseInt(computedStyle.borderTopWidth) || 0;
      const borderBottom = parseInt(computedStyle.borderBottomWidth) || 0;

      const minContentHeight = lineHeight + paddingTop + paddingBottom + 4;
      let effectiveMaxHeight = placement === 'bottom' ? 999999 : (lineHeight * 8 + paddingTop + paddingBottom);

      if (typeof maxHeight === 'number') {
        effectiveMaxHeight = maxHeight;
      } else if (typeof maxHeight === 'string') {
        if (maxHeight === 'none' || maxHeight === 'infinity') {
          effectiveMaxHeight = 999999;
        } else {
          effectiveMaxHeight = parseInt(maxHeight) || effectiveMaxHeight;
        }
      }

      // Important: scrollHeight does NOT include border in most browsers
      const scrollHeight = textarea.scrollHeight + borderTop + borderBottom;
      
      let finalHeight;
      if (forceShrink || textarea.value === "") {
        finalHeight = Math.min(Math.max(scrollHeight, minContentHeight), effectiveMaxHeight);
      } else {
        const visualHeight = textarea.offsetHeight;
        finalHeight = Math.min(Math.max(scrollHeight, visualHeight, minContentHeight), effectiveMaxHeight);
      }

      // Apply the calculated height
      textarea.style.height = `${finalHeight}px`;
      
      // Determine if we have a scrollbar
      const hasScrollbar = scrollHeight > effectiveMaxHeight;
      textarea.style.overflowY = hasScrollbar ? 'auto' : 'hidden';

      // 2. Sync Overlay Styles Perfectly
      if (ov) {
        const borderLeft = parseInt(computedStyle.borderLeftWidth) || 0;
        const borderRight = parseInt(computedStyle.borderRightWidth) || 0;
        
        // Calculate the exact scrollbar width currently being displayed
        // offsetWidth includes borders, clientWidth does not.
        // So (offsetWidth - clientWidth) = (borderLeft + borderRight + scrollbarWidth).
        const actualScrollbarWidth = Math.max(0, (textarea.offsetWidth - textarea.clientWidth) - (borderLeft + borderRight));

        ov.style.width = computedStyle.width;
        ov.style.height = `${finalHeight}px`;
        ov.style.paddingTop = computedStyle.paddingTop;
        ov.style.paddingBottom = computedStyle.paddingBottom;
        ov.style.paddingLeft = computedStyle.paddingLeft;
        // THE FIX: Add the scrollbar width to the overlay's padding-right 
        // to ensure text wraps at the same spot.
        ov.style.paddingRight = `${parseInt(computedStyle.paddingRight || '0') + actualScrollbarWidth}px`;
        
        ov.style.borderWidth = computedStyle.borderWidth;
        ov.style.borderStyle = computedStyle.borderStyle;
        ov.style.fontSize = computedStyle.fontSize;
        ov.style.fontFamily = computedStyle.fontFamily;
        ov.style.lineHeight = computedStyle.lineHeight;
        ov.style.letterSpacing = computedStyle.letterSpacing;
        ov.style.boxSizing = computedStyle.boxSizing;
        
        // Ensure scroll sync
        ov.scrollTop = textarea.scrollTop;
      }
    }, [maxHeight, placement]);

    // Enhanced scroll sync
    const handleScroll = useCallback(() => {
      if (textareaRef.current && overlayRef.current) {
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      }
    }, []);

    // Sync internal value with display value changes
    const syncInternalValue = useCallback((newDisplayValue: string) => {
      // Use a more surgical sync to prevent cursor jumping
      const existingMentions = parseMentions(value);
      let syncedValue = newDisplayValue;

      // We only need to replace mentions that are still present in the display text
      // Sort by length descending to avoid partial replacements (e.g., "@John" vs "@John Doe")
      const mentionCandidates = [
        ...existingMentions.map((mention) => ({
          id: mention.id,
          displayName: mention.displayName,
        })),
        ...users
          .map((user) => ({
            id: user.id,
            displayName: user.display_name || user.id,
          }))
          .filter((mention) => mention.id && mention.displayName),
      ];

      const sortedMentions = mentionCandidates.sort((a, b) => b.displayName.length - a.displayName.length);

      sortedMentions.forEach(mention => {
        const displayPattern = `@${mention.displayName}`;
        const internalPattern = `@[${mention.id}:${mention.displayName}]`;
        
        // Use a more targeted replacement: only if it looks like a stand-alone mention
        // (Either start of string or preceded by whitespace)
        // This is still imperfect but better than full string rebuilds
        syncedValue = syncedValue.split(displayPattern).join(internalPattern);
      });

      return syncedValue;
    }, [users, value]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newDisplayValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      setDisplayValue(newDisplayValue);

      // Immediately adjust height - check if we should allow shrink
      const isDeleting = displayValue.length > newDisplayValue.length;
      adjustTextareaHeight(isDeleting);

      // Sync with internal format
      const syncedInternalValue = syncInternalValue(newDisplayValue);
      onChange?.(syncedInternalValue);

      // Check for @ mention
      const textBeforeCursor = newDisplayValue.slice(0, cursorPos);
      const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

      if (mentionMatch) {
        setMentionQuery(mentionMatch[1]);

        if (textareaRef.current) {
          const rect = textareaRef.current.getBoundingClientRect();
          const dropdownHeight = 200; 

          let top;
          if (placement === 'top') {
            top = rect.top - dropdownHeight + 10;
          } else {
            top = rect.bottom + 5;
          }

          setDropdownPosition({
            top,
            left: rect.left,
            width: rect.width
          });
        }

        setShowDropdown(true);
        setSelectedIndex(0);
      } else {
        setShowDropdown(false);
        setMentionQuery('');
      }
    }, [onChange, syncInternalValue, placement, adjustTextareaHeight, displayValue]);

    const insertMention = useCallback((user: MentionableUser) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = displayValue.slice(0, cursorPos);
      const textAfterCursor = displayValue.slice(cursorPos);

      const mentionStart = textBeforeCursor.lastIndexOf('@');
      if (mentionStart === -1) return;

      const displayMentionText = `@${user.display_name || user.id}`;
      const internalMentionText = `@[${user.id}:${user.display_name || user.id}]`;

      // Build new display value
      const newDisplayValue =
        textBeforeCursor.slice(0, mentionStart) +
        displayMentionText + ' ' +
        textAfterCursor;

      // Build new internal value by preserving existing mentions and adding new one
      const beforeMentionText = textBeforeCursor.slice(0, mentionStart);
      const afterMentionText = textAfterCursor;

      // Convert existing mentions in the before text back to internal format
      const existingMentions = parseMentions(value);
      let processedBeforeText = beforeMentionText;

      existingMentions.forEach(mention => {
        const displayPattern = `@${mention.displayName}`;
        const internalPattern = `@[${mention.id}:${mention.displayName}]`;
        processedBeforeText = processedBeforeText.replace(displayPattern, internalPattern);
      });

      const newInternalValue =
        processedBeforeText +
        internalMentionText + ' ' +
        afterMentionText;

      setDisplayValue(newDisplayValue);
      onChange?.(newInternalValue);
      setShowDropdown(false);

      requestAnimationFrame(() => {
        const newCursorPos = mentionStart + displayMentionText.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
        // Adjust height after mention insertion
        adjustTextareaHeight();
      });
    }, [displayValue, onChange, value, adjustTextareaHeight]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown && filteredUsers.length > 0) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filteredUsers.length - 1));
            break;
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
            break;
          case 'Enter':
          case 'Tab':
            if (e.key === 'Enter' && e.shiftKey) break;
            e.preventDefault();
            insertMention(filteredUsers[selectedIndex]);
            break;
          case 'Escape':
            e.preventDefault();
            setShowDropdown(false);
            break;
          default:
            onKeyDown?.(e);
        }
      } else {
        onKeyDown?.(e);
      }
    }, [showDropdown, filteredUsers, selectedIndex, insertMention, onKeyDown]);

    // Auto-resize on content changes
    useLayoutEffect(() => {
      adjustTextareaHeight();
    }, [displayValue, adjustTextareaHeight]);

    // Also resize on window resize for responsive behavior
    useEffect(() => {
      const handleResize = () => adjustTextareaHeight();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [adjustTextareaHeight]);

    // Remove redundant event listeners that cause jumping/flickering
    // Height is already managed by adjustTextareaHeight in handleInputChange and useLayoutEffect

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setShowDropdown(false);
        }
      };

      if (showDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [showDropdown]);

    const hasMentions = parseMentions(value).length > 0;
    const hasUrls = /(https?:\/\/[^\s]+)/.test(displayValue);

    const shouldShowOverlay = hasMentions || hasUrls;

    return (
      <div className="relative">
        {/* Background textarea for input handling */}
        <Textarea
          ref={(element) => {
            textareaRef.current = element;
            if (typeof ref === 'function') {
              ref(element);
            } else if (ref) {
              ref.current = element;
            }
          }}
          value={displayValue}
          onChange={handleInputChange}
          onInput={() => {
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          placeholder={placeholder}
          className={cn(
            className,
            'resize-none relative z-20 whitespace-pre-wrap break-words' 
          )}
          style={{
            ...style,
            minHeight: '2.5rem',
            lineHeight: '1.5',   
            color: shouldShowOverlay ? 'transparent' : 'inherit',
            caretColor: 'var(--sidebar-foreground)'
          }}
          {...props}
        />

        {/* Text overlay with colored mentions and URLs */}
        {shouldShowOverlay && (
          <div
            ref={overlayRef}
            className={cn(
              "absolute inset-0 pointer-events-none whitespace-pre-wrap break-words z-10 overflow-hidden",
              // No hardcoded padding - synced dynamically via adjustTextareaHeight
              "border-transparent" // transparent border to match box-sizing
            )}
            style={{
              // Base styles, but most will be synced
              minHeight: '2.5rem',
              height: textareaRef.current?.style.height || 'auto'
            }}
          >
            {(() => {
              const mentions = parseMentions(value);
              const parts: React.ReactNode[] = [];

              // Combine URL and Mentions logic
              // First, find all mentions and URLs and sort by index

              const items: Array<{
                type: 'mention' | 'url',
                start: number,
                end: number,
                text: string,
                data?: {
                  id: string;
                  displayName: string;
                }
              }> = [];

              // Find mentions
              let lastIndex = 0;
              mentions.forEach(mention => {
                const mentionText = `@${mention.displayName}`;
                const index = displayValue.indexOf(mentionText, lastIndex);
                if (index !== -1) {
                  items.push({
                    type: 'mention',
                    start: index,
                    end: index + mentionText.length,
                    text: mentionText,
                    data: mention
                  });
                  lastIndex = index + mentionText.length;
                }
              });

              // Find URLs - this is simple regex, might need more robust if overlapping with users (unlikely)
              const urlRegex = /(https?:\/\/[^\s]+)/g;
              let match;
              while ((match = urlRegex.exec(displayValue)) !== null) {
                // Check if this URL overlaps with any existing item (very unlikely for mention but safe to check)
                const isOverlapping = items.some(item =>
                  (match!.index >= item.start && match!.index < item.end) ||
                  (match!.index + match![0].length > item.start && match!.index + match![0].length <= item.end)
                );

                if (!isOverlapping) {
                  items.push({
                    type: 'url',
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0]
                  });
                }
              }

              // Sort items by position
              items.sort((a, b) => a.start - b.start);

              // Build the overlay parts
              let cursor = 0;
              items.forEach((item, idx) => {
                // Add text before item
                if (item.start > cursor) {
                  parts.push(
                    <span key={`text-${idx}`} style={{ color: 'rgb(var(--foreground))' }}>
                      {displayValue.slice(cursor, item.start)}
                    </span>
                  );
                }

                if (item.type === 'mention') {
                  const colors = getMentionCSSColor(item.data!.id);
                  parts.push(
                    <span
                      key={`mention-${idx}`}
                      className="relative inline"
                    >
                      {/* Badge Background Layer - does not affect text flow */}
                      <span 
                        className="absolute inset-x-[-2px] inset-y-[-1px] rounded pointer-events-none"
                        style={{
                          backgroundColor: colors.bg,
                          border: `1px solid ${colors.border}`,
                          zIndex: -1
                        }}
                      />
                      {/* The actual text - MUST MATCH TEXTAREA EXACTLY (no font-semibold if textarea is normal) */}
                      <span 
                        style={{ color: colors.text }}
                      >
                        {item.text}
                      </span>
                    </span>
                  );
                } else if (item.type === 'url') {
                  parts.push(
                    <span
                      key={`url-${idx}`}
                      className="text-blue-400 underline"
                    >
                      {item.text}
                    </span>
                  );
                }

                cursor = item.end;
              });

              // remaining text
              if (cursor < displayValue.length) {
                parts.push(
                  <span key="end-text" style={{ color: 'rgb(var(--foreground))' }}>
                    {displayValue.slice(cursor)}
                  </span>
                );
              }

              return parts;
            })()}
          </div>
        )}

        {/* Simple visual indicator for mentions */}
        {hasMentions && (
          <div className="absolute top-2 right-2 w-2 h-2 bg-blue-400 rounded-full opacity-60 pointer-events-none" />
        )}

        {/* Dropdown portal */}
        {showDropdown && typeof window !== 'undefined' && createPortal(
          <div
            ref={dropdownRef}
            className={cn(
              "fixed z-[99999] max-h-64 overflow-y-auto rounded-xl border border-border dark:border-white/10 bg-popover dark:bg-[#111827]/98 p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.45)] ring-1 ring-border dark:ring-white/[0.03] backdrop-blur-xl",
              "[scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]",
              "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent",
              "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border dark:[&::-webkit-scrollbar-thumb]:bg-slate-500/45",
              "hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/65"
            )}
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              minWidth: '320px',
              maxWidth: 'calc(100vw - 24px)'
            }}
          >
            <div className="space-y-1">
              {loading && (
                <div className="rounded-lg px-3 py-4 text-center text-sm text-muted-foreground dark:text-slate-400">
                  Loading users...
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-400/15 bg-red-400/8 px-3 py-4 text-center text-sm text-red-700 dark:text-red-300">
                  Error loading users
                </div>
              )}

              {!loading && !error && filteredUsers.length === 0 && (
                <div className="rounded-lg px-3 py-4 text-center text-sm text-muted-foreground dark:text-slate-400">
                  No users found
                </div>
              )}

              {!loading && !error && filteredUsers.map((user, index) => {
                const colors = getMentionCSSColor(user.id);
                const displayName = user.display_name || user.id;
                const isSelected = index === selectedIndex;

                return (
                  <div
                    key={user.id}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2.5 text-sm transition-all",
                      isSelected
                        ? "border-cyan-300/20 bg-cyan-300/12 text-popover-foreground dark:text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        : "border-transparent text-muted-foreground dark:text-slate-300 hover:border-border dark:hover:border-white/8 hover:bg-accent dark:hover:bg-white/[0.045] hover:text-accent-foreground dark:hover:text-white"
                    )}
                    onMouseEnter={() => setSelectedIndex(index)}
                    // Use pointer down to prevent blurring the textarea before click registers
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(user);
                    }}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-semibold text-white shadow-sm"
                      style={{
                        backgroundColor: colors.bg,
                        borderColor: isSelected ? 'rgba(103,232,249,0.34)' : colors.border,
                      }}
                    >
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span>{getAvatarInitials(displayName)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold leading-5 text-popover-foreground dark:text-slate-100">
                        {displayName}
                      </div>
                      {user.email && (
                        <div className="truncate text-xs leading-4 text-muted-foreground dark:text-slate-400">
                          {user.email}
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        "max-w-[42%] shrink-0 truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none",
                        isSelected ? "bg-cyan-300/12 text-cyan-700 dark:text-cyan-100" : "bg-accent dark:bg-white/[0.035] text-muted-foreground dark:text-slate-300"
                      )}
                      style={{
                        borderColor: isSelected ? 'rgba(103,232,249,0.26)' : colors.border,
                      }}
                    >
                      @{displayName}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }
);

SimpleMentionTextareaFinal.displayName = 'SimpleMentionTextareaFinal';

export { SimpleMentionTextareaFinal };

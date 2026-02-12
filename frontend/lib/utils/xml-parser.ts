/**
 * XML Tag Parser for Thinking/Answer Separation
 *
 * Handles:
 * - Multiple interleaved <thinking> and <answer> blocks
 * - Incomplete tags during streaming (returns buffer for retry)
 * - Mixed content (text before/after/between tags)
 * - Malformed XML (graceful degradation)
 * - Backwards compatibility (no tags = all content is answer)
 */

export interface ParsedContent {
  thinking: string[];  // Array of thinking block contents
  answer: string[];    // Array of answer block contents
  unparsed: string;    // Content that couldn't be categorized (before first tag)
}

/**
 * Parse content containing <thinking> and <answer> tags
 *
 * @param content - Raw content from TalkToUser/AnalystAgent
 * @param isStreaming - Currently unused, kept for backwards compatibility
 * @returns Parsed sections or null if no tags found (backwards compatibility)
 */
export function parseThinkingAnswer(
  content: string,
  isStreaming: boolean = false
): ParsedContent | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  // Quick check: if no tags present, return null for backwards compatibility
  if (!content.includes('<thinking') && !content.includes('<answer')) {
    return null;
  }

  const thinking: string[] = [];
  const answer: string[] = [];
  let unparsed = '';

  // Regex to match tags: <thinking>...</thinking> or <answer>...</answer>
  // Flags: g=global, i=case insensitive
  // Use [\s\S] instead of . with s flag for ES5 compatibility (matches any character including newlines)
  const tagRegex = /<(thinking|answer)>([\s\S]*?)<\/\1>/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Extract all complete tag pairs
  while ((match = tagRegex.exec(content)) !== null) {
    const [fullMatch, tagName, tagContent] = match;
    const matchStart = match.index;

    // Capture content before this tag (if any)
    if (matchStart > lastIndex) {
      const beforeTag = content.substring(lastIndex, matchStart).trim();
      if (beforeTag) {
        // Content before first tag goes to unparsed
        if (thinking.length === 0 && answer.length === 0) {
          unparsed += beforeTag + '\n';
        }
        // Content between tags is ignored (shouldn't happen with proper model output)
      }
    }

    // Add tag content to appropriate array
    const trimmedContent = tagContent.trim();
    if (trimmedContent) {
      if (tagName.toLowerCase() === 'thinking') {
        thinking.push(trimmedContent);
      } else {
        answer.push(trimmedContent);
      }
    }

    lastIndex = matchStart + fullMatch.length;
  }

  // Handle remaining content after last complete tag
  if (lastIndex < content.length) {
    const remaining = content.substring(lastIndex);

    // Check for incomplete opening tag at the end
    const incompleteOpenMatch = remaining.match(/<(thinking|answer)>([\s\S]*)$/i);

    if (incompleteOpenMatch) {
      // Incomplete tag found - immediately show the partial content
      const matchIndex = incompleteOpenMatch.index!;

      // Capture content before the incomplete tag (if any)
      if (matchIndex > 0) {
        const beforeTag = remaining.substring(0, matchIndex).trim();
        if (beforeTag) {
          // Content before first tag goes to unparsed
          if (thinking.length === 0 && answer.length === 0) {
            unparsed += beforeTag + '\n';
          }
        }
      }

      // Extract and show the partial content after the opening tag
      const [, tagName, partialContent] = incompleteOpenMatch;
      const trimmed = partialContent.trim();
      if (trimmed) {
        if (tagName.toLowerCase() === 'thinking') {
          thinking.push(trimmed);
        } else {
          answer.push(trimmed);
        }
      }
      // Note: We don't set incomplete field anymore - content is immediately visible
    } else {
      // Regular trailing content - add to unparsed
      const trimmed = remaining.trim();
      if (trimmed) {
        unparsed += trimmed;
      }
    }
  }

  // If no tags were successfully parsed, return null
  if (thinking.length === 0 && answer.length === 0) {
    return null;
  }

  return {
    thinking,
    answer,
    unparsed: unparsed.trim()
  };
}

/**
 * Combine parsed content for rendering
 *
 * @param parsed - Parsed content from parseThinkingAnswer
 * @param includeThinking - Whether to include thinking blocks (for collapsible section)
 * @returns Combined content string
 */
export function combineContent(
  parsed: ParsedContent,
  includeThinking: boolean = false
): string {
  const parts: string[] = [];

  if (parsed.unparsed) {
    parts.push(parsed.unparsed);
  }

  if (includeThinking && parsed.thinking.length > 0) {
    parts.push(...parsed.thinking);
  }

  if (parsed.answer.length > 0) {
    parts.push(...parsed.answer);
  }

  return parts.join('\n\n');
}

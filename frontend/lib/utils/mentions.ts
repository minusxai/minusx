import type { ChatMentionData } from '@/lib/types';

/**
 * Matches an `@{...json...}` mention. Lazy `.+?` so the first `}` closes the
 * mention (mention JSON never nests braces). Kept in sync with the Lexical
 * mention transformer (`components/lexical/mention-transformer.ts`).
 */
export const MENTION_REGEX = /@(\{.+?\})/;

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; raw: string; json: string; data: ChatMentionData };

/**
 * Split a raw string into text and mention segments. A match whose JSON fails to
 * parse is emitted as plain text (mirrors the chat parser's fallback).
 */
export function splitMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const re = new RegExp(MENTION_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    try {
      const data = JSON.parse(match[1]) as ChatMentionData;
      segments.push({ type: 'mention', raw: match[0], json: match[1], data });
    } catch {
      segments.push({ type: 'text', value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

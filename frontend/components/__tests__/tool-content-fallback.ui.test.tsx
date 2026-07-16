/**
 * Conversations V2 — display-view fallback for tool-card parsing (see /conversations-v2.md).
 * In the slim wire view, toolResult `content` is dropped and `details` carries the display data:
 * parseToolContent must fall back to `msg.details`, and isToolSuccess must read `details.success`.
 */
import { describe, it, expect } from 'vitest';
import { parseToolContent, isToolSuccess } from '@/components/explore/tools/DetailCarousel';
import type { MessageWithFlags } from '@/components/explore/message/messageHelpers';

const asMsg = (m: Record<string, unknown>) => m as unknown as MessageWithFlags;

describe('parseToolContent — details fallback (slim wire view)', () => {
  it('still parses a JSON content string when present (full view / legacy)', () => {
    const msg = asMsg({ role: 'tool', content: JSON.stringify({ success: true, files: [1] }) });
    expect(parseToolContent(msg)).toEqual({ success: true, files: [1] });
  });

  it('falls back to details when content is empty (slim view)', () => {
    const msg = asMsg({ role: 'tool', content: '', details: { success: true, files: [{ id: 1 }] } });
    expect(parseToolContent(msg)).toEqual({ success: true, files: [{ id: 1 }] });
  });

  it('falls back to details when content is missing entirely', () => {
    const msg = asMsg({ role: 'tool', details: { selection: ['a'] } });
    expect(parseToolContent(msg)).toEqual({ selection: ['a'] });
  });

  it('returns {} when neither content nor details exist', () => {
    expect(parseToolContent(asMsg({ role: 'tool' }))).toEqual({});
  });
});

describe('isToolSuccess — details fallback (slim wire view)', () => {
  it('reads success from a JSON content string when present', () => {
    expect(isToolSuccess(asMsg({ role: 'tool', content: JSON.stringify({ success: false }) }))).toBe(false);
  });

  it('reads details.success when content is empty', () => {
    expect(isToolSuccess(asMsg({ role: 'tool', content: '', details: { success: false } }))).toBe(false);
    expect(isToolSuccess(asMsg({ role: 'tool', content: '', details: { success: true } }))).toBe(true);
  });

  it('defaults to success when neither channel says otherwise', () => {
    expect(isToolSuccess(asMsg({ role: 'tool', content: '' }))).toBe(true);
    expect(isToolSuccess(asMsg({ role: 'tool', content: '(executing...)' }))).toBe(true);
  });
});

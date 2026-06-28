import { describe, it, expect } from 'vitest';
import { conversationDisplayName } from '@/lib/conversations-utils';

describe('conversationDisplayName', () => {
  it('prefers the generated title once one exists', () => {
    expect(conversationDisplayName({ titleGenerated: true, firstMessage: 'show me revenue by region for…' }, 'Regional Revenue')).toBe('Regional Revenue');
  });

  it('falls back to the first user message until a title is generated', () => {
    expect(conversationDisplayName({ firstMessage: 'show me revenue' }, 'New Conversation')).toBe('show me revenue');
  });

  it('falls back to the stored title when there is no first message', () => {
    expect(conversationDisplayName({}, 'New Conversation')).toBe('New Conversation');
    expect(conversationDisplayName(undefined, 'New Conversation')).toBe('New Conversation');
  });

  it('ignores a generated flag if the title is empty', () => {
    expect(conversationDisplayName({ titleGenerated: true, firstMessage: 'hi' }, '   ')).toBe('hi');
  });
});

import { describe, it, expect } from 'vitest';
import { makeStore } from '@/store/store';
import { selectChatAttachments } from '@/store/uiSlice';
import { PASTED_TEXT_ATTACHMENT_CHARS } from '@/lib/context/context-budgets';
import {
  isPastedTextOverLimit,
  buildPastedTextAttachment,
  handlePastedText,
} from '@/lib/chat/paste-attachment';

describe('isPastedTextOverLimit', () => {
  it('is false at exactly the limit and true one char over', () => {
    expect(isPastedTextOverLimit('a'.repeat(PASTED_TEXT_ATTACHMENT_CHARS))).toBe(false);
    expect(isPastedTextOverLimit('a'.repeat(PASTED_TEXT_ATTACHMENT_CHARS + 1))).toBe(true);
  });

  it('is false for short text', () => {
    expect(isPastedTextOverLimit('hello')).toBe(false);
  });
});

describe('buildPastedTextAttachment', () => {
  it('produces a text attachment carrying the full content', () => {
    const text = 'line1\nline2\nline3';
    const att = buildPastedTextAttachment(text);
    expect(att.type).toBe('text');
    expect(att.content).toBe(text);
    expect(att.metadata?.language).toBe('text');
  });

  it('encodes the line count in the name', () => {
    expect(buildPastedTextAttachment('a\nb\nc').name).toBe('Pasted text (3 lines)');
    expect(buildPastedTextAttachment('just one line').name).toBe('Pasted text (1 line)');
  });
});

describe('handlePastedText', () => {
  it('stages a text attachment and returns true when over the limit', () => {
    const store = makeStore();
    const big = 'x'.repeat(PASTED_TEXT_ATTACHMENT_CHARS + 1);

    const handled = handlePastedText(store.dispatch, big);

    expect(handled).toBe(true);
    const attachments = selectChatAttachments(store.getState());
    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('text');
    expect(attachments[0].content).toBe(big);
  });

  it('does nothing and returns false for small pastes', () => {
    const store = makeStore();

    const handled = handlePastedText(store.dispatch, 'small paste');

    expect(handled).toBe(false);
    expect(selectChatAttachments(store.getState())).toHaveLength(0);
  });
});

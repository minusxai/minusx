import { describe, it, expect } from 'vitest';
import uiReducer, { addChatAttachment, updateChatAttachment } from '@/store/uiSlice';
import type { Attachment } from '@/lib/types/chat';

const img = (content: string): Attachment => ({ type: 'image', name: 'Screen selection', content });

describe('uiSlice updateChatAttachment', () => {
  it('replaces the attachment at the given index (annotated image swap)', () => {
    let state = uiReducer(undefined, addChatAttachment(img('url-a')));
    state = uiReducer(state, addChatAttachment(img('url-b')));
    state = uiReducer(state, updateChatAttachment({ index: 1, attachment: img('url-b-annotated') }));
    expect(state.chatAttachments[0].content).toBe('url-a');
    expect(state.chatAttachments[1].content).toBe('url-b-annotated');
  });

  it('ignores out-of-range indices', () => {
    let state = uiReducer(undefined, addChatAttachment(img('url-a')));
    state = uiReducer(state, updateChatAttachment({ index: 5, attachment: img('nope') }));
    expect(state.chatAttachments).toHaveLength(1);
    expect(state.chatAttachments[0].content).toBe('url-a');
  });
});

'use client';

/**
 * Large-paste → text-attachment handling for the chat composer.
 *
 * When a user pastes a very large blob (e.g. thousands of lines) into the chat
 * input, inserting it inline makes the Lexical editor — and the whole app — slow.
 * Instead, over the `PASTED_TEXT_ATTACHMENT_CHARS` threshold we stage the paste as
 * a VISIBLE text attachment (the same chip mechanism used by the select-to-chat
 * feature and document uploads, see lib/chat/edit-with-agent.ts), so the composer
 * stays snappy and the content still reaches the agent.
 */

import type { Attachment } from '@/lib/types';
import type { AppDispatch } from '@/store/store';
import { addChatAttachment } from '@/store/uiSlice';
import { isPastedTextOverLimit } from '@/lib/context/context-budgets';

export { isPastedTextOverLimit };

/** Build the text attachment for a pasted blob. The name doubles as the chip label
 *  and the provenance the agent sees (server drops `metadata`). */
export function buildPastedTextAttachment(text: string): Attachment {
  const lineCount = text.split('\n').length;
  return {
    type: 'text',
    name: `Pasted text (${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`,
    content: text,
    metadata: { language: 'text' },
  };
}

/**
 * If `text` is over the inline limit, stage it as a text attachment and report that
 * it was handled (so the caller can suppress the inline insert). Returns false for
 * smaller pastes, which fall through to normal inline paste behavior.
 */
export function handlePastedText(dispatch: AppDispatch, text: string): boolean {
  if (!isPastedTextOverLimit(text)) return false;
  dispatch(addChatAttachment(buildPastedTextAttachment(text)));
  return true;
}

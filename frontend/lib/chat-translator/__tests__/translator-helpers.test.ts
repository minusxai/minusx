// Tests for the file-level translator predicate `isV2ConversationFile`, which the
// API routes / loaders use to decide whether a conversation file is pi-shaped (v=2)
// vs legacy (v=1). The pure log-shape translation is tested in translator.test.ts.
// (The read-path down-translation wrapper `translateConversationForFrontend` has been
// retired — v=2 files now serve the pi log as-is; see lib/conversations-utils.ts.)

import { describe, it, expect } from 'vitest';
import {
  isV2ConversationFile,
} from '../index';

describe('isV2ConversationFile', () => {
  it('false for non-conversation files', () => {
    expect(isV2ConversationFile({ type: 'question', meta: { version: 2 } })).toBe(false);
    expect(isV2ConversationFile({ type: 'dashboard', meta: { version: 2 } })).toBe(false);
    expect(isV2ConversationFile({ type: 'connection', meta: null })).toBe(false);
  });

  it('false for conversation files without meta.version', () => {
    expect(isV2ConversationFile({ type: 'conversation', meta: null })).toBe(false);
    expect(isV2ConversationFile({ type: 'conversation', meta: undefined })).toBe(false);
    expect(isV2ConversationFile({ type: 'conversation', meta: {} })).toBe(false);
    expect(isV2ConversationFile({ type: 'conversation', meta: { version: 1 } })).toBe(false);
  });

  it('true for conversation files with meta.version === 2', () => {
    expect(isV2ConversationFile({ type: 'conversation', meta: { version: 2 } })).toBe(true);
    expect(isV2ConversationFile({ type: 'conversation', meta: { version: 2, other: 'x' } })).toBe(true);
  });

  it('false when meta.version is not strictly 2', () => {
    expect(isV2ConversationFile({ type: 'conversation', meta: { version: '2' } })).toBe(false);
    expect(isV2ConversationFile({ type: 'conversation', meta: { version: 3 } })).toBe(false);
  });
});

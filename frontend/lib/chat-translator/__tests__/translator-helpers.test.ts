// Tests for the file-level translator helpers — `isV2ConversationFile` and
// `translateConversationForFrontend`. These are the predicates and wrappers
// the API routes use to decide WHEN to translate, separate from the pure
// log-shape translation tested in translator.test.ts.

import { describe, it, expect } from 'vitest';
import {
  isV2ConversationFile,
  translateConversationForFrontend,
} from '../index';
import type { ConversationLog } from '@/orchestrator/types';

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

describe('translateConversationForFrontend', () => {
  const piContent = {
    metadata: { name: 'pi-ai', logLength: 1 },
    log: [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'WebAnalystAgent',
        arguments: { userMessage: 'hi' },
        context: {},
        parent_id: null,
      },
    ] as unknown as ConversationLog,
  };

  it('passes through non-v=2 files unchanged', () => {
    const v1 = {
      type: 'conversation',
      meta: null,
      content: { metadata: {}, log: [{ _type: 'task', agent: 'AnalystAgent', args: {} }] },
    };
    const out = translateConversationForFrontend(v1);
    expect(out).toBe(v1); // shallow-eq (no copy made)
  });

  it('passes through non-conversation files unchanged', () => {
    const q = {
      type: 'question',
      meta: { version: 2 },
      content: { query: 'select 1' },
    };
    const out = translateConversationForFrontend(q);
    expect(out).toBe(q);
  });

  it('translates v=2 conversation file: pi-ai content.log → legacy task entries', () => {
    const v2 = {
      type: 'conversation',
      meta: { version: 2 },
      content: piContent,
      otherField: 'preserved',
    };
    const out = translateConversationForFrontend(v2);
    // Returned object is a shallow copy (mutates new content); other fields
    // preserved.
    expect(out).not.toBe(v2);
    expect((out as { otherField?: string }).otherField).toBe('preserved');
    expect(out.type).toBe('conversation');
    const log = out.content!.log as unknown as Array<{ _type: string; agent?: string; args?: { user_message?: string } }>;
    expect(log[0]._type).toBe('task');
    expect(log[0].agent).toBe('AnalystAgent');
    expect(log[0].args?.user_message).toBe('hi');
  });

  it('returns input unchanged when content.log is missing or non-array', () => {
    const v2NoLog = { type: 'conversation', meta: { version: 2 }, content: { metadata: {} } };
    expect(translateConversationForFrontend(v2NoLog)).toBe(v2NoLog);

    const v2NullContent = { type: 'conversation', meta: { version: 2 }, content: null };
    expect(translateConversationForFrontend(v2NullContent)).toBe(v2NullContent);
  });
});

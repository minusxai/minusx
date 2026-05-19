import { describe, it, expect } from 'vitest';
import { extractCallIds } from '../dump-llm-calls';

describe('extractCallIds', () => {
  it('returns unique IDs from `log` (single-run) rows', () => {
    const jsonl = [
      JSON.stringify({
        log: [
          { role: 'assistant', content: [
            { type: 'toolCall', _lllmCallId: 'a' },
            { type: 'toolCall', _lllmCallId: 'b' },
          ] },
          { role: 'toolResult' },
          { role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'a' }] },
        ],
      }),
      JSON.stringify({
        log: [{ role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'c' }] }],
      }),
    ].join('\n');
    expect(extractCallIds(jsonl).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns unique IDs from `logs[]` (multi-run rows from DAB_TIMES_RUN > 1)', () => {
    const jsonl = JSON.stringify({
      logs: [
        [{ role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'x' }] }],
        [{ role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'y' }] }],
      ],
    });
    expect(extractCallIds(jsonl).sort()).toEqual(['x', 'y']);
  });

  it('ignores assistant messages without _lllmCallId', () => {
    const jsonl = JSON.stringify({
      log: [
        { role: 'assistant', content: 'plain text' },
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'only' }] },
      ],
    });
    expect(extractCallIds(jsonl)).toEqual(['only']);
  });

  it('captures _lllmCallId on the assistant message itself (text-only stops)', () => {
    // Per `lib/chat-translator/index.ts:240-242`: callLLM attaches
    // `_lllmCallId` to the first toolCall OR to the AssistantMessage
    // itself when the stop is text-only.
    const jsonl = JSON.stringify({
      log: [
        { role: 'assistant', stopReason: 'stop', _lllmCallId: 'top-level',
          content: [{ type: 'text', text: 'TL;DR: ...' }] },
      ],
    });
    expect(extractCallIds(jsonl)).toEqual(['top-level']);
  });

  it('skips blank lines and malformed rows gracefully', () => {
    const jsonl = [
      '',
      '   ',
      JSON.stringify({ log: [{ role: 'assistant', content: [{ type: 'toolCall', _lllmCallId: 'ok' }] }] }),
      '{not valid json',
    ].join('\n');
    expect(extractCallIds(jsonl)).toEqual(['ok']);
  });
});

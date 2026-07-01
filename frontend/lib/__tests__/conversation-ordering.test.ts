/**
 * Regression: reopening an old conversation that has any error-stream row rendered all user
 * messages stacked at the top, followed by all agent replies/tool calls — wrong chronological order.
 *
 * Cause: `piLogToLegacy` stamped every user/sub-agent invocation with epoch-0 (`tsFromTimestamp(undefined)`),
 * and `parseLogToMessages` does a `created_at` sort to interleave the errors[] rows. With every user
 * message at time 0, that sort floated them all to the front. The fix gives invocations the timestamp
 * of their first response, so the sort keeps turns interleaved and chronological.
 */
import { describe, it, expect } from 'vitest';
import { parsePiConversation } from '@/lib/conversations-utils';
import type { ConversationLog } from '@/orchestrator/types';
import type { ErrorLogEntry } from '@/lib/types';

const USAGE = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

// Two full turns; timestamps make the true order q1 → a1 → q2 → a2.
const piLog = [
  { type: 'toolCall', id: 'r1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q1' }, context: {} },
  { role: 'assistant', parent_id: 'r1', content: [{ type: 'text', text: 'a1' }], stopReason: 'stop', usage: USAGE, model: 'm', timestamp: 1000 },
  { type: 'toolCall', id: 'r2', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q2' }, context: {} },
  { role: 'assistant', parent_id: 'r2', content: [{ type: 'text', text: 'a2' }], stopReason: 'stop', usage: USAGE, model: 'm', timestamp: 2000 },
] as unknown as ConversationLog;

// An error row is what triggers the destructive created_at sort in parseLogToMessages.
const errors: ErrorLogEntry[] = [
  { _type: 'error', source: 'llm', message: 'boom', timestamp: 1500 } as unknown as ErrorLogEntry,
];

/** Compact, order-preserving signature of the rendered message list. */
function signature(messages: Array<{ role?: string; content?: unknown }>): string[] {
  return messages.map((m) => {
    if (m.role === 'user') return `U:${m.content}`;
    if (m.role === 'error') return `E:${m.content}`;
    if (m.role === 'tool') return 'A'; // assistant text renders as a TalkToUser tool message
    return String(m.role);
  });
}

describe('parsePiConversation — chronological ordering with an error row present', () => {
  it('keeps turns interleaved (q1 → a1 → q2 → a2), NOT all users stacked on top', () => {
    const { messages } = parsePiConversation(piLog, errors);
    const sig = signature(messages);

    const iU1 = sig.indexOf('U:q1');
    const iU2 = sig.indexOf('U:q2');
    const iA1 = sig.indexOf('A'); // first assistant reply (a1)

    // The bug put both user messages before any assistant reply: iU2 < iA1.
    // Correct order interleaves them: the second user turn comes AFTER the first reply.
    expect(iU1).toBeGreaterThanOrEqual(0);
    expect(iA1).toBeGreaterThan(iU1);
    expect(iU2).toBeGreaterThan(iA1);
  });

  it('interleaves the error row chronologically (after a1@1000, before q2@2000)', () => {
    const { messages } = parsePiConversation(piLog, errors);
    const sig = signature(messages);
    const iErr = sig.indexOf('E:boom');
    const iU2 = sig.indexOf('U:q2');
    expect(iErr).toBeGreaterThan(sig.indexOf('A'));
    expect(iErr).toBeLessThan(iU2);
  });
});

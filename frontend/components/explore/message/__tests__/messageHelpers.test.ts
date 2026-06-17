// deduplicateMessages: a tool call must stay visible after it resolves. The bug
// was that completeToolCall sets `result` on the pending entry but doesn't move
// it into `messages` until the next updateConversation — and the display filtered
// out resolved pending tools, so they vanished during that window (most visibly
// after answering a Clarify).
import { describe, it, expect } from 'vitest';
import { deduplicateMessages } from '../messageHelpers';
import type { Conversation } from '@/store/chatSlice';

function conv(partial: Partial<Conversation>): Conversation {
  return { messages: [], streamedCompletedToolCalls: [], pending_tool_calls: [], ...partial } as Conversation;
}
const toolCall = (id: string, name = 'Clarify') => ({ id, type: 'function', function: { name, arguments: '{}' } });

describe('deduplicateMessages — resolved pending tools stay visible', () => {
  it('keeps a resolved pending tool visible (result set, not yet in messages)', () => {
    const c = conv({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pending_tool_calls: [{ toolCall: toolCall('t1'), result: { role: 'tool', tool_call_id: 't1', content: '{"answer":"yes"}', created_at: 'now' } }] as any,
    });
    const t1 = deduplicateMessages(c).find((m) => (m as { tool_call_id?: string }).tool_call_id === 't1');
    expect(t1).toBeDefined();
    expect((t1 as { content: string }).content).toBe('{"answer":"yes"}');
    expect((t1 as { isPending?: boolean }).isPending).toBe(false);
  });

  it('still shows an executing (unresolved) pending tool as "(executing...)"', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = conv({ pending_tool_calls: [{ toolCall: toolCall('t2') }] as any });
    const t2 = deduplicateMessages(c).find((m) => (m as { tool_call_id?: string }).tool_call_id === 't2');
    expect((t2 as { content: string }).content).toBe('(executing...)');
    expect((t2 as { isPending?: boolean }).isPending).toBe(true);
  });

  it('does not double-display once the tool also lands in messages', () => {
    const completed = { role: 'tool', tool_call_id: 't3', content: '{"done":true}', run_id: 'r', function: { name: 'Clarify', arguments: '{}' }, created_at: 'now' };
    const c = conv({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [completed] as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pending_tool_calls: [{ toolCall: toolCall('t3'), result: { role: 'tool', tool_call_id: 't3', content: '{"done":true}', created_at: 'now' } }] as any,
    });
    const t3s = deduplicateMessages(c).filter((m) => (m as { tool_call_id?: string }).tool_call_id === 't3');
    expect(t3s).toHaveLength(1);
    // The persistent messages version wins (no isPending flag).
    expect((t3s[0] as { isPending?: boolean }).isPending).toBeUndefined();
  });
});

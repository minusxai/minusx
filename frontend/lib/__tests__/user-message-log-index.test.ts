// A LOADED conversation's user messages must carry the PI-LOG index (= the
// server's message seq) as `logIndex` — that value is what edit-and-fork and
// delete-and-fork send as the fork endpoint's `atSeq`, which the server
// interprets in SEQ space (copy messages [0, atSeq)).
//
// Regression guarded here: parseLogToMessages assigned `logIndex: i` where i
// indexes the LEGACY-translated log, which expands each assistant turn into
// several entries (synthetic TalkToUser task + result + usage debug). The
// second user turn of a plain 2-exchange conversation sits at pi seq 2 but
// legacy index 4 — so a fork "at" that message copied the WHOLE log and the
// server-side fork silently contained everything the user asked to remove
// (observed live in the browser; the Redux truncation masked it client-side).
import { describe, it, expect } from 'vitest';
import type { ConversationLog, ConversationLogEntry as PiLogEntry, AgentInvocation } from '@/orchestrator/types';
import type { AssistantMessage } from '@/orchestrator/llm';
import { parsePiConversation } from '@/lib/conversations-utils';

const EMPTY_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function rootInvocation(id: string, userMessage: string): PiLogEntry {
  return {
    type: 'toolCall', id, name: 'WebAnalystAgent',
    arguments: { userMessage }, context: {}, parent_id: null,
  } as AgentInvocation & { parent_id: null };
}

function assistantReply(parentAgentId: string, text: string): PiLogEntry {
  const msg: AssistantMessage & { parent_id: string } = {
    role: 'assistant', content: [{ type: 'text', text }],
    api: 'anthropic-messages', provider: 'anthropic', model: 'claude-test',
    usage: EMPTY_USAGE, stopReason: 'stop', timestamp: 1000, parent_id: parentAgentId,
  };
  return msg;
}

describe('parsePiConversation: user message logIndex is the PI seq, not the legacy index', () => {
  it('a two-exchange log yields user messages at logIndex 0 and 2', () => {
    const piLog: ConversationLog = [
      rootInvocation('inv_1', 'first question'),   // pi seq 0
      assistantReply('inv_1', 'answer one'),       // pi seq 1
      rootInvocation('inv_2', 'second question'),  // pi seq 2
      assistantReply('inv_2', 'answer two'),       // pi seq 3
    ] as ConversationLog;

    const { messages } = parsePiConversation(piLog);
    const userMsgs = messages.filter((m: { role: string }) => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[0].logIndex).toBe(0);
    expect(userMsgs[1].logIndex).toBe(2); // NOT the legacy-log position
  });
});

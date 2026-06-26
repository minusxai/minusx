// parsePiLogToMessages: the single pi-native parse that replaces the read-path
// `piLogToLegacy` (server) → `parseLogToMessages` (frontend) two-hop. It produces the SAME render
// structs (so renderers are untouched) AND carries each turn's appState + currentTime onto its user
// message (read off the pi root invocation's `context`, which the append-only log persists per turn).
import { describe, it, expect } from 'vitest';
import { parsePiLogToMessages, parsePiConversation } from '@/lib/conversations-utils';
import type { ConversationLog } from '@/orchestrator/types';
import type { UserMessage } from '@/store/chatSlice';

const USAGE = {
  input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe('parsePiLogToMessages', () => {
  it('parses a pi log into render messages and carries appState + currentTime onto the user turn', () => {
    const piLog = [
      {
        type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null,
        arguments: { userMessage: 'which month has max mrr?' },
        context: { appState: { type: 'file', state: { fileState: { id: 1041, name: 'MRR Dashboard' } } }, currentTime: '2026-06-26 20:00 UTC' },
      },
      {
        role: 'assistant', parent_id: 'root1', content: [{ type: 'text', text: 'June 2024.' }],
        stopReason: 'stop', usage: USAGE, model: 'gpt-5.4', timestamp: 1000,
      },
    ] as unknown as ConversationLog;

    const messages = parsePiLogToMessages(piLog);

    const user = messages.find((m) => m.role === 'user') as UserMessage;
    expect(user).toBeDefined();
    expect(user.content).toBe('which month has max mrr?');
    expect(user.currentTime).toBe('2026-06-26 20:00 UTC');
    expect(user.appState).toBeDefined();
    expect((user.appState as { type: string }).type).toBe('file');
    expect((user.appState as { state: { fileState: { id: number } } }).state.fileState.id).toBe(1041);

    // assistant text becomes a TalkToUser tool message — same as the legacy pipeline produced.
    const ttu = messages.find((m) => m.role === 'tool' && m.function?.name === 'TalkToUser');
    expect(ttu).toBeDefined();
  });

  it("attaches each turn's appState to its own user message, in order (multi-turn)", () => {
    const piLog = [
      { type: 'toolCall', id: 'r1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q1' },
        context: { appState: { type: 'file', state: { fileState: { id: 1 } } }, currentTime: 't1' } },
      { role: 'assistant', parent_id: 'r1', content: [{ type: 'text', text: 'a1' }], stopReason: 'stop', usage: USAGE, model: 'm', timestamp: 1 },
      { type: 'toolCall', id: 'r2', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q2' },
        context: { appState: { type: 'file', state: { fileState: { id: 2 } } }, currentTime: 't2' } },
      { role: 'assistant', parent_id: 'r2', content: [{ type: 'text', text: 'a2' }], stopReason: 'stop', usage: USAGE, model: 'm', timestamp: 2 },
    ] as unknown as ConversationLog;

    const users = parsePiLogToMessages(piLog).filter((m) => m.role === 'user') as UserMessage[];
    expect(users).toHaveLength(2);
    expect(users[0].content).toBe('q1');
    expect((users[0].appState as { state: { fileState: { id: number } } }).state.fileState.id).toBe(1);
    expect(users[0].currentTime).toBe('t1');
    expect(users[1].content).toBe('q2');
    expect((users[1].appState as { state: { fileState: { id: number } } }).state.fileState.id).toBe(2);
    expect(users[1].currentTime).toBe('t2');
  });

  it('parsePiConversation derives agent + agent_args off the first task (for continuation)', () => {
    const piLog = [
      { type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null,
        arguments: { userMessage: 'hi', connection_id: 'static', schema: [{ s: 1 }] },
        context: { appState: { type: 'file', state: { fileState: { id: 7 } } }, currentTime: 't' } },
      { role: 'assistant', parent_id: 'root1', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', usage: USAGE, model: 'm', timestamp: 1 },
    ] as unknown as ConversationLog;

    const { messages, agent, agent_args } = parsePiConversation(piLog);
    // agent derivation matches the legacy loader (piLogToLegacy hardcodes the root task agent)
    expect(agent).toBe('AnalystAgent');
    // agent_args = the root task args (user_message + the rest of the invocation arguments)
    expect(agent_args.user_message).toBe('hi');
    expect(agent_args.connection_id).toBe('static');
    // messages still carry appState
    const user = messages.find((m) => m.role === 'user') as UserMessage;
    expect((user.appState as { state: { fileState: { id: number } } }).state.fileState.id).toBe(7);
  });

  it('produces the same non-user messages as the legacy two-hop (tool calls + debug)', () => {
    const piLog = [
      { type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'go' }, context: {} },
      { role: 'assistant', parent_id: 'root1', content: [{ type: 'toolCall', id: 'tc1', name: 'ReadFiles', arguments: { fileIds: [1] } }], stopReason: 'toolUse', usage: USAGE, model: 'm', timestamp: 1 },
      { role: 'toolResult', parent_id: 'root1', toolCallId: 'tc1', toolName: 'ReadFiles', content: [{ type: 'text', text: '{"success":true}' }], details: { success: true }, isError: false, timestamp: 2 },
    ] as unknown as ConversationLog;

    const messages = parsePiLogToMessages(piLog);
    const readFiles = messages.find((m) => m.role === 'tool' && m.function?.name === 'ReadFiles');
    expect(readFiles).toBeDefined();
    expect((readFiles as { content: string }).content).toContain('success');
    // user message still present with no appState (context empty)
    const user = messages.find((m) => m.role === 'user') as UserMessage;
    expect(user.content).toBe('go');
    expect(user.appState).toBeUndefined();
  });
});

import { deduplicateMessages } from '@/components/explore/message/messageHelpers';
import type { Conversation, CompletedToolCall, UserMessage } from '@/store/chatSlice';

function makeUserMessage(content: string, logIndex: number, created_at = new Date().toISOString()): UserMessage {
  return {
    role: 'user',
    content,
    created_at,
    logIndex,
  };
}

function makeToolMessage({
  tool_call_id,
  content,
  name = 'TalkToUser',
  created_at = new Date().toISOString(),
}: {
  tool_call_id: string;
  content: string;
  name?: string;
  created_at?: string;
}): CompletedToolCall {
  return {
    role: 'tool',
    tool_call_id,
    content,
    run_id: 'run-1',
    function: {
      name,
      arguments: '{}',
    },
    created_at,
  };
}

function makeConversation(overrides: Partial<Conversation>): Conversation {
  return {
    _id: 'conv-1',
    conversationID: 1,
    log_index: 0,
    executionState: 'FINISHED',
    messages: [],
    pending_tool_calls: [],
    agent: 'AnalystAgent',
    agent_args: {},
    streamedCompletedToolCalls: [],
    streamedThinking: '',
    ...overrides,
  };
}

describe('deduplicateMessages', () => {
  it('hides a streamed TalkToUser duplicate once the completed answer for the current turn exists', () => {
    const conversation = makeConversation({
      messages: [
        makeUserMessage('count to 10', 0),
        makeToolMessage({
          tool_call_id: 'final-answer',
          content: JSON.stringify({ content: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10!' }),
        }),
      ],
      streamedCompletedToolCalls: [
        makeToolMessage({
          tool_call_id: 'synthetic-stream',
          content: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10!',
        }),
      ],
    });

    const deduped = deduplicateMessages(conversation);
    const assistantMessages = deduped.filter(message => message.role === 'tool');

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].tool_call_id).toBe('final-answer');
  });

  it('does not hide the current streamed answer when the same text appeared in a previous turn', () => {
    const conversation = makeConversation({
      executionState: 'STREAMING',
      messages: [
        makeUserMessage('count to 10', 0, '2026-04-15T20:00:00.000Z'),
        makeToolMessage({
          tool_call_id: 'previous-answer',
          content: JSON.stringify({ content: 'Done.' }),
          created_at: '2026-04-15T20:00:01.000Z',
        }),
        makeUserMessage('say it again', 2, '2026-04-15T20:01:00.000Z'),
      ],
      streamedCompletedToolCalls: [
        makeToolMessage({
          tool_call_id: 'current-stream',
          content: 'Done.',
          created_at: '2026-04-15T20:01:01.000Z',
        }),
      ],
    });

    const deduped = deduplicateMessages(conversation);
    const assistantMessages = deduped.filter(message => message.role === 'tool');

    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages.map(message => message.tool_call_id)).toEqual([
      'previous-answer',
      'current-stream',
    ]);
  });

  it('hides a stale streamed answer from the previous turn after a new user message is sent', () => {
    const conversation = makeConversation({
      executionState: 'WAITING',
      messages: [
        makeUserMessage('count to 10', 0, '2026-04-15T20:00:00.000Z'),
        makeToolMessage({
          tool_call_id: 'previous-answer',
          content: JSON.stringify({ content: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10!' }),
          created_at: '2026-04-15T20:00:01.000Z',
        }),
        makeUserMessage('now count backwards', 2, '2026-04-15T20:01:00.000Z'),
      ],
      streamedCompletedToolCalls: [
        makeToolMessage({
          tool_call_id: 'stale-stream',
          content: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10!',
          created_at: '2026-04-15T20:00:01.000Z',
        }),
      ],
    });

    const deduped = deduplicateMessages(conversation);
    const assistantMessages = deduped.filter(message => message.role === 'tool');

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].tool_call_id).toBe('previous-answer');
  });
});

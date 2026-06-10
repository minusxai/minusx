/**
 * UI tests for FeedbackBlock gating inside ContentDisplay.
 *
 * The feedback thumbs must appear ONLY when:
 *  1. The agent is done (conversation executionState === 'FINISHED'), and
 *  2. The message is the last assistant message in the conversation.
 *
 * Regression: the block used to render as soon as answer text existed,
 * so it appeared while the answer was still streaming.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { loadConversation, type Conversation } from '@/store/chatSlice';
import ContentDisplay from '@/components/explore/tools/ContentDisplay';
import type { DisplayProps } from '@/lib/types';

const CONVERSATION_ID = 42;

function makeTalkToUserTuple(): DisplayProps['toolCallTuple'] {
  const toolCall = {
    id: 'tc-1',
    type: 'function',
    function: { name: 'TalkToUser', arguments: '{}' },
  };
  const toolMessage = {
    role: 'tool',
    tool_call_id: 'tc-1',
    content: JSON.stringify({
      content_blocks: [{ type: 'text', text: 'Here is your answer.' }],
    }),
  };
  return [toolCall, toolMessage] as unknown as DisplayProps['toolCallTuple'];
}

function makeConversation(executionState: Conversation['executionState']): Conversation {
  return {
    _id: 'test-conv',
    conversationID: CONVERSATION_ID,
    log_index: 2,
    executionState,
    messages: [],
    pending_tool_calls: [],
    agent: 'AnalystAgent',
    agent_args: {},
    streamedCompletedToolCalls: [],
    streamedThinking: '',
  };
}

function renderContentDisplay({
  executionState,
  isLastAssistantMessage,
}: {
  executionState: Conversation['executionState'];
  isLastAssistantMessage: boolean;
}) {
  const store = makeStore();
  store.dispatch(loadConversation({ conversation: makeConversation(executionState) }));
  return renderWithProviders(
    <ContentDisplay
      toolCallTuple={makeTalkToUserTuple()}
      showThinking={false}
      conversationID={CONVERSATION_ID}
      userMessageLogIndex={0}
      isLastAssistantMessage={isLastAssistantMessage}
    />,
    { store },
  );
}

describe('ContentDisplay feedback gating', () => {
  it('shows feedback on the last assistant message once the agent is FINISHED', () => {
    renderContentDisplay({ executionState: 'FINISHED', isLastAssistantMessage: true });
    expect(screen.getByLabelText('Thumbs up')).toBeInTheDocument();
    expect(screen.getByLabelText('Thumbs down')).toBeInTheDocument();
  });

  it('hides feedback while the answer is STREAMING', () => {
    renderContentDisplay({ executionState: 'STREAMING', isLastAssistantMessage: true });
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thumbs down')).not.toBeInTheDocument();
  });

  it('hides feedback while tools are still EXECUTING', () => {
    renderContentDisplay({ executionState: 'EXECUTING', isLastAssistantMessage: true });
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
  });

  it('hides feedback on earlier assistant messages even when FINISHED', () => {
    renderContentDisplay({ executionState: 'FINISHED', isLastAssistantMessage: false });
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
  });
});

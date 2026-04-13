/**
 * Tests for editAndForkMessage action in chatSlice.
 *
 * editAndForkMessage truncates conversation.messages at the fork point,
 * adds the new user message, sets log_index to the fork log index, and
 * sets executionState = 'WAITING'.
 */

import { configureStore } from '@reduxjs/toolkit';
import chatReducer, {
  createConversation,
  editAndForkMessage,
  type UserMessage,
} from '@/store/chatSlice';
import type { RootState } from '@/store/store';

function buildStore(preloaded?: Partial<RootState['chat']>) {
  return configureStore({
    reducer: { chat: chatReducer },
    preloadedState: preloaded ? { chat: preloaded as any } : undefined,
  });
}

/** Build a minimal conversation state with a few messages. */
function storeWithConversation() {
  const store = buildStore();

  store.dispatch(createConversation({
    conversationID: 1,
    agent: 'AnalystAgent',
    agent_args: {},
  }));

  // Manually push some messages to simulate a multi-turn conversation
  const state = store.getState().chat;
  const conv = state.conversations[1];

  // We inject messages directly (simulating what parseLogToMessages + updateConversation would do)
  const userMsg1: UserMessage = { role: 'user', content: 'first message', created_at: '2024-01-01T00:00:00Z', logIndex: 0 };
  const toolMsg1 = { role: 'tool' as const, tool_call_id: 'tc-1', content: 'result 1', run_id: 'r1', function: { name: 'sql', arguments: '{}' }, created_at: '2024-01-01T00:00:01Z' };
  const userMsg2: UserMessage = { role: 'user', content: 'second message', created_at: '2024-01-01T00:00:02Z', logIndex: 2 };
  const toolMsg2 = { role: 'tool' as const, tool_call_id: 'tc-2', content: 'result 2', run_id: 'r2', function: { name: 'sql', arguments: '{}' }, created_at: '2024-01-01T00:00:03Z' };

  // Push into store via direct mutation of preloaded state (simulating Redux hydration)
  return configureStore({
    reducer: { chat: chatReducer },
    preloadedState: {
      chat: {
        ...state,
        conversations: {
          1: {
            ...conv,
            messages: [userMsg1, toolMsg1, userMsg2, toolMsg2],
            log_index: 4,
          },
        },
      },
    },
  });
}

describe('editAndForkMessage', () => {
  it('truncates messages to before the edited user message and adds new message', () => {
    const store = storeWithConversation();

    store.dispatch(editAndForkMessage({
      conversationID: 1,
      logIndex: 2,  // Fork from second user message (logIndex=2)
      message: 'edited second message',
    }));

    const messages = store.getState().chat.conversations[1].messages;
    // Should have: userMsg1, toolMsg1, new user message (everything from logIndex=2 onwards removed)
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'first message' });
    expect(messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'tc-1' });
    expect(messages[2]).toMatchObject({ role: 'user', content: 'edited second message' });
  });

  it('sets conversation log_index to the fork logIndex', () => {
    const store = storeWithConversation();

    store.dispatch(editAndForkMessage({
      conversationID: 1,
      logIndex: 2,
      message: 'edited',
    }));

    expect(store.getState().chat.conversations[1].log_index).toBe(2);
  });

  it('sets executionState to WAITING', () => {
    const store = storeWithConversation();

    store.dispatch(editAndForkMessage({
      conversationID: 1,
      logIndex: 2,
      message: 'edited',
    }));

    expect(store.getState().chat.conversations[1].executionState).toBe('WAITING');
  });

  it('allows forking from the first message (logIndex=0)', () => {
    const store = storeWithConversation();

    store.dispatch(editAndForkMessage({
      conversationID: 1,
      logIndex: 0,
      message: 'brand new start',
    }));

    const messages = store.getState().chat.conversations[1].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'brand new start' });
  });

  it('does nothing if conversationID does not exist', () => {
    const store = storeWithConversation();
    const before = store.getState().chat.conversations;

    store.dispatch(editAndForkMessage({
      conversationID: 999,
      logIndex: 0,
      message: 'noop',
    }));

    expect(store.getState().chat.conversations).toEqual(before);
  });
});

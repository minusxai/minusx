import { configureStore } from '@reduxjs/toolkit';

import chatReducer, {
  addStreamingMessage,
  createConversation,
  queueMessage,
  selectConversation,
  updateConversation,
} from '../chatSlice';
import type { RootState } from '../store';

describe('chat queue across temp to real conversation fork', () => {
  it('preserves queued messages added after /explore navigates to the real conversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const tempConversationID = -105;
    const realConversationID = 321;

    store.dispatch(createConversation({
      conversationID: tempConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start from explore',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'NewConversation',
      payload: { name: 'Queued chat regression' },
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'StreamedThinking',
      payload: { chunk: 'thinking...' },
    }));

    store.dispatch(queueMessage({
      conversationID: realConversationID,
      message: 'follow-up queued after navigation',
    }));

    let realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued after navigation');

    store.dispatch(updateConversation({
      conversationID: tempConversationID,
      newConversationID: realConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued after navigation');
  });

  it('preserves queued messages if the UI still dispatches to the temp conversation after the real one exists', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const tempConversationID = -106;
    const realConversationID = 322;

    store.dispatch(createConversation({
      conversationID: tempConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start from explore',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'NewConversation',
      payload: { name: 'Queued chat regression' },
    }));

    store.dispatch(queueMessage({
      conversationID: tempConversationID,
      message: 'follow-up queued on stale temp conversation',
    }));

    const tempConversation = selectConversation(
      store.getState() as RootState,
      tempConversationID
    );
    expect(tempConversation?.queuedMessages).toHaveLength(1);

    store.dispatch(updateConversation({
      conversationID: tempConversationID,
      newConversationID: realConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    const realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued on stale temp conversation');
  });
});

// ─── chatQueueFork.test.ts ───

import { configureStore } from '@reduxjs/toolkit';

import chatReducer, {
  addStreamingMessage,
  clearStreamingContent,
  createConversation,
  queueMessage,
  selectConversation,
  updateConversation,
} from '../chatSlice';
import type { RootState } from '../store';

describe('chat queue across conflict-fork (real → new real)', () => {
  // Conversations now always start with real positive IDs (from /api/chat/init).
  // Forks still happen on conflict resolution: updateConversation with newConversationID != conversationID.

  it('merges queued messages from original conversation into forked conversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const originalConversationID = 321;
    const forkedConversationID = 400;

    store.dispatch(createConversation({
      conversationID: originalConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start',
    }));

    store.dispatch(queueMessage({
      conversationID: originalConversationID,
      message: 'follow-up queued during execution',
    }));

    store.dispatch(updateConversation({
      conversationID: originalConversationID,
      newConversationID: forkedConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    const forked = selectConversation(store.getState() as RootState, forkedConversationID);
    expect(forked?.queuedMessages).toHaveLength(1);
    expect(forked?.queuedMessages?.[0].message).toBe('follow-up queued during execution');
  });

  it('merges queued messages from both original and pre-existing forked conversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const originalConversationID = 322;
    const forkedConversationID = 401;

    store.dispatch(createConversation({
      conversationID: originalConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start',
    }));

    // Pre-seed forked conversation with a queued message
    store.dispatch(createConversation({
      conversationID: forkedConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
    }));
    store.dispatch(queueMessage({
      conversationID: forkedConversationID,
      message: 'queued on forked before merge',
    }));

    store.dispatch(queueMessage({
      conversationID: originalConversationID,
      message: 'queued on original',
    }));

    store.dispatch(updateConversation({
      conversationID: originalConversationID,
      newConversationID: forkedConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    const forked = selectConversation(store.getState() as RootState, forkedConversationID);
    expect(forked?.queuedMessages).toHaveLength(2);
  });

  it('clears ephemeral streamed content from the forked conversation on updateConversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const originalConversationID = 323;
    const forkedConversationID = 402;

    store.dispatch(createConversation({
      conversationID: originalConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: originalConversationID,
      type: 'StreamedContent',
      payload: { chunk: 'stale streamed answer' },
    }));

    store.dispatch(clearStreamingContent({ conversationID: originalConversationID }));

    store.dispatch(updateConversation({
      conversationID: originalConversationID,
      newConversationID: forkedConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    const forked = selectConversation(store.getState() as RootState, forkedConversationID);
    expect(forked?.streamedCompletedToolCalls).toHaveLength(0);
    expect(forked?.streamedThinking).toBe('');
  });
});

// ─── fileAnalytics tests moved to analytics.test.ts ───
// The analytics layer now uses PGLite/Postgres (same DB as documents).
// Full write/read tests live in store/__tests__/analytics.test.ts.


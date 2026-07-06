// ─── chatQueueFork.test.ts ───

import { configureStore } from '@reduxjs/toolkit';

import chatReducer, {
  addStreamingMessage,
  clearStreamingContent,
  createConversation,
  queueMessage,
  selectConversation,
  sendMessage,
  updateAgentArgs,
  updateConversation,
} from '../chatSlice';
import type { RootState } from '../store';
import type { UserMessage } from '../chatSlice';

describe('chat queue across conflict-fork (real → new real)', () => {
  // Conversations now always start with real positive IDs (from POST /api/conversations).
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

// ─── sendMessage snapshots the per-turn app state onto the user message ───
// The "Inspect tool calls" modal builds its App-state entry off `userMessage.appState`. The
// read-path parser attaches it from the persisted pi log; the LIVE send path must do the same so
// the App-state entry (screenshot / markup / JSON) shows up for the active conversation too.
describe('sendMessage attaches the current app state to the user message', () => {
  const makeStore = () => configureStore({ reducer: { chat: chatReducer } });
  const APP_STATE = {
    type: 'file' as const,
    state: { fileState: { id: 7, name: 'Q', path: '/q', type: 'question', isDirty: false, image: { key: 'k', url: 'https://x/s.jpg' } }, references: [], queryResults: [] },
  };

  it('snapshots agent_args.app_state (+ currentTime) onto the sent user message', () => {
    const store = makeStore();
    const cid = 900;
    store.dispatch(createConversation({ conversationID: cid, agent: 'AnalystAgent', agent_args: {} }));
    // ChatInterface sets the screenshot-bearing app state on agent_args BEFORE dispatching sendMessage.
    store.dispatch(updateAgentArgs({ conversationID: cid, agent_args: { app_state: APP_STATE, currentTime: '2026-06-27 10:00 UTC' } }));
    store.dispatch(sendMessage({ conversationID: cid, message: 'which month has max mrr?' }));

    const conv = selectConversation(store.getState() as RootState, cid);
    const user = conv?.messages.find((m) => m.role === 'user') as UserMessage;
    expect(user.content).toBe('which month has max mrr?');
    expect(user.appState).toEqual(APP_STATE);
    expect(user.currentTime).toBe('2026-06-27 10:00 UTC');
  });

  it('omits appState when none is set (no empty entry)', () => {
    const store = makeStore();
    const cid = 901;
    store.dispatch(createConversation({ conversationID: cid, agent: 'AnalystAgent', agent_args: {} }));
    store.dispatch(sendMessage({ conversationID: cid, message: 'hi' }));
    const conv = selectConversation(store.getState() as RootState, cid);
    const user = conv?.messages.find((m) => m.role === 'user') as UserMessage;
    expect(user.appState).toBeUndefined();
  });
});

// ─── fileAnalytics tests moved to analytics.test.ts ───
// The analytics layer now uses PGLite/Postgres (same DB as documents).
// Full write/read tests live in store/__tests__/analytics.test.ts.


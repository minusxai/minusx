// chatV2Slice — sibling to the legacy chatSlice. Tracks per-chat state for
// the new TS-orchestrator-driven chat flow (`type: 'chat'` files served by
// `/api/chat/v2`). Intentionally narrower than chatSlice — no Python-format
// parsing, no `forkedConversationID` chain, no message-queue model.
//
// State model (per chat):
//   - `log`: ConversationLog (orchestrator's append-only entries).
//   - `executionState`: 'idle' | 'running' | 'pending' | 'finished' | 'error'.
//     `running` = fetch in flight; `pending` = waiting for the bridge to
//     resolve frontend tools; `finished` = stop turn reached.
//   - `pendingToolCalls`: snapshot of orchestrator pending tool calls
//     returned from the last `/api/chat/v2` response.
//   - `error`: last error message, if any.
//
// The `chatV2Listener` middleware reacts to `sendChatV2Message` and resume
// dispatches; UI components read from this slice.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ConversationLog, PendingToolCall } from '@/orchestrator/types';

export type ChatV2ExecutionState = 'idle' | 'running' | 'pending' | 'finished' | 'error';

export interface ChatV2State {
  log: ConversationLog;
  executionState: ChatV2ExecutionState;
  pendingToolCalls: PendingToolCall[];
  error?: string;
  forkedFrom?: number;
}

export interface ChatV2RootState {
  /** Map keyed by chatId. Drafts (no chatId yet) are tracked under `chatId: 0` and reassigned. */
  chats: Record<number, ChatV2State>;
  activeChatId: number | null;
}

const initialChatState: ChatV2State = {
  log: [],
  executionState: 'idle',
  pendingToolCalls: [],
};

const initialState: ChatV2RootState = {
  chats: {},
  activeChatId: null,
};

const chatV2Slice = createSlice({
  name: 'chatV2',
  initialState,
  reducers: {
    setActiveChat(state, action: PayloadAction<{ chatId: number | null }>) {
      state.activeChatId = action.payload.chatId;
    },

    /**
     * UI dispatches this to send a new user message. The chatV2Listener
     * picks it up, POSTs `/api/chat/v2`, and updates state via the
     * `chatTurnStarted/Completed/Failed` reducers below.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- payload consumed by listener middleware
    sendChatV2Message(state, _action: PayloadAction<{ chatId?: number; message: string; agentArgs?: Record<string, unknown> }>) {
      // No state mutation here — the listener does the work and dispatches
      // chatTurnStarted to mark the chat as running.
      void state;
    },

    chatTurnStarted(state, action: PayloadAction<{ chatId: number }>) {
      const { chatId } = action.payload;
      if (!state.chats[chatId]) state.chats[chatId] = { ...initialChatState };
      state.chats[chatId].executionState = 'running';
      state.chats[chatId].error = undefined;
    },

    chatTurnCompleted(
      state,
      action: PayloadAction<{
        chatId: number;
        log: ConversationLog;
        pendingToolCalls: PendingToolCall[];
        done: 'stop' | 'pending' | 'error';
        forkedFrom?: number;
      }>,
    ) {
      const { chatId, log, pendingToolCalls, done, forkedFrom } = action.payload;
      if (!state.chats[chatId]) state.chats[chatId] = { ...initialChatState };
      state.chats[chatId].log = log;
      state.chats[chatId].pendingToolCalls = pendingToolCalls;
      state.chats[chatId].executionState =
        done === 'pending' ? 'pending' : done === 'error' ? 'error' : 'finished';
      if (forkedFrom !== undefined) state.chats[chatId].forkedFrom = forkedFrom;
    },

    chatTurnFailed(state, action: PayloadAction<{ chatId: number; error: string }>) {
      const { chatId, error } = action.payload;
      if (!state.chats[chatId]) state.chats[chatId] = { ...initialChatState };
      state.chats[chatId].executionState = 'error';
      state.chats[chatId].error = error;
    },

    /**
     * Snapshot a chat's saved log into Redux (e.g. when navigating to an
     * existing chat). Useful for the chat detail page on initial load.
     */
    loadChatV2(state, action: PayloadAction<{ chatId: number; log: ConversationLog }>) {
      const { chatId, log } = action.payload;
      state.chats[chatId] = {
        ...initialChatState,
        log,
        executionState: 'finished',
      };
    },
  },
});

export const {
  setActiveChat,
  sendChatV2Message,
  chatTurnStarted,
  chatTurnCompleted,
  chatTurnFailed,
  loadChatV2,
} = chatV2Slice.actions;

export const selectChatV2 = (state: { chatV2: ChatV2RootState }, chatId: number) =>
  state.chatV2.chats[chatId];

export const selectActiveChatV2 = (state: { chatV2: ChatV2RootState }) =>
  state.chatV2.activeChatId != null ? state.chatV2.chats[state.chatV2.activeChatId] : undefined;

export default chatV2Slice.reducer;

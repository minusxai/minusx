// chatV2Listener — middleware that drives the new chat surface.
// On `sendChatV2Message`:
//   1. POST `/api/chat/v2` with { chatId, message, agentArgs }.
//   2. Update Redux state with response (log + pendingToolCalls + executionState).
//   3. If pending tools — call `bridgePendingTools` with real Redux state, then
//      POST again with completedToolCalls; loop until done = 'stop' | 'error'.
//
// API_BASE_URL mirrors chatListener.ts so node test environments reach
// localhost:3000 (where setupMockFetch intercepts).

import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from './store';
import {
  sendChatV2Message,
  chatTurnStarted,
  chatTurnCompleted,
  chatTurnFailed,
  setActiveChat,
} from './chatV2Slice';
import type { ConversationLog, PendingToolCall } from '@/orchestrator/types';
import { bridgePendingTools } from '@/lib/api/chat-v2/bridge';
import type { ToolResultMessage } from '@mariozechner/pi-ai';
import type { DatabaseWithSchema } from '@/lib/types';

// Frontend tools used by WebAnalystAgent (EditFile/CreateFile/DeleteFile)
// don't need an active connection — they mutate file Redux state directly.
// We pass an empty schema-bearing stub so executeToolCall's signature is
// satisfied. If a future frontend tool needs a real database, plumb the
// active connection here.
const EMPTY_DB_STUB: DatabaseWithSchema = {
  databaseName: '',
  dialect: 'duckdb',
  schemas: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:3000' : '';

interface ChatV2Response {
  chatId: number;
  forked: boolean;
  log: ConversationLog;
  pendingToolCalls: PendingToolCall[];
  done: 'stop' | 'pending' | 'error';
  error?: string;
}

async function postChatV2(body: Record<string, unknown>): Promise<ChatV2Response> {
  const res = await fetch(`${API_BASE_URL}/api/chat/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/chat/v2 ${res.status}: ${text}`);
  }
  return (await res.json()) as ChatV2Response;
}

export const chatV2ListenerMiddleware = createListenerMiddleware();

chatV2ListenerMiddleware.startListening({
  actionCreator: sendChatV2Message,
  effect: async (action, listenerApi) => {
    const dispatch = listenerApi.dispatch as AppDispatch;
    const initialChatId = action.payload.chatId ?? 0;

    dispatch(chatTurnStarted({ chatId: initialChatId }));

    try {
      // Turn 1: send the user message.
      let response = await postChatV2({
        chatId: action.payload.chatId,
        message: action.payload.message,
        agentArgs: action.payload.agentArgs,
      });

      // If chatId changed (draft → real id assigned by server, or fork),
      // reassign in Redux and clear the placeholder slot.
      let resolvedChatId = response.chatId;
      if (resolvedChatId !== initialChatId) {
        dispatch(setActiveChat({ chatId: resolvedChatId }));
      }
      dispatch(chatTurnCompleted({
        chatId: resolvedChatId,
        log: response.log,
        pendingToolCalls: response.pendingToolCalls,
        done: response.done,
        forkedFrom: response.forked ? initialChatId : undefined,
      }));

      // Resume loop: while pending, bridge then re-POST.
      // eslint-disable-next-line no-restricted-syntax -- bridge needs current Redux state at each step
      while (response.done === 'pending' && response.pendingToolCalls.length > 0) {
        const state = listenerApi.getState() as RootState;
        const completedToolCalls: ToolResultMessage[] = await bridgePendingTools(
          response.pendingToolCalls,
          dispatch,
          state,
          EMPTY_DB_STUB,
          listenerApi.signal,
        );

        response = await postChatV2({
          chatId: resolvedChatId,
          completedToolCalls,
        });
        if (response.chatId !== resolvedChatId) {
          resolvedChatId = response.chatId;
          dispatch(setActiveChat({ chatId: resolvedChatId }));
        }
        dispatch(chatTurnCompleted({
          chatId: resolvedChatId,
          log: response.log,
          pendingToolCalls: response.pendingToolCalls,
          done: response.done,
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch(chatTurnFailed({ chatId: initialChatId, error: message }));
    }
  },
});

// chatV2Listener — middleware that drives the new chat surface via SSE.
// On `sendChatV2Message`:
//   1. POST `/api/chat/v2/stream` with { chatId, message, agentArgs }.
//   2. Parse incoming SSE frames; dispatch each `event: orchestrator` into
//      `chatV2OrchestratorEvent` so the UI sees streaming events live.
//   3. On `event: done`, dispatch `chatTurnCompleted` with the canonical
//      log + pendingToolCalls.
//   4. If pending tools — call `bridgePendingTools` against real Redux,
//      then re-POST `/api/chat/v2/stream` with completedToolCalls. Loop
//      until done = 'stop' | 'error'.
//
// The non-streaming /api/chat/v2 remains available for tests and as a
// fallback; the listener prefers the streaming endpoint.

import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from './store';
import {
  sendChatV2Message,
  chatTurnStarted,
  chatTurnCompleted,
  chatTurnFailed,
  chatV2OrchestratorEvent,
  setActiveChat,
} from './chatV2Slice';
import type { ConversationLog, PendingToolCall, StreamEvent } from '@/orchestrator/types';
import { bridgePendingTools } from '@/lib/api/chat-v2/bridge';
import type { ToolResultMessage } from '@mariozechner/pi-ai';
import type { DatabaseWithSchema } from '@/lib/types';

const API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:3000' : '';

interface ChatV2Response {
  chatId: number;
  forked: boolean;
  log: ConversationLog;
  pendingToolCalls: PendingToolCall[];
  done: 'stop' | 'pending' | 'error';
  error?: string;
}

// Frontend tools used by WebAnalystAgent (EditFile/CreateFile/DeleteFile)
// don't need an active connection — they mutate file Redux state directly.
// Pass an empty schema-bearing stub so executeToolCall's signature is
// satisfied. If a future frontend tool needs a real database, plumb the
// active connection here.
const EMPTY_DB_STUB: DatabaseWithSchema = {
  databaseName: '',
  dialect: 'duckdb',
  schemas: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface SsePostResult {
  response: ChatV2Response;
  error?: string;
}

/**
 * Streaming POST. Yields each orchestrator event to `onOrchestratorEvent`
 * as it arrives. Resolves when the `done` SSE frame is received.
 */
async function postChatV2Stream(
  body: Record<string, unknown>,
  onOrchestratorEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<SsePostResult> {
  const res = await fetch(`${API_BASE_URL}/api/chat/v2/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '<unreadable>');
    throw new Error(`/api/chat/v2/stream ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: ChatV2Response | null = null;
  let errorPayload: string | undefined;

  // eslint-disable-next-line no-constant-condition, no-restricted-syntax -- driving SSE stream
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = chunk.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice('event: '.length);
      const data = JSON.parse(dataLine.slice('data: '.length));
      if (event === 'orchestrator') {
        onOrchestratorEvent(data as StreamEvent);
      } else if (event === 'done') {
        finalResponse = data as ChatV2Response;
      } else if (event === 'error') {
        errorPayload = (data as { error?: string }).error ?? 'stream error';
      }
    }
  }

  if (!finalResponse) {
    throw new Error(errorPayload ?? '/api/chat/v2/stream: stream ended without a `done` frame');
  }
  return { response: finalResponse, error: errorPayload };
}

export const chatV2ListenerMiddleware = createListenerMiddleware();

chatV2ListenerMiddleware.startListening({
  actionCreator: sendChatV2Message,
  effect: async (action, listenerApi) => {
    const dispatch = listenerApi.dispatch as AppDispatch;
    const initialChatId = action.payload.chatId ?? 0;

    dispatch(chatTurnStarted({ chatId: initialChatId }));

    let resolvedChatId = initialChatId;
    const onEvent = (ev: StreamEvent) => {
      // Pre-resolution: events route to the placeholder slot until the
      // `done` frame tells us the real chatId. Post-resolution: route to it.
      dispatch(chatV2OrchestratorEvent({ chatId: resolvedChatId, event: ev }));
    };

    try {
      // Turn 1: send the user message.
      let { response } = await postChatV2Stream(
        {
          chatId: action.payload.chatId,
          message: action.payload.message,
          agentArgs: action.payload.agentArgs,
        },
        onEvent,
        listenerApi.signal,
      );

      if (response.chatId !== initialChatId) {
        resolvedChatId = response.chatId;
        dispatch(setActiveChat({ chatId: resolvedChatId }));
      }
      dispatch(chatTurnCompleted({
        chatId: resolvedChatId,
        log: response.log,
        pendingToolCalls: response.pendingToolCalls,
        done: response.done,
        forkedFrom: response.forked ? initialChatId : undefined,
      }));

      // Resume loop: while pending, bridge then re-POST (also streamed).
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

        dispatch(chatTurnStarted({ chatId: resolvedChatId }));
        const next = await postChatV2Stream(
          {
            chatId: resolvedChatId,
            completedToolCalls,
          },
          onEvent,
          listenerApi.signal,
        );
        response = next.response;
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
      dispatch(chatTurnFailed({ chatId: resolvedChatId, error: message }));
    }
  },
});

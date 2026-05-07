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
import { getCurrentAsUser, getCurrentV } from '@/lib/navigation/url-utils';
import { getCurrentMode } from '@/lib/mode/mode-utils';
import { IS_TEST } from '@/lib/constants';

const API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:3000' : '';

// Mirror lib/api/fetch-patch.ts. XHR doesn't go through patched window.fetch,
// so we have to thread as_user / mode / v onto the URL ourselves.
function patchApiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  const asUser = getCurrentAsUser();
  const mode = getCurrentMode();
  const v = getCurrentV();
  if (!asUser && mode === 'org' && !v) return path;
  const url = new URL(path, window.location.origin);
  if (asUser) url.searchParams.set('as_user', asUser);
  if (mode !== 'org') url.searchParams.set('mode', mode);
  if (v) url.searchParams.set('v', v);
  return url.pathname + url.search;
}

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
  schemas: [],
};

interface SsePostResult {
  response: ChatV2Response;
  error?: string;
}

/**
 * Fetch-based SSE for tests (Node env). Tests mock global.fetch and return a
 * Response with a string body — the real ReadableStream-on-Response path
 * streams those bytes correctly. Browser uses postChatV2StreamXHR instead
 * (see `postChatV2Stream` dispatcher below).
 */
async function postChatV2StreamFetch(
  body: Record<string, unknown>,
  onOrchestratorEvent: (ev: StreamEvent) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<SsePostResult> {
  const res = await fetch(patchApiUrl(`${API_BASE_URL}/api/chat/v2/stream`), {
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
      const parsed = parseSSEChunk(chunk);
      if (!parsed) continue;
      const { event, data } = parsed;
      if (event === 'orchestrator') {
        await onOrchestratorEvent(data as StreamEvent);
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

function parseSSEChunk(chunk: string): { event: string; data: unknown } | null {
  const lines = chunk.trim().split('\n');
  let event = '';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.substring(6).trim();
    else if (line.startsWith('data:')) data = line.substring(5).trim();
  }
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch (e) {
    console.error('[chat/v2/stream] failed to parse SSE data:', e);
    return null;
  }
}

/**
 * Streaming POST via XMLHttpRequest. Yields each orchestrator event to
 * `onOrchestratorEvent` as it arrives. Resolves when the `done` SSE frame
 * is received.
 *
 * Uses XHR instead of fetch() because Next.js/React patches the global
 * fetch() to buffer entire responses before resolving, which breaks SSE —
 * the browser receives all bytes at once only after the stream closes. XHR's
 * onprogress fires incrementally as each chunk arrives. (Mirrors the legacy
 * streamChatSSE pattern in chatListener.ts.)
 *
 * Streaming events are serialised through `processingChain` so React renders
 * each chunk in order — the setTimeout(0) yield inside the dispatch call
 * needs to complete before the next dispatch.
 */
function postChatV2StreamXHR(
  body: Record<string, unknown>,
  onOrchestratorEvent: (ev: StreamEvent) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<SsePostResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', patchApiUrl(`${API_BASE_URL}/api/chat/v2/stream`));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');

    let offset = 0;
    let buffer = '';
    let finalResponse: ChatV2Response | null = null;
    let errorPayload: string | undefined;
    let processingChain: Promise<void> = Promise.resolve();

    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onprogress = () => {
      const newText = xhr.responseText.slice(offset);
      offset = xhr.responseText.length;

      buffer += newText;
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const parsed = parseSSEChunk(chunk);
        if (!parsed) continue;
        const { event, data } = parsed;

        if (event === 'orchestrator') {
          const captured = data as StreamEvent;
          processingChain = processingChain.then(() =>
            Promise.resolve(onOrchestratorEvent(captured)),
          );
        } else if (event === 'done') {
          finalResponse = data as ChatV2Response;
        } else if (event === 'error') {
          errorPayload = (data as { error?: string })?.error ?? 'stream error';
        }
      }
    };

    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`/api/chat/v2/stream ${xhr.status}: ${xhr.responseText.slice(0, 500)}`));
        return;
      }
      // Drain queued event handlers before resolving.
      processingChain.then(() => {
        if (!finalResponse) {
          reject(
            new Error(
              errorPayload ?? '/api/chat/v2/stream: stream ended without a `done` frame',
            ),
          );
          return;
        }
        resolve({ response: finalResponse, error: errorPayload });
      });
    };

    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('Network error'));
    };

    xhr.onabort = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(JSON.stringify(body));
  });
}

/**
 * Streaming POST. In the browser, uses XHR (Next.js patches global fetch
 * to buffer the entire response, breaking SSE — XHR onprogress fires per
 * chunk). In Node tests, fetch streams correctly so we use fetch directly.
 */
function postChatV2Stream(
  body: Record<string, unknown>,
  onOrchestratorEvent: (ev: StreamEvent) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<SsePostResult> {
  if (IS_TEST || typeof XMLHttpRequest === 'undefined') {
    return postChatV2StreamFetch(body, onOrchestratorEvent, signal);
  }
  return postChatV2StreamXHR(body, onOrchestratorEvent, signal);
}

export const chatV2ListenerMiddleware = createListenerMiddleware();

chatV2ListenerMiddleware.startListening({
  actionCreator: sendChatV2Message,
  effect: async (action, listenerApi) => {
    const dispatch = listenerApi.dispatch as AppDispatch;
    const initialChatId = action.payload.chatId ?? 0;

    dispatch(chatTurnStarted({ chatId: initialChatId, userMessage: action.payload.message }));

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

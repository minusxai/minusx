/**
 * Chat Architecture v3 — browser streaming client.
 *
 * Drives one v3 turn from the frontend: POST …/turns to start (or resume), then read the resumable
 * GET …/stream and surface its events. On a transport drop it reconnects with the last cursor
 * (`since`) — the server replays the gap from the durable log, so the user never loses a turn.
 * Decoupled from Redux: the chat listener maps the callbacks to actions.
 */
import { API_BASE_URL, patchApiUrl } from './api-url';
import type { ConversationStreamEvent, StreamPendingToolCall, RunStatus } from '@/lib/data/conversations.types';

export interface V3TurnInput {
  userMessage?: string;
  completedToolCalls?: unknown[];
  agent?: string;
  agentArgs?: Record<string, unknown>;
}

export interface V3StreamCallbacks {
  /** A live (ephemeral) token chunk for the in-flight assistant message. */
  onDelta: (text: string) => void;
  /** The turn paused on frontend-bridged tool calls the client must execute. */
  onPending: (toolCalls: StreamPendingToolCall[]) => void;
  /** A committed message landed (seq advanced) — used to track the resume cursor. */
  onMessageSeq?: (seq: number) => void;
}

export interface V3TurnResult {
  status: RunStatus;     // terminal status observed (idle | paused | error)
  error?: string;
  pendingToolCalls: StreamPendingToolCall[];
  finalSeq: number;
}

const RESUME_BACKOFF_MS = [1000, 2000, 4000];

function parseSseEvents(buffer: string): { events: ConversationStreamEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: ConversationStreamEvent[] = [];
  for (const part of parts) {
    const line = part.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(6)) as ConversationStreamEvent); } catch { /* skip */ }
  }
  return { events, rest };
}

/**
 * Read the resumable GET stream once (XHR for incremental onprogress, like the v2 path). Resolves
 * on the terminal `done`/`error` event; rejects with `Network error` on a transport drop so the
 * caller can reconnect with the latest cursor.
 */
function readStreamOnce(
  conversationId: number,
  since: number,
  signal: AbortSignal,
  cb: V3StreamCallbacks,
  state: { cursor: number; result: V3TurnResult },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', patchApiUrl(`${API_BASE_URL}/api/conversations/${conversationId}/stream?since=${since}`));

    let offset = 0;
    let buffer = '';
    let settled = false;

    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    const handle = (e: ConversationStreamEvent) => {
      switch (e.type) {
        case 'message':
          state.cursor = Math.max(state.cursor, e.seq);
          cb.onMessageSeq?.(e.seq);
          break;
        case 'delta':
          cb.onDelta(e.text);
          break;
        case 'pending':
          state.result.pendingToolCalls = e.toolCalls;
          cb.onPending(e.toolCalls);
          break;
        case 'status':
          state.result.status = e.runStatus;
          break;
        case 'done':
          state.result.finalSeq = e.seq;
          settled = true;
          break;
        case 'error':
          state.result.status = 'error';
          state.result.error = e.error;
          settled = true;
          break;
      }
    };

    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(offset);
      offset = xhr.responseText.length;
      const { events, rest } = parseSseEvents(buffer);
      buffer = rest;
      for (const e of events) handle(e);
    };

    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      // Drain any trailing buffered event.
      const { events } = parseSseEvents(buffer + '\n\n');
      for (const e of events) handle(e);
      resolve();
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      if (settled) { resolve(); return; }
      reject(new Error('Network error'));
    };
    xhr.onabort = () => {
      signal.removeEventListener('abort', onAbort);
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    };
    xhr.send();
  });
}

/** Start (or resume) a v3 turn and stream it to completion, reconnecting across transport drops. */
export async function runV3Turn(
  conversationId: number,
  sinceLogIndex: number,
  turn: V3TurnInput,
  signal: AbortSignal,
  cb: V3StreamCallbacks,
): Promise<V3TurnResult> {
  // 1. Start/resume the turn. The route flips run_status -> running before returning, so the stream
  //    we open next always sees an active turn.
  const startRes = await fetch(patchApiUrl(`${API_BASE_URL}/api/conversations/${conversationId}/turns`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      ...(turn.userMessage != null ? { userMessage: turn.userMessage } : {}),
      ...(turn.completedToolCalls ? { completedToolCalls: turn.completedToolCalls } : {}),
      ...(turn.agent ? { agent: turn.agent } : {}),
      agentArgs: turn.agentArgs ?? {},
    }),
  });
  if (!startRes.ok) {
    const body = await startRes.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message || `turn failed: HTTP ${startRes.status}`);
  }

  // 2. Read the resumable stream, reconnecting on transport drops.
  const state = {
    cursor: sinceLogIndex - 1,
    result: { status: 'running' as RunStatus, pendingToolCalls: [] as StreamPendingToolCall[], finalSeq: sinceLogIndex - 1 },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await readStreamOnce(conversationId, state.cursor, signal, cb, state);
      return state.result;
    } catch (error) {
      const isTransport = error instanceof Error && error.message === 'Network error';
      if (!isTransport || attempt >= RESUME_BACKOFF_MS.length) throw error;
      await new Promise((r) => setTimeout(r, RESUME_BACKOFF_MS[attempt]));
      if (signal.aborted) {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        throw err;
      }
      // reconnect: GET stream?since=cursor replays the gap from the durable log.
    }
  }
}

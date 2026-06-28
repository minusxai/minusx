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
  /** A committed message landed — its raw pi-log content, so server tool calls can render live. */
  onMessage?: (content: unknown) => void;
}

export interface V3TurnResult {
  status: RunStatus;     // terminal status observed (idle | paused | error)
  error?: string;
  retryable?: boolean;   // the error was a crash-interruption the client may silently re-run
  pendingToolCalls: StreamPendingToolCall[];
  finalSeq: number;
}

const RESUME_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/** Safety bound on silent auto-retries of a crash-interrupted turn. The SERVER is authoritative:
 *  it stops sending `retryable` once meta.autoRetries hits MAX_AUTO_RETRIES (and surfaces one durable
 *  error). This is just a backstop so a misbehaving server can't loop the client forever — keep it
 *  comfortably above the server cap. */
const MAX_CLIENT_AUTO_RETRIES = 5;

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
          cb.onMessage?.(e.message);
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
          state.result.retryable = !!e.retryable; // reflect the latest status (a non-retryable error clears it)
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
      // Only a terminal event (done/error) is a clean finish. A stream that ends WITHOUT one — a
      // mid-turn sever (CDP offline can fire onload with status 0, not onerror), a proxy cut, etc. —
      // is a transport drop: reject so the caller reconnects with ?since=<cursor> and the durable log
      // replays the gap. Otherwise we'd finalize on a partial log and lose the in-flight reply.
      if (settled) { resolve(); return; }
      reject(new Error('Network error'));
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

/**
 * Start (or resume / auto-retry) a v3 turn once and stream it to completion, reconnecting across
 * transport drops. `autoRetry` re-runs a crash-interrupted turn server-side (no userMessage — the
 * server replays it from the preserved log).
 */
async function startAndStream(
  conversationId: number,
  sinceLogIndex: number,
  turn: V3TurnInput,
  autoRetry: boolean,
  signal: AbortSignal,
  cb: V3StreamCallbacks,
): Promise<V3TurnResult> {
  // 1. Start the turn. The route flips run_status -> running before returning, so the stream we open
  //    next always sees an active turn.
  const startRes = await fetch(patchApiUrl(`${API_BASE_URL}/api/conversations/${conversationId}/turns`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      ...(autoRetry ? { autoRetry: true } : {}),
      ...(turn.userMessage != null ? { userMessage: turn.userMessage } : {}),
      ...(turn.completedToolCalls ? { completedToolCalls: turn.completedToolCalls } : {}),
      ...(turn.agent ? { agent: turn.agent } : {}),
      agentArgs: turn.agentArgs ?? {},
    }),
  });
  if (!startRes.ok) {
    if (startRes.status === 401) {
      const err = new Error('Session expired — please sign in again') as Error & { name: string; httpStatus: number };
      err.name = 'SessionExpiredError';
      err.httpStatus = 401;
      throw err;
    }
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

/**
 * Run a v3 turn to completion. On a crash-interruption (the stream reports a `retryable` error —
 * server restarted mid-turn), silently re-run the turn from the durable log, up to the cap. The
 * server independently enforces MAX_AUTO_RETRIES on the conversation, so a reload or second tab
 * can't exceed the bound and re-crash the box.
 */
export async function runV3Turn(
  conversationId: number,
  sinceLogIndex: number,
  turn: V3TurnInput,
  signal: AbortSignal,
  cb: V3StreamCallbacks,
): Promise<V3TurnResult> {
  let result = await startAndStream(conversationId, sinceLogIndex, turn, false, signal, cb);
  for (let retry = 0; result.status === 'error' && result.retryable && retry < MAX_CLIENT_AUTO_RETRIES; retry++) {
    if (signal.aborted) break;
    // Replay server-side from the preserved log (no userMessage). Re-stream from the same point.
    result = await startAndStream(conversationId, sinceLogIndex, { agent: turn.agent, agentArgs: turn.agentArgs }, true, signal, cb);
  }
  return result;
}

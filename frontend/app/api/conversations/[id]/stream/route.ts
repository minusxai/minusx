import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getConversation, loadMessages, loadLog, isRunLeaseStale, releaseRunLease, appendError } from '@/lib/data/conversations.server';
import { subscribe } from '@/lib/chat/conversation-stream.server';
import { derivePendingToolCalls } from '@/lib/data/conversation-log';
import type { ConversationStreamEvent } from '@/lib/data/conversations.types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/conversations/:id/stream?since=<cursor>
 *
 * Resumable SSE. Replays committed messages past `since`, then (if a turn is active) subscribes to
 * the conversation's NOTIFY channel and tails: each `message` wakeup triggers a catch-up SELECT,
 * `delta` wakeups stream ephemeral typing, `status` transitions are forwarded, and `pending` (paused)
 * carries the frontend-tool calls derived from the log. Closes on `done` (idle/error) or client
 * disconnect. Correctness is the cursor + SELECT — a missed NOTIFY is harmless. See chat-arch-v3 §7.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId)) return new Response('invalid id', { status: 400 });

  const user = await getEffectiveUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const conversation = await getConversation(conversationId);
  if (!conversation) return new Response('Not found', { status: 404 });
  if (conversation.ownerUserId !== user.userId || conversation.mode !== user.mode) {
    return new Response('Forbidden', { status: 403 });
  }

  const sinceParam = new URL(request.url).searchParams.get('since');
  let cursor = sinceParam != null && Number.isFinite(Number(sinceParam)) ? Number(sinceParam) : -1;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  let unsub: (() => Promise<void>) | undefined;

  const send = (e: ConversationStreamEvent) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => { /* client gone */ });

  const keepalive = setInterval(() => {
    writer.write(encoder.encode(': ping\n\n')).catch(() => { /* client gone */ });
  }, 15000);

  let staleCheck: ReturnType<typeof setInterval> | undefined;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    if (staleCheck) clearInterval(staleCheck);
    if (unsub) await unsub().catch(() => {});
    await writer.close().catch(() => {});
  };

  /**
   * Fail an orphaned turn cleanly (lease released → error) and end the stream. `retryable: true`
   * signals the client it may silently re-run the interrupted turn (server enforces MAX_AUTO_RETRIES).
   */
  const failStale = async () => {
    await releaseRunLease(conversationId, 'error');
    await appendError(conversationId, { source: 'session', message: 'Turn interrupted (server restarted). Please retry.' });
    await flushCatchup();
    send({ type: 'status', runStatus: 'error', retryable: true });
    send({ type: 'done', seq: cursor });
    await close();
  };

  /** Emit every committed message past the cursor, advancing it. */
  const flushCatchup = async () => {
    const rows = await loadMessages(conversationId, cursor);
    for (const r of rows) {
      if (r.seq == null) continue; // error rows (seq NULL) aren't part of the pi-log cursor stream
      send({ type: 'message', seq: r.seq, message: r.content });
      cursor = r.seq;
    }
  };

  /** When paused, deliver the pending frontend-tool calls (derived from the committed log). */
  const emitPendingIfPaused = async () => {
    const pending = derivePendingToolCalls(await loadLog(conversationId));
    if (pending.length > 0) send({ type: 'pending', seq: cursor, toolCalls: pending });
  };

  request.signal.addEventListener('abort', () => { void close(); });

  // Drive setup off-thread so we can return the streaming Response immediately.
  (async () => {
    await flushCatchup();
    const fresh = await getConversation(conversationId);
    let status = fresh?.runStatus ?? 'idle';

    // Orphaned turn: claims 'running' but its lease heartbeat is stale → the owner process died.
    // Fail it cleanly so the client shows a retryable error instead of hanging forever. The durable
    // rows (incl. the user message, committed eagerly) are preserved, so a retry is idempotent.
    if (fresh && isRunLeaseStale(fresh)) {
      await failStale();
      return;
    }

    if (status === 'idle' || status === 'error') {
      send({ type: 'status', runStatus: status });
      send({ type: 'done', seq: cursor });
      await close();
      return;
    }
    if (status === 'paused') {
      send({ type: 'status', runStatus: 'paused' });
      await emitPendingIfPaused();
      send({ type: 'done', seq: cursor });
      await close();
      return;
    }

    // status === 'running' — tail to completion. Serialize handler work so catch-up SELECTs
    // (which advance the shared cursor) never overlap.
    let chain: Promise<void> = Promise.resolve();
    unsub = await subscribe(conversationId, (n) => {
      chain = chain.then(async () => {
        if (closed) return;
        if (n.kind === 'delta') { send({ type: 'delta', seq: n.seq, text: n.text ?? '' }); return; }
        if (n.kind === 'message') { await flushCatchup(); return; }
        if (n.kind === 'status' && n.runStatus) {
          await flushCatchup();
          send({ type: 'status', runStatus: n.runStatus });
          if (n.runStatus === 'paused') await emitPendingIfPaused();
          if (n.runStatus === 'idle' || n.runStatus === 'error' || n.runStatus === 'paused') {
            send({ type: 'done', seq: cursor });
            await close();
          }
        }
      }).catch(() => {});
    });

    // Periodic stale re-check: a NOTIFY only fires while the owner is alive, so if the owner died
    // AFTER we subscribed (or we reconnected inside the 90s lease window onto an already-dead turn),
    // no wakeup would ever come and we'd tail forever. Poll the lease so an orphaned turn is failed
    // cleanly even with no NOTIFY traffic. (The DB is source of truth; this only governs liveness.)
    staleCheck = setInterval(() => {
      void (async () => {
        if (closed) return;
        const cur = await getConversation(conversationId);
        if (cur && isRunLeaseStale(cur)) await failStale();
      })().catch(() => {});
    }, 15000);

    // Race guard: the turn may have settled between catch-up and subscribe.
    const recheck = (await getConversation(conversationId))?.runStatus ?? 'running';
    if (recheck !== 'running') {
      await flushCatchup();
      send({ type: 'status', runStatus: recheck });
      if (recheck === 'paused') await emitPendingIfPaused();
      send({ type: 'done', seq: cursor });
      await close();
    }
  })().catch(async (e) => {
    console.error('[chat-v3 stream] setup error:', e);
    await close();
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    },
  });
}

import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { ChatRequest } from '@/lib/chat-orchestration';
import {
  runChatTurnStreamV2,
  validateV2Mode,
  forkV1ConversationToV2,
} from '@/lib/chat-orchestration-v2.server';
import { startRun, attach, registerCancel, type SequencedFrame } from '@/lib/chat/run-registry.server';
import { createNewConversation } from '@/lib/conversations';
import { guestChatDenialReason } from '@/lib/auth/guest-session';
import { checkGuestChatRateLimit } from '@/lib/auth/guest-rate-limit';
import { SHARE_GUEST_CHAT_ENABLED } from '@/lib/config';
import { getModules } from '@/lib/modules/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Format an SSE event frame. */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Forward sequence-numbered frames from a registry observer to this
 * connection's writer. Each frame's data carries `seq` so the client can
 * resume from the last frame it received after a transport drop. A write
 * failure here means THIS client disconnected — stop forwarding; the run
 * itself is owned by the registry pump and is unaffected.
 */
async function forwardFrames(
  observer: AsyncGenerator<SequencedFrame, void, unknown>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  for await (const { seq, frame } of observer) {
    if (frame.wire === 'streaming_event' && !frame.data) continue;
    await writer.write(
      encoder.encode(formatSSE(frame.wire, { ...(frame.data as object), seq })),
    );
  }
}

/**
 * POST /api/chat/stream
 * Streaming chat endpoint (Server-Sent Events) backed by the in-process
 * TypeScript orchestrator (the only engine).
 *
 * Uses TransformStream + a background task: the Response is returned immediately
 * with the readable end while the writable end is populated asynchronously, so
 * Next.js App Router doesn't buffer the whole stream before sending it.
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Parse body and authenticate HERE, while the request context is still active.
  // getEffectiveUser() calls headers() from next/headers, which is tied to the
  // request lifecycle. If called from a background task after POST() returns,
  // the request context is gone and headers() hangs indefinitely.
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    // Malformed request body — return JSON 400 BEFORE opening the SSE stream,
    // so the client sees a structured error instead of a generic "Stream ended
    // without done event".
    return new Response(
      JSON.stringify({ error: 'malformed request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const user = await getEffectiveUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Anonymous public-share guests: enforce the chat gate (kill-switch + lead capture)
  // and a per-guest rate limit before spending any LLM tokens.
  if (user.guest) {
    const denial = guestChatDenialReason(user, SHARE_GUEST_CHAT_ENABLED);
    if (denial) {
      return new Response(JSON.stringify({ error: denial }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const rl = checkGuestChatRateLimit(user.userId);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: rl.reason }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }
  }

  await getModules().auth.addHeaders(request, new Headers());

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // Ping flushes response headers to the client immediately.
  writer.write(encoder.encode(': ping\n\n'));

  // SSE keepalive — emit a comment-line ping every 15 s so external proxies
  // (Cloudflare / ALB / nginx) don't sever the connection during long native-
  // thinking turns where no SSE frames flow. Cleared in the `finally` of
  // processStreamV2 below (via the `closeWriter` wrapper).
  const keepalive = setInterval(() => {
    writer.write(encoder.encode(': ping\n\n')).catch(() => { /* writer closed */ });
  }, 15000);

  processStreamV2(writer, encoder, body, user)
    .catch((err) => {
      console.error('[chat/stream] Unhandled processStream error:', err);
    })
    .finally(() => {
      clearInterval(keepalive);
      void writer.close().catch(() => {});
    });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    },
  });
}

/**
 * Stream processor — runs the orchestrator and writes legacy-shaped SSE frames
 * (`event: streaming_event` + `event: done`) so the frontend listener parses
 * them unchanged. Continues an existing v2 conversation, forks a legacy file to
 * v2, or creates a fresh v2 conversation.
 *
 * The turn itself is owned by the run registry: a detached pump drains the turn
 * generator into a sequence-numbered buffer, and this connection merely
 * OBSERVES it. A client disconnect breaks only the observer loop — the run (and
 * its persistence) always completes — and the client can reconnect with
 * `body.resume.afterSeq` to replay what it missed and tail the rest.
 */
async function processStreamV2(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  body: ChatRequest,
  user: NonNullable<Awaited<ReturnType<typeof getEffectiveUser>>>,
): Promise<void> {
  try {
    // Resume path: attach to an in-flight/recently-finished run — never starts
    // a new turn. If there's nothing to attach to (server restarted, or the run
    // was evicted), say so explicitly so the client can fall back.
    if (body.resume) {
      const conversationId = body.conversationID ?? 0;
      const observer = attach(conversationId, body.resume.afterSeq);
      if (!observer) {
        await writer.write(
          encoder.encode(
            formatSSE('done', {
              type: 'done',
              conversationID: conversationId,
              log_index: 0,
              pending_tool_calls: [],
              completed_tool_calls: [],
              debug: [],
              resume_miss: true,
              timestamp: new Date().toISOString(),
            }),
          ),
        );
        return;
      }
      await forwardFrames(observer, writer, encoder);
      return;
    }

    let conversationId: number;
    if (body.conversationID) {
      const check = await validateV2Mode(body.conversationID, user, true);
      conversationId = check.ok
        ? body.conversationID
        : await forkV1ConversationToV2(body.conversationID, user);
    } else {
      const created = await createNewConversation(
        user,
        body.user_message ?? undefined,
        { version: 2 },
      );
      conversationId = created.fileId;
    }

    // The registry pump owns the generator (and thus persistence); this
    // connection observes from the start.
    startRun(
      conversationId,
      runChatTurnStreamV2(body, user, conversationId, (cancel) => registerCancel(conversationId, cancel)),
    );
    const observer = attach(conversationId, 0)!;
    await forwardFrames(observer, writer, encoder);
  } catch (err) {
    // The frontend chatListener expects a `done` frame even on error — without
    // one it throws "Stream ended without done event" instead of surfacing the
    // actual error. Emit BOTH an `error` frame (for logs) and a `done` frame
    // carrying the error in the legacy ChatResponse shape.
    const message = err instanceof Error ? err.message : String(err);
    const ts = new Date().toISOString();
    await writer.write(
      encoder.encode(formatSSE('error', { type: 'error', error: message, timestamp: ts })),
    );
    await writer.write(
      encoder.encode(
        formatSSE('done', {
          type: 'done',
          conversationID: body.conversationID ?? 0,
          log_index: 0,
          pending_tool_calls: [],
          completed_tool_calls: [],
          debug: [],
          error: message,
          timestamp: ts,
        }),
      ),
    );
  } finally {
    await writer.close();
  }
}

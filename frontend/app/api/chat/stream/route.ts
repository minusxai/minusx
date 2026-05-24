import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { ChatRequest } from '@/lib/chat-orchestration';
import {
  runChatTurnStreamV2,
  validateV2Mode,
  forkV1ConversationToV2,
} from '@/lib/chat-orchestration-v2.server';
import { createNewConversation } from '@/lib/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Format an SSE event frame. */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat/stream
 * Streaming chat endpoint (Server-Sent Events) backed by the in-process
 * TypeScript orchestrator (the only engine — the legacy Python backend is gone).
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
  const body: ChatRequest = await request.json();
  const user = await getEffectiveUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // Ping flushes response headers to the client immediately.
  writer.write(encoder.encode(': ping\n\n'));

  processStreamV2(writer, encoder, body, user).catch((err) => {
    console.error('[chat/stream] Unhandled processStream error:', err);
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
 */
async function processStreamV2(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  body: ChatRequest,
  user: NonNullable<Awaited<ReturnType<typeof getEffectiveUser>>>,
): Promise<void> {
  try {
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

    for await (const frame of runChatTurnStreamV2(body, user, conversationId)) {
      if (frame.wire === 'streaming_event') {
        if (frame.data) {
          await writer.write(encoder.encode(formatSSE('streaming_event', frame.data)));
        }
      } else if (frame.wire === 'done') {
        await writer.write(encoder.encode(formatSSE('done', frame.data)));
      } else if (frame.wire === 'error') {
        await writer.write(encoder.encode(formatSSE('error', frame.data)));
      }
    }
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

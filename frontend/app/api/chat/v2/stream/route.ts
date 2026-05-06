import 'server-only';
import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { runChatTurnStream, type ChatV2RequestBody } from '../shared';

/**
 * Server-Sent Events stream for /api/chat/v2.
 *
 * Each orchestrator stream event becomes a `event: orchestrator` SSE frame;
 * the final state arrives as a single `event: done` frame whose payload
 * matches the non-streaming /api/chat/v2 response. This is the streaming
 * surface chatV2Listener uses on the client.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as ChatV2RequestBody;
  const user = await getEffectiveUser();
  if (!user) {
    return new Response(`event: error\ndata: ${JSON.stringify({ error: 'Not authenticated' })}\n\n`, {
      status: 401,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };
      try {
        for await (const ev of runChatTurnStream(body, user)) {
          if (ev.type === 'orchestrator') {
            write('orchestrator', ev.event);
          } else {
            write('done', ev.response);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        write('error', { error: errorMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

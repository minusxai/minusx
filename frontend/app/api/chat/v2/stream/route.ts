import 'server-only';
import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { runChatTurn, type ChatV2RequestBody } from '../shared';

/**
 * SSE variant of /api/chat/v2. Until the orchestrator's EventStream is wired
 * through, this is a pragmatic implementation that runs the turn and emits a
 * single `done` event with the same payload as the non-streaming route. The
 * /api/chat/v2 (non-streaming) route remains the gated test target.
 *
 * Future: stream `pi-ai` events as they arrive so the UI updates token-by-token.
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
      try {
        const response = await runChatTurn(body, user);
        const payload = `event: done\ndata: ${JSON.stringify(response)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const payload = `event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`;
        controller.enqueue(encoder.encode(payload));
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

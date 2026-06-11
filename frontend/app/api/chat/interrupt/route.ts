import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { interruptRun } from '@/lib/chat/run-registry.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/interrupt
 * Cancel a conversation's in-flight turn server-side. The client's Stop button
 * aborts its own stream connection AND calls this — without it, the engine
 * would keep running (and billing LLM tokens) to completion in the background,
 * since the run registry deliberately decouples runs from connections.
 *
 * The cancelled turn winds down and persists its partial log (user message
 * included) through the normal pump path.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { conversationID } = await req.json();
    if (typeof conversationID !== 'number') {
      return Response.json({ error: 'conversationID required' }, { status: 400 });
    }
    const interrupted = interruptRun(conversationID);
    return Response.json({ interrupted });
  } catch (error) {
    return handleApiError(error);
  }
}

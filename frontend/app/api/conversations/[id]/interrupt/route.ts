import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { getConversation, interruptRun } from '@/lib/data/conversations.server';
import { notifyInterrupt } from '@/lib/chat/conversation-stream.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/conversations/:id/interrupt — the "Stop" button.
 * Publishes an interrupt wakeup; the active turn (wherever it runs) cancels its orchestrator.
 */
export const POST = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const conversationId = Number(id);
    if (!Number.isInteger(conversationId)) return ApiErrors.validationError('invalid conversation id');

    const conversation = await getConversation(conversationId);
    if (!conversation) return ApiErrors.notFound('Conversation');
    if (conversation.ownerUserId !== user.userId || conversation.mode !== user.mode) return ApiErrors.forbidden();

    // Durably clear an orphaned run (paused/stale-running) so it doesn't reappear as EXECUTING on
    // refresh; a live turn is left for its own cancel path. Then wake any live turn to cancel now.
    await interruptRun(conversationId);
    await notifyInterrupt(conversationId);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});

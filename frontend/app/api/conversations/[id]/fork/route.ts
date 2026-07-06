import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { getConversation, forkConversation } from '@/lib/data/conversations.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/conversations/:id/fork  { atSeq }
 * Creates a new conversation copying messages [0, atSeq) from this one (edit-and-fork). Returns the
 * new conversation id; the client then runs the edited turn on it. Owner+mode gated.
 */
export const POST = withAuth(async (
  request: NextRequest,
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

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const atSeq = Number(body.atSeq);
    if (!Number.isInteger(atSeq) || atSeq < 0) return ApiErrors.validationError('atSeq must be a non-negative integer');

    const forked = await forkConversation(conversationId, atSeq);
    return successResponse({ id: forked.id, conversation: forked });
  } catch (error) {
    return handleApiError(error);
  }
});

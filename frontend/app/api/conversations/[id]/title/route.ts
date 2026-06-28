import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getConversation } from '@/lib/data/conversations.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/conversations/:id/title
 * Cheap single-row lookup of a conversation's AI-generated title (the chat header
 * fetches this once after the first turn, when the title is freshly generated —
 * existing conversations already carry it from the full load). Returns
 * `{ title }` where title is the generated title, or null if not generated yet.
 */
export const GET = withAuth(async (
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

    const title = conversation.meta?.titleGenerated && conversation.title?.trim() ? conversation.title : null;
    return successResponse({ title });
  } catch (error) {
    return handleApiError(error);
  }
});

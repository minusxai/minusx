import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import {
  getConversation,
  loadMessages,
  loadErrors,
  deleteConversation,
  setGeneratedConversationTitle,
} from '@/lib/data/conversations.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A v3 conversation is visible only to its owner, within the same mode. */
function ownsConversation(conv: { ownerUserId: number; mode: string }, user: { userId: number; mode: string }) {
  return conv.ownerUserId === user.userId && conv.mode === user.mode;
}

/**
 * GET /api/conversations/:id
 * Returns the conversation row + its full message log (pi entries) + parallel error stream.
 * The frontend rebuilds the chat from `messages[].content` (each is a verbatim pi log entry).
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
    if (!ownsConversation(conversation, user)) return ApiErrors.forbidden();

    const [messages, errors] = await Promise.all([
      loadMessages(conversationId),
      loadErrors(conversationId),
    ]);
    return successResponse({ conversation, messages, errors });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * DELETE /api/conversations/:id — idempotent. Cascades to messages + errors.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const conversationId = Number(id);
    if (!Number.isInteger(conversationId)) return ApiErrors.validationError('invalid conversation id');

    const conversation = await getConversation(conversationId);
    if (!conversation) return successResponse({ ok: true }); // already gone
    if (!ownsConversation(conversation, user)) return ApiErrors.forbidden();

    await deleteConversation(conversationId);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * PATCH /api/conversations/:id — rename. Body: { title }. Marks the title as
 * generated/explicit so the list + header show it (vs the raw first message).
 */
export const PATCH = withAuth(async (
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
    if (!ownsConversation(conversation, user)) return ApiErrors.forbidden();

    const body = await request.json().catch(() => ({}));
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) return ApiErrors.validationError('title is required');

    await setGeneratedConversationTitle(conversationId, title.slice(0, 200));
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});

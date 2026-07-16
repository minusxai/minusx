import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import {
  getConversation,
  loadMessages,
  loadErrors,
  getMaxSeq,
  deleteConversation,
  setGeneratedConversationTitle,
} from '@/lib/data/conversations.server';
import { parseConversationView, projectMessageRowForDisplay } from '@/lib/data/conversation-projection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A v3 conversation is visible only to its owner, within the same mode. */
function ownsConversation(conv: { ownerUserId: number; mode: string }, user: { userId: number; mode: string }) {
  return conv.ownerUserId === user.userId && conv.mode === user.mode;
}

/**
 * GET /api/conversations/:id?view=display|full&since=<seq>
 * Returns the conversation row + its message log (pi entries) + parallel error stream.
 * The frontend rebuilds the chat from `messages[].content`.
 *
 * Conversations V2 (see /conversations-v2.md): the default `display` view projects each entry
 * to display-grade size (LLM-only payloads stripped); `view=full` (dev mode) returns the
 * verbatim log. `since` returns only rows with seq > since (incremental post-turn reload);
 * `maxSeq` in the response lets the client detect server-side truncation (retry/replay) and
 * fall back to a full fetch. Errors are always returned in full (small, not seq-cursored).
 */
export const GET = withAuth(async (
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

    const searchParams = new URL(request.url).searchParams;
    const view = parseConversationView(searchParams.get('view'));
    const sinceRaw = searchParams.get('since');
    const since = sinceRaw != null && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : -1;

    const [messages, errors, maxSeq] = await Promise.all([
      loadMessages(conversationId, since),
      loadErrors(conversationId),
      getMaxSeq(conversationId),
    ]);
    const wireMessages = view === 'full' ? messages : messages.map((m) => projectMessageRowForDisplay(m, conversation.mode));
    return successResponse({ conversation, messages: wireMessages, errors, maxSeq });
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

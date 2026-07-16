import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { getConversation, findToolResultEntry } from '@/lib/data/conversations.server';
import { extractToolResultImage } from '@/lib/data/conversation-projection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/conversations/:id/screenshots/:callId — Conversations V2 lazy screenshot endpoint
 * (see /conversations-v2.md).
 *
 * The display view strips inline base64 screenshots from the conversation JSON and rewrites
 * `details.screenshotUrl` to this URL; the bytes are served on demand from the stored (full)
 * log. Fully generic: `callId` addresses a tool call, and the image is the first inline image
 * block in that tool call's RESPONSE content — no tool names involved. Gated by the same
 * owner+mode check as the conversation itself. The stored entry is immutable, so the browser
 * caches each screenshot at most once.
 */
export const GET = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string; callId: string }> },
) => {
  try {
    const { id, callId } = await params;
    const conversationId = Number(id);
    if (!Number.isInteger(conversationId)) return ApiErrors.validationError('invalid conversation id');

    const conversation = await getConversation(conversationId);
    if (!conversation) return ApiErrors.notFound('Conversation');
    if (conversation.ownerUserId !== user.userId || conversation.mode !== user.mode) {
      return ApiErrors.forbidden();
    }

    const entry = await findToolResultEntry(conversationId, callId);
    const image = entry ? extractToolResultImage(entry) : null;
    if (!image) return ApiErrors.notFound('Screenshot');

    return new NextResponse(Buffer.from(image.base64, 'base64'), {
      headers: {
        'Content-Type': image.mimeType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
});

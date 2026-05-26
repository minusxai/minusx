/**
 * POST /api/chat/feedback
 *
 * Records user feedback (thumbs up/down) on an AI response.
 * Fire-and-forget from the client — best-effort.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { handleApiError } from '@/lib/api/api-responses';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

interface FeedbackBody {
  conversationId: number;
  userMessageLogIndex: number;
  rating: 'positive' | 'negative';
  tags: string[];
  comment?: string;
}

function isValidFeedback(body: unknown): body is FeedbackBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.conversationId === 'number' &&
    typeof b.userMessageLogIndex === 'number' &&
    (b.rating === 'positive' || b.rating === 'negative') &&
    Array.isArray(b.tags) && b.tags.every(t => typeof t === 'string') &&
    (b.comment === undefined || typeof b.comment === 'string')
  );
}

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    if (!isValidFeedback(body)) {
      return NextResponse.json(
        { success: false, error: 'invalid request: expected { conversationId, userMessageLogIndex, rating, tags, comment? }' },
        { status: 400 },
      );
    }
    appEventRegistry.publish(AppEvents.FEEDBACK, {
      conversationId: body.conversationId,
      userMessageLogIndex: body.userMessageLogIndex,
      rating: body.rating,
      tags: body.tags,
      comment: body.comment || '',
      mode: user.mode,
      userId: user.userId,
      userEmail: user.email,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
});

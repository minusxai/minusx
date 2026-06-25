import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { createNewConversation } from '@/lib/conversations';
import { handleApiError } from '@/lib/api/api-responses';
import { isV2 } from '@/lib/chat-v2/chat-version';

/**
 * POST /api/chat/init
 * Creates a blank conversation file and returns its real positive ID.
 * Called by the frontend before opening the SSE stream so that the
 * conversation URL is stable from the first render.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) as { firstMessage?: string } : {};
    const { firstMessage } = body;

    // The resolved chat version marks the conversation: v2 (the default; see
    // DEFAULT_CHAT_VERSION) is orchestrator-driven and tagged `meta.version=2`,
    // while an explicit `?v=1` creates a legacy (v1-shaped) conversation (no
    // version meta). Both create the same `type:'conversation'` file shape; the
    // chat routes branch on `meta.version` to decide which engine handles the
    // turn.
    const isV2Request = isV2(request.nextUrl.searchParams.get('v'));
    const { fileId, name } = await createNewConversation(
      user,
      firstMessage,
      isV2Request ? { version: 2 } : undefined,
    );

    return NextResponse.json({ conversationID: fileId, name });
  } catch (error) {
    return handleApiError(error);
  }
}

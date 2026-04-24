import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { createNewConversation } from '@/lib/conversations';
import { handleApiError } from '@/lib/api/api-responses';

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

    const body = await request.json();
    const { firstMessage } = body;

    const { fileId, name } = await createNewConversation(user, firstMessage);

    return NextResponse.json({ conversationID: fileId, name });
  } catch (error) {
    return handleApiError(error);
  }
}

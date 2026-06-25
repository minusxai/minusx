import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { estimateNextChatContextV2, validateV2Mode } from '@/lib/chat-orchestration-v2.server';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { ContextSizeEstimate } from '@/lib/chat/context-size-estimate';
import { handleApiError } from '@/lib/api/api-responses';

interface ContextSizeResponse extends ContextSizeEstimate {
  conversationID: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  let body: ChatRequest | undefined;
  try {
    body = await request.json();
    if (!body) throw new Error('Invalid request body');

    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!body.conversationID) {
      return NextResponse.json(
        { error: 'No active conversation available for context-size estimate' },
        { status: 400 },
      );
    }

    const check = await validateV2Mode(body.conversationID, user, true);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const estimate = await estimateNextChatContextV2(body, user, body.conversationID);
    return NextResponse.json({ conversationID: body.conversationID, ...estimate } as ContextSizeResponse);
  } catch (error: unknown) {
    console.error('Context size API error:', error);
    return handleApiError(error);
  }
}

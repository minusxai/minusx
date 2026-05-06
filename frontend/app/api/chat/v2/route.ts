import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { runChatTurn, type ChatV2RequestBody, type ChatV2Response } from './shared';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatV2RequestBody;
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json<ChatV2Response>(
        {
          chatId: 0,
          forked: false,
          log: [],
          pendingToolCalls: [],
          done: 'error',
          error: 'Not authenticated',
        },
        { status: 401 },
      );
    }
    const response = await runChatTurn(body, user);
    return NextResponse.json<ChatV2Response>(response);
  } catch (error) {
    return handleApiError(error);
  }
}

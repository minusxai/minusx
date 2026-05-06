import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createDraftChat } from '@/lib/chat-v2/chat-file';

interface NewChatBody {
  agentArgs?: Record<string, unknown>;
}

interface NewChatResponse {
  chatId: number;
  error?: string;
}

/**
 * Create a new draft chat and return its ID. Used by the "New Chat" UI
 * affordance — clients then route to /f/<chatId> to land in the chat
 * detail surface (ChatV2Container).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as NewChatBody;
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json<NewChatResponse>(
        { chatId: 0, error: 'Not authenticated' },
        { status: 401 },
      );
    }
    const { chatId } = await createDraftChat(user, 'WebAnalystAgent', body.agentArgs ?? {});
    return NextResponse.json<NewChatResponse>({ chatId });
  } catch (error) {
    return handleApiError(error);
  }
}

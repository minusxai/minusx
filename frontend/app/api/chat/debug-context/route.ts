import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { isAdmin } from '@/lib/auth/role-helpers';
import { previewNextChatContext } from '@/lib/chat/orchestration-core.server';
import { getConversation } from '@/lib/data/conversations.server';
import type { ChatRequest } from '@/lib/chat/chat-types';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';

/**
 * /debug visualization "Projected" data source: the exact Context the next
 * chat turn would send to the LLM ({@link previewNextChatContext}).
 * Admin only — the response carries the raw system
 * prompt and full projected conversation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequest | undefined;
    if (!body) throw new Error('Invalid request body');

    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!isAdmin(user.role)) return ApiErrors.forbidden('Admin only');

    if (!body.conversationID) {
      return ApiErrors.badRequest('No active conversation for debug context');
    }
    const conversation = await getConversation(body.conversationID);
    if (!conversation) {
      return ApiErrors.badRequest(`Conversation ${body.conversationID} not found`);
    }

    const context = await previewNextChatContext(body, user, body.conversationID);
    const tools = context.tools ?? [];
    return NextResponse.json({
      conversationID: body.conversationID,
      systemPrompt: context.systemPrompt ?? '',
      messages: context.messages,
      toolDefsChars: tools.length > 0 ? JSON.stringify(tools).length : 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

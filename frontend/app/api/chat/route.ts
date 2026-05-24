import { NextRequest, NextResponse } from 'next/server';
import { withResponseLogging } from '@/lib/api/with-response-logging';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { ToolCall } from '@/lib/types';
import type { DebugMessage } from '@/store/chatSlice';
import { ChatRequest, CompletedToolCallResult } from '@/lib/chat-orchestration';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { runChatTurnV2, validateV2Mode, forkV1ConversationToV2 } from '@/lib/chat-orchestration-v2.server';
import { createNewConversation } from '@/lib/conversations';

/**
 * Chat response to frontend
 */
interface ChatResponse {
  conversationID: number;            // File ID
  log_index: number;
  pending_tool_calls: ToolCall[];                         // Non-empty if frontend tools are pending
  completed_tool_calls: CompletedToolCallResult[];    // Flat list; frontend groups by run_id if needed
  debug: DebugMessage[];                                  // Aggregated debug info from this turn's logDiff
  request_id?: string | null;                             // HTTP request ID from middleware
  credits?: number | null;
  error?: string | null;
}

/**
 * POST /api/chat
 *
 * Non-streaming chat turn. Runs the in-process TypeScript orchestrator (the only
 * engine). Existing conversations
 * are continued in place; a legacy (v1) conversation file is forked to a fresh
 * v2 conversation and continued there.
 */
export const POST = withResponseLogging(async function POST(request: NextRequest) {
  let body: ChatRequest | undefined;
  let user: Awaited<ReturnType<typeof getEffectiveUser>> | undefined;

  try {
    body = await request.json();
    if (!body) {
      throw new Error('Invalid request body');
    }

    user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json(
        {
          conversationID: 0,
          log_index: 0,
          pending_tool_calls: [],
          completed_tool_calls: [],
          debug: [],
          error: 'Not authenticated',
        } as ChatResponse,
        { status: 401 },
      );
    }

    // Resolve the conversation: continue an existing v2 file, fork a legacy file
    // to v2, or create a fresh v2 conversation.
    let conversationId: number;
    if (body.conversationID) {
      const check = await validateV2Mode(body.conversationID, user, true);
      conversationId = check.ok
        ? body.conversationID
        : await forkV1ConversationToV2(body.conversationID, user);
    } else {
      const created = await createNewConversation(
        user,
        body.user_message ?? undefined,
        { version: 2 },
      );
      conversationId = created.fileId;
    }

    if (body.user_message) {
      appEventRegistry.publish(AppEvents.USER_MESSAGE, {
        source: body.source ?? 'explore',
        conversationId,
        userId: user.userId,
        userEmail: user.email,
        messagePreview: body.user_message.slice(0, 100),
        mode: user.mode,
      });
    }

    const v2Result = await runChatTurnV2(body, user, conversationId);
    return NextResponse.json(v2Result as ChatResponse);
  } catch (error: any) {
    console.error('Chat API error:', error);

    if (user) {
      appEventRegistry.publish(AppEvents.ERROR, {
        source: 'nextjs_chat',
        message: error.message || 'Unknown error',
        mode: user.mode,
        context: { route: '/api/chat' },
      });
    }

    // eslint-disable-next-line no-restricted-syntax -- must return ChatResponse shape; AppEvents.ERROR above reports to bug channel
    return NextResponse.json(
      {
        conversationID: body?.conversationID || 0,
        log_index: 0,
        pending_tool_calls: [],
        completed_tool_calls: [],
        debug: [],
        credits: null,
        error: error.message || 'Unknown error occurred',
      } as ChatResponse,
      { status: 500 },
    );
  }
});

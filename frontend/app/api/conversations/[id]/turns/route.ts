import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getConversation, setRunStatus, appendError } from '@/lib/data/conversations.server';
import { notifyStatus } from '@/lib/chat/conversation-stream.server';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { getModules } from '@/lib/modules/registry';
import type { ChatRequest } from '@/lib/chat-orchestration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/conversations/:id/turns
 *
 * Starts a new turn (`userMessage`) or resumes one with completed frontend-tool results
 * (`completedToolCalls`). The turn runs DETACHED (the long-running Node process keeps it alive) and
 * writes durable rows + NOTIFYs; the client receives output via GET …/stream. Returns immediately.
 *
 * Body: { userMessage?, completedToolCalls?, agent?, agentArgs?, turnKey? }
 */
export const POST = withAuth(async (
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
    if (conversation.ownerUserId !== user.userId || conversation.mode !== user.mode) return ApiErrors.forbidden();

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage : undefined;
    const completedToolCalls = Array.isArray(body.completedToolCalls) ? body.completedToolCalls : undefined;
    if (!userMessage && !completedToolCalls) {
      return ApiErrors.validationError('turn requires userMessage or completedToolCalls');
    }
    // A fresh user turn can't start while one is already running (idempotency for retried POSTs).
    if (userMessage && conversation.runStatus === 'running') {
      return successResponse({ ok: true, alreadyRunning: true });
    }

    const chatRequest: ChatRequest = {
      ...(userMessage ? { user_message: userMessage } : {}),
      ...(completedToolCalls ? { completed_tool_calls: completedToolCalls } : {}),
      agent: typeof body.agent === 'string' ? body.agent : conversation.agent,
      agent_args: (body.agentArgs ?? {}) as Record<string, unknown>,
    } as unknown as ChatRequest;

    // Preserve request-scoped context (auth/mode) for the detached run; no-op in the base build.
    const runInContext = (await getModules().auth.getContextRunner?.()) ?? ((fn: () => Promise<unknown>) => fn());

    void runInContext(() => runConversationTurn(conversationId, user, chatRequest))
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[chat-v3] detached turn failed:', message);
        try {
          await appendError(conversationId, { source: 'unhandled', message });
          await setRunStatus(conversationId, 'error');
          await notifyStatus(conversationId, 'error', conversation.runStatus === 'paused' ? 0 : 0);
        } catch { /* best-effort */ }
      });

    return successResponse({ ok: true, started: true });
  } catch (error) {
    return handleApiError(error);
  }
});

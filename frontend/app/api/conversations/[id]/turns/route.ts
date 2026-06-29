import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getConversation, releaseRunLease, acquireRunLease, appendError, getMaxSeq } from '@/lib/data/conversations.server';
import { notifyStatus } from '@/lib/chat/conversation-stream.server';
import { runConversationTurn, INSTANCE_ID } from '@/lib/chat/conversation-turn.server';
import { getModules } from '@/lib/modules/registry';
import type { ChatRequest } from '@/lib/chat-orchestration';
import { boundContextAppState } from '@/lib/api/compress-augmented';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/conversations/:id/turns
 *
 * Starts a new turn (`userMessage`), resumes one with completed frontend-tool results
 * (`completedToolCalls`), or silently re-runs a crash-interrupted turn (`autoRetry`). The turn runs
 * DETACHED (the long-running Node process keeps it alive) and writes durable rows + NOTIFYs; the
 * client receives output via GET …/stream. Returns immediately.
 *
 * Body: { userMessage?, completedToolCalls?, autoRetry?, agent?, agentArgs?, turnKey? }
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
    const autoRetry = body.autoRetry === true;
    if (!userMessage && !completedToolCalls && !autoRetry) {
      return ApiErrors.validationError('turn requires userMessage, completedToolCalls, or autoRetry');
    }
    // A fresh user turn / auto-retry can't start while one is already running (idempotency for retried POSTs).
    if ((userMessage || autoRetry) && conversation.runStatus === 'running') {
      return successResponse({ ok: true, alreadyRunning: true });
    }

    const agentArgs = (body.agentArgs ?? {}) as Record<string, unknown>;
    // Defense-in-depth: bound any oversized context in the inbound AppState before it reaches the
    // orchestrator. A stale client (pre schema-shaping bundle) can still ship a multi-MB schema
    // cache, which is what OOM'd the box; this caps it server-side regardless of client version.
    if (agentArgs.app_state) boundContextAppState(agentArgs.app_state);
    const chatRequest: ChatRequest = {
      ...(userMessage ? { user_message: userMessage } : {}),
      ...(completedToolCalls ? { completed_tool_calls: completedToolCalls } : {}),
      agent: typeof body.agent === 'string' ? body.agent : conversation.agent,
      agent_args: agentArgs,
    } as unknown as ChatRequest;

    // Claim the lease (status running + fresh heartbeat) + NOTIFY synchronously BEFORE returning, so
    // a client opening the stream right after this POST sees an active, non-stale turn (never a
    // premature idle/done, and never a heartbeat-less "running" that looks orphaned). The detached
    // runner re-acquires the lease (idempotent). For an auto-retry, PRESERVE the dead turn's
    // run_started_seq — it's the rollback/replay point the runner truncates to (overwriting it with
    // maxSeq+1 would point the truncate past the crashed rows).
    const startSeq = autoRetry && conversation.runStartedSeq != null
      ? conversation.runStartedSeq
      : (await getMaxSeq(conversationId)) + 1;
    await acquireRunLease(conversationId, INSTANCE_ID, startSeq);
    await notifyStatus(conversationId, 'running', startSeq);

    // Preserve request-scoped context (auth/mode) for the detached run; no-op in the base build.
    const runInContext = (await getModules().auth.getContextRunner?.()) ?? ((fn: () => Promise<unknown>) => fn());

    void runInContext(() => runConversationTurn(conversationId, user, chatRequest, { autoRetry }))
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[chat-v3] detached turn failed:', message);
        try {
          await appendError(conversationId, { source: 'unhandled', message });
          await releaseRunLease(conversationId, 'error');
          await notifyStatus(conversationId, 'error', startSeq);
        } catch { /* best-effort */ }
      });

    return successResponse({ ok: true, started: true });
  } catch (error) {
    return handleApiError(error);
  }
});

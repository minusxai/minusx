/**
 * Logs orchestrator-tagged unhandled rejections to their conversation's
 * `errors[]`. Wire from `instrumentation.ts`'s `process.on('unhandledRejection')`
 * handler — and tag rejections in the orchestrator with `conversationId` so this
 * function can route them to the right conversation document.
 */
import 'server-only';
import { appendErrorToConversation } from '@/lib/conversations';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export interface TaggedError {
  conversationId?: number;
  message?: string;
  stack?: string;
}

export async function logTaggedRejection(error: unknown, user: EffectiveUser): Promise<void> {
  const e = (error ?? {}) as TaggedError;
  const conversationId = typeof e.conversationId === 'number' ? e.conversationId : 0;
  if (!Number.isFinite(conversationId) || conversationId <= 0) return; // not orchestrator-tagged → ignore
  try {
    await appendErrorToConversation(
      conversationId,
      {
        _type: 'error',
        source: 'unhandled',
        message: typeof e.message === 'string' ? e.message : String(error),
        timestamp: Date.now(),
        ...(typeof e.stack === 'string' ? { details: { stack: e.stack } } : {}),
      },
      user,
    );
  } catch (logErr) {
    console.error('[unhandled-rejection-logger] failed to append error entry:', logErr);
  }
}

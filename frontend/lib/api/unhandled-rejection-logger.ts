/**
 * Logs orchestrator-tagged unhandled rejections to their conversation's
 * dedicated `conversation_errors` (v3). Wire from `instrumentation.ts`'s
 * `process.on('unhandledRejection')` handler — and tag rejections in the
 * orchestrator with `conversationId` so this function can route them to the
 * right conversation.
 */
import 'server-only';
import { appendError } from '@/lib/data/conversations.server';

export interface TaggedError {
  conversationId?: number;
  message?: string;
  stack?: string;
}

export async function logTaggedRejection(error: unknown): Promise<void> {
  const e = (error ?? {}) as TaggedError;
  const conversationId = typeof e.conversationId === 'number' ? e.conversationId : 0;
  if (!Number.isFinite(conversationId) || conversationId <= 0) return; // not orchestrator-tagged → ignore
  try {
    await appendError(conversationId, {
      source: 'unhandled',
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(typeof e.stack === 'string' ? { details: { stack: e.stack } } : {}),
    });
  } catch (logErr) {
    console.error('[unhandled-rejection-logger] failed to append error entry:', logErr);
  }
}

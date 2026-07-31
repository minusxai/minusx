/**
 * Logs orchestrator-tagged unhandled rejections to their conversation's
 * error stream (kind='error' rows in `messages`, v3). Wired from the
 * `process.on('unhandledRejection')` handler in
 * `lib/instrumentation/register-modules.ts`. Routing depends on the orchestrator
 * tagging rejections with `conversationId`; untagged ones are ignored here and
 * left to Sentry.
 */
import 'server-only';
import { appendError } from '@/lib/data/conversations.server';

interface TaggedError {
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

/**
 * POST /api/chat/log-error
 *
 * Client-side errors (transport failures, "stream ended without done event",
 * session expiry, etc.) don't go through the server orchestrator, so the
 * `errors[]` log entries for them are written from the browser via this
 * fire-and-forget endpoint. Idempotent + best-effort.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { handleApiError } from '@/lib/api/api-responses';
import { appendError } from '@/lib/data/conversations.server';
import type { ErrorLogEntry } from '@/lib/types';

const VALID_SOURCES: ReadonlyArray<ErrorLogEntry['source']> = [
  'llm', 'server-tool', 'frontend-tool', 'persist', 'transport', 'session', 'unhandled',
];

interface LogErrorBody {
  conversationID: number;
  error: ErrorLogEntry;
}

function isValidErrorEntry(e: unknown): e is ErrorLogEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    r._type === 'error' &&
    typeof r.message === 'string' &&
    typeof r.source === 'string' &&
    VALID_SOURCES.includes(r.source as ErrorLogEntry['source'])
  );
}

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as Partial<LogErrorBody>;
    if (typeof body.conversationID !== 'number' || !isValidErrorEntry(body.error)) {
      return NextResponse.json(
        { success: false, error: 'invalid request: expected { conversationID: number, error: ErrorLogEntry }' },
        { status: 400 },
      );
    }
    const entry: ErrorLogEntry = {
      ...body.error,
      // Always stamp server-side timestamp if the client didn't.
      timestamp: typeof body.error.timestamp === 'number' ? body.error.timestamp : Date.now(),
    };
    // v3: client-side errors land in the conversation error stream (kind='error' rows in messages).
    await appendError(body.conversationID, {
      source: entry.source,
      message: entry.message,
      ...(entry.parent_id ? { parentPiId: entry.parent_id } : {}),
      ...(entry.details ? { details: entry.details as Record<string, unknown> } : {}),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
});

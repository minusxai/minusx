import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import {
  appendLogToConversation,
  createNewConversation,
} from '@/lib/conversations';
import { handleApiError } from '@/lib/api/api-responses';
import type { ConversationLog } from '@/orchestrator/types';
import type { ConversationLogEntry } from '@/lib/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';

/**
 * POST /api/benchmark/import
 *
 * Persist a benchmark run's orchestrator conversation log as a v=2 conversation
 * file in the documents DB so it can be opened at `/explore/<fileId>?v=2`
 * and continued in the chat UI.
 *
 * Body shape:
 *   {
 *     log: ConversationLog,
 *     label?: string,
 *     connections?: BenchmarkConnectionEntry[]   // dataset's connections.json
 *   }
 *
 * The optional `connections` array (the same JSON the runner reads from
 * `<dataset>_connections.json`) is persisted on the conversation file's
 * `meta.benchmark_connections` so v=2 chat continuation can wire per-
 * conversation NodeConnector-backed executors. Without it, SQL queries
 * fail with "connector 'X' not loaded".
 *
 * Security note: connection configs may contain credentials. The conversation
 * file lives in the same documents DB as connection documents (which already
 * hold credentials), so storing here doesn't widen the access surface; it
 * does mean the credentials travel inside the file's `meta` field over
 * authenticated API responses, same as connection docs.
 *
 * Returns `{ fileId, name }`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const log = (body as { log?: unknown }).log;
    const label = (body as { label?: unknown }).label;
    const connections = (body as { connections?: unknown }).connections;
    if (!Array.isArray(log)) {
      return NextResponse.json({ error: 'log is required and must be an array' }, { status: 400 });
    }
    if (connections !== undefined && !Array.isArray(connections)) {
      return NextResponse.json({ error: 'connections must be an array of BenchmarkConnectionEntry' }, { status: 400 });
    }

    // Pull the first user message from the saved root invocation so the
    // conversation file is named meaningfully. Falls back to the optional
    // `label` field, then to the default "New Conversation" name.
    const root = (log as ConversationLog).find((e) => {
      const cast = e as { type?: string; parent_id?: string | null };
      return cast.type === 'toolCall' && cast.parent_id === null;
    }) as { arguments?: { userMessage?: unknown } } | undefined;
    const firstMessage =
      typeof label === 'string' && label.length > 0
        ? label
        : typeof root?.arguments?.userMessage === 'string'
          ? root.arguments.userMessage
          : undefined;

    const extraMeta: Record<string, unknown> = {};
    if (Array.isArray(connections)) {
      extraMeta.benchmark_connections = connections as BenchmarkConnectionEntry[];
    }

    const { fileId, name } = await createNewConversation(user, firstMessage, {
      version: 2,
      ...(Object.keys(extraMeta).length > 0 ? { extraMeta } : {}),
    });

    if (log.length > 0) {
      // appendLogToConversation accepts any JSON-array log; the v=2 path
      // already uses it for orchestrator entries (chat-orchestration-v2.server.ts).
      await appendLogToConversation(
        fileId,
        log as unknown as ConversationLogEntry[],
        0,
        user,
      );
    }

    return NextResponse.json({ fileId, name });
  } catch (error) {
    return handleApiError(error);
  }
}

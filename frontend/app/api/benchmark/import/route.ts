import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import { truncateMessageForName } from '@/lib/conversations-utils';
import { handleApiError } from '@/lib/api/api-responses';
import type { ConversationLog } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';

/**
 * POST /api/benchmark/import
 *
 * Persist a benchmark run's orchestrator conversation log as a v3 conversation
 * (dedicated `conversations` + `messages` tables) so it can be opened at
 * `/explore/<id>` and continued in the chat UI.
 *
 * Body shape:
 *   {
 *     log: ConversationLog,
 *     label?: string,
 *     connections?: BenchmarkConnectionEntry[]   // dataset's connections.json
 *   }
 *
 * The optional `connections` array (the same JSON the runner reads from
 * `<dataset>_connections.json`) is persisted on the conversation's
 * `meta.benchmark_connections` so v3 chat continuation can wire per-
 * conversation NodeConnector-backed executors. Without it, SQL queries
 * fail with "connector 'X' not loaded".
 *
 * Security note: connection configs may contain credentials. The conversation
 * lives in the same documents DB as connection documents (which already
 * hold credentials), so storing here doesn't widen the access surface; it
 * does mean the credentials travel inside the `meta` field over
 * authenticated API responses, same as connection docs.
 *
 * Returns `{ fileId, name }` (`fileId` is the v3 conversation id).
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

    const meta: Record<string, unknown> = {};
    if (firstMessage) meta.firstMessage = firstMessage;
    if (Array.isArray(connections)) {
      meta.benchmark_connections = connections as BenchmarkConnectionEntry[];
    }

    // v3: a dedicated conversation + its pi log as message rows. The benchmark root agent + the
    // per-conversation connections are recovered at continuation time from the log + meta.
    const conv = await createConversation({
      ownerUserId: user.userId,
      mode: user.mode,
      agent: 'BenchmarkAnalystAgent',
      title: firstMessage ? truncateMessageForName(firstMessage) : undefined,
      meta,
    });

    if (log.length > 0) {
      await appendMessages(conv.id, log as ConversationLog, 0);
    }

    return NextResponse.json({ fileId: conv.id, name: conv.title });
  } catch (error) {
    return handleApiError(error);
  }
}

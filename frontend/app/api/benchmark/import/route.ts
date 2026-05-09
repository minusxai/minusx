import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import {
  appendLogToConversation,
  createNewConversation,
} from '@/lib/conversations';
import { handleApiError } from '@/lib/api/api-responses';
import type { ConversationLog } from '@/orchestrator/types';
import type { ConversationLogEntry } from '@/lib/types';

/**
 * POST /api/benchmark/import
 *
 * Persist a benchmark run's pi-ai conversation log as a v=2 conversation
 * file in the documents DB so it can be opened at `/explore/<fileId>?v=2`
 * and continued in the chat UI. The body shape is:
 *
 *   { log: ConversationLog, label?: string }
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
    if (!Array.isArray(log)) {
      return NextResponse.json({ error: 'log is required and must be an array' }, { status: 400 });
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

    const { fileId, name } = await createNewConversation(user, firstMessage, { version: 2 });

    if (log.length > 0) {
      // appendLogToConversation accepts any JSON-array log; the v=2 path
      // already uses it for pi-ai entries (chat-orchestration-v2.server.ts).
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

/**
 * Chat Architecture v3 — the turn runner.
 *
 * Drives one orchestrator segment (a fresh user turn OR a resume with completed frontend-tool
 * results) and persists to the dedicated tables instead of a conversation file + the in-memory
 * run-registry:
 *   - loads the pi log from `messages` rows, builds the orchestrator via the (reused) setupOrchestration
 *   - streams token deltas live via NOTIFY (batched, ephemeral)
 *   - on segment end, appends the new pi entries as durable rows + NOTIFYs the cursor
 *   - mirrors tool/run errors to conversation_errors, records LLM usage, sets run_status
 *
 * The client never receives output from here — it reads the resumable GET …/stream. This fn just
 * produces durable rows + wakeups. See docs/chat-architecture-v3.md §7.
 */
import { setupOrchestration, recordLlmCalls } from '@/lib/chat-orchestration-v2.server';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLog, PendingToolCall } from '@/orchestrator/types';
import {
  loadLog, appendMessages, setRunStatus, updateConversationTitle, appendError, ConcurrentAppendError,
} from '@/lib/data/conversations.server';
import { notifyMessage, notifyDelta, notifyStatus } from './conversation-stream.server';
import { truncateMessageForName } from '@/lib/conversations-utils';

const DELTA_FLUSH_MS = 50;

/** First user message = the userMessage on the root invocation (parent_id null) in this diff. */
function firstUserMessage(entries: ConversationLog): string | null {
  for (const e of entries) {
    if ((e as { type?: string }).type === 'toolCall' && (e as { parent_id?: unknown }).parent_id === null) {
      const um = (e as { arguments?: { userMessage?: unknown } }).arguments?.userMessage;
      if (typeof um === 'string') return um;
    }
  }
  return null;
}

/** Mirror server/frontend tool errors + a hard run error into the parallel error stream (UI-only). */
async function mirrorErrors(conversationId: number, piDiff: ConversationLog, runError?: string): Promise<void> {
  try {
    if (runError) await appendError(conversationId, { source: 'llm', message: runError });
    for (const raw of piDiff) {
      const entry = raw as unknown as Record<string, unknown>;
      if (entry?.role !== 'toolResult') continue;
      const content = entry.content;
      const text = Array.isArray(content)
        ? (content as Array<{ type?: string; text?: string }>)
            .filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n')
        : String(content ?? '');
      // Check {success:false} content FIRST (frontend-tool errors carry both flags), then isError.
      let source: 'server-tool' | 'frontend-tool' | null = null;
      let message = text;
      try {
        const p = JSON.parse(text) as { success?: unknown; error?: unknown };
        if (p && typeof p === 'object' && p.success === false) {
          source = 'frontend-tool';
          if (typeof p.error === 'string') message = p.error;
        }
      } catch { /* not JSON — not a frontend-tool error */ }
      if (!source && entry.isError === true) source = 'server-tool';
      if (!source) continue;
      await appendError(conversationId, {
        source, message,
        parentPiId: typeof entry.parent_id === 'string' ? entry.parent_id : null,
        details: {
          tool_name: typeof entry.toolName === 'string' ? entry.toolName : undefined,
          tool_call_id: typeof entry.toolCallId === 'string' ? entry.toolCallId : undefined,
        },
      });
    }
  } catch (e) {
    console.error('[chat-v3] mirrorErrors failed:', e);
  }
}

export interface TurnResult {
  conversationId: number;
  runStatus: 'idle' | 'paused' | 'error';
  pendingToolCalls: PendingToolCall[];
  finalSeq: number;
  error?: string;
}

/**
 * Run one turn segment to completion (or to a frontend-tool pause), persisting rows + notifying.
 * Awaitable; the route fires it detached (the long-running Node process keeps it alive) and the
 * client receives output via the stream.
 */
export async function runConversationTurn(
  conversationId: number,
  user: EffectiveUser,
  body: ChatRequest,
): Promise<TurnResult> {
  const savedLog = await loadLog(conversationId);
  const startSeq = savedLog.length;

  const setup = await setupOrchestration(body, user, conversationId, { savedLog });
  if (setup.fatalError) {
    await appendError(conversationId, { source: 'session', message: setup.fatalError });
    await setRunStatus(conversationId, 'error');
    await notifyStatus(conversationId, 'error', startSeq);
    return { conversationId, runStatus: 'error', pendingToolCalls: [], finalSeq: startSeq, error: setup.fatalError };
  }

  await setRunStatus(conversationId, 'running');
  await notifyStatus(conversationId, 'running', startSeq);

  let runError: string | undefined;
  let buf = '';
  let lastFlush = Date.now();
  const flush = async () => {
    if (!buf) return;
    const text = buf;
    buf = '';
    lastFlush = Date.now();
    await notifyDelta(conversationId, startSeq, text); // seq = turn base (in-flight grouping)
  };

  try {
    if (setup.rawStream) {
      for await (const ev of setup.rawStream) {
        const t = (ev as { type?: string }).type;
        if (t === 'error') {
          const errMsg = (ev as { error?: { errorMessage?: string } }).error?.errorMessage;
          if (errMsg && !runError) runError = errMsg;
        } else if (t === 'text_delta' || t === 'thinking_delta') {
          buf += (ev as { delta?: string }).delta ?? '';
          if (Date.now() - lastFlush >= DELTA_FLUSH_MS) await flush();
        }
      }
      await setup.rawStream.result();
      await flush();
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  // Commit the new pi entries as durable rows.
  const piDiff = setup.orchestrator.log.slice(startSeq) as ConversationLog;
  let finalSeq = startSeq;
  if (piDiff.length > 0) {
    try {
      const rows = await appendMessages(conversationId, piDiff, startSeq);
      finalSeq = startSeq + rows.length;
      if (startSeq === 0) {
        const fm = firstUserMessage(piDiff);
        if (fm) await updateConversationTitle(conversationId, truncateMessageForName(fm));
      }
      // One wakeup with the latest cursor — listeners SELECT everything past their own cursor.
      await notifyMessage(conversationId, finalSeq - 1);
    } catch (e) {
      if (e instanceof ConcurrentAppendError) {
        runError = runError ?? 'concurrent turn — the conversation advanced underneath this run';
      } else {
        throw e;
      }
    }
  }

  await mirrorErrors(conversationId, piDiff, runError);
  await recordLlmCalls(piDiff, conversationId, user);

  const pendingToolCalls = setup.orchestrator.getPendingToolCalls();
  const runStatus: TurnResult['runStatus'] = runError ? 'error' : pendingToolCalls.length > 0 ? 'paused' : 'idle';
  await setRunStatus(conversationId, runStatus);
  await notifyStatus(conversationId, runStatus, finalSeq);

  return { conversationId, runStatus, pendingToolCalls, finalSeq, error: runError };
}

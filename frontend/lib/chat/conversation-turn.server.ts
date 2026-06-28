/**
 * Chat Architecture v3 — the turn runner.
 *
 * Drives one orchestrator segment (a fresh user turn OR a resume with completed frontend-tool
 * results) and persists to the dedicated tables:
 *   - loads the pi log from `messages` rows, builds the orchestrator via the (reused) setupOrchestration
 *   - streams token deltas live via NOTIFY (batched, ephemeral)
 *   - on segment end, appends the new pi entries as durable rows + NOTIFYs the cursor
 *   - mirrors tool/run errors to the error stream (kind='error' rows), records LLM usage, sets run_status
 *
 * The client never receives output from here — it reads the resumable GET …/stream. This fn just
 * produces durable rows + wakeups. See docs/chat-architecture-v3.md §7.
 */
import { setupOrchestration, recordLlmCalls } from '@/lib/chat-orchestration-v2.server';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLog, PendingToolCall } from '@/orchestrator/types';
import {
  loadLog, loadMessages, appendMessages, updateConversationTitle, setGeneratedConversationTitle, appendError, ConcurrentAppendError,
  acquireRunLease, heartbeatRunLease, releaseRunLease, getConversation,
  bumpAutoRetries, resetAutoRetries, truncateMessagesFrom, MAX_AUTO_RETRIES, AUTO_RETRY_EXHAUSTED_MESSAGE,
} from '@/lib/data/conversations.server';
import type { Conversation } from '@/lib/data/conversations.types';
import { notifyMessage, notifyDelta, notifyStatus, subscribe } from './conversation-stream.server';
import { truncateMessageForName } from '@/lib/conversations-utils';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';

const DELTA_FLUSH_MS = 50;
const HEARTBEAT_MS = 30_000;
/** Identifies this process as the lease owner (so a stale lease = this owner died/restarted). */
export const INSTANCE_ID = `pid-${typeof process !== 'undefined' ? process.pid : 0}`;

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

/**
 * Best-effort: replace the placeholder first-turn title (the truncated first
 * message) with a concise AI-generated title, derived from the user's request.
 * Runs after the turn so it never blocks streaming; failures are swallowed.
 */
async function generateConversationTitle(conversationId: number, userMessage: string, user: EffectiveUser): Promise<void> {
  try {
    const title = await runMicroTask(
      'title',
      {
        input: userMessage,
        subject: 'a data-analysis chat conversation',
        instructions: 'Title it by what the user is trying to find out or do.',
      },
      user,
    );
    await setGeneratedConversationTitle(conversationId, title);
  } catch (e) {
    console.error('[conversation-turn] auto-title failed:', e);
  }
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
 * Prepare a silent auto-retry of a server-restart-interrupted turn. The dead turn began at
 * `run_started_seq` (preserved across the failed run); its root invocation there carries the user
 * message. We roll back the dead turn's partial rows and hand back the user message to replay — but
 * only if (a) we're under the server-enforced cap and (b) it's a user-message turn (resume-turn
 * crashes aren't auto-retried — truncating a half-applied frontend-tool resume is unsafe).
 */
async function prepareAutoRetry(
  conversationId: number,
  conv: Conversation | null,
): Promise<{ ok: true; userMessage: string; startSeq: number } | { ok: false; reason: string; seq: number }> {
  const startedSeq = conv?.runStartedSeq ?? null;
  const retries = Number(conv?.meta?.autoRetries ?? 0);
  if (startedSeq == null) return { ok: false, reason: 'no run_started_seq to retry from', seq: 0 };

  if (retries >= MAX_AUTO_RETRIES) {
    await appendError(conversationId, { source: 'session', message: AUTO_RETRY_EXHAUSTED_MESSAGE });
    return { ok: false, reason: 'auto-retry limit reached', seq: startedSeq };
  }

  const rows = await loadMessages(conversationId, startedSeq - 1);
  const root = rows.find((r) => r.seq === startedSeq);
  const userMessage = root && root.parentPiId == null
    ? (root.content as unknown as { arguments?: { userMessage?: unknown } })?.arguments?.userMessage
    : undefined;
  if (typeof userMessage !== 'string') {
    await appendError(conversationId, { source: 'session', message: 'Interrupted turn is not auto-retriable — please try again.' });
    return { ok: false, reason: 'not a retriable user-message turn', seq: startedSeq };
  }

  await bumpAutoRetries(conversationId);
  await truncateMessagesFrom(conversationId, startedSeq); // roll back the dead turn's partial rows
  return { ok: true, userMessage, startSeq: startedSeq };
}

/**
 * Run one turn segment to completion (or to a frontend-tool pause), persisting rows + notifying.
 * Awaitable; the route fires it detached (the long-running Node process keeps it alive) and the
 * client receives output via the stream. `opts.autoRetry` replays a crash-interrupted turn (rolls
 * back its partial rows and re-runs from the preserved user message, bounded by MAX_AUTO_RETRIES).
 */
export async function runConversationTurn(
  conversationId: number,
  user: EffectiveUser,
  body: ChatRequest,
  opts: { autoRetry?: boolean } = {},
): Promise<TurnResult> {
  // Benchmark conversations carry their per-conversation connection configs in meta.benchmark_connections;
  // hand it to setupOrchestration so continuation can wire NodeConnector-backed executors.
  const conv = await getConversation(conversationId);

  if (opts.autoRetry) {
    const prep = await prepareAutoRetry(conversationId, conv);
    if (!prep.ok) {
      await releaseRunLease(conversationId, 'error');
      await notifyStatus(conversationId, 'error', prep.seq);
      return { conversationId, runStatus: 'error', pendingToolCalls: [], finalSeq: prep.seq, error: prep.reason };
    }
    // Replay as a fresh user-message turn from the rolled-back point.
    body = { ...body, user_message: prep.userMessage, completed_tool_calls: undefined, resume: undefined } as ChatRequest;
  } else {
    // A new user intent (or manual retry) clears the consecutive auto-retry budget.
    await resetAutoRetries(conversationId);
  }

  const savedLog = await loadLog(conversationId);
  const startSeq = savedLog.length;

  const setup = await setupOrchestration(body, user, conversationId, { savedLog, fileMeta: conv?.meta ?? null });
  if (setup.fatalError) {
    await appendError(conversationId, { source: 'session', message: setup.fatalError });
    await releaseRunLease(conversationId, 'error');
    await notifyStatus(conversationId, 'error', startSeq);
    return { conversationId, runStatus: 'error', pendingToolCalls: [], finalSeq: startSeq, error: setup.fatalError };
  }

  // Claim the lease + heartbeat so a reconnect can tell a live turn from an orphaned one (crash).
  await acquireRunLease(conversationId, INSTANCE_ID, startSeq);
  await notifyStatus(conversationId, 'running', startSeq);
  const heartbeat = setInterval(() => { void heartbeatRunLease(conversationId, INSTANCE_ID); }, HEARTBEAT_MS);

  // Honor a "Stop" (interrupt NOTIFY) by cancelling this orchestrator, wherever Stop was clicked.
  const unsubInterrupt = await subscribe(conversationId, (n) => {
    if (n.kind === 'interrupt') setup.orchestrator.cancel();
  });

  let runError: string | undefined;
  let committedSeq = startSeq; // highest seq already persisted

  /**
   * Commit any pi entries the orchestrator has appended beyond `committedSeq` as durable rows +
   * NOTIFY. Called eagerly (root invocation lands first → the user message survives a crash) and as
   * the turn progresses, so reconnect/replay sees committed work even mid-turn.
   */
  const commitNew = async (): Promise<void> => {
    const diff = setup.orchestrator.log.slice(committedSeq) as ConversationLog;
    if (diff.length === 0) return;
    const base = committedSeq;
    const rows = await appendMessages(conversationId, diff, base);
    committedSeq += rows.length;
    if (base === 0) {
      const fm = firstUserMessage(diff);
      if (fm) await updateConversationTitle(conversationId, truncateMessageForName(fm));
    }
    await notifyMessage(conversationId, committedSeq - 1);
  };

  let buf = '';
  let lastFlush = Date.now();
  const flush = async () => {
    if (!buf) return;
    const text = buf;
    buf = '';
    lastFlush = Date.now();
    await notifyDelta(conversationId, committedSeq, text);
  };

  try {
    // Commit the root invocation (user message) immediately — it's already in the log from run().
    await commitNew();
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
        await commitNew(); // persist any entries finalized this step
      }
      await setup.rawStream.result();
      await flush();
      await commitNew();
    }
  } catch (e) {
    if (e instanceof ConcurrentAppendError) {
      runError = runError ?? 'concurrent turn — the conversation advanced underneath this run';
    } else {
      runError = e instanceof Error ? e.message : String(e);
    }
  } finally {
    clearInterval(heartbeat);
    await unsubInterrupt();
  }

  const piDiff = setup.orchestrator.log.slice(startSeq) as ConversationLog;
  const finalSeq = committedSeq;
  await mirrorErrors(conversationId, piDiff, runError);
  await recordLlmCalls(piDiff, conversationId, user);

  const pendingToolCalls = setup.orchestrator.getPendingToolCalls();
  const runStatus: TurnResult['runStatus'] = runError ? 'error' : pendingToolCalls.length > 0 ? 'paused' : 'idle';
  await releaseRunLease(conversationId, runStatus);
  // A turn that actually progressed (idle/paused) clears the auto-retry budget so the next
  // interruption gets a fresh MAX_AUTO_RETRIES. Only consecutive failures count toward the cap.
  if (runStatus !== 'error') await resetAutoRetries(conversationId);
  await notifyStatus(conversationId, runStatus, finalSeq);

  // First successful turn → upgrade the placeholder title to an AI-generated one
  // from the user's request. Awaited (not fire-and-forget) so it completes in a
  // standalone prod build; best-effort inside.
  if (startSeq === 0 && !runError) {
    const fm = firstUserMessage(piDiff);
    if (fm) await generateConversationTitle(conversationId, fm, user);
  }

  return { conversationId, runStatus, pendingToolCalls, finalSeq, error: runError };
}

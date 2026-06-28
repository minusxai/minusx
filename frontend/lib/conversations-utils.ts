import { ConversationLogEntry, ErrorLogEntry, type Attachment } from '@/lib/types';
import type { DebugMessage } from '@/store/chatSlice';
import { piLogToLegacy } from '@/lib/chat-translator';
import type { ConversationLog, ConversationLogEntry as PiLogEntry } from '@/orchestrator/types';
import type { AppState } from '@/lib/appState';
import type { AgentAttachment } from '@/agents/analyst/types';

/**
 * Convert a persisted `AgentAttachment` (what the conversation log stores in each
 * turn's context) back into the client `Attachment` shape the transcript renders.
 * Images may have been stored as a remote URL or base64 — reconstruct the `content`
 * the UI expects. Returns null for an image with neither.
 */
function agentAttachmentToClient(a: AgentAttachment): Attachment | null {
  if (a.type === 'text') {
    return {
      type: 'text',
      name: a.name ?? 'Attachment',
      content: a.content,
      metadata: a.pages ? { pages: a.pages } : {},
    };
  }
  const content = a.url ?? (a.data ? `data:${a.mimeType ?? 'image/png'};base64,${a.data}` : '');
  if (!content) return null;
  return { type: 'image', name: 'image', content, metadata: {} };
}

/**
 * Aggregate task_debug entries from a log (or logDiff) into DebugMessages.
 * Groups entries by task_unique_id, summing duration and concatenating llmDebug.
 * Preserves encounter order.
 */
export function extractDebugMessages(log: ConversationLogEntry[]): DebugMessage[] {
  const debugByTaskId = new Map<string, { debugInfo: any; firstIndex: number }>();

  for (const entry of log) {
    if (entry._type !== 'task_debug') continue;

    const existing = debugByTaskId.get(entry._task_unique_id);
    if (existing) {
      existing.debugInfo.duration += entry.duration;
      existing.debugInfo.llmDebug.push(...(entry.llmDebug || []));
    } else {
      debugByTaskId.set(entry._task_unique_id, {
        debugInfo: {
          task_unique_id: entry._task_unique_id,
          duration: entry.duration,
          llmDebug: [...(entry.llmDebug || [])],
          extra: entry.extra,
          created_at: entry.created_at,
        },
        firstIndex: debugByTaskId.size,
      });
    }
  }

  return Array.from(debugByTaskId.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map(({ debugInfo }) => ({ role: 'debug' as const, ...debugInfo }));
}

/**
 * Parse a pi (orchestrator) ConversationLog directly into displayable messages — the single
 * frontend-side parse that replaces the read-path `piLogToLegacy` (server) → `parseLogToMessages`
 * (frontend) two-hop. It REUSES the existing pi→legacy mapping + legacy parse (no duplication of
 * that intricate logic), and additionally carries each turn's `appState` + `currentTime` onto its
 * user message — read off the pi root invocation's `context`, which the append-only log persists
 * per turn (the legacy translation dropped it). Render structs are unchanged, so renderers are
 * untouched; the inspector can now show exactly what the model saw each turn.
 */
export function parsePiLogToMessages(piLog: ConversationLog, errors?: ErrorLogEntry[]): any[] {
  return parsePiConversation(piLog, errors).messages;
}

/**
 * Parse a pi ConversationLog into everything the conversation loader needs: the displayable
 * `messages` (render structs + per-turn appState/currentTime) AND the `agent` + `agent_args`
 * derived exactly as the legacy loader did (off the first task), so continuation/resume is
 * unchanged. Computes the pi→legacy mapping ONCE (DRY). The caller uses `piLog.length` as the
 * log index — the pi length, which matches the server's append index (the legacy length did not).
 */
export function parsePiConversation(
  piLog: ConversationLog,
  errors?: ErrorLogEntry[],
): { messages: any[]; agent: string; agent_args: Record<string, any> } {
  const legacy = piLogToLegacy(piLog);
  const messages = parseLogToMessages(legacy, errors);

  // Root invocations (pi `toolCall` entries with parent_id === null) are the user turns, in order.
  // Each carries that turn's appState + frozen currentTime in its `context`. Zip them onto the user
  // messages (1:1, chronological — both sequences are in turn order).
  const rootContexts = piLog
    .filter((e) => (e as { type?: string }).type === 'toolCall' && (e as { parent_id?: unknown }).parent_id === null)
    .map((e) => (e as PiLogEntry & { context?: { appState?: AppState; currentTime?: string; attachments?: AgentAttachment[] } }).context);
  let r = 0;
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const ctx = rootContexts[r++];
    if (ctx?.appState !== undefined) m.appState = ctx.appState;
    if (ctx?.currentTime !== undefined) m.currentTime = ctx.currentTime;
    // The legacy parse only finds attachments in task args (always empty — they
    // live in context), so restore them here so they survive a conversation reload.
    if (!m.attachments && ctx?.attachments?.length) {
      const restored = ctx.attachments.map(agentAttachmentToClient).filter((a): a is Attachment => a !== null);
      if (restored.length) m.attachments = restored;
    }
  }

  const firstTask = legacy.find((e) => e._type === 'task');
  return {
    messages,
    agent: firstTask?.agent || 'DefaultAgent',
    agent_args: (firstTask?.args as Record<string, any>) || {},
  };
}

/**
 * Slugify text for use in filenames (max 50 chars)
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/\s+/g, '-')      // Spaces to hyphens
    .replace(/-+/g, '-')       // Collapse multiple hyphens
    .substring(0, 50);         // Max 50 chars
}

/**
 * Truncate message for display name (50 chars)
 */
export function truncateMessageForName(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 50) return cleaned;
  return cleaned.substring(0, 47) + '...';
}

/**
 * Parse conversation log into displayable messages
 * Extracts user messages, tool calls, and debug entries from log
 *
 * @param log - Conversation log entries
 * @returns Array of user messages, completed tool calls, and debug entries
 */
export function parseLogToMessages(log: ConversationLogEntry[], errors?: ErrorLogEntry[]): any[] {
  const messages: any[] = [];
  const pendingTasks = new Map<string, any>(); // unique_id -> task

  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry._type === 'task') {
      const agent = entry.agent;

      // Check if this is the main agent task (contains user message)
      const userMessage = entry.args?.goal || entry.args?.user_message || entry.args?.message;
      if (userMessage && (agent === 'AnalystAgent' || agent === 'DefaultAgent' || agent === 'SlackAgent')) {
        const attachments = entry.args?.attachments;
        messages.push({
          role: 'user',
          content: userMessage,
          created_at: entry.created_at,
          logIndex: i,
          ...(attachments?.length > 0 ? { attachments } : {}),
        });
      }

      // Otherwise, this is a tool call task - store it until we see its result
      pendingTasks.set(entry.unique_id, entry);

    } else if (entry._type === 'task_result') {
      // Find the corresponding task
      const task = pendingTasks.get(entry._task_unique_id);
      if (!task) continue; // Skip if no matching task

      // Create completed tool call from task + result
      const completedToolCall: any = {
        role: 'tool',
        tool_call_id: task.unique_id,
        content: typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result),
        run_id: task._run_id,
        function: {
          name: task.agent,
          arguments: JSON.stringify(task.args)
        },
        created_at: entry.created_at,
        ...(task._parent_unique_id ? { parent_id: task._parent_unique_id } : {}),
      };
      // Restore persisted UI details (e.g. queryResult with rows for ExecuteQuery)
      if (entry.details) {
        completedToolCall.details = entry.details;
      }
      messages.push(completedToolCall);

      // Remove from pending
      pendingTasks.delete(entry._task_unique_id);

    }
  }

  // Append aggregated debug messages (reuse extractDebugMessages)
  messages.push(...extractDebugMessages(log));

  // Merge in conversation `errors[]` as `role:'error'` ErrorMessage rows so the
  // chat UI can render them distinctly (similar to debug messages). pi-ai never
  // sees these; they live on a parallel `errors[]` field on the conversation doc.
  if (errors && errors.length > 0) {
    for (const err of errors) {
      messages.push({
        role: 'error',
        source: err.source,
        content: err.message,
        created_at: new Date(typeof err.timestamp === 'number' ? err.timestamp : Date.now()).toISOString(),
        ...(err.details ? { details: err.details } : {}),
        ...(err.parent_id ? { parent_id: err.parent_id } : {}),
      });
    }
    // Re-sort by created_at so errors interleave with log entries in time order.
    messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  return messages;
}

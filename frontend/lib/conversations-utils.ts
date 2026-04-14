import { ConversationLogEntry } from '@/lib/types';
import type { DebugMessage } from '@/store/chatSlice';

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
export function parseLogToMessages(log: ConversationLogEntry[]): any[] {
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
        created_at: entry.created_at
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

  return messages;
}

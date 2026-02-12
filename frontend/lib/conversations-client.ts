'use client';

import { ConversationLogEntry } from '@/lib/types';

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
  const debugByTaskId = new Map<string, {
    debugInfo: any;
    firstIndex: number;
  }>();

  for (const entry of log) {
    if (entry._type === 'task') {
      const agent = entry.agent;

      // Check if this is the main agent task (contains user message)
      const userMessage = entry.args?.goal || entry.args?.user_message || entry.args?.message;
      if (userMessage && (agent === 'AnalystAgent' || agent === 'DefaultAgent')) {
        // User message
        messages.push({
          role: 'user',
          content: userMessage,
          created_at: entry.created_at
        });
      }

      // Otherwise, this is a tool call task - store it until we see its result
      pendingTasks.set(entry.unique_id, entry);

    } else if (entry._type === 'task_result') {
      // Find the corresponding task
      const task = pendingTasks.get(entry._task_unique_id);
      if (!task) continue; // Skip if no matching task

      // Create completed tool call from task + result
      messages.push({
        role: 'tool',
        tool_call_id: task.unique_id,
        content: typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result),
        run_id: task._run_id,
        function: {
          name: task.agent,
          arguments: JSON.stringify(task.args)
        },
        created_at: entry.created_at
      });

      // Remove from pending
      pendingTasks.delete(entry._task_unique_id);

    } else if (entry._type === 'task_debug') {
      // Aggregate debug deltas by task_unique_id
      const existing = debugByTaskId.get(entry._task_unique_id);
      if (existing) {
        // Accumulate duration and extend llmDebug
        existing.debugInfo.duration += entry.duration;
        existing.debugInfo.llmDebug.push(...(entry.llmDebug || []));
      } else {
        // First entry for this task
        debugByTaskId.set(entry._task_unique_id, {
          debugInfo: {
            task_unique_id: entry._task_unique_id,
            duration: entry.duration,
            llmDebug: [...(entry.llmDebug || [])],
            extra: entry.extra,
            created_at: entry.created_at
          },
          firstIndex: messages.length
        });
      }
    }
  }

  // Add aggregated debug entries in order
  const sortedDebug = Array.from(debugByTaskId.values())
    .sort((a, b) => a.firstIndex - b.firstIndex);

  for (const { debugInfo } of sortedDebug) {
    messages.push({
      role: 'debug',
      ...debugInfo
    });
  }

  return messages;
}

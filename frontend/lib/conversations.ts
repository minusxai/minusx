import 'server-only';
import {
  OrchestrationTask,
  ConversationFileContent,
  ConversationLogEntry,
} from '@/lib/types';

// Type alias for convenience
export type Task = OrchestrationTask;
export type ConversationFile = ConversationFileContent;

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
 * Parse a legacy (v1) conversation log into displayable messages.
 * Extracts user messages and tool calls from task-shaped log entries.
 *
 * @param log - Conversation log entries
 * @returns Array of user messages and completed tool calls
 */
export function parseLogToMessages(log: ConversationLogEntry[]): any[] {
  const messages: any[] = [];

  for (const entry of log) {
    if (entry._type === 'task') {
      // User message (task entry contains user input)
      const userMessage = entry.args?.user_message || entry.args?.message;
      if (userMessage) {
        messages.push({
          type: 'user',
          content: userMessage,
          timestamp: entry.created_at,
          run_id: entry._run_id
        });
      }
    } else if (entry._type === 'task_result') {
      // Assistant response with tool calls
      const result = entry.result;
      if (result?.completed_tool_calls) {
        // Add completed tool calls from this task result
        messages.push(...result.completed_tool_calls.map((tc: any) => ({
          ...tc,
          run_id: entry._task_unique_id
        })));
      }
    }
  }

  return messages;
}

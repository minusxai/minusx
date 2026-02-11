import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  OrchestrationTask,
  ConversationFileContent,
  ConversationLogEntry
} from '@/lib/types';
import { resolvePath } from '@/lib/mode/path-resolver';

// Type alias for convenience
export type Task = OrchestrationTask;
export type ConversationFile = ConversationFileContent;

/**
 * Generate unique run_id for root task
 */
export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
 * Get or create conversation file
 * If conversationId provided, load existing; otherwise create new with auto-generated name
 *
 * @param conversationId - File ID of existing conversation, or null to create new
 * @param user - Effective user
 * @param firstUserMessage - First user message (used for naming new conversations)
 * @returns File ID and conversation content
 */
export async function getOrCreateConversation(
  conversationId: number | null,
  user: EffectiveUser,
  firstUserMessage?: string
): Promise<{ fileId: number; content: ConversationFile }> {
  // If conversationId provided, load existing conversation
  if (conversationId) {
    const fileResult = await FilesAPI.loadFile(conversationId, user);
    const content = fileResult.data.content as unknown as ConversationFile;

    return {
      fileId: conversationId,
      content
    };
  }

  // Create new conversation with auto-generated name from first message
  const userId = user.userId?.toString() || user.email;
  const timestamp = Date.now();
  const name = truncateMessageForName(firstUserMessage || 'New Conversation');
  const slug = slugify(firstUserMessage || 'conversation');
  const fileName = `${timestamp}-${slug}.chat.json`;
  const path = resolvePath(user.mode, `/logs/conversations/${userId}/${fileName}`);
  const now = new Date().toISOString();

  const initialConversation: ConversationFile = {
    metadata: {
      userId,
      name,  // Full truncated message stored in metadata
      createdAt: now,
      updatedAt: now,
      logLength: 0
    },
    log: []
  };

  const createResult = await FilesAPI.createFile(
    {
      name: fileName,
      path,
      type: 'conversation',
      content: initialConversation as any,
      options: {
        createPath: true,
        returnExisting: false  // Always create new
      }
    },
    user
  );

  return {
    fileId: createResult.data.id,
    content: initialConversation
  };
}

/**
 * Read tasks up to a specific tasks_id (run_id)
 * @deprecated This function is deprecated. Use log-based approach instead.
 * Returns empty array to maintain compatibility.
 */
export function getTasksUpTo(_conversation: ConversationFile, _tasksId?: string): Task[] {
  console.warn('getTasksUpTo is deprecated. Use log-based approach instead.');
  return [];
}

/**
 * Append tasks to conversation file
 * @deprecated This function is deprecated. Use appendLogToConversation instead.
 */
export async function appendTasksToConversation(
  _fileId: number,
  _tasks: Task[],
  _user: EffectiveUser
): Promise<void> {
  console.warn('appendTasksToConversation is deprecated. Use appendLogToConversation instead.');
  // No-op for backward compatibility
}

/**
 * Append log entries to conversation file with conflict detection
 * If conflict detected (log_index doesn't match current length), forks to new conversation
 *
 * @param fileId - Current conversation file ID
 * @param logDiff - New log entries to append
 * @param log_index - Expected log length before append (for conflict detection)
 * @param user - Effective user
 * @returns conversationID (file ID) and fileId (may be new if forked)
 */
export async function appendLogToConversation(
  fileId: number,
  logDiff: ConversationLogEntry[],
  log_index: number,
  user: EffectiveUser
): Promise<{ conversationID: number; fileId: number }> {
  // Read the current file to get conversation structure
  const fileResult = await FilesAPI.loadFile(fileId, user);
  const conversation = fileResult.data.content as unknown as ConversationFile;

  // Check for conflict: does log_index match current log length?
  if (conversation.log.length === log_index) {
    // No conflict - append normally
    conversation.log.push(...logDiff);
    conversation.metadata.updatedAt = new Date().toISOString();
    conversation.metadata.logLength = conversation.log.length;

    // Save updated conversation
    await FilesAPI.saveFile(
      fileId,
      fileResult.data.name,
      fileResult.data.path,
      conversation as any,
      [],  // Phase 6: Conversations have no references
      user
    );

    return {
      conversationID: fileId,  // Return same file ID
      fileId
    };
  }

  // Conflict detected - fork to new conversation
  console.warn(`[CONVERSATION] Conflict detected: expected log_index=${log_index}, actual=${conversation.log.length}. Forking conversation.`);

  const userId = user.userId?.toString() || user.email;
  const timestamp = Date.now();
  const forkedName = `${conversation.metadata.name} (forked)`;
  const slug = slugify(forkedName);
  const fileName = `${timestamp}-${slug}.chat.json`;
  const now = new Date().toISOString();

  // Create forked conversation with log up to log_index + new logDiff
  const forkedLog = [
    ...conversation.log.slice(0, log_index),
    ...logDiff
  ];

  const forkedConversation: ConversationFile = {
    metadata: {
      userId,
      name: forkedName,  // Stored in metadata only
      createdAt: now,
      updatedAt: now,
      logLength: forkedLog.length,
      forkedFrom: fileId  // Track parent file ID
    },
    log: forkedLog
  };

  // Create new conversation file
  const path = resolvePath(user.mode, `/logs/conversations/${userId}/${fileName}`);
  const createResult = await FilesAPI.createFile(
    {
      name: fileName,
      path,
      type: 'conversation',
      content: forkedConversation as any,
      options: {
        createPath: true,
        returnExisting: false  // Never return existing for forks
      }
    },
    user
  );

  return {
    conversationID: createResult.data.id,  // Return new file ID
    fileId: createResult.data.id
  };
}

/**
 * Parse conversation log into displayable messages
 * Extracts user messages and tool calls from log entries
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

/**
 * Find the latest root task in a task array
 * @deprecated Use log-based approach instead
 */
export function findLatestRootTask(tasks: Task[]): Task | null {
  const rootTasks = tasks.filter(t => t.parent_id === null);
  return rootTasks.length > 0 ? rootTasks[rootTasks.length - 1] : null;
}

/**
 * Find the previous root task in a task array
 * @deprecated Use log-based approach instead
 */
export function findPreviousRootTask(tasks: Task[]): Task | null {
  const rootTasks = tasks.filter(t => t.parent_id === null);
  return rootTasks.length > 1 ? rootTasks[rootTasks.length - 2] : null;
}

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

function buildConversationPath(user: EffectiveUser, name: string): { userId: string; fileName: string; path: string } {
  const userId = user.userId?.toString() || user.email;
  const slug = slugify(name);
  const fileName = `${Date.now()}-${slug}.chat.json`;
  const path = resolvePath(user.mode, `/logs/conversations/${userId}/${fileName}`);
  return { userId, fileName, path };
}

/**
 * Create a new conversation file and return its real positive ID.
 * Called by /api/chat/init before any streaming starts so the frontend
 * can navigate to the real URL immediately.
 */
export async function createNewConversation(
  user: EffectiveUser,
  firstUserMessage?: string
): Promise<{ fileId: number; name: string }> {
  const name = truncateMessageForName(firstUserMessage || 'New Conversation');
  const { userId, fileName, path } = buildConversationPath(user, firstUserMessage || 'conversation');
  const now = new Date().toISOString();

  const initialConversation: ConversationFile = {
    metadata: {
      userId,
      name,
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
        returnExisting: false
      }
    },
    user
  );

  return { fileId: createResult.data.id, name };
}

/**
 * Get or create conversation file.
 * If conversationId provided, load existing; otherwise create new via createNewConversation.
 */
export async function getOrCreateConversation(
  conversationId: number | null,
  user: EffectiveUser,
  firstUserMessage?: string
): Promise<{ fileId: number; content: ConversationFile }> {
  if (conversationId) {
    const fileResult = await FilesAPI.loadFile(conversationId, user);
    return {
      fileId: conversationId,
      content: fileResult.data.content as unknown as ConversationFile
    };
  }

  const { fileId, name } = await createNewConversation(user, firstUserMessage);
  const now = new Date().toISOString();
  const userId = user.userId?.toString() || user.email;
  const initialConversation: ConversationFile = {
    metadata: { userId, name, createdAt: now, updatedAt: now, logLength: 0 },
    log: []
  };
  return { fileId, content: initialConversation };
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
 * Append log entries to conversation file with conflict detection.
 * Uses an atomic SQL JSONB append — no full read on the happy path.
 * If the log length doesn't match log_index, forks to a new conversation file.
 */
export async function appendLogToConversation(
  fileId: number,
  logDiff: ConversationLogEntry[],
  log_index: number,
  user: EffectiveUser
): Promise<{ conversationID: number; fileId: number }> {
  // Optimistic atomic append — succeeds when log length matches expected index
  const updated = await FilesAPI.appendJsonArray(fileId, logDiff, log_index, user, 'log', 'metadata.updatedAt');
  if (updated) {
    if (log_index === 0) {
      const firstTask = logDiff.find(e => e._type === 'task');
      const firstMsg = firstTask?.args?.user_message || firstTask?.args?.message || firstTask?.args?.goal;
      if (firstMsg) {
        const displayName = truncateMessageForName(String(firstMsg));
        const { path: newPath } = buildConversationPath(user, String(firstMsg));
        await FilesAPI.updateNamePath(fileId, displayName, newPath, user);
      }
    }
    return { conversationID: fileId, fileId };
  }

  // Length mismatch — read current state and fork
  console.warn(`[CONVERSATION] Conflict: expected log_index=${log_index}. Forking conversation ${fileId}.`);

  const fileResult = await FilesAPI.loadFile(fileId, user);
  const conversation = fileResult.data.content as unknown as ConversationFile;

  const forkedName = `${conversation.metadata.name} (forked)`;
  const { userId, fileName, path } = buildConversationPath(user, forkedName);
  const now = new Date().toISOString();

  const forkedLog = [
    ...conversation.log.slice(0, log_index),
    ...logDiff
  ];

  const forkedConversation: ConversationFile = {
    metadata: {
      userId,
      name: forkedName,
      createdAt: now,
      updatedAt: now,
      logLength: forkedLog.length,
      forkedFrom: fileId
    },
    log: forkedLog
  };
  const createResult = await FilesAPI.createFile(
    {
      name: fileName,
      path,
      type: 'conversation',
      content: forkedConversation as any,
      options: { createPath: true, returnExisting: false }
    },
    user
  );

  return {
    conversationID: createResult.data.id,
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

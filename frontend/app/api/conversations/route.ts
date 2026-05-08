import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { ConversationFileContent, ConversationLogEntry, FileType, ConversationSource } from '@/lib/types';
import { truncateMessageForName } from '@/lib/conversations';
import { resolvePath } from '@/lib/mode/path-resolver';
import { isV2ConversationFile, piLogToLegacy } from '@/lib/chat-translator';
import type { ConversationLog } from '@/orchestrator/types';

/**
 * Conversation summary for listing
 */
export interface ConversationSummary {
  id: number;                    // File ID
  name: string;                  // Display name
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  forkedFrom?: number;           // Parent file ID if forked
  messageCount: number;          // Number of user messages
  lastMessage?: string;          // Preview of last message
  parentPageType?: FileType | 'explore';        // Type of page (e.g., 'dashboard', 'report')
  parentFileId?: number;         // File ID of the page where conversation started
  parentFileName?: string;       // Name of the file where conversation started
  source?: ConversationSource;   // Origin metadata (e.g. Slack thread)
}

/**
 * Response for GET /api/conversations
 */
interface ConversationsResponse {
  conversations: ConversationSummary[];
  error?: string;
}

/**
 * Count user messages in conversation log
 */
function countUserMessages(log: ConversationLogEntry[]): number {
  return log.filter(entry =>
    entry._type === 'task' &&
    (entry.args?.user_message || entry.args?.message || entry.args?.goal)
  ).length;
}

/**
 * Get last user message from conversation log
 */
function getLastUserMessage(log: ConversationLogEntry[]): string | undefined {
  // Find last task entry with user message
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry._type === 'task') {
      const userMessage = entry.args?.user_message || entry.args?.message;
      if (userMessage) {
        return truncateMessageForName(userMessage);
      }
    }
  }
  return undefined;
}

/**
 * Get page type from first task in conversation log
 */
function getParentPageType(log: ConversationLogEntry[]): FileType | 'explore' | undefined {
  const firstTask = log.find(entry => entry._type === 'task');
  return firstTask?.args?.app_state?.pageType || firstTask?.args?.app_state?.state?.fileState?.type || 'explore';
}

/**
 * Get parent file info (id, name) from first task's app_state
 */
function getParentFileInfo(log: ConversationLogEntry[]): { id?: number; name?: string } {
  const firstTask = log.find(entry => entry._type === 'task');
  const fileState = firstTask?.args?.app_state?.state?.fileState;
  if (!fileState) return {};
  return { id: fileState.id, name: fileState.name };
}

/**
 * GET /api/conversations
 * List all conversations for the current user
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    // Strict mode separation:
    //   ?v=2 → return ONLY v=2 conversations (meta.version === 2).
    //   else → return ONLY v=1 conversations (meta.version !== 2).
    const isV2 = searchParams.get('v') === '2';

    // Get effective user
    const user = await getEffectiveUser();

    if (!user) {
      return NextResponse.json(
        {
          conversations: [],
          error: 'Unauthorized'
        } as ConversationsResponse,
        { status: 401 }
      );
    }

    // Derive userId from user object
    const userId = user.userId?.toString() || user.email;

    // Get all conversation files for this user (personal + Slack threads)
    // Slack threads are stored at /logs/conversations/{userId}/slack-* (same folder, depth 2 covers them)
    const conversationsPath = resolvePath(user.mode, `/logs/conversations/${userId}`);
    const filesResult = await FilesAPI.getFiles({
      type: 'conversation',
      paths: [conversationsPath],
      depth: 2,  // covers direct children + one subfolder (e.g. slack-* files)
    }, user);

    // Parse and summarize conversations
    const conversations: ConversationSummary[] = [];

    for (const fileInfo of filesResult.data) {
      try {
        // Load file content
        const fileResult = await FilesAPI.loadFile(fileInfo.id, user);
        const fileIsV2 = isV2ConversationFile(fileResult.data);

        // Strict mode filter — skip files that don't match the requested mode.
        if (isV2 !== fileIsV2) continue;

        const rawContent = fileResult.data.content as unknown as ConversationFileContent | undefined;
        if (!rawContent) continue;

        // For v=2 files, translate the pi-ai log to legacy task-log shape so
        // the summary helpers (countUserMessages, getParentPageType, etc.)
        // work unchanged.
        const log: ConversationLogEntry[] = fileIsV2
          ? piLogToLegacy((rawContent.log as unknown) as ConversationLog)
          : rawContent.log;

        const parentFileInfo = getParentFileInfo(log);
        const summary: ConversationSummary = {
          id: fileInfo.id,
          name: rawContent.metadata.name || fileResult.data.name,
          createdAt: rawContent.metadata.createdAt,
          updatedAt: rawContent.metadata.updatedAt,
          forkedFrom: rawContent.metadata.forkedFrom,
          messageCount: countUserMessages(log),
          lastMessage: getLastUserMessage(log),
          parentPageType: getParentPageType(log),
          parentFileId: parentFileInfo.id,
          parentFileName: parentFileInfo.name,
          source: rawContent.metadata.source,
        };

        conversations.push(summary);
      } catch (error) {
        console.error(`Failed to load conversation ${fileInfo.id}:`, error);
        // Skip malformed conversations
        continue;
      }
    }

    // Sort by updatedAt DESC (most recent first)
    conversations.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const result = limit && limit > 0 ? conversations.slice(0, limit) : conversations;

    return NextResponse.json({
      conversations: result
    } as ConversationsResponse);

  } catch (error: any) {
    console.error('Conversations API error:', error);
    return handleApiError(error);
  }
}

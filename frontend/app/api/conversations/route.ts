import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { ConversationFileContent, ConversationLogEntry, FileType } from '@/lib/types';
import { truncateMessageForName } from '@/lib/conversations';
import { resolvePath } from '@/lib/mode/path-resolver';

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
  return firstTask?.args?.app_state?.pageType;
}

/**
 * GET /api/conversations
 * List all conversations for the current user
 */
export async function GET() {
  try {
    // Get effective user
    const user = await getEffectiveUser();

    if (!user || !user.companyId) {
      return NextResponse.json(
        {
          conversations: [],
          error: 'No company ID found for user'
        } as ConversationsResponse,
        { status: 401 }
      );
    }

    // Derive userId from user object
    const userId = user.userId?.toString() || user.email;

    // Get all conversation files for this user
    const conversationsPath = resolvePath(user.mode, `/logs/conversations/${userId}`);
    const filesResult = await FilesAPI.getFiles({
      type: 'conversation',
      paths: [conversationsPath],
      depth: 2  // Get all descendants
    }, user);

    // Parse and summarize conversations
    const conversations: ConversationSummary[] = [];

    for (const fileInfo of filesResult.data) {
      try {
        // Load file content
        const fileResult = await FilesAPI.loadFile(fileInfo.id, user);
        const content = fileResult.data.content as unknown as ConversationFileContent;

        // Extract summary info
        const summary: ConversationSummary = {
          id: fileInfo.id,
          name: content.metadata.name || fileResult.data.name,  // Use file.name (metadata) as fallback, not content.name
          createdAt: content.metadata.createdAt,
          updatedAt: content.metadata.updatedAt,
          forkedFrom: content.metadata.forkedFrom,
          messageCount: countUserMessages(content.log),
          lastMessage: getLastUserMessage(content.log),
          parentPageType: getParentPageType(content.log)
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

    return NextResponse.json({
      conversations
    } as ConversationsResponse);

  } catch (error: any) {
    console.error('Conversations API error:', error);

    return NextResponse.json(
      {
        conversations: [],
        error: error.message || 'Unknown error occurred'
      } as ConversationsResponse,
      { status: 500 }
    );
  }
}

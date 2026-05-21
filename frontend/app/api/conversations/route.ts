import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { isV2ConversationFile } from '@/lib/chat-translator';
import { displayNameFromFileName } from '@/lib/conversations';

/**
 * Conversation summary for listing.
 *
 * Served metadata-only — every field here is available from FilesAPI.getFiles()
 * without loading conversation content. `name` is the full first user message
 * (from meta.firstMessage), falling back to the file name for conversations
 * created before firstMessage was tracked.
 */
export interface ConversationSummary {
  id: number;        // File ID
  name: string;      // Display name — meta.firstMessage ?? file name
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Response for GET /api/conversations
 */
interface ConversationsResponse {
  conversations: ConversationSummary[];
  error?: string;
}

/**
 * GET /api/conversations
 * List all conversations for the current user.
 *
 * Metadata-only: a single getFiles() call, no per-conversation content load.
 * The v=1 / v=2 split and the display name both come from the file row + meta.
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

    // Get all conversation files for this user (personal + Slack threads).
    // Slack threads are stored at /logs/conversations/{userId}/slack-* (depth 2 covers them).
    const conversationsPath = resolvePath(user.mode, `/logs/conversations/${userId}`);
    const filesResult = await FilesAPI.getFiles({
      type: 'conversation',
      paths: [conversationsPath],
      depth: 2,  // covers direct children + one subfolder (e.g. slack-* files)
    }, user);

    const conversations: ConversationSummary[] = [];

    for (const fileInfo of filesResult.data) {
      // Strict mode filter — driven by meta.version, no content needed.
      if (isV2 !== isV2ConversationFile(fileInfo)) continue;

      const meta = (fileInfo.meta ?? {}) as { firstMessage?: string };
      conversations.push({
        id: fileInfo.id,
        name: meta.firstMessage || displayNameFromFileName(fileInfo.name),
        createdAt: fileInfo.created_at,
        updatedAt: fileInfo.updated_at,
      });
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

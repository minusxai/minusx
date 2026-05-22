import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { isV2 } from '@/lib/chat-v2/chat-version';
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
  legacy?: boolean;  // v1 conversation shown in v2 mode — forked to v2 on continue
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
    // Mode listing (v2 is the default surface; see DEFAULT_CHAT_VERSION):
    //   v=2 / default → return ALL conversations; v=1 ones are tagged `legacy`
    //          (they fork to v2 on continue, so users can see + resume old chats).
    //   ?v=1 → return ONLY v=1 conversations (the legacy Python surface).
    const isV2Request = isV2(searchParams.get('v'));

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
      const fileIsV2 = isV2ConversationFile(fileInfo);
      // v1 (Python) surface shows only v1 files; v2 surface shows everything
      // (v1 tagged legacy).
      if (!isV2Request && fileIsV2) continue;

      const meta = (fileInfo.meta ?? {}) as { firstMessage?: string };
      conversations.push({
        id: fileInfo.id,
        name: meta.firstMessage || displayNameFromFileName(fileInfo.name),
        createdAt: fileInfo.created_at,
        updatedAt: fileInfo.updated_at,
        ...(isV2Request && !fileIsV2 ? { legacy: true } : {}),
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

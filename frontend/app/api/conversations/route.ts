import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { isV2 } from '@/lib/chat-v2/chat-version';
import { isV2ConversationFile } from '@/lib/chat-translator';
import { displayNameFromFileName } from '@/lib/conversations';
import { createConversation, listConversations } from '@/lib/data/conversations.server';

/**
 * Conversation summary for listing.
 *
 * Served metadata-only — every field here is available from FilesAPI.getFiles()
 * without loading conversation content. `name` is the full first user message
 * (from meta.firstMessage), falling back to the file name for conversations
 * created before firstMessage was tracked.
 */
export interface ConversationSummary {
  id: number;        // Conversation id (v3 row id) or file id (v1/v2)
  name: string;      // Display name — meta.firstMessage ?? file name
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  legacy?: boolean;  // v1 conversation shown in v2 mode — forked to v2 on continue
  version?: number;  // 3 = dedicated tables (v3), 2 = v2 file, 1 = legacy file
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
    //   ?v=1 → return ONLY v=1 conversations (the legacy surface).
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

    // v3 conversations (dedicated tables) join the default (v2) surface. After the backfill the
    // source file still exists with the SAME id, so v3 takes precedence: skip any file whose id has
    // a v3 row.
    const v3Conversations = isV2Request ? await listConversations(user.userId, user.mode) : [];
    const v3Ids = new Set(v3Conversations.map((c) => c.id));

    for (const fileInfo of filesResult.data) {
      if (v3Ids.has(fileInfo.id)) continue; // migrated → served from v3 below
      const fileIsV2 = isV2ConversationFile(fileInfo);
      // v1 (legacy) surface shows only v1 files; v2 surface shows everything
      // (v1 tagged legacy).
      if (!isV2Request && fileIsV2) continue;

      const meta = (fileInfo.meta ?? {}) as { firstMessage?: string };
      conversations.push({
        id: fileInfo.id,
        name: meta.firstMessage || displayNameFromFileName(fileInfo.name),
        createdAt: fileInfo.created_at,
        updatedAt: fileInfo.updated_at,
        version: fileIsV2 ? 2 : 1,
        ...(isV2Request && !fileIsV2 ? { legacy: true } : {}),
      });
    }

    for (const c of v3Conversations) {
      conversations.push({
        id: c.id,
        name: (c.meta.firstMessage as string) || c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        version: 3,
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

/**
 * POST /api/conversations
 * Create a v3 conversation (dedicated tables). Returns its id (shared global id-space).
 * Body (all optional): { agent?, title?, firstMessage? }.
 */
export async function POST(request: Request) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const firstMessage = typeof body.firstMessage === 'string' ? body.firstMessage : undefined;

    const conversation = await createConversation({
      ownerUserId: user.userId,
      mode: user.mode,
      agent: typeof body.agent === 'string' ? body.agent : 'WebAnalystAgent',
      title: typeof body.title === 'string' ? body.title : undefined,
      meta: firstMessage ? { firstMessage } : undefined,
    });

    return NextResponse.json({ id: conversation.id, conversation });
  } catch (error: any) {
    console.error('Conversations API POST error:', error);
    return handleApiError(error);
  }
}

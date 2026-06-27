import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createConversation, listConversations } from '@/lib/data/conversations.server';

/**
 * Conversation summary for listing. Metadata-only — no per-conversation content load.
 * `name` is the full first user message (meta.firstMessage), falling back to the title.
 */
export interface ConversationSummary {
  id: number;        // v3 conversation id
  name: string;      // Display name — meta.firstMessage ?? title
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  version: number;   // always 3 (conversations are v3-only)
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
 * List the current user's conversations. v3-only: a single metadata query on the `conversations`
 * table. Legacy conversation *files* are never surfaced — the one-time backfill ports them into v3
 * rows (until then they simply don't appear; all chat still works).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json(
        { conversations: [], error: 'Unauthorized' } as ConversationsResponse,
        { status: 401 },
      );
    }

    const rows = await listConversations(user.userId, user.mode);
    const conversations: ConversationSummary[] = rows.map((c) => ({
      id: c.id,
      name: (c.meta.firstMessage as string) || c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      version: 3,
    }));

    // Sort by updatedAt DESC (most recent first)
    conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const result = limit && limit > 0 ? conversations.slice(0, limit) : conversations;
    return NextResponse.json({ conversations: result } as ConversationsResponse);
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

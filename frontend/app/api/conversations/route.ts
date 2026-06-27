import { NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createConversation, listConversations, type ConversationCursor } from '@/lib/data/conversations.server';

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

const DEFAULT_PAGE_SIZE = 15;

/**
 * Response for GET /api/conversations. `nextCursor` is the keyset for the next page (null when the
 * last page was returned) — the client passes it back as `?before=<updatedAt>&beforeId=<id>`.
 */
interface ConversationsResponse {
  conversations: ConversationSummary[];
  nextCursor?: ConversationCursor | null;
  error?: string;
}

/**
 * GET /api/conversations?limit=&before=&beforeId=
 * List the current user's conversations, keyset-paginated (newest-first). v3-only: a single
 * metadata query on the `conversations` table — no message content loaded. Legacy conversation
 * *files* are never surfaced (the one-time backfill ports them into v3 rows).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = Math.min(Math.max(limitParam ? parseInt(limitParam, 10) : DEFAULT_PAGE_SIZE, 1), 50);
    const beforeUpdatedAt = searchParams.get('before');
    const beforeIdParam = searchParams.get('beforeId');
    const before: ConversationCursor | undefined =
      beforeUpdatedAt && beforeIdParam && Number.isFinite(Number(beforeIdParam))
        ? { updatedAt: beforeUpdatedAt, id: Number(beforeIdParam) }
        : undefined;
    const search = searchParams.get('q') ?? undefined;

    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json(
        { conversations: [], error: 'Unauthorized' } as ConversationsResponse,
        { status: 401 },
      );
    }

    // Already ordered (updated_at DESC, id DESC) by the keyset query — do NOT re-sort (that would
    // drop the id tiebreak and desync the cursor).
    const rows = await listConversations(user.userId, user.mode, { limit, before, search });
    const conversations: ConversationSummary[] = rows.map((c) => ({
      id: c.id,
      name: (c.meta.firstMessage as string) || c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      version: 3,
    }));

    // A full page implies there may be more — hand back the last row as the next cursor.
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === limit && last ? { updatedAt: last.updatedAt, id: last.id } : null;

    return NextResponse.json({ conversations, nextCursor } as ConversationsResponse);
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

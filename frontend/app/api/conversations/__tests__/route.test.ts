/**
 * GET /api/conversations — route integration test (v3-only).
 *
 * Conversations are v3 rows. The listing is a single metadata query on the `conversations`
 * table — no per-conversation content load, and legacy conversation *files* are NEVER surfaced
 * (the one-time backfill ports them into v3 rows). Verifies:
 * 1. Seeded v3 conversations appear, newest-first.
 * 2. Display name comes from meta.firstMessage, falling back to the title.
 * 3. Legacy conversation files in the `files` table are NOT listed.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { GET } from '@/app/api/conversations/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ConversationSummary } from '@/app/api/conversations/route';
import type { ConversationLog } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('conversations_route');

// Global mock provides: userId:1, mode:'org', role:'admin'.

const FULL_FIRST_MESSAGE =
  'What is the full revenue breakdown by region for last quarter, including refunds?';

// A minimal pi log so a seeded conversation is non-empty (empty ones are excluded from the list).
const LOG = (m: string): ConversationLog => ([
  { type: 'toolCall', id: 'r', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: m }, context: {} },
] as unknown as ConversationLog);

async function seedConversations(_dbPath: string): Promise<void> {
  // v3 conversations (the only surface) — each gets a message so it lists.
  const a = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent', title: 'My first question', meta: { firstMessage: 'What is revenue?' } });
  await appendMessages(a.id, LOG('What is revenue?'), 0);
  const b = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent', title: 'fallback-to-title' });
  await appendMessages(b.id, LOG('hello'), 0);
  const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent', title: 'revenue', meta: { firstMessage: FULL_FIRST_MESSAGE } });
  await appendMessages(c.id, LOG(FULL_FIRST_MESSAGE), 0);

  // A legacy conversation FILE — must NOT be surfaced by the v3-only listing.
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();
  const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files', [],
  );
  await db.exec(
    `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [next_id, 'legacy chat', '/org/logs/conversations/1/legacy', 'conversation',
     JSON.stringify({ metadata: { userId: '1', name: 'legacy chat', createdAt: now, updatedAt: now, logLength: 0 }, log: [] }),
     '[]', 1, now, now],
  );
}

describe('GET /api/conversations (v3-only)', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seedConversations });

  async function callGet(): Promise<{ status: number; conversations: ConversationSummary[] }> {
    const res = await GET(new Request('http://localhost/api/conversations'));
    const body = await res.json();
    return { status: res.status, conversations: body.conversations ?? [] };
  }

  it('returns 200 with the seeded v3 conversations (legacy files excluded)', async () => {
    const { status, conversations } = await callGet();
    expect(status).toBe(200);
    // 3 v3 conversations — the legacy FILE ('legacy chat') is not surfaced.
    expect(conversations.length).toBe(3);
    expect(conversations.every((c) => c.version === 3)).toBe(true);
    expect(conversations.some((c) => c.name === 'legacy chat')).toBe(false);
  });

  it('uses meta.firstMessage as the display name when present (full, untruncated)', async () => {
    const { conversations } = await callGet();
    const withMeta = conversations.find((c) => c.name === FULL_FIRST_MESSAGE);
    expect(withMeta).toBeDefined();
    expect(withMeta!.name.length).toBeGreaterThan(50);
  });

  it('falls back to the title when meta.firstMessage is absent', async () => {
    const { conversations } = await callGet();
    expect(conversations.some((c) => c.name === 'fallback-to-title')).toBe(true);
  });

  it('includes each conversation with id and timestamps, newest-first', async () => {
    const { conversations } = await callGet();
    for (const c of conversations) {
      expect(typeof c.id).toBe('number');
      expect(c.createdAt).toBeTruthy();
      expect(c.updatedAt).toBeTruthy();
    }
    const ts = conversations.map((c) => new Date(c.updatedAt).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });

  it('respects the limit param', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?limit=2'));
    const body = await res.json();
    expect(body.conversations.length).toBe(2);
  });
});

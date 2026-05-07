/**
 * GET /api/conversations — route integration test
 *
 * Verifies that:
 * 1. Regular conversations appear in the listing
 * 2. Slack conversations (stored at /logs/conversations/{userId}/slack-*) appear
 *    with their `source` metadata, which is the fix for Bug #3 (sidebar visibility)
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { GET } from '@/app/api/conversations/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ConversationSummary } from '@/app/api/conversations/route';
import type { ConversationFileContent } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('conversations_route');

// Global mock provides: userId:1, mode:'org', role:'admin'
// → conversationsPath = '/org/logs/conversations/1'

function makeConvContent(opts: {
  name: string;
  source?: ConversationFileContent['metadata']['source'];
  message?: string;
}): ConversationFileContent {
  const now = new Date().toISOString();
  return {
    metadata: {
      userId: '1',
      name: opts.name,
      createdAt: now,
      updatedAt: now,
      logLength: opts.message ? 2 : 0,
      ...(opts.source && { source: opts.source }),
    },
    log: opts.message
      ? [
          { _type: 'task', args: { user_message: opts.message } } as any,
          { _type: 'task_result', result: { success: true, content: 'ok' } } as any,
        ]
      : [],
  };
}

async function seedConversations(_dbPath: string): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files',
    [],
  );

  const files: Array<{ id: number; name: string; path: string; content: object }> = [
    {
      id: next_id,
      name: 'My first question',
      path: '/org/logs/conversations/1/conv-regular-1',
      content: makeConvContent({ name: 'My first question', message: 'What is revenue?' }),
    },
    {
      id: next_id + 1,
      name: 'slack-C_TEST-2024-01-15',
      path: '/org/logs/conversations/1/slack-T_TEAM-C_TEST-1705312800-000001',
      content: makeConvContent({
        name: 'slack-C_TEST-2024-01-15',
        message: 'hello bot',
        source: {
          type: 'slack',
          teamId: 'T_TEAM',
          channelId: 'C_TEST',
          threadTs: '1705312800.000001',
          channelName: 'general',
        },
      }),
    },
  ];

  for (const f of files) {
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [f.id, f.name, f.path, 'conversation', JSON.stringify(f.content), '[]', 1, now, now],
    );
  }

}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('GET /api/conversations', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seedConversations });

  async function callGet(): Promise<{ status: number; conversations: ConversationSummary[] }> {
    const res = await GET(new Request('http://localhost/api/conversations'));
    const body = await res.json();
    return { status: res.status, conversations: body.conversations ?? [] };
  }

  it('returns 200 with the seeded conversations', async () => {
    const { status, conversations } = await callGet();
    expect(status).toBe(200);
    expect(conversations.length).toBe(2);
  });

  it('includes regular conversations with message preview', async () => {
    const { conversations } = await callGet();
    const regular = conversations.find(c => c.name === 'My first question');
    expect(regular).toBeDefined();
    expect(regular!.messageCount).toBe(1);
    expect(regular!.lastMessage).toBeTruthy();
    expect(regular!.source).toBeUndefined();
  });

  it('includes Slack conversations with source metadata (Bug #3 fix)', async () => {
    const { conversations } = await callGet();
    const slack = conversations.find(c => c.name === 'slack-C_TEST-2024-01-15');
    expect(slack).toBeDefined();
    expect(slack!.source).toEqual({
      type: 'slack',
      teamId: 'T_TEAM',
      channelId: 'C_TEST',
      threadTs: '1705312800.000001',
      channelName: 'general',
    });
    expect(slack!.messageCount).toBe(1);
  });

  it('Slack conversations are sorted alongside regular ones by updatedAt', async () => {
    const { conversations } = await callGet();
    // Both seeded with the same `now`, so order may vary — but both must be present
    const names = conversations.map(c => c.name);
    expect(names).toContain('My first question');
    expect(names).toContain('slack-C_TEST-2024-01-15');
  });

  it('default URL (no ?v=2) returns only v=1 conversations (no meta.version)', async () => {
    const { conversations } = await callGet();
    // The seeded files have no meta.version → all classified as v=1.
    expect(conversations.length).toBe(2);
  });

  it('?v=2 returns only v=2 conversations (none seeded → empty)', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toEqual([]);
  });
});

describe('GET /api/conversations — v=2 strict filter', () => {
  const TEST_DB_PATH_V2 = getTestDbPath('conversations_route_v2');

  async function seedV2(_dbPath: string): Promise<void> {
    const { getModules } = await import('@/lib/modules/registry');
    const db = getModules().db;
    const now = new Date().toISOString();

    const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
      'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files',
      [],
    );

    // V=1 conversation (no meta.version)
    const v1Content: ConversationFileContent = {
      metadata: { userId: '1', name: 'legacy chat', createdAt: now, updatedAt: now, logLength: 0 },
      log: [],
    };
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [next_id, 'legacy', '/org/logs/conversations/1/legacy', 'conversation', JSON.stringify(v1Content), '[]', 1, now, now],
    );

    // V=2 conversation (meta.version=2; content.log is pi-ai shape)
    const v2Content = {
      metadata: { userId: '1', name: 'pi-ai chat', createdAt: now, updatedAt: now, logLength: 1 },
      log: [
        {
          type: 'toolCall',
          id: 'root1',
          name: 'WebAnalystAgent',
          arguments: { userMessage: 'What is revenue?' },
          context: {},
          parent_id: null,
        },
      ],
    };
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, meta, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        next_id + 1,
        'v2 chat',
        '/org/logs/conversations/1/v2',
        'conversation',
        JSON.stringify(v2Content),
        JSON.stringify({ version: 2 }),
        '[]',
        1,
        now,
        now,
      ],
    );
  }

  setupTestDb(TEST_DB_PATH_V2, { customInit: seedV2 });

  it('default URL returns only v=1 conversations', async () => {
    const res = await GET(new Request('http://localhost/api/conversations'));
    const body = await res.json();
    const names = body.conversations.map((c: ConversationSummary) => c.name);
    expect(names).toContain('legacy chat');
    expect(names).not.toContain('pi-ai chat');
  });

  it('?v=2 returns only v=2 conversations', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=2'));
    const body = await res.json();
    const names = body.conversations.map((c: ConversationSummary) => c.name);
    expect(names).toContain('pi-ai chat');
    expect(names).not.toContain('legacy chat');
  });

  it('?v=2 derives messageCount from pi-ai log via translator', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=2'));
    const body = await res.json();
    const v2Conv = body.conversations.find((c: ConversationSummary) => c.name === 'pi-ai chat');
    expect(v2Conv).toBeDefined();
    // Root invocation → 1 user message after translation.
    expect(v2Conv!.messageCount).toBe(1);
    expect(v2Conv!.lastMessage).toBe('What is revenue?');
  });
});

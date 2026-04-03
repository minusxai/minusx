/**
 * GET /api/conversations — route integration test
 *
 * Verifies that:
 * 1. Regular conversations appear in the listing
 * 2. Slack conversations (stored at /logs/conversations/{userId}/slack-*) appear
 *    with their `source` metadata, which is the fix for Bug #3 (sidebar visibility)
 */

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_conversations_route.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

import { GET } from '@/app/api/conversations/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ConversationSummary } from '@/app/api/conversations/route';
import type { ConversationFileContent } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('conversations_route');

// Global mock provides: userId:1, mode:'org', companyId:1, role:'admin'
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

async function seedConversations(dbPath: string): Promise<void> {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();

  const { rows: [{ next_id }] } = await db.query<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = 1',
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
    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [1, f.id, f.name, f.path, 'conversation', JSON.stringify(f.content), '[]', 1, now, now],
    );
  }

  await db.close();
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('GET /api/conversations', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seedConversations });

  async function callGet(): Promise<{ status: number; conversations: ConversationSummary[] }> {
    const res = await GET();
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
});

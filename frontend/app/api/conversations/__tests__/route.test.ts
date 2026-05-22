/**
 * GET /api/conversations — route integration test
 *
 * The listing is metadata-only: it serves the sidebar / recents / conversations
 * page from a single getFiles() call and NEVER loads per-conversation content.
 * Verifies that:
 * 1. Seeded conversations appear in the listing
 * 2. The display name comes from meta.firstMessage when present, else the file name
 * 3. No per-conversation content load happens (no FilesAPI.loadFile calls)
 * 4. The v=1 / v=2 strict filter still works (driven by meta.version, no content)
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
import { FilesAPI } from '@/lib/data/files.server';
import type { ConversationSummary } from '@/app/api/conversations/route';
import type { ConversationFileContent } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('conversations_route');

// Global mock provides: userId:1, mode:'org', role:'admin'
// → conversationsPath = '/org/logs/conversations/1'

const FULL_FIRST_MESSAGE =
  'What is the full revenue breakdown by region for last quarter, including refunds?';

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

  const files: Array<{
    id: number;
    name: string;
    path: string;
    content: object;
    meta?: object;
  }> = [
    {
      // Old conversation: no meta.firstMessage, and the row name is the raw
      // `${timestamp}-${slug}.chat.json` filename → display name is un-slugified.
      id: next_id,
      name: '1705312800000-my-first-question.chat.json',
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
    {
      // File row name is the raw (ugly) filename; meta.firstMessage holds the
      // full, untruncated first message that should be displayed.
      id: next_id + 2,
      name: '1705312800000-revenue.chat.json',
      path: '/org/logs/conversations/1/conv-with-meta',
      content: makeConvContent({ name: 'ignored content name', message: FULL_FIRST_MESSAGE }),
      meta: { firstMessage: FULL_FIRST_MESSAGE },
    },
  ];

  for (const f of files) {
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, meta, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        f.id,
        f.name,
        f.path,
        'conversation',
        JSON.stringify(f.content),
        f.meta ? JSON.stringify(f.meta) : null,
        '[]',
        1,
        now,
        now,
      ],
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
    expect(conversations.length).toBe(3);
  });

  it('does not load per-conversation content (metadata-only listing)', async () => {
    const spy = vi.spyOn(FilesAPI, 'loadFile');
    try {
      const { conversations } = await callGet();
      expect(conversations.length).toBe(3);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('uses meta.firstMessage as the display name when present', async () => {
    const { conversations } = await callGet();
    const withMeta = conversations.find(c => c.name === FULL_FIRST_MESSAGE);
    expect(withMeta).toBeDefined();
    // Full message preserved — not truncated to the 50-char file name.
    expect(withMeta!.name.length).toBeGreaterThan(50);
  });

  it('un-slugifies the file name when meta.firstMessage is absent (old conversations)', async () => {
    const { conversations } = await callGet();
    // Raw row name '1705312800000-my-first-question.chat.json' → readable name.
    const regular = conversations.find(c => c.name === 'My first question');
    expect(regular).toBeDefined();
  });

  it('includes each conversation with id and timestamps', async () => {
    const { conversations } = await callGet();
    for (const c of conversations) {
      expect(typeof c.id).toBe('number');
      expect(c.createdAt).toBeTruthy();
      expect(c.updatedAt).toBeTruthy();
    }
  });

  it('?v=2 lists the seeded v=1 conversations, each tagged legacy', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The seeded conversations are all v=1 → visible in v=2 mode, tagged legacy.
    expect(body.conversations.length).toBeGreaterThan(0);
    expect(body.conversations.every((c: ConversationSummary) => c.legacy === true)).toBe(true);
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
      [next_id, 'legacy chat', '/org/logs/conversations/1/legacy', 'conversation', JSON.stringify(v1Content), '[]', 1, now, now],
    );

    // V=2 conversation (meta.version=2). Content is irrelevant to the listing now.
    const v2Content = {
      metadata: { userId: '1', name: 'orchestrator chat', createdAt: now, updatedAt: now, logLength: 1 },
      log: [],
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
        JSON.stringify({ version: 2, firstMessage: 'What is revenue?' }),
        '[]',
        1,
        now,
        now,
      ],
    );
  }

  setupTestDb(TEST_DB_PATH_V2, { customInit: seedV2 });

  it('default URL (v2 is default) returns both, tagging the v=1 conversation legacy', async () => {
    const res = await GET(new Request('http://localhost/api/conversations'));
    const body = await res.json();
    const byName = new Map<string, ConversationSummary>(
      body.conversations.map((c: ConversationSummary) => [c.name, c]),
    );
    // v=2 conversation present, not legacy
    expect(byName.has('What is revenue?')).toBe(true);
    expect(byName.get('What is revenue?')!.legacy).toBeUndefined();
    // v=1 conversation visible under the default (v2) surface, tagged legacy
    expect(byName.has('legacy chat')).toBe(true);
    expect(byName.get('legacy chat')!.legacy).toBe(true);
  });

  it('?v=1 returns only v=1 conversations (legacy Python surface)', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=1'));
    const body = await res.json();
    const names = body.conversations.map((c: ConversationSummary) => c.name);
    expect(names).toContain('legacy chat');
    expect(names).not.toContain('What is revenue?');
  });

  it('?v=2 returns both v=2 and v=1 conversations, tagging v=1 as legacy', async () => {
    const res = await GET(new Request('http://localhost/api/conversations?v=2'));
    const body = await res.json();
    const byName = new Map<string, ConversationSummary>(
      body.conversations.map((c: ConversationSummary) => [c.name, c]),
    );
    // v=2 conversation present, not legacy
    expect(byName.has('What is revenue?')).toBe(true);
    expect(byName.get('What is revenue?')!.legacy).toBeUndefined();
    // v=1 conversation now visible in v=2 mode, tagged legacy (forks on continue)
    expect(byName.has('legacy chat')).toBe(true);
    expect(byName.get('legacy chat')!.legacy).toBe(true);
  });

  it('?v=2 does not load content to classify or name conversations', async () => {
    const spy = vi.spyOn(FilesAPI, 'loadFile');
    try {
      await GET(new Request('http://localhost/api/conversations?v=2'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// Verifies that `appendLogToConversation` preserves the source file's
// top-level `meta` (most importantly `meta.version`) when forking on a log
// length mismatch. Without this fix, forking a v=2 conversation would
// produce a v=1 conversation file (no meta.version), and the next turn
// would mode-mismatch.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { appendLogToConversation } from '@/lib/conversations';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('conversations_v2_fork');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

let v2FileId: number;

async function seed(_dbPath: string): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files',
    [],
  );
  v2FileId = next_id;

  // V=2 conversation with one entry already in the log (length=1). We'll
  // append with expectedLogIndex=0 to force a fork.
  const v2Content = {
    metadata: { userId: '1', name: 'pre-existing', createdAt: now, updatedAt: now, logLength: 1 },
    log: [{ _type: 'task', _run_id: 'r', agent: 'AnalystAgent', args: { user_message: 'first' }, unique_id: 't1', created_at: now }],
  };
  await db.exec(
    `INSERT INTO files (id, name, path, type, content, meta, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      v2FileId,
      'pre-existing',
      '/org/logs/conversations/1/pre-existing.chat.json',
      'conversation',
      JSON.stringify(v2Content),
      JSON.stringify({ version: 2, customField: 'preserved' }),
      '[]',
      1,
      now,
      now,
    ],
  );
}

describe('appendLogToConversation — fork preserves source meta', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seed });

  it('forking a v=2 conversation produces a forked file with meta.version === 2 (not v=1)', async () => {
    const newEntry: ConversationLogEntry = {
      _type: 'task',
      _run_id: 'r2',
      agent: 'AnalystAgent',
      args: { user_message: 'forked turn' },
      unique_id: 't2',
      created_at: new Date().toISOString(),
    };
    // Pass expectedLogIndex=0 even though the source has 1 entry → forces fork.
    const result = await appendLogToConversation(v2FileId, [newEntry], 0, ADMIN);

    expect(result.fileId).not.toBe(v2FileId); // forked to a new file
    const forked = await FilesAPI.loadFile(result.fileId, ADMIN);
    const meta = (forked.data as { meta?: Record<string, unknown> }).meta;
    expect(meta).toBeDefined();
    expect(meta!.version).toBe(2);
    // Other meta fields preserved verbatim, not just `version`.
    expect(meta!.customField).toBe('preserved');
  });
});

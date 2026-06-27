// Phase 5 backfill: conversation FILES (v=1 legacy + v=2 pi) port into the v3 tables, preserving
// ids, converting v1 logs to pi, carrying errors[], and skipping already-migrated ids (idempotent).
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { migrateConversationsToV3 } from '@/lib/data/migrate-conversations-v3.server';
import { getConversation, loadLog, loadMessages, loadErrors } from '@/lib/data/conversations.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('migrate_conversations_v3');

async function insertConversationFile(id: number, opts: {
  path: string; name: string; content: unknown; meta: unknown;
}) {
  await getModules().db.exec(
    `INSERT INTO files (id, name, path, type, content, meta) VALUES ($1, $2, $3, 'conversation', $4::jsonb, $5::jsonb)`,
    [id, opts.name, opts.path, JSON.stringify(opts.content), JSON.stringify(opts.meta)],
  );
}

const PI_LOG = [
  { type: 'toolCall', id: 'root', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'v2 hello' }, context: {} },
  { role: 'assistant', parent_id: 'root', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop', model: 'm', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
];

const LEGACY_LOG = [
  { _type: 'task', _run_id: 'r1', agent: 'AnalystAgent', args: { user_message: 'v1 hello' }, unique_id: 't1', created_at: '2024-01-01T00:00:00Z' },
];

describe('migrateConversationsToV3', () => {
  setupTestDb(TEST_DB_PATH);

  it('ports v2 + v1 conversation files into v3 tables, preserving ids; idempotent', async () => {
    await insertConversationFile(3001, {
      path: '/org/logs/conversations/1/a.chat.json', name: 'v2 hello',
      content: { metadata: { userId: '1', name: 'v2 hello' }, log: PI_LOG, errors: [{ source: 'llm', message: 'boom', timestamp: 1 }] },
      meta: { version: 2, firstMessage: 'v2 hello' },
    });
    await insertConversationFile(3002, {
      path: '/tutorial/logs/conversations/7/b.chat.json', name: 'old v1',
      content: { metadata: { userId: '7' }, log: LEGACY_LOG },
      meta: {}, // v1 (no version)
    });

    const report = await migrateConversationsToV3();
    expect(report.found).toBe(2);
    expect(report.migrated).toBe(2);
    expect(report.failed).toBe(0);

    // v2 conversation preserved its id, owner, mode, pi log, and error.
    const c1 = await getConversation(3001);
    expect(c1?.ownerUserId).toBe(1);
    expect(c1?.mode).toBe('org');
    expect(c1?.meta.originalVersion).toBe(2);
    expect((await loadLog(3001))).toEqual(PI_LOG);
    expect((await loadErrors(3001))[0].message).toBe('boom');

    // v1 conversation: id + mode preserved; legacy log converted to pi (root toolCall present).
    const c2 = await getConversation(3002);
    expect(c2?.mode).toBe('tutorial');
    expect(c2?.ownerUserId).toBe(7);
    const log2 = await loadMessages(3002);
    expect(log2[0].kind).toBe('toolCall');
    expect(log2.length).toBeGreaterThanOrEqual(1);

    // Idempotent: a second run skips both (already migrated), migrates nothing.
    const again = await migrateConversationsToV3();
    expect(again.skipped).toBe(2);
    expect(again.migrated).toBe(0);
  });

  it('--dry reports without writing', async () => {
    await insertConversationFile(3010, {
      path: '/org/logs/conversations/1/c.chat.json', name: 'dry', content: { metadata: { userId: '1' }, log: PI_LOG }, meta: { version: 2 },
    });
    const report = await migrateConversationsToV3({ dry: true });
    expect(report.migrated).toBe(1);
    expect(await getConversation(3010)).toBeNull(); // nothing written
  });
});

// Integration tests for the v3 conversation store against a real (PGLite) test DB: shared-id
// allocation (never collides with files), append/load round-trip of the pi log, OCC on concurrent
// append, the parallel error stream, and list/get/delete.
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  createConversation, getConversation, listConversations, deleteConversation,
  appendMessages, loadLog, loadMessages, getMaxSeq, appendError, loadErrors,
  ConcurrentAppendError, setRunStatus,
} from '@/lib/data/conversations.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConversationLog } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('conversations_store');

const LOG = (userMessage: string): ConversationLog => ([
  { type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage }, context: {} },
  { role: 'assistant', parent_id: 'root1', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', model: 'm', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
] as unknown as ConversationLog);

describe('v3 conversation store', () => {
  setupTestDb(TEST_DB_PATH);

  it('allocates ids in the shared files id-space (≥1000, never colliding with files)', async () => {
    // Seed a file with a high id; the conversation id must come out strictly higher.
    await getModules().db.exec(
      `INSERT INTO files (id, name, path, type, content) VALUES (5000, 'q', '/q', 'question', '{}'::jsonb)`,
    );
    const a = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const b = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    expect(a.id).toBeGreaterThan(5000);
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.meta.version).toBe(3);
  });

  it('preserves an explicit id (for backfill)', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent', explicitId: 7777, title: 'old' });
    expect(c.id).toBe(7777);
    expect((await getConversation(7777))?.title).toBe('old');
  });

  it('appends pi entries and rebuilds the exact log (round-trip)', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    expect(await getMaxSeq(c.id)).toBe(-1);
    const log = LOG('hello');
    const rows = await appendMessages(c.id, log, 0);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(rows[0].kind).toBe('toolCall');
    expect(rows[0].piId).toBe('root1');
    expect(await getMaxSeq(c.id)).toBe(1);
    expect(await loadLog(c.id)).toEqual(log);
  });

  it('appends incrementally across turns', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await appendMessages(c.id, LOG('t1'), 0);          // seq 0,1
    await appendMessages(c.id, LOG('t2'), 2);          // seq 2,3
    const log = await loadLog(c.id);
    expect(log).toHaveLength(4);
    expect((log[2] as unknown as { arguments: { userMessage: string } }).arguments.userMessage).toBe('t2');
    expect(await loadMessages(c.id, 1).then((m) => m.map((r) => r.seq))).toEqual([2, 3]);
  });

  it('rejects a concurrent append at a taken seq (OCC → fork signal)', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await appendMessages(c.id, LOG('t1'), 0);          // seq 0,1
    // A stale writer thinks the log is still empty and appends at seq 0 again:
    await expect(appendMessages(c.id, LOG('stale'), 0)).rejects.toBeInstanceOf(ConcurrentAppendError);
  });

  it('lists by owner+mode (newest first) and deletes (cascading messages)', async () => {
    const c1 = await createConversation({ ownerUserId: 42, mode: 'org', agent: 'WebAnalystAgent', title: 'first' });
    const c2 = await createConversation({ ownerUserId: 42, mode: 'org', agent: 'WebAnalystAgent', title: 'second' });
    await createConversation({ ownerUserId: 42, mode: 'tutorial', agent: 'WebAnalystAgent', title: 'other-mode' });
    await appendMessages(c2.id, LOG('bump c2'), 0); // c2 becomes most recent

    const org = await listConversations(42, 'org');
    expect(org.map((c) => c.id)).toEqual([c2.id, c1.id]);   // updated_at DESC
    expect((await listConversations(42, 'tutorial')).map((c) => c.title)).toEqual(['other-mode']);

    await deleteConversation(c1.id);
    expect(await getConversation(c1.id)).toBeNull();
  });

  it('records the parallel error stream and sets run status', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await appendError(c.id, { source: 'llm', message: 'boom', details: { http_status: 500 } });
    const errs = await loadErrors(c.id);
    expect(errs).toHaveLength(1);
    expect(errs[0].source).toBe('llm');
    expect(errs[0].details).toEqual({ http_status: 500 });

    await setRunStatus(c.id, 'running');
    expect((await getConversation(c.id))?.runStatus).toBe('running');
  });
});

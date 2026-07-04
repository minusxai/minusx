// Integration tests for the v3 conversation store against a real (PGLite) test DB: shared-id
// allocation (never collides with files), append/load round-trip of the pi log, OCC on concurrent
// append, the parallel error stream, and list/get/delete.

import {
  createConversation, getConversation, listConversations, deleteConversation,
  appendMessages, loadLog, loadMessages, getMaxSeq, appendError, loadErrors,
  ConcurrentAppendError, setRunStatus, acquireRunLease, interruptRun,
  truncateMessagesFrom, bumpAutoRetries, resetAutoRetries,
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

  describe('interruptRun — durable Stop for orphaned runs', () => {
    it('clears a stuck paused run to idle (so reopen/refresh no longer shows EXECUTING)', async () => {
      const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
      await setRunStatus(c.id, 'paused');
      expect(await interruptRun(c.id)).toBe(true);
      expect((await getConversation(c.id))?.runStatus).toBe('idle');
    });

    it('clears an orphaned running run (stale/absent heartbeat) to idle', async () => {
      const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
      await setRunStatus(c.id, 'running'); // running with NO heartbeat → orphaned
      expect(await interruptRun(c.id)).toBe(true);
      expect((await getConversation(c.id))?.runStatus).toBe('idle');
    });

    it('leaves a LIVE running turn (fresh lease) alone — its own cancel path releases it', async () => {
      const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
      await acquireRunLease(c.id, 'owner-1', 0); // running + fresh heartbeat NOW
      expect(await interruptRun(c.id)).toBe(false);
      expect((await getConversation(c.id))?.runStatus).toBe('running');
    });

    it('is a no-op for an idle conversation', async () => {
      const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
      expect(await interruptRun(c.id)).toBe(false);
      expect((await getConversation(c.id))?.runStatus).toBe('idle');
    });
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

  it('lists non-empty conversations by owner+mode (newest first) and deletes', async () => {
    const c1 = await createConversation({ ownerUserId: 42, mode: 'org', agent: 'WebAnalystAgent', title: 'first' });
    await appendMessages(c1.id, LOG('m1'), 0);
    const c2 = await createConversation({ ownerUserId: 42, mode: 'org', agent: 'WebAnalystAgent', title: 'second' });
    const t = await createConversation({ ownerUserId: 42, mode: 'tutorial', agent: 'WebAnalystAgent', title: 'other-mode' });
    await appendMessages(t.id, LOG('mt'), 0);
    await appendMessages(c2.id, LOG('bump c2'), 0); // c2 becomes most recent

    const org = await listConversations(42, 'org');
    expect(org.map((c) => c.id)).toEqual([c2.id, c1.id]);   // updated_at DESC
    expect((await listConversations(42, 'tutorial')).map((c) => c.title)).toEqual(['other-mode']);

    await deleteConversation(c1.id);
    expect(await getConversation(c1.id)).toBeNull();
  });

  it('keyset-paginates newest-first with no gaps or overlaps (id tiebreak on equal timestamps)', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await createConversation({ ownerUserId: 55, mode: 'org', agent: 'WebAnalystAgent', title: `c${i}` });
      await appendMessages(c.id, LOG(`m${i}`), 0);
      ids.push(c.id);
    }

    const page1 = await listConversations(55, 'org', { limit: 2 });
    expect(page1).toHaveLength(2);
    const page2 = await listConversations(55, 'org', { limit: 2, before: { updatedAt: page1[1].updatedAt, id: page1[1].id } });
    expect(page2).toHaveLength(2);
    const page3 = await listConversations(55, 'org', { limit: 2, before: { updatedAt: page2[1].updatedAt, id: page2[1].id } });
    expect(page3).toHaveLength(1);

    const seen = [...page1, ...page2, ...page3].map((c) => c.id);
    expect(new Set(seen).size).toBe(5);                 // no duplicates across pages
    expect([...seen].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b)); // covers all
  });

  it('server-side search matches title OR first message (spans all pages)', async () => {
    const a = await createConversation({ ownerUserId: 56, mode: 'org', agent: 'WebAnalystAgent', title: 'Revenue dashboard' });
    await appendMessages(a.id, LOG('x'), 0);
    const b = await createConversation({ ownerUserId: 56, mode: 'org', agent: 'WebAnalystAgent', title: 'unrelated', meta: { firstMessage: 'show me REVENUE please' } });
    await appendMessages(b.id, LOG('y'), 0);
    const weather = await createConversation({ ownerUserId: 56, mode: 'org', agent: 'WebAnalystAgent', title: 'weather' });
    await appendMessages(weather.id, LOG('z'), 0);

    const res = await listConversations(56, 'org', { search: 'revenue' }); // case-insensitive (ILIKE)
    expect(res.map((r) => r.id).sort((x, y) => x - y)).toEqual([a.id, b.id].sort((x, y) => x - y));
  });

  it('excludes EMPTY conversations (pre-created, never sent a message) from the list', async () => {
    const empty = await createConversation({ ownerUserId: 99, mode: 'org', agent: 'WebAnalystAgent', title: 'New Conversation' });
    const used = await createConversation({ ownerUserId: 99, mode: 'org', agent: 'WebAnalystAgent', title: 'real one' });
    await appendMessages(used.id, LOG('hi'), 0);

    const list = await listConversations(99, 'org');
    expect(list.map((c) => c.id)).toEqual([used.id]); // the empty pre-created row is hidden
    // It still exists + is loadable directly (e.g. the active draft you're composing).
    expect(await getConversation(empty.id)).not.toBeNull();
  });

  it('deleting a conversation removes its messages and errors', async () => {
    const c = await createConversation({ ownerUserId: 7, mode: 'org', agent: 'WebAnalystAgent' });
    await appendMessages(c.id, LOG('hello'), 0);
    await appendError(c.id, { source: 'llm', message: 'boom' });
    expect(await loadMessages(c.id)).not.toHaveLength(0);

    await deleteConversation(c.id);

    expect(await getConversation(c.id)).toBeNull();
    expect(await loadMessages(c.id)).toHaveLength(0);
    expect(await loadErrors(c.id)).toHaveLength(0);
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

  it('error rows live in messages but never leak into the pi log or disturb seq', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await appendMessages(c.id, LOG('t1'), 0);                 // seq 0,1
    await appendError(c.id, { source: 'frontend-tool', message: 'edit failed', parentPiId: 'root1', details: { tool_name: 'EditFile' } });
    await appendMessages(c.id, LOG('t2'), 2);                 // seq 2,3 — NOT pushed by the error row

    // The pi log is exactly the 4 seq-bearing entries; the error is excluded.
    const log = await loadLog(c.id);
    expect(log).toHaveLength(4);
    expect(await getMaxSeq(c.id)).toBe(3);
    expect(JSON.stringify(log)).not.toContain('edit failed');

    // The error is readable via the error stream, with its payload + parent tie intact.
    const errs = await loadErrors(c.id);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ source: 'frontend-tool', message: 'edit failed', parentPiId: 'root1' });
    expect(errs[0].details).toEqual({ tool_name: 'EditFile' });

    // loadMessages (the API/stream view) returns only the seq-bearing rows, not the error.
    const msgs = await loadMessages(c.id);
    expect(msgs.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  it('truncateMessagesFrom rolls back pi rows at/after a seq but keeps error rows', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await appendMessages(c.id, LOG('t1'), 0);   // seq 0,1
    await appendMessages(c.id, LOG('t2'), 2);   // seq 2,3
    await appendError(c.id, { source: 'llm', message: 'boom' });

    const deleted = await truncateMessagesFrom(c.id, 2);  // drop the 2nd turn (seq 2,3)
    expect(deleted).toBe(2);
    expect((await loadLog(c.id)).length).toBe(2);          // only the first turn remains
    expect(await getMaxSeq(c.id)).toBe(1);                 // a replay re-appends from seq 2
    expect(await loadErrors(c.id)).toHaveLength(1);        // the error row survived
  });

  it('auto-retry counter: bump increments, reset zeroes (server-enforced cap state)', async () => {
    const c = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    expect((await getConversation(c.id))?.meta?.autoRetries ?? 0).toBe(0);
    expect(await bumpAutoRetries(c.id)).toBe(1);
    expect(await bumpAutoRetries(c.id)).toBe(2);
    expect((await getConversation(c.id))?.meta?.autoRetries).toBe(2);
    await resetAutoRetries(c.id);
    expect((await getConversation(c.id))?.meta?.autoRetries).toBe(0);
  });
});

// ─── chatQueueFork.test.ts ───

import { configureStore } from '@reduxjs/toolkit';

import chatReducer, {
  addStreamingMessage,
  clearStreamingContent,
  createConversation,
  queueMessage,
  selectConversation,
  updateConversation,
} from '../chatSlice';
import type { RootState } from '../store';

describe('chat queue across temp to real conversation fork', () => {
  it('preserves queued messages added after /explore navigates to the real conversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const tempConversationID = -105;
    const realConversationID = 321;

    store.dispatch(createConversation({
      conversationID: tempConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start from explore',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'NewConversation',
      payload: { name: 'Queued chat regression' },
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'StreamedThinking',
      payload: { chunk: 'thinking...' },
    }));

    store.dispatch(queueMessage({
      conversationID: realConversationID,
      message: 'follow-up queued after navigation',
    }));

    let realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued after navigation');

    store.dispatch(updateConversation({
      conversationID: tempConversationID,
      newConversationID: realConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued after navigation');
  });

  it('preserves queued messages if the UI still dispatches to the temp conversation after the real one exists', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const tempConversationID = -106;
    const realConversationID = 322;

    store.dispatch(createConversation({
      conversationID: tempConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start from explore',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'NewConversation',
      payload: { name: 'Queued chat regression' },
    }));

    store.dispatch(queueMessage({
      conversationID: tempConversationID,
      message: 'follow-up queued on stale temp conversation',
    }));

    const tempConversation = selectConversation(
      store.getState() as RootState,
      tempConversationID
    );
    expect(tempConversation?.queuedMessages).toHaveLength(1);

    store.dispatch(updateConversation({
      conversationID: tempConversationID,
      newConversationID: realConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    const realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.queuedMessages).toHaveLength(1);
    expect(realConversation?.queuedMessages?.[0].message).toBe('follow-up queued on stale temp conversation');
  });

  it('clears ephemeral streamed assistant content when the temp conversation resolves to the real conversation', () => {
    const store = configureStore({
      reducer: {
        chat: chatReducer,
      },
    });
    const tempConversationID = -107;
    const realConversationID = 323;

    store.dispatch(createConversation({
      conversationID: tempConversationID,
      agent: 'MultiToolAgent',
      agent_args: {},
      message: 'start from explore',
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'NewConversation',
      payload: { name: 'Streaming cleanup regression' },
    }));

    store.dispatch(addStreamingMessage({
      conversationID: realConversationID,
      type: 'StreamedContent',
      payload: { chunk: 'stale streamed answer' },
    }));

    let realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.streamedCompletedToolCalls).toHaveLength(1);

    store.dispatch(clearStreamingContent({ conversationID: tempConversationID }));

    store.dispatch(updateConversation({
      conversationID: tempConversationID,
      newConversationID: realConversationID,
      log_index: 1,
      completed_tool_calls: [],
      pending_tool_calls: [],
    }));

    realConversation = selectConversation(
      store.getState() as RootState,
      realConversationID
    );
    expect(realConversation?.streamedCompletedToolCalls).toHaveLength(0);
    expect(realConversation?.streamedThinking).toBe('');
  });
});

// ─── fileAnalytics.test.ts ───

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Override the global jest.setup.ts mock — this suite specifically tests the real DuckDB layer.
jest.unmock('@/lib/analytics/file-analytics.server');

import { trackFileEvent } from '@/lib/analytics/file-analytics.server';
import { getAnalyticsDb, runQuery } from '@/lib/analytics/file-analytics.db';

const TEST_DIR = path.join(os.tmpdir(), `minusx-analytics-test-${process.pid}`);

describe('File Analytics - DuckDB event tracking', () => {
  beforeAll(() => {
    process.env.ANALYTICS_DB_DIR = TEST_DIR;
  });

  afterAll(() => {
    delete process.env.ANALYTICS_DB_DIR;
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('schema initialization', () => {
    it('creates the DuckDB file and file_events table on first access', async () => {
      const db = await getAnalyticsDb();
      expect(db).toBeDefined();

      const rows = await runQuery<{ count: bigint }>(
        db,
        'SELECT COUNT(*) AS count FROM file_events',
        []
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it('returns the same Database instance on repeated calls (pool hit)', async () => {
      const db1 = await getAnalyticsDb();
      const db2 = await getAnalyticsDb();
      expect(db1).toBe(db2);
    });

    it('is idempotent: CREATE TABLE IF NOT EXISTS does not error on re-init', async () => {
      await expect(getAnalyticsDb()).resolves.toBeDefined();
    });
  });

  describe('event types', () => {
    it('tracks a "created" event with all fields populated', async () => {
      await trackFileEvent({
        eventType: 'created',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'created' AND file_id = 10",
        []
      );

      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.event_type).toBe('created');
      expect(r.file_id).toBe(10);
      expect(r.file_type).toBe('question');
      expect(r.file_path).toBe('/org/revenue');
      expect(r.file_name).toBe('Revenue Query');
      expect(r.user_id).toBe(7);
      expect(r.user_email).toBe('alice@example.com');
      expect(r.user_role).toBe('admin');
      expect(r.referenced_by_file_id).toBeNull();
      expect(r.referenced_by_file_type).toBeNull();
      expect(r.timestamp).toBeDefined();
    });

    it('tracks an "updated" event', async () => {
      await trackFileEvent({
        eventType: 'updated',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query (v2)',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'updated' AND file_id = 10",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_name).toBe('Revenue Query (v2)');
    });

    it('tracks a "read_direct" event', async () => {
      await trackFileEvent({
        eventType: 'read_direct',
        fileId: 20,
        fileType: 'dashboard',
        filePath: '/org/sales-dash',
        fileName: 'Sales Dashboard',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'read_direct' AND file_id = 20",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_type).toBe('dashboard');
    });

    it('tracks a "read_as_reference" event with parent file info', async () => {
      await trackFileEvent({
        eventType: 'read_as_reference',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        referencedByFileId: 20,
        referencedByFileType: 'dashboard',
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'read_as_reference' AND file_id = 10",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].referenced_by_file_id).toBe(20);
      expect(rows[0].referenced_by_file_type).toBe('dashboard');
    });

    it('tracks a "deleted" event', async () => {
      await trackFileEvent({
        eventType: 'deleted',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<{ event_type: string }>(
        db,
        "SELECT event_type FROM file_events WHERE file_id = 10 ORDER BY id",
        []
      );
      const types = rows.map(r => r.event_type);
      expect(types).toContain('created');
      expect(types).toContain('updated');
      expect(types).toContain('read_as_reference');
      expect(types).toContain('deleted');
    });
  });

  describe('optional fields', () => {
    it('stores NULL for all optional fields when omitted', async () => {
      await trackFileEvent({
        eventType: 'created',
        fileId: 30,
      });

      const db = await getAnalyticsDb();
      const rows = await runQuery<Record<string, unknown>>(
        db,
        'SELECT * FROM file_events WHERE file_id = 30',
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_type).toBeNull();
      expect(rows[0].file_path).toBeNull();
      expect(rows[0].file_name).toBeNull();
      expect(rows[0].user_id).toBeNull();
      expect(rows[0].user_email).toBeNull();
      expect(rows[0].user_role).toBeNull();
      expect(rows[0].referenced_by_file_id).toBeNull();
      expect(rows[0].referenced_by_file_type).toBeNull();
    });
  });

  describe('aggregate queries', () => {
    it('supports GROUP BY user_email for top-editors ranking', async () => {
      await trackFileEvent({ eventType: 'updated', fileId: 40, userEmail: 'bob@example.com' });
      await trackFileEvent({ eventType: 'updated', fileId: 41, userEmail: 'alice@example.com' });
      await trackFileEvent({ eventType: 'updated', fileId: 42, userEmail: 'alice@example.com' });

      const db = await getAnalyticsDb();
      const rows = await runQuery<{ user_email: string; edit_count: bigint }>(
        db,
        "SELECT user_email, COUNT(*) AS edit_count FROM file_events WHERE event_type = 'updated' AND user_email IS NOT NULL GROUP BY user_email ORDER BY edit_count DESC",
        []
      );

      const alice = rows.find(r => r.user_email === 'alice@example.com');
      const bob = rows.find(r => r.user_email === 'bob@example.com');
      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      expect(Number(alice!.edit_count)).toBeGreaterThan(Number(bob!.edit_count));
    });

    it('supports DATE_TRUNC for time-series sparklines', async () => {
      const db = await getAnalyticsDb();
      const rows = await runQuery<{ day: unknown; events: bigint }>(
        db,
        "SELECT DATE_TRUNC('day', timestamp) AS day, COUNT(*) AS events FROM file_events GROUP BY day ORDER BY day",
        []
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].events)).toBeGreaterThan(0);
    });

    it('supports COUNT DISTINCT user_email for unique viewers', async () => {
      const db = await getAnalyticsDb();
      const rows = await runQuery<{ unique_viewers: bigint }>(
        db,
        "SELECT COUNT(DISTINCT user_email) AS unique_viewers FROM file_events WHERE event_type = 'read_direct'",
        []
      );
      expect(Number(rows[0].unique_viewers)).toBeGreaterThanOrEqual(1);
    });
  });
});

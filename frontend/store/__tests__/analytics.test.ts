/**
 * Analytics E2E Tests
 *
 * Tests the full analytics pipeline:
 * - Write path: events insert rows into file_events / llm_call_events / query_execution_events
 * - Read path: getFileAnalyticsSummary / getConversationAnalytics return correct aggregates
 *
 * Unmocks the analytics module so real DocumentDB inserts are tested.
 */

// Must be before any imports — overrides the global stub in jest.setup.ts
jest.unmock('@/lib/analytics/file-analytics.server');
jest.unmock('@/lib/analytics/file-analytics.db');

import { getTestDbPath } from './test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';

// ---------------------------------------------------------------------------
// DB mock (same as read-write-e2e)
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// ---------------------------------------------------------------------------
// next/headers — return null request-id so fire-and-forget gracefully skips it
// ---------------------------------------------------------------------------

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: () => null }),
}));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function waitForRow(
  table: string,
  condition: string,
  params: unknown[],
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getModules().db.exec<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE ${condition} LIMIT 1`,
      params,
    );
    if (result.rows.length > 0) return result.rows[0];
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`waitForRow: no row found in ${table} WHERE ${condition}`);
}

async function countRows(table: string, condition: string, params: unknown[]): Promise<number> {
  const result = await getModules().db.exec<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM ${table} WHERE ${condition}`,
    params,
  );
  return parseInt(result.rows[0].count, 10);
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('Analytics write + read', () => {
  const { getStore: _getStore } = setupTestDb(getTestDbPath('analytics'));

  // -------------------------------------------------------------------------
  // Write path — insertFileEvent
  // -------------------------------------------------------------------------

  describe('insertFileEvent', () => {
    it('inserts a READ_DIRECT row with correct fields', async () => {
      const { insertFileEvent, FileEventType } = await import('@/lib/analytics/file-analytics.db');

      insertFileEvent({ eventType: FileEventType.READ_DIRECT, fileId: 1, fileVersion: 3, userId: 1 });

      const row = await waitForRow('file_events', 'file_id = $1 AND event_type = $2', [1, FileEventType.READ_DIRECT]);

      expect(row['file_id']).toBe(1);
      expect(Number(row['event_type'])).toBe(FileEventType.READ_DIRECT);
      expect(Number(row['file_version'])).toBe(3);
      expect(Number(row['user_id'])).toBe(1);
    });

    it('inserts a READ_AS_REFERENCE row with referenced_by_file_id', async () => {
      const { insertFileEvent, FileEventType } = await import('@/lib/analytics/file-analytics.db');

      insertFileEvent({
        eventType: FileEventType.READ_AS_REFERENCE,
        fileId: 2,
        fileVersion: 1,
        referencedByFileId: 5,
        userId: 1,
      });

      const row = await waitForRow('file_events', 'file_id = $1 AND event_type = $2', [2, FileEventType.READ_AS_REFERENCE]);

      expect(Number(row['referenced_by_file_id'])).toBe(5);
    });

    it('inserts a CREATED row', async () => {
      const { insertFileEvent, FileEventType } = await import('@/lib/analytics/file-analytics.db');

      insertFileEvent({ eventType: FileEventType.CREATED, fileId: 3, fileVersion: 1, userId: 1 });

      await waitForRow('file_events', 'file_id = $1 AND event_type = $2', [3, FileEventType.CREATED]);
    });
  });

  // -------------------------------------------------------------------------
  // Write path — insertLlmCallEvent
  // -------------------------------------------------------------------------

  describe('insertLlmCallEvent', () => {
    it('inserts an LLM call row with correct fields', async () => {
      const { insertLlmCallEvent } = await import('@/lib/analytics/file-analytics.db');

      insertLlmCallEvent({
        conversationId: 10,
        llmCallId: 'call-abc',
        model: 'claude-3-5-sonnet',
        totalTokens: 500,
        promptTokens: 300,
        completionTokens: 200,
        systemPromptTokens: 100,
        appStateTokens: 80,
        totalToolCalls: 3,
        cost: 0.002,
        durationS: 1.5,
        finishReason: 'stop',
        trigger: 'user_message',
        userId: 1,
      });

      const row = await waitForRow('llm_call_events', 'conversation_id = $1', [10]);

      expect(row['llm_call_id']).toBe('call-abc');
      expect(row['model']).toBe('claude-3-5-sonnet');
      expect(Number(row['total_tokens'])).toBe(500);
      expect(Number(row['system_prompt_tokens'])).toBe(100);
      expect(Number(row['app_state_tokens'])).toBe(80);
      expect(Number(row['total_tool_calls'])).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Write path — insertQueryExecutionEvent
  // -------------------------------------------------------------------------

  describe('insertQueryExecutionEvent', () => {
    it('stores query identity in queries table and metrics in query_execution_events', async () => {
      const { insertQueryExecutionEvent } = await import('@/lib/analytics/file-analytics.db');

      insertQueryExecutionEvent({
        queryHash: 'hash-001',
        query: 'SELECT * FROM orders WHERE id = :id',
        params: { id: 42 },
        schemaContext: [{ schema: 'public', table: 'orders', columns: ['id', 'total'] }],
        connectionName: 'default_db',
        fileId: 42,
        fileVersion: 3,
        durationMs: 120,
        rowCount: 5,
        colCount: 2,
        wasCacheHit: false,
        error: null,
        userId: 1,
      });

      // Query identity stored in queries table
      const qRow = await waitForRow('queries', 'query_hash = $1', ['hash-001']);
      expect(qRow['query']).toBe('SELECT * FROM orders WHERE id = :id');
      expect(qRow['connection_name']).toBe('default_db');
      expect(Number(qRow['file_id'])).toBe(42);
      expect(Number(qRow['file_version'])).toBe(3);
      expect(qRow['schema_context']).not.toBeNull();
      expect(qRow['params']).not.toBeNull();

      // Execution metrics stored in query_execution_events
      const execRow = await waitForRow('query_execution_events', 'query_hash = $1', ['hash-001']);
      expect(Number(execRow['row_count'])).toBe(5);
      expect(Number(execRow['col_count'])).toBe(2);
      expect(execRow['error']).toBeNull();
    });

    it('records error field when query fails', async () => {
      const { insertQueryExecutionEvent } = await import('@/lib/analytics/file-analytics.db');

      insertQueryExecutionEvent({
        queryHash: 'hash-err',
        query: 'SELECT * FROM nonexistent',
        durationMs: 10,
        rowCount: 0,
        colCount: 0,
        wasCacheHit: false,
        error: 'table not found: nonexistent',
        userId: 1,
      });

      // Error on execution row
      const execRow = await waitForRow('query_execution_events', 'query_hash = $1', ['hash-err']);
      expect(execRow['error']).toBe('table not found: nonexistent');

      // Query still registered in queries table (with nulls for missing fields)
      const qRow = await waitForRow('queries', 'query_hash = $1', ['hash-err']);
      expect(qRow['query']).toBe('SELECT * FROM nonexistent');
    });

    it('deduplicates queries by hash — second execution reuses the queries row', async () => {
      const { insertQueryExecutionEvent } = await import('@/lib/analytics/file-analytics.db');
      const HASH = 'hash-dedup';

      insertQueryExecutionEvent({ queryHash: HASH, query: 'SELECT 1', durationMs: 10, rowCount: 1, colCount: 1, wasCacheHit: false, fileId: 10, fileVersion: 1, userId: 1 });
      insertQueryExecutionEvent({ queryHash: HASH, query: 'SELECT 1', durationMs: 20, rowCount: 1, colCount: 1, wasCacheHit: false, fileId: 99, fileVersion: 5, userId: 2 });

      await new Promise(r => setTimeout(r, 200));

      // Only one row in queries (first file_id wins via ON CONFLICT DO NOTHING)
      const qCount = await countRows('queries', 'query_hash = $1', [HASH]);
      expect(qCount).toBe(1);
      const qRow = await waitForRow('queries', 'query_hash = $1', [HASH]);
      expect(Number(qRow['file_id'])).toBe(10);

      // Both executions recorded separately
      const execCount = await countRows('query_execution_events', 'query_hash = $1', [HASH]);
      expect(execCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Read path — getFileAnalyticsSummary
  // -------------------------------------------------------------------------

  describe('getFileAnalyticsSummary', () => {
    it('returns correct aggregates from seeded file_events', async () => {
      const { getFileAnalyticsSummary } = await import('@/lib/analytics/file-analytics.server');
      const { insertFileEvent, FileEventType } = await import('@/lib/analytics/file-analytics.db');
      const FILE_ID = 100;

      // Seed: 1 created, 3 views (2 by user 1, 1 by user 2), 2 edits (both by user 1), 1 reference
      insertFileEvent({ eventType: FileEventType.CREATED,           fileId: FILE_ID, userId: 1 });
      insertFileEvent({ eventType: FileEventType.READ_DIRECT,       fileId: FILE_ID, userId: 1 });
      insertFileEvent({ eventType: FileEventType.READ_DIRECT,       fileId: FILE_ID, userId: 1 });
      insertFileEvent({ eventType: FileEventType.READ_DIRECT,       fileId: FILE_ID, userId: 2 });
      insertFileEvent({ eventType: FileEventType.UPDATED,           fileId: FILE_ID, userId: 1 });
      insertFileEvent({ eventType: FileEventType.UPDATED,           fileId: FILE_ID, userId: 1 });
      insertFileEvent({ eventType: FileEventType.READ_AS_REFERENCE, fileId: FILE_ID, userId: 1, referencedByFileId: 99 });

      // Wait for all inserts to land
      await new Promise(r => setTimeout(r, 200));
      // Verify at least one row exists before checking aggregates
      const rowCount = await countRows('file_events', 'file_id = $1', [FILE_ID]);
      expect(rowCount).toBe(7);

      const summary = await getFileAnalyticsSummary(FILE_ID);

      expect(summary).not.toBeNull();
      expect(summary!.totalViews).toBe(3);
      expect(summary!.uniqueViewers).toBe(2);
      expect(summary!.totalEdits).toBe(2);
      expect(summary!.uniqueEditors).toBe(1);
      expect(summary!.usedByFiles).toBe(1);
      expect(summary!.createdAt).not.toBeNull();
      expect(summary!.lastEditedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Read path — getConversationAnalytics
  // -------------------------------------------------------------------------

  describe('getConversationAnalytics', () => {
    it('returns correct model breakdown from seeded llm_call_events', async () => {
      const { getConversationAnalytics } = await import('@/lib/analytics/file-analytics.server');
      const { insertLlmCallEvent } = await import('@/lib/analytics/file-analytics.db');
      const CONV_ID = 200;

      insertLlmCallEvent({ conversationId: CONV_ID, model: 'claude-sonnet', totalTokens: 400, promptTokens: 300, completionTokens: 100, cost: 0.001, durationS: 1, userId: 1 });
      insertLlmCallEvent({ conversationId: CONV_ID, model: 'claude-sonnet', totalTokens: 600, promptTokens: 400, completionTokens: 200, cost: 0.002, durationS: 2, userId: 1 });
      insertLlmCallEvent({ conversationId: CONV_ID, model: 'claude-opus',   totalTokens: 800, promptTokens: 500, completionTokens: 300, cost: 0.010, durationS: 3, userId: 1 });

      await new Promise(r => setTimeout(r, 200));

      const analytics = await getConversationAnalytics(CONV_ID);

      expect(analytics).not.toBeNull();
      expect(analytics!.totalCalls).toBe(3);
      expect(analytics!.totalTokens).toBe(1800);
      expect(analytics!.byModel['claude-sonnet'].calls).toBe(2);
      expect(analytics!.byModel['claude-sonnet'].tokens).toBe(1000);
      expect(analytics!.byModel['claude-opus'].calls).toBe(1);
    });

    it('returns null when no LLM events exist for conversation', async () => {
      const { getConversationAnalytics } = await import('@/lib/analytics/file-analytics.server');
      const result = await getConversationAnalytics(99999);
      expect(result).toBeNull();
    });
  });
});

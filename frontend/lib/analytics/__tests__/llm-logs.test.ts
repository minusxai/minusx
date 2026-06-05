// Storage-layer coverage for the local LLM debug logs (llm_logs): the
// write-request-then-fill-response flow, order-independent upsert, the error
// column, read-back, and the date-scoped clear (Settings → Data Management).
// End-to-end capture against the real chat is covered by the QA chat flows.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi } from 'vitest';
import { getLlmLog, clearLlmLogsBefore, recordLlmRequest, recordLlmResponse } from '@/lib/analytics/file-analytics.db';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('llm_logs');

async function insertLog(callId: string, createdAt: string): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_logs (call_id, user_id, provider, model, request_json, response_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [callId, 1, 'anthropic', 'claude-haiku-4-5-20251001', `{"req":"${callId}"}`, `{"resp":"${callId}"}`, createdAt],
  );
}

describe('llm_logs storage', () => {
  setupTestDb(TEST_DB_PATH);

  it('reads back a stored log by call id', async () => {
    await insertLog('c-read', '2026-01-01T00:00:00.000Z');
    const log = await getLlmLog('c-read');
    expect(log).not.toBeNull();
    expect(log?.call_id).toBe('c-read');
    expect(log?.provider).toBe('anthropic');
    expect(log?.request_json).toBe('{"req":"c-read"}');
    expect(log?.response_json).toBe('{"resp":"c-read"}');
  });

  it('returns null for an unknown call id', async () => {
    expect(await getLlmLog('does-not-exist')).toBeNull();
  });

  it('writes the request first, then fills in the response (the production flow)', async () => {
    await recordLlmRequest('c-flow', '{"request":1}');
    let log = await getLlmLog('c-flow');
    expect(log?.request_json).toBe('{"request":1}');
    expect(log?.response_json).toBeNull();

    await recordLlmResponse({
      callId: 'c-flow', userId: 7, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      responseJson: '{"response":2}', error: null,
    });
    log = await getLlmLog('c-flow');
    expect(log?.request_json).toBe('{"request":1}');   // preserved
    expect(log?.response_json).toBe('{"response":2}');
    expect(log?.provider).toBe('anthropic');
  });

  it('is order-independent: response upsert before the request still merges', async () => {
    await recordLlmResponse({ callId: 'c-race', responseJson: '{"r":1}', error: null });
    await recordLlmRequest('c-race', '{"q":1}');
    const log = await getLlmLog('c-race');
    expect(log?.request_json).toBe('{"q":1}');
    expect(log?.response_json).toBe('{"r":1}');
  });

  it('records the error column for a failed call', async () => {
    await recordLlmRequest('c-err', '{"q":1}');
    await recordLlmResponse({ callId: 'c-err', responseJson: '{"stopReason":"error"}', error: 'boom' });
    const log = await getLlmLog('c-err');
    expect(log?.error).toBe('boom');
    expect(log?.request_json).toBe('{"q":1}');
  });

  it('clearLlmLogsBefore deletes only logs strictly older than the cutoff', async () => {
    await insertLog('c-old', '2020-01-01T00:00:00.000Z');
    await insertLog('c-new', '2030-01-01T00:00:00.000Z');

    const removed = await clearLlmLogsBefore(new Date('2025-01-01T00:00:00.000Z'));
    expect(removed).toBe(1);

    expect(await getLlmLog('c-old')).toBeNull();
    expect(await getLlmLog('c-new')).not.toBeNull();
  });
});

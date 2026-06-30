/**
 * The agent's production ExecuteQuery shares the durable query cache with
 * /api/query (arch doc §5): a second identical execution is served from the
 * cached blob WITHOUT re-running the connector.
 */
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

const { mockRunQuery } = vi.hoisted(() => ({ mockRunQuery: vi.fn() }));
vi.mock('@/lib/connections/run-query', () => ({ runQuery: mockRunQuery }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { ExecuteQuery } from '../db-tools.server';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const ctx = {
  userId: 'u', mode: 'org',
  effectiveUser: { userId: 1, email: 't@t.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org' },
} as unknown as RemoteAnalystContext;

async function runQueryTool(query: string) {
  const tool = new ExecuteQuery(new Orchestrator([]), { connectionId: 'main', query }, ctx);
  return tool.run();
}

describe('Agent ExecuteQuery — shared durable cache', () => {
  setupTestDb(getTestDbPath('agent_execute_cache'));
  beforeEach(async () => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue({ columns: ['n'], types: ['INTEGER'], rows: [{ n: 1 }], finalQuery: 'SELECT 1' });
    // Start each test with an empty cache (rows persist across tests otherwise).
    const { getModules } = await import('@/lib/modules/registry');
    await getModules().db.exec('DELETE FROM query_cache');
  });

  it('serves the second identical agent query from cache (connector runs once)', async () => {
    const r1 = await runQueryTool('SELECT 1');
    expect(r1.isError).toBe(false);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    const r2 = await runQueryTool('SELECT 1');
    expect(r2.isError).toBe(false);
    expect(mockRunQuery).toHaveBeenCalledTimes(1); // cache hit — NOT re-executed
  });

  it('a different query is a separate cache key (connector runs again)', async () => {
    await runQueryTool('SELECT 1');
    await runQueryTool('SELECT 2');
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
  });
});

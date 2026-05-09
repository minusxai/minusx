// buildBenchmarkSources — extracted from setupBenchmarkSources so a v=2
// chat continuation can wire NodeConnector-backed executors per
// conversation (via the agent context) instead of clobbering the global
// SchemaSource/SqlExecutor singletons.

import { describe, it, expect } from 'vitest';
import { buildBenchmarkSources } from '@/agents/benchmark-analyst/connection-source';
import type { NodeConnector } from '@/lib/connections/base';

function fakeConnector(): NodeConnector {
  return {
    async getSchema() {
      return [
        {
          schema: 'main',
          tables: [
            { table: 'orders', columns: [{ name: 'id', type: 'integer' }, { name: 'amount', type: 'numeric' }] },
          ],
        },
      ];
    },
    async query(sql: string) {
      return { rows: [{ sql, ok: true }] };
    },
  } as unknown as NodeConnector;
}

describe('buildBenchmarkSources', () => {
  it('returns a SqlExecutor that runs against the named connector', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const allowed = new Set(['default_duckdb']);
    const { sqlExecutor } = buildBenchmarkSources(connectors, allowed);

    const result = await sqlExecutor.execute('select 1', 'default_duckdb');
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([{ sql: 'select 1', ok: true }]);
  });

  it('returns an error from SqlExecutor when the connection is not in the allowlist', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const allowed = new Set(['default_duckdb']);
    const { sqlExecutor } = buildBenchmarkSources(connectors, allowed);

    const result = await sqlExecutor.execute('select 1', 'other_db');
    expect(result.error).toMatch(/not in this agent's connections/);
  });

  it('returns an error from SqlExecutor when the connector is not loaded (env missing)', async () => {
    // Connection is allowed but the env didn't supply a connector for it.
    const { sqlExecutor } = buildBenchmarkSources(new Map(), new Set(['default_duckdb']));
    const result = await sqlExecutor.execute('select 1', 'default_duckdb');
    expect(result.error).toMatch(/not loaded/);
  });

  it('returns a SchemaSource that filters tables by query keyword', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const { schemaSource } = buildBenchmarkSources(connectors, new Set(['default_duckdb']));

    const hits = await schemaSource.search('order', 'default_duckdb');
    expect(hits).toHaveLength(1);
    expect(hits[0].table).toBe('orders');
  });
});

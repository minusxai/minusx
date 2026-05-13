// buildBenchmarkSources — extracted from setupBenchmarkSources so a v=2
// chat continuation can wire NodeConnector-backed executors per
// conversation (via the agent context) instead of clobbering the global
// SchemaSource/SqlExecutor singletons.

import { describe, it, expect } from 'vitest';
import { buildBenchmarkSources } from '@/agents/benchmark-analyst/connection-source';
import { DEFAULT_LIMIT } from '@/lib/sql/limit-enforcer';
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
    const dialects = new Map<string, string>([['default_duckdb', 'duckdb']]);
    const allowed = new Set(['default_duckdb']);
    const { sqlExecutor } = buildBenchmarkSources(connectors, dialects, allowed);

    const result = await sqlExecutor.execute('SELECT * FROM orders', 'default_duckdb');
    expect(result.error).toBeUndefined();
    // The executor caps results via enforceQueryLimit's default row limit.
    const echoed = (result.rows[0] as { sql: string }).sql.toUpperCase();
    expect(echoed).toContain(`LIMIT ${DEFAULT_LIMIT}`);
  });

  it('returns an error from SqlExecutor when the connection is not in the allowlist', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const dialects = new Map<string, string>([['default_duckdb', 'duckdb']]);
    const allowed = new Set(['default_duckdb']);
    const { sqlExecutor } = buildBenchmarkSources(connectors, dialects, allowed);

    const result = await sqlExecutor.execute('select 1', 'other_db');
    expect(result.error).toMatch(/not in this agent's connections/);
  });

  it('returns an error from SqlExecutor when the connector is not loaded (env missing)', async () => {
    // Connection is allowed but the env didn't supply a connector for it.
    const { sqlExecutor } = buildBenchmarkSources(new Map(), new Map(), new Set(['default_duckdb']));
    const result = await sqlExecutor.execute('select 1', 'default_duckdb');
    expect(result.error).toMatch(/not loaded/);
  });

  it('returns a SchemaSource that provides raw schemas', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const dialects = new Map<string, string>([['default_duckdb', 'duckdb']]);
    const { schemaSource } = buildBenchmarkSources(connectors, dialects, new Set(['default_duckdb']));

    const schemas = await schemaSource.getSchema('default_duckdb');
    expect(schemas).toHaveLength(1);
    expect(schemas[0].schema).toBe('main');
    expect(schemas[0].tables).toHaveLength(1);
    expect(schemas[0].tables[0].table).toBe('orders');
  });

});

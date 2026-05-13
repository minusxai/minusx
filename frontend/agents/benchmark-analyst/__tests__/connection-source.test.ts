// buildBenchmarkSources — extracted from setupBenchmarkSources so a v=2
// chat continuation can wire NodeConnector-backed executors per
// conversation (via the agent context) instead of clobbering the global
// SchemaSource/SqlExecutor singletons.

import { describe, it, expect } from 'vitest';
import {
  appendLimitIfMissing,
  buildBenchmarkSources,
  BENCHMARK_MAX_ROWS,
} from '@/agents/benchmark-analyst/connection-source';
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
    // The executor appends `LIMIT 100` (BENCHMARK_MAX_ROWS) to bound results.
    expect(result.rows).toEqual([{ sql: 'select 1 LIMIT 100', ok: true }]);
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

  it('returns a SchemaSource that provides raw schemas', async () => {
    const connectors = new Map<string, NodeConnector>([['default_duckdb', fakeConnector()]]);
    const { schemaSource } = buildBenchmarkSources(connectors, new Set(['default_duckdb']));

    const schemas = await schemaSource.getSchema('default_duckdb');
    expect(schemas).toHaveLength(1);
    expect(schemas[0].schema).toBe('main');
    expect(schemas[0].tables).toHaveLength(1);
    expect(schemas[0].tables[0].table).toBe('orders');
  });
});

describe('appendLimitIfMissing', () => {
  it('appends LIMIT when the SQL has no LIMIT clause', () => {
    expect(appendLimitIfMissing('select * from t', 100)).toBe('select * from t LIMIT 100');
  });

  it('strips a single trailing semicolon before appending', () => {
    expect(appendLimitIfMissing('select * from t;', 100)).toBe('select * from t LIMIT 100');
  });

  it('leaves the SQL alone when LIMIT is already present (case-insensitive)', () => {
    expect(appendLimitIfMissing('SELECT * FROM t LIMIT 5', 100)).toBe('SELECT * FROM t LIMIT 5');
    expect(appendLimitIfMissing('select * from t limit 200', 100)).toBe('select * from t limit 200');
  });

  it('caps SqlExecutor results to BENCHMARK_MAX_ROWS even when the connector returns more', async () => {
    const tooManyRows = Array.from({ length: BENCHMARK_MAX_ROWS + 50 }, (_, i) => ({ i }));
    const conn: NodeConnector = {
      async getSchema() { return []; },
      async query() { return { rows: tooManyRows }; },
    } as unknown as NodeConnector;
    const connectors = new Map<string, NodeConnector>([['db', conn]]);
    const { sqlExecutor } = buildBenchmarkSources(connectors, new Set(['db']));
    const result = await sqlExecutor.execute('select * from t', 'db');
    expect(result.rows).toHaveLength(BENCHMARK_MAX_ROWS);
    expect(result.error).toBeUndefined();
  });
});

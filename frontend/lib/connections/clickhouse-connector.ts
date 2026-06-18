import 'server-only';
import type { QueryResult, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { getOrCreateClickHouseClient } from './clickhouse-registry';

// ClickHouse exposes a parameterised-query syntax `{name:Type}` paired with a
// `query_params` map (see `namedToClickHouse`). The type annotation is required,
// so we infer it from the JS value.
function inferClickHouseType(value: string | number): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int64' : 'Float64';
  return 'String';
}

/**
 * Rewrite `:name` placeholders into ClickHouse `{name:Type}` form and collect
 * the `query_params` map. A placeholder whose value is absent or null is
 * inlined as the literal `NULL` (the parameter system strips None-valued
 * filters upstream, so a surviving `:name` with no value means "no value").
 *
 * `(?<!:)` negative lookbehind: the second `:` of a `::Type` cast
 * (`'2021'::Date`, which ClickHouse supports) is not a placeholder.
 */
function namedToClickHouse(
  sql: string,
  params?: Record<string, string | number>,
): { sql: string; query_params: Record<string, unknown> } {
  const query_params: Record<string, unknown> = {};
  const out = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    const value = params?.[key];
    if (value == null) return 'NULL';
    query_params[key] = value;
    return `{${key}:${inferClickHouseType(value)}}`;
  });
  return { sql: out, query_params };
}

// `system.columns` always spans every database regardless of the connection's
// default database — the client cannot scope it for us. So we filter here:
// when a `database` is configured we restrict to it; otherwise we list all
// non-system databases.
const ALL_DATABASES_SQL = `
  SELECT database, table, name, type
  FROM system.columns
  WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
  ORDER BY database, table, position
`;
const SINGLE_DATABASE_SQL = `
  SELECT database, table, name, type
  FROM system.columns
  WHERE database = {db:String}
  ORDER BY table, position
`;

export class ClickHouseConnector extends NodeConnectorBase {
  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      const client = getOrCreateClickHouseClient(this.config);
      // A real query validates reachability AND credentials. `client.ping()`
      // hits the unauthenticated /ping endpoint, so it would pass even with
      // bad credentials — use SELECT 1 instead.
      const rs = await client.query({ query: 'SELECT 1', format: 'JSON' });
      await rs.json();
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message ?? String(err) };
    }
  }

  async query(
    sql: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    const client = getOrCreateClickHouseClient(this.config);
    const { sql: chSql, query_params } = namedToClickHouse(sql, params);
    const finalQuery = inlineSqlParams(sql, params);

    const resultSet = await client.query({
      query: chSql,
      format: 'JSON',
      query_params,
      ...(timeoutMs
        ? { clickhouse_settings: { max_execution_time: Math.ceil(timeoutMs / 1000) } }
        : {}),
    });

    const json = (await resultSet.json()) as {
      meta?: Array<{ name: string; type: string }>;
      data?: Record<string, unknown>[];
    };
    const meta = json.meta ?? [];
    return {
      columns: meta.map((m) => m.name),
      types: meta.map((m) => m.type),
      rows: json.data ?? [],
      finalQuery,
    };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const client = getOrCreateClickHouseClient(this.config);
    const database = (this.config.database ?? '').trim();
    const resultSet = await client.query(
      database
        ? { query: SINGLE_DATABASE_SQL, format: 'JSON', query_params: { db: database } }
        : { query: ALL_DATABASES_SQL, format: 'JSON' },
    );
    const json = (await resultSet.json()) as {
      data?: Array<{ database: string; table: string; name: string; type: string }>;
    };
    const rows = json.data ?? [];

    // database → table → columns
    const schemaMap = new Map<string, Map<string, Array<{ name: string; type: string }>>>();
    for (const row of rows) {
      if (!schemaMap.has(row.database)) schemaMap.set(row.database, new Map());
      const tableMap = schemaMap.get(row.database)!;
      if (!tableMap.has(row.table)) tableMap.set(row.table, []);
      tableMap.get(row.table)!.push({ name: row.name, type: row.type });
    }

    // No secondary-index concept in ClickHouse → leave indexes undefined.
    return Array.from(schemaMap.entries()).map(([schema, tableMap]) => ({
      schema,
      tables: Array.from(tableMap.entries()).map(([table, columns]) => ({ table, columns })),
    }));
  }
}

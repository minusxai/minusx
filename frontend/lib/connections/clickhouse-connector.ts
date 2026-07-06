import 'server-only';
import type { QueryResult, QueryStream, SchemaEntry } from './base';
import { NodeConnector as NodeConnectorBase, groupColumnsIntoSchemaEntries } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { getOrCreateClickHouseClient } from './clickhouse-registry';
import { rewriteNamedParams } from './named-to-positional';

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
 * Matching grammar (incl. the `::Type` cast lookbehind) lives in the shared
 * `rewriteNamedParams` — this only supplies ClickHouse's own replacement form.
 */
function namedToClickHouse(
  sql: string,
  params?: Record<string, string | number>,
): { sql: string; query_params: Record<string, unknown> } {
  const query_params: Record<string, unknown> = {};
  const out = rewriteNamedParams(sql, params, (key, value) => {
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
  protected async ping(): Promise<void> {
    const client = getOrCreateClickHouseClient(this.config);
    // A real query validates reachability AND credentials. `client.ping()`
    // hits the unauthenticated /ping endpoint, so it would pass even with
    // bad credentials — use SELECT 1 instead.
    const rs = await client.query({ query: 'SELECT 1', format: 'JSON' });
    await rs.json();
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

  /**
   * Streaming variant — uses the JSONCompactEachRowWithNamesAndTypes format so
   * the server streams rows as ClickHouse produces them. The first two streamed
   * rows are the column NAMES then TYPES (preserving the typed metadata); the
   * rest are value arrays zipped back into row objects.
   */
  override async queryStream(
    sql: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryStream> {
    const client = getOrCreateClickHouseClient(this.config);
    const { sql: chSql, query_params } = namedToClickHouse(sql, params);
    const finalQuery = inlineSqlParams(sql, params);

    const resultSet = await client.query({
      query: chSql,
      format: 'JSONCompactEachRowWithNamesAndTypes',
      query_params,
      ...(timeoutMs ? { clickhouse_settings: { max_execution_time: Math.ceil(timeoutMs / 1000) } } : {}),
    });

    // Flatten the stream's batches into a single row iterator (each row is a value array).
    const stream = resultSet.stream();
    async function* flatten(): AsyncGenerator<unknown[]> {
      for await (const batch of stream as AsyncIterable<Array<{ json: () => unknown }>>) {
        for (const row of batch) yield row.json() as unknown[];
      }
    }
    const it = flatten();
    const names = (await it.next()).value as string[] | undefined;
    const typesRow = (await it.next()).value as string[] | undefined;
    const columns = names ?? [];
    const types = typesRow ?? [];

    async function* rows(): AsyncGenerator<Record<string, unknown>> {
      for await (const arr of it) {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) obj[columns[i]] = arr[i];
        yield obj;
      }
    }

    return { columns, types, finalQuery, rows: rows() };
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

    // database → table → columns. No secondary-index concept in ClickHouse
    // → leave indexes undefined.
    return groupColumnsIntoSchemaEntries(rows, {
      schema: (row) => row.database,
      table: (row) => row.table,
      columns: (row) => [{ name: row.name, type: row.type }],
    });
  }
}

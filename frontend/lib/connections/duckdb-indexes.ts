import 'server-only';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { TableIndex } from './base';

/**
 * Introspect indexes via DuckDB's `duckdb_indexes()` catalog function.
 * Works for natively-opened DuckDB files AND for SQLite databases attached
 * through DuckDB's sqlite extension — SQLite's own indexes surface here
 * (verified against a real attached READ_ONLY SQLite db).
 *
 * Returns a Map keyed by `schema.table` → `TableIndex[]`. `databaseName`
 * filters to one attached catalog when provided (e.g. `'db'` for the
 * sqlite-via-duckdb connector, the connection name for the benchmark
 * shared instance); omit it for a directly-opened DuckDB file.
 *
 * `duckdb_indexes().expressions` is a bracketed, comma-joined string like
 * `[country, filing_date]`; parsed back into an ordered column list. A
 * purely-expression index parses to whatever text duckdb emits — fine,
 * the agent still sees the index exists and on roughly what.
 */
export async function collectDuckDbIndexes(
  conn: DuckDBConnection,
  databaseName?: string,
): Promise<Map<string, TableIndex[]>> {
  const where = databaseName
    ? `WHERE database_name = '${databaseName.replace(/'/g, "''")}'`
    : '';
  const result = await conn.run(
    `SELECT schema_name, table_name, index_name, is_unique, expressions
     FROM duckdb_indexes() ${where}`,
  );
  const rows = (await result.getRowObjectsJS()) as Array<{
    schema_name: string;
    table_name: string;
    index_name: string;
    is_unique: boolean;
    expressions: string;
  }>;

  const out = new Map<string, TableIndex[]>();
  for (const row of rows) {
    const columns = String(row.expressions ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const key = `${row.schema_name}.${row.table_name}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({
      name: row.index_name,
      columns,
      unique: !!row.is_unique,
    });
  }
  return out;
}

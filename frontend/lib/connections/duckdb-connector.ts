import 'server-only';
import * as path from 'path';
import * as fs from 'fs';
import { BASE_DUCKDB_DATA_PATH } from '@/lib/config';
import { NodeConnector, SchemaEntry, QueryResult, QueryStream } from './base';
import { withDuckDbConnection, getOrCreateDuckDbInstance } from './duckdb-registry';
import { collectDuckDbIndexes } from './duckdb-indexes';
import { runDuckDbWithTimeout } from './duckdb-query';
import { duckDbStreamFromConn } from './duckdb-stream';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { namedToPositional } from './named-to-positional';

const SKIP_SCHEMAS = immutableSet(['system', 'temp']);

// Make rows JSON-safe: JSON.stringify handles Date→ISO natively; BigInt needs an
// explicit replacer (it throws otherwise).
function makeJsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(rows, (_, v) => {
    if (typeof v === 'bigint') {
      return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(v) : v.toString();
    }
    return v;
  }));
}

/**
 * Resolve a DuckDB file path to an absolute path.
 * Resolves a DuckDB file path against BASE_DUCKDB_DATA_PATH.
 *
 * - Absolute paths are used as-is.
 * - Prod Docker path (/app/...) is remapped to BASE_DUCKDB_DATA_PATH when /app doesn't exist.
 * - Relative paths are prepended with BASE_DUCKDB_DATA_PATH (default: '..').
 */
export function resolveDuckDbFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    if (filePath.startsWith('/app') && !fs.existsSync('/app')) {
      const base = BASE_DUCKDB_DATA_PATH;
      return path.resolve(filePath.replace('/app', base));
    }
    return filePath;
  }
  const base = BASE_DUCKDB_DATA_PATH;
  return path.resolve(base, filePath);
}

/**
 * Node.js DuckDB connector.
 * Uses the shared duckdb-registry to ensure a single DuckDBInstance per file,
 * preventing exclusive-lock conflicts when multiple callers reference the same DB.
 */
export class DuckDbConnector extends NodeConnector {
  private readonly absPath: string;

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    this.absPath = resolveDuckDbFilePath(config.file_path);
  }

  protected async ping(): Promise<void> {
    if (!fs.existsSync(this.absPath)) {
      throw new Error(`File not found: ${this.absPath}`);
    }
    await withDuckDbConnection(this.absPath, 'READ_ONLY', async (conn) => {
      await conn.run('SELECT 1');
    });
  }

  async query(
    sql: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    return withDuckDbConnection(this.absPath, 'READ_ONLY', async (conn) => {
      // Replace named params (:name) with positional $1, $2, ... (DuckDB
      // prepared-statement syntax). The shared helper's negative-lookbehind
      // protects `::cast` operators (DuckDB supports PostgreSQL casts).
      const { sql: positionalSql, values: paramValues } = namedToPositional(sql, params);

      const finalQuery = inlineSqlParams(sql, params);

      const result = await runDuckDbWithTimeout(conn, positionalSql, timeoutMs, paramValues);
      const colCount = result.columnCount;
      const columns: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < colCount; i++) {
        columns.push(result.columnName(i));
        types.push(result.columnType(i).toString());
      }
      const rawRows = await result.getRowObjectsJS() as Record<string, unknown>[];
      const rows = makeJsonSafe(rawRows);
      return { columns, types, rows, finalQuery };
    });
  }

  /**
   * Streaming variant — reads the result chunk-by-chunk via `conn.stream()` and
   * yields rows as DuckDB produces them, so the server never holds the whole
   * result. The connection is held open across the (lazy) iteration and closed
   * in the generator's `finally`. Per-chunk `convertRows(JSDuckDBValueConverter)`
   * gives the SAME JS values as the materialized `getRowObjectsJS()`.
   */
  override async queryStream(
    sql: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryStream> {
    const instance = await getOrCreateDuckDbInstance(this.absPath, 'READ_ONLY');
    const conn = await instance.connect();
    const { sql: positionalSql, values } = namedToPositional(sql, params);
    return duckDbStreamFromConn({
      conn, positionalSql, values, finalQuery: inlineSqlParams(sql, params), timeoutMs,
      onClose: () => conn.closeSync(),
    });
  }

  async getSchema(): Promise<SchemaEntry[]> {
    return withDuckDbConnection(this.absPath, 'READ_ONLY', async (conn) => {
      const result = await conn.run(`
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        ORDER BY table_schema, table_name, ordinal_position
      `);
      const rows = await result.getRowObjectsJS() as Array<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
      }>;

      const schemaMap = new Map<string, Map<string, Array<{ name: string; type: string }>>>();

      for (const row of rows) {
        let schemaName = row.table_schema;
        // Handle "database.schema" prefixed names
        if (schemaName.includes('.')) {
          const [prefix, suffix] = schemaName.split('.', 2);
          if (SKIP_SCHEMAS.has(prefix)) continue;
          schemaName = suffix;
        } else {
          if (SKIP_SCHEMAS.has(schemaName)) continue;
        }

        if (!schemaMap.has(schemaName)) schemaMap.set(schemaName, new Map());
        const tableMap = schemaMap.get(schemaName)!;
        if (!tableMap.has(row.table_name)) tableMap.set(row.table_name, []);
        tableMap.get(row.table_name)!.push({ name: row.column_name, type: row.data_type });
      }

      // No `databaseName` filter — a directly-opened DuckDB file has just
      // its own catalog plus `system`/`temp` (which carry no user indexes).
      // `duckdb_indexes().schema_name` is the bare schema (`main`), matching
      // the `schemaName` computed above.
      const indexMap = await collectDuckDbIndexes(conn);

      return Array.from(schemaMap.entries()).map(([schema, tables]) => ({
        schema,
        tables: Array.from(tables.entries()).map(([table, columns]) => ({
          table,
          columns,
          indexes: indexMap.get(`${schema}.${table}`) ?? [],
        })),
      }));
    });
  }
}

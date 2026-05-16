import 'server-only';
import * as fs from 'fs';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';
import { resolveDuckDbFilePath } from './duckdb-connector';
import { withSqliteViaDuckdbConnection } from './sqlite-via-duckdb-registry';
import { collectDuckDbIndexes } from './duckdb-indexes';
import { runDuckDbWithTimeout } from './duckdb-query';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { namedToPositional } from './named-to-positional';

const SKIP_SCHEMAS = immutableSet(['information_schema', 'pg_catalog']);

// Make rows JSON-safe: JSON.stringify handles Date natively; BigInt needs
// an explicit replacer. Same shape as the DuckDB connector.
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
 * SQLite connector. Routes queries through DuckDB's `sqlite_scanner`
 * extension instead of better-sqlite3, so SQLite I/O lands on DuckDB's
 * worker threads and stops blocking the Node event loop. This was the
 * dominant cause of multi-row benchmark slowdowns (sibling rows'
 * synchronous `stmt.all()` calls were starving DuckDB callbacks on the
 * JS thread, producing 270-625× wall-clock blow-up vs direct DB time).
 *
 * SQL dialect is now DuckDB (Postgres-flavoured). Column types reflect
 * that: INTEGER → BIGINT, TEXT → VARCHAR, REAL → DOUBLE.
 */
export class SqliteConnector extends NodeConnector {
  private readonly absPath: string;

  constructor(name: string, config: Record<string, any>) {
    super(name, config);
    this.absPath = resolveDuckDbFilePath(config.file_path);
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    if (!fs.existsSync(this.absPath)) {
      return { success: false, message: `File not found: ${this.absPath}` };
    }
    try {
      await withSqliteViaDuckdbConnection(this.absPath, async (conn) => {
        await conn.run('SELECT 1');
      });
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async query(
    sql: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    return withSqliteViaDuckdbConnection(this.absPath, async (conn) => {
      // Replace named params (:name) with positional $N (DuckDB syntax).
      // The shared helper's negative-lookbehind protects `::cast` operators.
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

  async getSchema(): Promise<SchemaEntry[]> {
    return withSqliteViaDuckdbConnection(this.absPath, async (conn) => {
      const result = await conn.run(`
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_catalog = 'db'
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
        if (SKIP_SCHEMAS.has(row.table_schema)) continue;
        if (!schemaMap.has(row.table_schema)) schemaMap.set(row.table_schema, new Map());
        const tableMap = schemaMap.get(row.table_schema)!;
        if (!tableMap.has(row.table_name)) tableMap.set(row.table_name, []);
        tableMap.get(row.table_name)!.push({ name: row.column_name, type: row.data_type });
      }

      // SQLite's own indexes surface through DuckDB's `duckdb_indexes()` on
      // the attached catalog (alias `db`, matching the columns query above).
      const indexMap = await collectDuckDbIndexes(conn, 'db');

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

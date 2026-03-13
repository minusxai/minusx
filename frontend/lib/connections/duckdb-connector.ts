import 'server-only';
import * as path from 'path';
import * as fs from 'fs';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';
import { getOrCreateDuckDbInstance } from './duckdb-registry';

const SKIP_SCHEMAS = new Set(['system', 'temp']);

// Make rows JSON-safe: JSON.stringify handles Date→ISO string natively;
// BigInt needs an explicit replacer since it throws otherwise.
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
 * Mirrors Python's backend/config.py:resolve_duckdb_path().
 *
 * - Absolute paths are used as-is.
 * - Prod Docker path (/app/...) is remapped to BASE_DUCKDB_DATA_PATH when /app doesn't exist.
 * - Relative paths are prepended with BASE_DUCKDB_DATA_PATH (default: '..').
 */
export function resolveDuckDbFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    if (filePath.startsWith('/app') && !fs.existsSync('/app')) {
      const base = process.env.BASE_DUCKDB_DATA_PATH || '..';
      return path.resolve(filePath.replace('/app', base));
    }
    return filePath;
  }
  const base = process.env.BASE_DUCKDB_DATA_PATH || '..';
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

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    if (!fs.existsSync(this.absPath)) {
      return { success: false, message: `File not found: ${this.absPath}` };
    }
    try {
      const instance = await getOrCreateDuckDbInstance(this.absPath, 'READ_ONLY');
      const conn = await instance.connect();
      try {
        await conn.run('SELECT 1');
      } finally {
        conn.closeSync();
      }
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async query(sql: string, params?: Record<string, string | number>): Promise<QueryResult> {
    const instance = await getOrCreateDuckDbInstance(this.absPath, 'READ_ONLY');
    const conn = await instance.connect();
    try {
      // Replace named params (:name) with positional $1, $2, ... (DuckDB syntax)
      const paramValues: unknown[] = [];
      const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
        paramValues.push(params?.[key] ?? null);
        return `$${paramValues.length}`;
      });

      const result = await conn.run(positionalSql, paramValues as never);
      const colCount = result.columnCount;
      const columns: string[] = [];
      const types: string[] = [];
      for (let i = 0; i < colCount; i++) {
        columns.push(result.columnName(i));
        types.push(result.columnType(i).toString());
      }
      const rawRows = await result.getRowObjectsJS() as Record<string, unknown>[];
      const rows = makeJsonSafe(rawRows);
      return { columns, types, rows };
    } finally {
      conn.closeSync();
    }
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const instance = await getOrCreateDuckDbInstance(this.absPath, 'READ_ONLY');
    const conn = await instance.connect();
    try {
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
        // Handle "database.schema" prefixed names (same as Python DuckDBConnector)
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

      return Array.from(schemaMap.entries()).map(([schema, tables]) => ({
        schema,
        tables: Array.from(tables.entries()).map(([table, columns]) => ({ table, columns })),
      }));
    } finally {
      conn.closeSync();
    }
  }
}

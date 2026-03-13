import 'server-only';
import * as path from 'path';
import * as fs from 'fs';
import { DuckDBTypeId } from '@duckdb/node-api';
import { NodeConnector, SchemaEntry, QueryResult, TestConnectionResult } from './base';
import { getOrCreateDuckDbInstance } from './duckdb-registry';

const SKIP_SCHEMAS = new Set(['system', 'temp']);

// JSON can't serialize BigInt — convert to number (safe for typical analytics IDs/counts).
// Values exceeding Number.MAX_SAFE_INTEGER are stringified to preserve precision.
function serializeValue(v: unknown): unknown {
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v !== null && typeof v === 'object') return serializeRow(v as Record<string, unknown>);
  return v;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in row) out[k] = serializeValue(row[k]);
  return out;
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

function duckDbTypeIdToString(typeId: number): string {
  switch (typeId) {
    case DuckDBTypeId.BIGINT:       return 'BIGINT';
    case DuckDBTypeId.INTEGER:      return 'INTEGER';
    case DuckDBTypeId.SMALLINT:     return 'SMALLINT';
    case DuckDBTypeId.TINYINT:      return 'TINYINT';
    case DuckDBTypeId.UBIGINT:      return 'UBIGINT';
    case DuckDBTypeId.UINTEGER:     return 'UINTEGER';
    case DuckDBTypeId.USMALLINT:    return 'USMALLINT';
    case DuckDBTypeId.UTINYINT:     return 'UTINYINT';
    case DuckDBTypeId.HUGEINT:      return 'HUGEINT';
    case DuckDBTypeId.DOUBLE:       return 'DOUBLE';
    case DuckDBTypeId.FLOAT:        return 'FLOAT';
    case DuckDBTypeId.DECIMAL:      return 'DECIMAL';
    case DuckDBTypeId.VARCHAR:      return 'VARCHAR';
    case DuckDBTypeId.BOOLEAN:      return 'BOOLEAN';
    case DuckDBTypeId.DATE:         return 'DATE';
    case DuckDBTypeId.TIMESTAMP:    return 'TIMESTAMP';
    case DuckDBTypeId.TIMESTAMP_S:  return 'TIMESTAMP_S';
    case DuckDBTypeId.TIMESTAMP_MS: return 'TIMESTAMP_MS';
    case DuckDBTypeId.TIMESTAMP_NS: return 'TIMESTAMP_NS';
    case DuckDBTypeId.TIMESTAMP_TZ: return 'TIMESTAMP WITH TIME ZONE';
    case DuckDBTypeId.BLOB:         return 'BLOB';
    case DuckDBTypeId.UUID:         return 'UUID';
    case DuckDBTypeId.INTERVAL:     return 'INTERVAL';
    case DuckDBTypeId.LIST:         return 'LIST';
    case DuckDBTypeId.STRUCT:       return 'STRUCT';
    case DuckDBTypeId.MAP:          return 'MAP';
    default:                        return 'VARCHAR';
  }
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
      const instance = await getOrCreateDuckDbInstance(this.absPath);
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
    const instance = await getOrCreateDuckDbInstance(this.absPath);
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
        types.push(duckDbTypeIdToString(result.columnTypeId(i)));
      }
      const rawRows = await result.getRowObjectsJS() as Record<string, unknown>[];
      const rows = rawRows.map(serializeRow);
      return { columns, types, rows };
    } finally {
      conn.closeSync();
    }
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const instance = await getOrCreateDuckDbInstance(this.absPath);
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

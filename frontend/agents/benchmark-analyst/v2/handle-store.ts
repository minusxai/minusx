// Handle store: process-lifetime storage for query results
// Every query returns a handle; results live outside the LLM context.
// Handles are also registered as queryable DuckDB tables so ExecuteQuery
// can `FROM handle_xyz`.

import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import type { QueryResult } from '@/lib/connections/base';

// Process-wide handle storage (intentional: benchmark agent runs in a single process, handles need to persist across tool calls)
// eslint-disable-next-line no-restricted-syntax
const handles = new Map<string, QueryResult>();
let handleCounter = 0;

// In-memory DuckDB instance for handle tables
let handleDb: DuckDBInstance | null = null;
let handleDbConn: DuckDBConnection | null = null;
let handleDbPromise: Promise<DuckDBConnection> | null = null;

async function getHandleDb(): Promise<DuckDBConnection> {
  if (handleDbConn) return handleDbConn;
  if (handleDbPromise) return handleDbPromise;

  handleDbPromise = (async () => {
    handleDb = await DuckDBInstance.create(':memory:');
    handleDbConn = await handleDb.connect();
    return handleDbConn;
  })();

  return handleDbPromise;
}

function generateHandleId(): string {
  handleCounter++;
  const timestamp = Date.now().toString(36);
  const counter = handleCounter.toString(36).padStart(4, '0');
  return `handle_${timestamp}_${counter}`;
}

function escapeValue(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // String: escape single quotes
  return `'${String(v).replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function mapTypeToDuckDb(type: string): string {
  const upper = type.toUpperCase();
  if (upper.includes('INT')) return 'BIGINT';
  if (upper.includes('DOUBLE') || upper.includes('FLOAT') || upper.includes('DECIMAL') || upper.includes('NUMERIC')) return 'DOUBLE';
  if (upper.includes('BOOL')) return 'BOOLEAN';
  if (upper.includes('DATE')) return 'DATE';
  if (upper.includes('TIME')) return 'TIMESTAMP';
  return 'VARCHAR';
}

// Track pending registrations so queryHandle can wait for them (intentional: coordinates async registration within a single process)
// eslint-disable-next-line no-restricted-syntax
const pendingRegistrations = new Map<string, Promise<void>>();

/**
 * Store a query result and return a unique handle ID.
 * The result is also registered as a queryable DuckDB table.
 */
export function storeHandle(result: QueryResult): string {
  const handleId = generateHandleId();
  handles.set(handleId, result);

  // Start async registration and track the promise
  const registration = registerHandleTable(handleId, result).catch((err) => {
    console.error(`Failed to register handle ${handleId} as DuckDB table:`, err);
  }).finally(() => {
    pendingRegistrations.delete(handleId);
  });
  pendingRegistrations.set(handleId, registration);

  return handleId;
}

async function registerHandleTable(handleId: string, result: QueryResult): Promise<void> {
  if (result.rows.length === 0 || result.columns.length === 0) return;

  const conn = await getHandleDb();

  // Build column definitions
  const colDefs = result.columns.map((col, i) => {
    const type = result.types?.[i] ?? 'VARCHAR';
    return `${quoteIdent(col)} ${mapTypeToDuckDb(type)}`;
  }).join(', ');

  // Create table
  await conn.run(`CREATE TABLE IF NOT EXISTS ${quoteIdent(handleId)} (${colDefs})`);

  // Insert rows
  if (result.rows.length > 0) {
    const colNames = result.columns.map(quoteIdent).join(', ');
    const valueRows = result.rows.map((row) => {
      const vals = result.columns.map((col) => escapeValue(row[col]));
      return `(${vals.join(', ')})`;
    }).join(',\n');

    await conn.run(`INSERT INTO ${quoteIdent(handleId)} (${colNames}) VALUES ${valueRows}`);
  }
}

/**
 * Fetch a stored query result by handle ID.
 */
export function fetchHandle(handleId: string): QueryResult | undefined {
  return handles.get(handleId);
}

/**
 * Clear all stored handles and reset the handle DuckDB.
 * Useful for testing.
 */
export async function clearHandles(): Promise<void> {
  // Wait for pending registrations before clearing
  if (pendingRegistrations.size > 0) {
    await Promise.all(pendingRegistrations.values());
  }
  pendingRegistrations.clear();
  handles.clear();
  handleCounter = 0;

  if (handleDbConn) {
    // Drop all tables
    try {
      const result = await handleDbConn.run("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'");
      const rows = await result.getRowObjectsJS() as Array<{ table_name: string }>;
      for (const row of rows) {
        await handleDbConn.run(`DROP TABLE IF EXISTS ${quoteIdent(row.table_name)}`);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Get the DuckDB table name for a handle (same as handle ID if registered).
 */
export function getHandleTable(handleId: string): string | undefined {
  return handles.has(handleId) ? handleId : undefined;
}

/**
 * Run a SQL query against handle tables.
 * Handles are registered as tables in an in-memory DuckDB instance.
 */
export async function queryHandle(sql: string): Promise<QueryResult> {
  // Wait for all pending registrations to complete
  if (pendingRegistrations.size > 0) {
    await Promise.all(pendingRegistrations.values());
  }
  const conn = await getHandleDb();
  const result = await conn.run(sql);

  const cc = result.columnCount;
  const columns: string[] = [];
  const types: string[] = [];
  for (let i = 0; i < cc; i++) {
    columns.push(result.columnName(i));
    types.push(result.columnType(i).toString());
  }

  const rawRows = await result.getRowObjectsJS() as Record<string, unknown>[];

  // Convert BigInt values to Numbers for JSON compatibility
  const rows = rawRows.map((row) => {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      converted[key] = typeof value === 'bigint' ? Number(value) : value;
    }
    return converted;
  });

  return { columns, types, rows, finalQuery: sql };
}

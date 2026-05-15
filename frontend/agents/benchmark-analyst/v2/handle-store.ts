// Handle store: process-lifetime storage for query results.
//
// Every query returns a handle; full results live outside the LLM context.
// Handle rows are also registered as queryable tables in the *shared*
// benchmark DuckDB instance's `memory` catalog (see `shared-duckdb.ts`) — so
// `ExecuteQuery` can `FROM handle_xyz` and join handles against live
// connection data, which all lives in that same instance.

import 'server-only';
import type { QueryResult } from '@/lib/connections/base';
import {
  registerHandleTable as sharedRegisterHandleTable,
  queryHandleTables,
  dropHandleTables,
} from '../shared-duckdb';

// Process-wide handle storage (intentional: the benchmark agent runs in a
// single process; handles must persist across tool calls within a run).
// eslint-disable-next-line no-restricted-syntax
const handles = new Map<string, QueryResult>();
let handleCounter = 0;

// In-flight `registerHandleTable` promises, so `qualifyHandleRefs` /
// `clearHandles` can wait for a handle's table to exist before using it.
// eslint-disable-next-line no-restricted-syntax
const pendingRegistrations = new Map<string, Promise<void>>();

// Handle-ID shape: `handle_<base36 timestamp>_<base36 counter>`.
const HANDLE_ID_RE = /\bhandle_[0-9a-z]+_[0-9a-z]+\b/gi;

function generateHandleId(): string {
  handleCounter++;
  const timestamp = Date.now().toString(36);
  const counter = handleCounter.toString(36).padStart(4, '0');
  return `handle_${timestamp}_${counter}`;
}

/**
 * Store a query result and return a unique handle ID. The result is also
 * registered (asynchronously) as a queryable table in the shared DuckDB
 * instance's `memory` catalog.
 */
export function storeHandle(result: QueryResult): string {
  const handleId = generateHandleId();
  handles.set(handleId, result);

  const registration = sharedRegisterHandleTable(handleId, result)
    .catch((err) => {
      console.error(`Failed to register handle ${handleId} as a DuckDB table:`, err);
    })
    .finally(() => {
      pendingRegistrations.delete(handleId);
    });
  pendingRegistrations.set(handleId, registration);

  return handleId;
}

/** Fetch a stored query result by handle ID. */
export function fetchHandle(handleId: string): QueryResult | undefined {
  return handles.get(handleId);
}

/** True if `handleId` is a currently-stored handle. */
export function hasHandle(handleId: string): boolean {
  return handles.has(handleId);
}

/** The DuckDB table name for a handle (identical to the handle ID). */
export function getHandleTable(handleId: string): string | undefined {
  return handles.has(handleId) ? handleId : undefined;
}

/** Wait for all in-flight handle-table registrations to complete. */
export async function awaitHandleRegistrations(): Promise<void> {
  if (pendingRegistrations.size > 0) {
    await Promise.all(pendingRegistrations.values());
  }
}

/**
 * Rewrite bare handle identifiers in a SQL string to their fully-qualified
 * `memory.main."handle_xyz"` form, so the query resolves the handle table
 * regardless of which ATTACHed catalog the connection is `USE`-ing. Only
 * *known* handles are rewritten — an unknown `handle_*`-looking token is left
 * untouched (it'll surface a normal "table not found" error).
 *
 * Awaits pending registrations when at least one handle is referenced, so the
 * tables exist before the caller runs the query. Returns the rewritten SQL
 * plus the list of handles actually referenced (callers guard non-SQL
 * connections off a non-empty list).
 */
export async function qualifyHandleRefs(
  sql: string,
): Promise<{ sql: string; referencedHandles: string[] }> {
  const referenced = new Set<string>();
  const rewritten = sql.replace(HANDLE_ID_RE, (match) => {
    if (!handles.has(match)) return match;
    referenced.add(match);
    return `memory.main."${match}"`;
  });
  if (referenced.size > 0) {
    await awaitHandleRegistrations();
  }
  return { sql: rewritten, referencedHandles: [...referenced] };
}

/** Run SQL directly against the registered handle tables. */
export async function queryHandle(sql: string): Promise<QueryResult> {
  const { sql: qualified } = await qualifyHandleRefs(sql);
  return queryHandleTables(qualified);
}

/** Clear all stored handles and drop their DuckDB tables (test/reset helper). */
export async function clearHandles(): Promise<void> {
  await awaitHandleRegistrations();
  pendingRegistrations.clear();
  handles.clear();
  handleCounter = 0;
  await dropHandleTables();
}

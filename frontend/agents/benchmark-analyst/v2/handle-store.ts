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

// Handle-ID shape: `handle_<base36 timestamp>_<base36 counter>`.
const HANDLE_ID_RE = /\bhandle_[0-9a-z]+_[0-9a-z]+\b/gi;

function generateHandleId(): string {
  handleCounter++;
  const timestamp = Date.now().toString(36);
  const counter = handleCounter.toString(36).padStart(4, '0');
  return `handle_${timestamp}_${counter}`;
}

export interface StoreHandleResult {
  handleId: string;
  /**
   * Present when DuckDB couldn't register the result as a SQL table
   * (most often: source query returned duplicate column names; could also
   * be a type-mapping issue, value too large, etc.). The raw rows are
   * still kept in the handle map — accessible via `fetchHandle` — but
   * `FROM <handleId>` will fail because the table doesn't exist. Callers
   * surface this verbatim to the agent so they can fix the source query
   * (e.g. give the duplicate column distinct aliases) if they need the
   * handle for in-engine joins.
   */
  error?: string;
}

/**
 * Store a query result, register it as a queryable DuckDB table, and
 * return `{ handleId, error? }`. The handle ID is always returned (the
 * row data is always stored in the handle map, so `fetchHandle` works
 * either way). `error` is present iff the DuckDB CREATE/INSERT failed —
 * surface it to the agent so they have an actionable signal instead of a
 * silent "table doesn't exist" later.
 */
export async function storeHandle(result: QueryResult): Promise<StoreHandleResult> {
  const handleId = generateHandleId();
  handles.set(handleId, result);

  try {
    await sharedRegisterHandleTable(handleId, result);
    return { handleId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handleId, error: msg };
  }
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

/**
 * Rewrite bare handle identifiers in a SQL string to their fully-qualified
 * `memory.main."handle_xyz"` form, so the query resolves the handle table
 * regardless of which ATTACHed catalog the connection is `USE`-ing. Only
 * *known* handles are rewritten — an unknown `handle_*`-looking token is left
 * untouched (it'll surface a normal "table not found" error).
 *
 * `storeHandle` now awaits registration, so by the time any handle id is
 * present in `handles` the table either exists or its registration has
 * already failed (and `storeHandle`'s caller surfaced the error). No
 * pending-registration wait needed here.
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
  return { sql: rewritten, referencedHandles: [...referenced] };
}

/** Run SQL directly against the registered handle tables. */
export async function queryHandle(sql: string): Promise<QueryResult> {
  const { sql: qualified } = await qualifyHandleRefs(sql);
  return queryHandleTables(qualified);
}

/** Clear all stored handles and drop their DuckDB tables (test/reset helper). */
export async function clearHandles(): Promise<void> {
  handles.clear();
  handleCounter = 0;
  await dropHandleTables();
}

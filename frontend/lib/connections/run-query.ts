import 'server-only';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { getNodeConnector } from '@/lib/connections';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { connectionTypeToDialect } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, any>[];
  finalQuery?: string;
}

/**
 * Execute a SQL query against a named connection.
 *
 * Tries the Node.js connector first (DuckDB, CSV, Google Sheets).
 * Falls back to the Python backend for all other connection types.
 *
 * @param databaseName - Connection name (matches the `name` field in connection config)
 * @param query        - SQL query string
 * @param params       - Parameter values (substituted for :param placeholders)
 * @param user - Effective user (supplies mode for path resolution)
 */
export async function runQuery(
  databaseName: string,
  query: string,
  params: Record<string, string | number>,
  user: EffectiveUser,
  parameterTypes?: Record<string, 'text' | 'number' | 'date'>
): Promise<QueryResult> {
  // Try Node.js connector first — use getRawByName so credentials (e.g. service_account_json) are included
  const rawConn = await ConnectionsAPI.getRawByName(databaseName, user.mode).catch(() => null);

  // Single seam for row-cap enforcement: every server-side execution (v1 chat
  // ExecuteQuery, /api/query, v2 chat orchestrator) flows through here, so
  // applying enforceQueryLimit at this point covers them all uniformly.
  // enforceQueryLimit is a no-op on parse failure and on non-SELECT statements
  // (ATTACH, INSERT, DDL, …), so this is safe for the full set of inputs.
  const dialect = rawConn ? connectionTypeToDialect(rawConn.type) : 'duckdb';
  const cappedQuery = await enforceQueryLimit(query, { dialect });

  if (rawConn) {
    const { type, config } = rawConn;
    if (type === 'internal_db' && user.mode !== 'internals') {
      throw new Error('internal_db connections are only available in internals mode');
    }
    const connector = getNodeConnector(databaseName, type, config);
    if (connector) {
      return connector.query(cappedQuery, params);
    }
  }

  // Fall back to Python backend (handles all non-Node types, and unknown connections)
  const response = await pythonBackendFetch('/api/execute-query', {
    method: 'POST',
    body: JSON.stringify({ query: cappedQuery, parameters: params, connection_name: databaseName, ...(parameterTypes && { parameter_types: parameterTypes }) }),
  }, user);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || data.message || 'Query execution failed');
  }

  return response.json();
}

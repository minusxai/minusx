import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath } from '@/lib/mode/path-resolver';
import { getNodeConnector } from '@/lib/connections';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import type { ConnectionContent } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, any>[];
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
 * @param user         - Effective user (supplies companyId and mode for path resolution)
 */
export async function runQuery(
  databaseName: string,
  query: string,
  params: Record<string, string | number>,
  user: EffectiveUser,
  parameterTypes?: Record<string, 'text' | 'number' | 'date'>
): Promise<QueryResult> {
  const connPath = resolvePath(user.mode, `/database/${databaseName}`);
  const connFile = await DocumentDB.getByPath(connPath, user.companyId);

  if (connFile?.content) {
    const { type, config } = connFile.content as ConnectionContent;
    const connector = getNodeConnector(databaseName, type, config);
    if (connector) {
      return connector.query(query, params);
    }
  }

  // Fall back to Python backend (handles all non-Node types, and unknown connections)
  const response = await pythonBackendFetch('/api/execute-query', {
    method: 'POST',
    body: JSON.stringify({ query, parameters: params, database_name: databaseName, ...(parameterTypes && { parameter_types: parameterTypes }) }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || data.message || 'Query execution failed');
  }

  return response.json();
}

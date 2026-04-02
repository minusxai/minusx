/**
 * ExecuteQuery - Standalone query execution (backend tool)
 *
 * Phase 1: Unified File System API
 *
 * Executes SQL query and caches results.
 * Does NOT modify any files - pure query execution.
 */

import { ExecuteQueryInput, ExecuteQueryDetails, QueryResult } from '@/lib/types';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { compressQueryResult } from '@/lib/api/file-state';
import type { ServerToolResult } from '@/app/api/chat/orchestrator';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * ExecuteQuery implementation
 *
 * @param input - Query, connection, and parameters
 * @param userOverride - Optional user for contexts without an HTTP session (e.g., MCP, cron jobs)
 * @returns Query result with columns, types, rows
 */
export async function executeQuery(
  input: ExecuteQueryInput,
  userOverride?: EffectiveUser
): Promise<ServerToolResult> {
  const { query, connectionId, parameters = {} } = input;

  try {
    // Forward request to Python backend
    const response = await pythonBackendFetch('/api/execute-query', {
      method: 'POST',
      body: JSON.stringify({
        query,
        parameters,
        database_name: connectionId,
      }),
    }, userOverride);

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.detail || data.message || 'Query execution failed';
      const details: ExecuteQueryDetails = { success: false, error: errMsg };
      return { content: details, details };
    }

    const queryResult: QueryResult = {
      columns: data.columns || [],
      types: data.types || [],
      rows: data.rows || []
    };
    const compressed = compressQueryResult(queryResult);
    const details: ExecuteQueryDetails = { success: true, queryResult };
    return { content: compressed, details };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const details: ExecuteQueryDetails = { success: false, error: errMsg };
    return { content: details, details };
  }
}

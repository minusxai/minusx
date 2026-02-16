/**
 * ExecuteQuery - Standalone query execution (backend tool)
 *
 * Phase 1: Unified File System API
 *
 * Executes SQL query and caches results.
 * Does NOT modify any files - pure query execution.
 */

import { ExecuteQueryInput, ExecuteQueryOutput } from '@/lib/types';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

/**
 * ExecuteQuery implementation
 *
 * @param input - Query, connection, and parameters
 * @returns Query result with columns, types, rows
 */
export async function executeQuery(
  input: ExecuteQueryInput
): Promise<ExecuteQueryOutput> {
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
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        columns: [],
        types: [],
        rows: [],
        error: data.detail || data.message || 'Query execution failed'
      };
    }

    // Return standardized QueryResult format
    return {
      columns: data.columns || [],
      types: data.types || [],
      rows: data.rows || []
    };
  } catch (error) {
    return {
      columns: [],
      types: [],
      rows: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

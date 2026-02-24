/**
 * Query executor - executes SQL queries against databases via Python backend
 */

import type { QuestionParameter } from '@/lib/types';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export interface QueryResult {
  columns: string[];
  types?: string[];
  rows: Record<string, any>[];
}

/**
 * Execute a SQL query against a database
 *
 * @param databaseName - Database connection name
 * @param query - SQL query to execute
 * @param parameters - Query parameters (optional)
 */
export async function executeQuery(
  databaseName: string,
  query: string,
  parameters?: QuestionParameter[] | Record<string, string | number>
): Promise<QueryResult> {
  // Convert parameters to Record<string, string | number> for backend
  const paramValues: Record<string, string | number> = {};
  if (Array.isArray(parameters)) {
    // Array format: [{name: 'param1', value: 'val1', type: 'text'}, ...]
    parameters.forEach(p => {
      if (p.defaultValue !== undefined && p.defaultValue !== null && p.defaultValue !== '') {
        paramValues[p.name] = p.defaultValue;
      }
    });
  } else if (typeof parameters === 'object' && parameters !== null) {
    // Object format: {param1: 'val1', param2: 'val2'}
    Object.assign(paramValues, parameters);
  }

  // Forward request to Python backend (company ID header added automatically)
  const response = await pythonBackendFetch('/api/execute-query', {
    method: 'POST',
    body: JSON.stringify({
      query,
      parameters: paramValues,
      database_name: databaseName,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || data.message || 'Query execution failed');
  }

  return data;
}

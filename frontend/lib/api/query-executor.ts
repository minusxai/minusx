/**
 * Query Execution Manager with Promise Caching and Deduplication
 *
 * Ensures that:
 * 1. Queries are cached in Redux for fast retrieval
 * 2. In-flight queries are deduplicated (same query = same promise)
 * 3. No race conditions or redundant backend calls
 */

import { getQueryHash } from '@/lib/utils/query-hash';
import { selectQueryResult } from '@/store/queryResultsSlice';
import { setQueryResult } from '@/store/queryResultsSlice';
import { PromiseManager } from '@/lib/utils/promise-manager';
import type { QueryResult } from '@/lib/types';
import type { RootState } from '@/store/store';
import type { Dispatch } from '@reduxjs/toolkit';

/**
 * Global promise manager for in-flight queries
 * Export for testing and debugging (e.g., queryManager.clear(), queryManager.size)
 */
export const queryManager = new PromiseManager<QueryResult>();

/**
 * Execute a query with caching and deduplication
 *
 * Flow:
 * 1. Check Redux cache - return immediately if cached
 * 2. Check promise store - return existing promise if already running
 * 3. Execute query - store promise, update Redux on completion
 * 4. Cleanup - remove from promise store when done
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @param connectionId - Database connection ID
 * @param getState - Redux getState function
 * @param dispatch - Redux dispatch function
 * @returns Promise that resolves to QueryResult
 */
export async function runQuery(
  query: string,
  params: Record<string, any>,
  connectionId: string,
  getState: () => RootState,
  dispatch: Dispatch
): Promise<QueryResult> {
  const queryId = getQueryHash(query, params, connectionId);

  // Step 1: Check Redux cache first
  const state = getState();
  const cached = selectQueryResult(state, query, params, connectionId);
  if (cached?.data) {
    console.log('[runQuery] Cache hit:', queryId);
    return Promise.resolve(cached.data);
  }

  // Step 2: Execute with deduplication via PromiseManager
  console.log('[runQuery] Starting query execution:', queryId);
  return queryManager.execute(queryId, async () => {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        database_name: connectionId,
        parameters: params
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Query execution failed: ${response.statusText}`);
    }

    const apiResponse: { data: QueryResult } = await response.json();
    const result = apiResponse.data;

    // Update Redux cache with result
    console.log('[runQuery] Query completed, caching result:', queryId);
    dispatch(setQueryResult({
      query,
      params,
      database: connectionId,
      data: result
    }));

    return result;
  });
}

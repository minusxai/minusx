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
import type { QueryResult } from '@/lib/types';
import type { RootState } from '@/store/store';
import type { Dispatch } from '@reduxjs/toolkit';

/**
 * Global promise store for in-flight queries
 * Maps queryId (hash) -> Promise<QueryResult>
 */
const queryPromises = new Map<string, Promise<QueryResult>>();

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

  // Step 2: Check if query is already running (deduplication)
  if (queryPromises.has(queryId)) {
    console.log('[runQuery] Query already in-flight, returning existing promise:', queryId);
    return queryPromises.get(queryId)!;
  }

  // Step 3: Execute new query via existing /api/query route
  console.log('[runQuery] Starting new query execution:', queryId);
  const promise = fetch('/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      database_name: connectionId,
      parameters: params
    })
  })
    .then(async (response) => {
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Query execution failed: ${response.statusText}`);
      }
      return response.json();
    })
    .then((apiResponse: { data: QueryResult }) => {
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
    })
    .catch((error) => {
      console.error('[runQuery] Query failed:', queryId, error);
      throw error;
    })
    .finally(() => {
      // Step 4: Cleanup - remove from promise store
      console.log('[runQuery] Removing from promise store:', queryId);
      queryPromises.delete(queryId);
    });

  // Store promise for deduplication
  queryPromises.set(queryId, promise);
  return promise;
}

/**
 * Clear all in-flight queries (useful for testing)
 */
export function clearQueryPromises(): void {
  queryPromises.clear();
}

/**
 * Get count of in-flight queries (useful for debugging)
 */
export function getInFlightQueryCount(): number {
  return queryPromises.size;
}

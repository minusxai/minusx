/**
 * useQueryResult Hook - Phase 3
 *
 * Manages query execution with TTL-based caching
 * Similar to useFile but for query results
 *
 * Features:
 * - Automatic execution when no data
 * - TTL-based caching (default: 10 hours)
 * - Background refetch for stale data
 * - Loading state management
 * - Error handling
 */
import { useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  selectQueryResult,
  selectIsQueryFresh,
  selectHasQueryData,
  setQueryLoading,
  setQueryResult,
  setQueryError
} from '@/store/queryResultsSlice';
import { CACHE_TTL } from '@/lib/constants/cache';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

import type { QuestionReference } from '@/lib/types';

/**
 * Query execution parameters
 */
export interface QueryParams {
  query: string;
  params: Record<string, any>;
  database: string;
  references?: QuestionReference[];  // Composed questions
}

/**
 * Result returned by useQueryResult hook
 */
export interface UseQueryResultReturn {
  data: any | null;              // Query result data (columns + rows)
  loading: boolean;              // Currently fetching
  error: string | null;          // Error message if fetch failed
  isStale: boolean;              // Data exists but is stale (being refetched)
  refetch: () => void;           // Manually trigger refetch
}

/**
 * Options for useQueryResult hook
 */
export interface UseQueryResultOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.QUERY = 10 hours)
  skip?: boolean;    // Skip execution (for conditional use)
}

/**
 * useQueryResult Hook
 *
 * Executes queries with TTL-based caching and automatic refetching
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @param database - Database name (connection)
 * @param options - Hook options (ttl, skip)
 * @returns {data, loading, error, isStale, refetch}
 *
 * Behavior:
 * 1. No data → Execute query, set loading true
 * 2. Data exists & fresh → Return cached data
 * 3. Data exists & stale → Return stale data, refetch in background
 *
 * Example:
 * ```tsx
 * const { data, loading, error, isStale } = useQueryResult(
 *   'SELECT * FROM users WHERE id = :userId',
 *   { userId: 123 },
 *   'default_db'
 * );
 *
 * if (loading && !data) return <Spinner />;
 * if (error) return <Error message={error} />;
 * if (!data) return <NoData />;
 *
 * return (
 *   <>
 *     {isStale && <Badge>Refetching...</Badge>}
 *     <Table data={data} />
 *   </>
 * );
 * ```
 */
export function useQueryResult(
  query: string,
  params: Record<string, any>,
  database: string,
  references?: QuestionReference[],
  options: UseQueryResultOptions = {}
): UseQueryResultReturn {
  const { ttl = CACHE_TTL.QUERY, skip = false } = options;
  const dispatch = useAppDispatch();

  // Select result from Redux
  const result = useAppSelector(state => selectQueryResult(state, query, params, database));

  // Check if result exists and is fresh
  const hasData = useAppSelector(state => selectHasQueryData(state, query, params, database));
  const isFresh = useAppSelector(state => selectIsQueryFresh(state, query, params, database, ttl));

  // Determine if we need to fetch
  // Don't auto-fetch if there's an error (user must explicitly refetch)
  const hasError = result?.error != null;
  const needsFetch = !skip && !hasError && (!hasData || !isFresh);

  // Determine loading state
  // loading=true if: (1) no data and fetching, or (2) Redis says loading
  const loading = result?.loading || false;

  // Determine isStale: has data but fetching new data
  const isStale = hasData && loading;

  // Execute query function
  const executeQuery = async () => {
    // Clear error and set loading state
    // This allows retrying after an error
    dispatch(setQueryLoading({ query, params, database, loading: true }));

    try {
      // Call query API with automatic deduplication (prevents duplicate in-flight requests)
      const json = await fetchWithCache('/api/query', {
        method: 'POST',
        body: JSON.stringify({
          query,
          parameters: params,
          database_name: database,
          references: references || []
        }),
        cacheStrategy: API.query.execute.cache,
      });

      const data = json.data || json;

      // Store result in Redux (clears error automatically)
      dispatch(setQueryResult({ query, params, database, data }));
    } catch (error) {
      console.error('[useQueryResult] Query execution failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      dispatch(setQueryError({ query, params, database, error: errorMessage }));
    }
  };

  // Effect: Execute query if needed
  useEffect(() => {
    if (!needsFetch) return;

    // Skip if already loading
    if (loading) return;

    executeQuery();
  }, [needsFetch, loading, query, params, database, references]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual refetch function
  const refetch = () => {
    executeQuery();
  };

  return {
    data: result?.data || null,
    loading,
    error: result?.error || null,
    isStale,
    refetch
  };
}

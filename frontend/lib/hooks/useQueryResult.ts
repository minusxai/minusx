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
import { useEffect, useCallback } from 'react';
import { useAppSelector } from '@/store/hooks';
import {
  selectQueryResult,
  selectIsQueryFresh,
  selectHasQueryData
} from '@/store/queryResultsSlice';
import { getQueryResult } from '@/lib/api/file-state';
import { CACHE_TTL } from '@/lib/constants/cache';

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
 * useQueryResult Hook - Phase 3 (Simplified)
 *
 * Executes queries with TTL-based caching and automatic refetching.
 * Uses getQueryResult from file-state.ts internally.
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @param database - Database name (connection)
 * @param references - Question references (optional)
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
  const loading = result?.loading || false;

  // Determine isStale: has data but fetching new data
  const isStale = hasData && loading;

  // Execute query function using getQueryResult from file-state.ts
  const executeQuery = useCallback(async () => {
    try {
      await getQueryResult({
        query,
        params,
        database
      }, { ttl });
    } catch (error) {
      console.error('[useQueryResult] Query execution failed:', error);
      // Error is already stored in Redux by getQueryResult
    }
  }, [query, params, database, ttl]);

  // Effect: Execute query if needed
  useEffect(() => {
    if (!needsFetch) return;

    // Skip if already loading
    if (loading) return;

    executeQuery();
  }, [needsFetch, loading, executeQuery]);

  // Manual refetch function
  const refetch = useCallback(() => {
    executeQuery();
  }, [executeQuery]);

  return {
    data: result?.data || null,
    loading,
    error: result?.error || null,
    isStale,
    refetch
  };
}

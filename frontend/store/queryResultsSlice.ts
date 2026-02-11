/**
 * Query Results Slice - Phase 3
 *
 * Stores query execution results separately from files.
 * Implements TTL-based caching and automatic cleanup.
 *
 * Architecture:
 * - Query results keyed by hash of (query, params, database)
 * - TTL-based freshness (default: 120 seconds)
 * - Auto-cleanup: Keep last 32 results, remove oldest
 * - Loading state tracked per query
 */
import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';

/**
 * Query result stored in Redux
 */
export interface QueryResult {
  query: string;
  params: Record<string, any>;
  database: string;
  data: any;                    // Query result data (columns + rows)
  updatedAt: number;            // Timestamp when data was fetched
  loading: boolean;             // Currently fetching
  error: string | null;         // Error message if fetch failed
}

/**
 * Query results state
 * Uses hash-based lookup for O(1) access
 */
interface QueryResultsState {
  results: Record<string, QueryResult>;  // hash -> result
}

const initialState: QueryResultsState = {
  results: {}
};

/**
 * Generate hash key for query lookup
 * Simple string concatenation with delimiter
 */
export function getQueryHash(query: string, params: Record<string, any>, database: string): string {
  const paramStr = JSON.stringify(params);
  return `${database}|||${query}|||${paramStr}`;
}

const queryResultsSlice = createSlice({
  name: 'queryResults',
  initialState,
  reducers: {
    /**
     * Set loading state for a query
     */
    setQueryLoading(state, action: PayloadAction<{ query: string; params: Record<string, any>; database: string; loading: boolean }>) {
      const { query, params, database, loading } = action.payload;
      const hash = getQueryHash(query, params, database);

      if (!state.results[hash]) {
        // Create new entry if doesn't exist
        state.results[hash] = {
          query,
          params,
          database,
          data: null,
          updatedAt: Date.now(),
          loading,
          error: null
        };
      } else {
        // Update existing entry - clear error when starting new fetch
        state.results[hash].loading = loading;
        if (loading) {
          state.results[hash].error = null;
        }
      }
    },

    /**
     * Set query result data
     * Automatically cleans up old results if > 32 entries
     */
    setQueryResult(state, action: PayloadAction<{ query: string; params: Record<string, any>; database: string; data: any }>) {
      const { query, params, database, data } = action.payload;
      const hash = getQueryHash(query, params, database);

      state.results[hash] = {
        query,
        params,
        database,
        data,
        updatedAt: Date.now(),
        loading: false,
        error: null
      };

      // Cleanup: Keep last 32 results
      const entries = Object.entries(state.results);
      if (entries.length > 32) {
        // Sort by updatedAt, keep newest 32
        const sorted = entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
        const toKeep = sorted.slice(0, 32);
        state.results = Object.fromEntries(toKeep);
      }
    },

    /**
     * Set query error
     */
    setQueryError(state, action: PayloadAction<{ query: string; params: Record<string, any>; database: string; error: string }>) {
      const { query, params, database, error } = action.payload;
      const hash = getQueryHash(query, params, database);

      if (!state.results[hash]) {
        state.results[hash] = {
          query,
          params,
          database,
          data: null,
          updatedAt: Date.now(),
          loading: false,
          error
        };
      } else {
        state.results[hash].loading = false;
        state.results[hash].error = error;
      }
    },

    /**
     * Clear all query results
     */
    clearAllResults(state) {
      state.results = {};
    },

    /**
     * Clear specific query result
     */
    clearQueryResult(state, action: PayloadAction<{ query: string; params: Record<string, any>; database: string }>) {
      const { query, params, database } = action.payload;
      const hash = getQueryHash(query, params, database);
      delete state.results[hash];
    }
  }
});

// Actions
export const {
  setQueryLoading,
  setQueryResult,
  setQueryError,
  clearAllResults,
  clearQueryResult
} = queryResultsSlice.actions;

// Selectors

/**
 * Select query result by hash
 */
export const selectQueryResult = (
  state: RootState,
  query: string,
  params: Record<string, any>,
  database: string
): QueryResult | undefined => {
  const hash = getQueryHash(query, params, database);
  return state.queryResults.results[hash];
};

/**
 * Check if query result is fresh (within TTL)
 * Default TTL: 120 seconds
 */
export const selectIsQueryFresh = (
  state: RootState,
  query: string,
  params: Record<string, any>,
  database: string,
  ttl: number = 120000  // 120 seconds in ms
): boolean => {
  const result = selectQueryResult(state, query, params, database);
  if (!result || !result.data) return false;

  const age = Date.now() - result.updatedAt;
  return age < ttl;
};

/**
 * Check if query result exists and has data
 */
export const selectHasQueryData = (
  state: RootState,
  query: string,
  params: Record<string, any>,
  database: string
): boolean => {
  const result = selectQueryResult(state, query, params, database);
  return !!result && !!result.data;
};

/**
 * Select all query results (for debugging)
 * Memoized to prevent unnecessary re-renders
 */
export const selectAllQueryResults = createSelector(
  [(state: RootState) => state.queryResults.results],
  (results): QueryResult[] => Object.values(results)
);

export default queryResultsSlice.reducer;

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithCache } from './fetch-wrapper';
import { ApiEndpoint } from './declarations';

export type UseFetchState<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

/**
 * React hook for fetching data with deduplication and caching
 */
export function useFetch<TInput, TOutput>(
  endpoint: ApiEndpoint<TInput, TOutput>,
  input?: TInput,
  options?: {
    enabled?: boolean;  // Disable automatic fetch
    skipCache?: boolean;  // Skip cache for this fetch
  }
): UseFetchState<TOutput> {
  const [data, setData] = useState<TOutput | null>(null);
  const [loading, setLoadingInternal] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Wrapper for loading state
  const setLoading = useCallback((value: boolean) => {
    setLoadingInternal(value);
  }, []);

  // Track if fetch is in progress to prevent concurrent fetches
  const isFetching = useRef(false);

  // Extract enabled value to use as dependency (avoid object reference issues)
  const enabled = options?.enabled;
  const skipCache = options?.skipCache;

  const fetchData = useCallback(async () => {
    // Prevent concurrent fetches from the same component instance
    if (isFetching.current) {
      return;
    }

    isFetching.current = true;
    setLoading(true);
    setError(null);

    try {
      // Resolve URL (static or function)
      const url = typeof endpoint.url === 'function'
        ? endpoint.url(input as TInput)
        : endpoint.url;

      // Prepare fetch options
      const fetchOptions: RequestInit & { cacheStrategy?: any; skipCache?: boolean } = {
        method: endpoint.method || 'GET',
        headers: endpoint.headers,
        cacheStrategy: endpoint.cache,
        skipCache: skipCache,
      };

      // Add body for POST/PUT requests
      if (input && (endpoint.method === 'POST' || endpoint.method === 'PUT')) {
        fetchOptions.body = JSON.stringify(input);
      }

      const result = await fetchWithCache<TOutput>(url, fetchOptions);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isFetching.current = false;
      setLoading(false);
    }
  }, [endpoint, input, skipCache]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (enabled !== false) {
      fetchData();
    } else {
      // Reset loading if fetch is disabled
      setLoadingInternal(false);
    }
  }, [fetchData, enabled]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for manual fetch (doesn't auto-fetch on mount)
 */
export function useFetchManual<TInput, TOutput>(
  endpoint: ApiEndpoint<TInput, TOutput>
): [(input?: TInput) => Promise<TOutput>, UseFetchState<TOutput>] {
  const [data, setData] = useState<TOutput | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (input?: TInput): Promise<TOutput> => {
    setLoading(true);
    setError(null);

    try {
      const url = typeof endpoint.url === 'function'
        ? endpoint.url(input as TInput)
        : endpoint.url;

      const fetchOptions: RequestInit & { cacheStrategy?: any } = {
        method: endpoint.method || 'GET',
        headers: endpoint.headers,
        cacheStrategy: endpoint.cache,
      };

      if (input && (endpoint.method === 'POST' || endpoint.method === 'PUT')) {
        fetchOptions.body = JSON.stringify(input);
      }

      const result = await fetchWithCache<TOutput>(url, fetchOptions);
      setData(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  const refetch = useCallback(async () => {
    await execute();
  }, [execute]);

  return [execute, { data, loading, error, refetch }];
}

import { useMemo } from 'react';
import { type ConnectionWithSchema } from '@/store/filesSlice';
import { useFilesByCriteria } from './file-state-hooks';
import type { ConnectionContent } from '@/lib/types';
import { CACHE_TTL } from '@/lib/constants/cache';

/**
 * Options for useConnections hook
 */
export interface UseConnectionsOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FILE = 10 hours)
  skip?: boolean;    // Skip loading (for conditional use)
}

/**
 * Return type for useConnections hook
 */
export interface UseConnectionsReturn {
  connections: Record<string, ConnectionWithSchema>;
  loading: boolean;
  error: Error | null;
}

/**
 * useConnections Hook
 *
 * Loads all connections with schemas, with TTL-based caching.
 * Uses core useFiles hook for file loading.
 *
 * Behavior:
 * 1. If data already loaded and fresh (within TTL) → return cached
 * 2. If data missing or stale → fetch from API
 * 3. Sets loading state during fetch
 *
 * @param options - Hook options (ttl, skip)
 * @returns {connections, loading, reload}
 */
export function useConnections(options: UseConnectionsOptions = {}): UseConnectionsReturn {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  // Memoize criteria to prevent unnecessary re-fetches (stable object reference)
  const criteria = useMemo(() => ({ type: 'connection' as const, depth: 1 }), []);

  // Delegate to core hook for loading (handles freshness checking internally)
  // Use partial: false to fully load connections with schemas (triggers connection-loader)
  const { files, loading, error } = useFilesByCriteria({
    criteria,
    ttl,
    skip,
    partial: false
  });

  // Transform files to ConnectionWithSchema format (domain-specific logic)
  const connections = useMemo(() => {
    return files.reduce((acc, file) => {
      const content = file.content as ConnectionContent;
      if (!content) return acc;

      const connection: ConnectionWithSchema = {
        metadata: {
          name: file.name,
          type: content.type,
          config: content.config,
          created_at: file.created_at,
          updated_at: file.updated_at
        },
        schema: content.schema || null,
        schemaLoadedAt: file.updatedAt,
        schemaError: content.schema ? undefined : 'Schema not available'
      };

      acc[file.name] = connection;
      return acc;
    }, {} as Record<string, ConnectionWithSchema>);
  }, [files]);

  return {
    connections,
    loading,
    error
  };
}

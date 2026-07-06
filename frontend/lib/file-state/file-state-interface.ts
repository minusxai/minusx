/**
 * Shared option/result types for reading file state.
 *
 * Used by the read-side shape of:
 *   - file-state.ts (client): reads from Redux, caches via TTL, user comes from store
 *   - file-state.server.ts (server): reads from DB directly, user passed explicitly
 *
 * Intentionally excludes write/optimistic operations (editFile, publishFile,
 * createVirtualFile, etc.) which are client-only concepts.
 */

import type { FileState, FileType, QuestionReference } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';

export interface ReadFilesOptions {
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.FILE)
  skip?: boolean;      // Skip loading (return from Redux / cache only)
  runQueries?: boolean; // Execute queries for question files (root + references) that lack cached results
  /** Cancels the auto-executed queries (e.g. the conversation's Stop). Without it a ReadFiles over
   *  a wide dashboard blocks on every uncached query to its full timeout, uncancellable. */
  signal?: AbortSignal;
}

export interface ReadFilesByCriteriaOptions {
  criteria: {
    paths?: string[];
    type?: FileType;
    depth?: number;
  };
  ttl?: number;
  skip?: boolean;
  partial?: boolean;  // If true, return metadata only (no full content)
}

export interface ReadFolderOptions {
  depth?: number;      // 1 = direct children, -1 = all descendants (default: 1)
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.FOLDER)
  forceLoad?: boolean; // Bypass cache and force a fresh load (default: false)
}

export interface ReadFolderResult {
  files: FileState[];
  loading: boolean;
  error: LoadError | null;
}

export interface QueryExecutionParams {
  query: string;
  params: Record<string, any>;
  database: string;
  references?: QuestionReference[];
  parameterTypes?: Record<string, 'text' | 'number' | 'date'>;
  /** Path of the question file — used by /api/query to resolve the correct context and validate against its whitelist */
  filePath?: string;
  /** ID of the question file — stored in query_execution_events for per-file analytics */
  fileId?: number;
  /** Version of the question file at execution time — stored in queries table for lineage tracking */
  fileVersion?: number;
  /** Per-file cache SWR windows (from the question's content.cachePolicy). When set, overrides the
   *  env-default revalidate/expiry for this query's durable cache entry; omitted → env defaults. */
  cachePolicy?: { revalidateMs?: number; expiryMs?: number };
}

export interface GetQueryResultOptions {
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.QUERY)
  skip?: boolean;      // Skip execution
  forceLoad?: boolean; // Bypass TTL cache and re-execute even if fresh
  /**
   * External abort signal (e.g. the conversation's Stop controller). Composed with
   * the built-in wall-clock timeout — whichever fires first aborts the /api/query fetch.
   */
  signal?: AbortSignal;
}

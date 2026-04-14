/**
 * IFileStateRead — shared contract for reading file state.
 *
 * Implemented by:
 *   - file-state.ts (client): reads from Redux, caches via TTL, user comes from store
 *   - file-state.server.ts (server): reads from DB directly via createServerFileState(user)
 *
 * Intentionally excludes write/optimistic operations (editFile, publishFile,
 * createVirtualFile, etc.) which are client-only concepts.
 */

import type { AugmentedFile, FileState, QueryResult, FileType, QuestionReference } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';

export interface ReadFilesOptions {
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.FILE)
  skip?: boolean;      // Skip loading (return from Redux / cache only)
  runQueries?: boolean; // Execute queries for question files (root + references) that lack cached results
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
}

export interface GetQueryResultOptions {
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.QUERY)
  skip?: boolean;      // Skip execution
  forceLoad?: boolean; // Bypass TTL cache and re-execute even if fresh
}

export interface IFileStateRead {
  readFiles(fileIds: number[], options?: ReadFilesOptions): Promise<AugmentedFile[]>;
  readFilesByCriteria(options: ReadFilesByCriteriaOptions): Promise<AugmentedFile[]>;
  readFolder(path: string, options?: ReadFolderOptions): Promise<ReadFolderResult>;
  getQueryResult(params: QueryExecutionParams, options?: GetQueryResultOptions): Promise<QueryResult>;
}

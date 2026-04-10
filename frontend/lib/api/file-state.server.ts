/**
 * Server-side File State Utilities
 *
 * Server-side equivalent of file-state.ts for loading files with references
 * and query results. Used by tool fallbacks, MCP tools, test runners, and
 * job handlers.
 *
 * Matches client-side behavior including:
 * - Parameter inheritance for dashboards
 * - Effective queryResultId computation
 * - Optional query execution
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { getQueryHash } from '@/lib/utils/query-hash';
import {
  compressAugmentedFile,
  dbFileToFileState,
} from '@/lib/api/compress-augmented';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type {
  DbFile,
  FileState,
  AugmentedFile,
  CompressedAugmentedFile,
  QuestionContent,
  QuestionParameter,
  QueryResult,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Parameter Inheritance (mirrored from file-state.ts)
// ---------------------------------------------------------------------------

/**
 * Extract root params from a dashboard's parameterValues.
 * For questions and other types, returns {} (no inheritance).
 */
function getRootParams(file: DbFile): Record<string, unknown> {
  if (file.type === 'dashboard') {
    return (file.content as { parameterValues?: Record<string, unknown> })?.parameterValues || {};
  }
  return {};
}

/**
 * Merge inherited params with question's own params (inherited wins).
 * Only includes params the question defines (no sibling pollution).
 */
function resolveEffectiveParams(
  parameters: QuestionParameter[],
  ownParamValues: Record<string, unknown>,
  inheritedParams: Record<string, unknown>
): Record<string, unknown> {
  const dict: Record<string, unknown> = {};
  for (const p of parameters) {
    dict[p.name] = Object.prototype.hasOwnProperty.call(inheritedParams, p.name)
      ? inheritedParams[p.name]
      : (ownParamValues[p.name] ?? '');
  }
  return dict;
}

/**
 * Build effective FileState with inherited params applied.
 * Recomputes queryResultId based on effective parameter values.
 */
function buildEffectiveReference(
  refFile: FileState,
  inheritedParams: Record<string, unknown>
): FileState {
  if (refFile.type !== 'question' || !refFile.content) return refFile;

  const content = refFile.content as QuestionContent;
  const ownParamValues = content.parameterValues ?? {};
  const effectiveParamsDict = content.parameters?.length
    ? resolveEffectiveParams(content.parameters, ownParamValues, inheritedParams)
    : {};
  const effectiveQueryResultId = content.query && content.connection_name
    ? getQueryHash(content.query, effectiveParamsDict, content.connection_name)
    : refFile.queryResultId;

  return {
    ...refFile,
    queryResultId: effectiveQueryResultId,
  };
}

// ---------------------------------------------------------------------------
// Query Execution
// ---------------------------------------------------------------------------

/**
 * Execute queries for file and references with inherited params.
 * Returns array of QueryResult with id field set.
 */
async function executeQueriesForFile(
  file: DbFile,
  references: DbFile[],
  inheritedParams: Record<string, unknown>,
  user: EffectiveUser
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  // Helper to execute query for a question
  const execQuestion = async (q: DbFile): Promise<void> => {
    if (q.type !== 'question') return;
    const content = q.content as QuestionContent;
    if (!content.query || !content.connection_name) return;

    const ownParamValues = content.parameterValues ?? {};
    const params = content.parameters?.length
      ? resolveEffectiveParams(content.parameters, ownParamValues, inheritedParams)
      : ownParamValues;

    // Convert to the format runQuery expects
    const paramRecord: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' || typeof v === 'number') {
        paramRecord[k] = v;
      } else if (v != null) {
        paramRecord[k] = String(v);
      }
    }

    const id = getQueryHash(content.query, params, content.connection_name);

    try {
      const result = await runQuery(content.connection_name, content.query, paramRecord, user);
      results.push({ ...result, id });
    } catch (err) {
      results.push({
        columns: [],
        types: [],
        rows: [],
        id,
        error: err instanceof Error ? err.message : 'Query failed',
      } as QueryResult & { error: string });
    }
  };

  // Execute for main file if it's a question
  await execQuestion(file);

  // Execute for all referenced questions in parallel
  await Promise.all(references.map(ref => execQuestion(ref)));

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReadFilesServerOptions {
  /** Execute queries for question files. Default: false */
  executeQueries?: boolean;
}

/**
 * Load files by ID with references, optionally executing queries.
 * Server-side equivalent of client's readFiles() + selectAugmentedFiles().
 *
 * @param fileIds - Array of file IDs to load
 * @param user - Effective user for permissions and connection access
 * @param options - Options including whether to execute queries
 * @returns Array of CompressedAugmentedFile matching client format
 */
export async function readFilesServer(
  fileIds: number[],
  user: EffectiveUser,
  options: ReadFilesServerOptions = {}
): Promise<CompressedAugmentedFile[]> {
  const { executeQueries = false } = options;

  const results: CompressedAugmentedFile[] = [];

  for (const fileId of fileIds) {
    try {
      const fileResult = await FilesAPI.loadFile(fileId, user);
      if (!fileResult.data) continue;

      const file = fileResult.data;
      const refs = fileResult.metadata?.references ?? [];
      const inheritedParams = getRootParams(file);

      // Convert to FileState with effective params applied to references
      const fileState = dbFileToFileState(file);
      const refFileStates = refs.map(ref =>
        buildEffectiveReference(dbFileToFileState(ref), inheritedParams)
      );

      // Execute queries if requested
      let queryResults: QueryResult[] = [];
      if (executeQueries) {
        queryResults = await executeQueriesForFile(file, refs, inheritedParams, user);
      }

      // Build and compress
      const augmented: AugmentedFile = {
        fileState,
        references: refFileStates,
        queryResults,
      };

      results.push(compressAugmentedFile(augmented));
    } catch {
      // Skip files that fail to load (permission denied, not found, etc.)
    }
  }

  return results;
}

/**
 * Build app state for a file.
 * Server-side equivalent of selectAppState() for file contexts.
 *
 * @param fileId - File ID to load
 * @param user - Effective user for permissions
 * @param options - Options including whether to execute queries
 * @returns AppState object or null if file not found
 */
export async function getAppStateServer(
  fileId: number,
  user: EffectiveUser,
  options: ReadFilesServerOptions = {}
): Promise<{ type: 'file'; state: CompressedAugmentedFile } | null> {
  const files = await readFilesServer([fileId], user, options);
  if (files.length === 0) return null;
  return { type: 'file', state: files[0] };
}

/**
 * Server-side File State — implements IFileStateRead for use in tool handlers,
 * MCP tools, test runners, and cron jobs.
 *
 * Use createServerFileState(user) to get an IFileStateRead bound to a user.
 * readFilesServer() is the legacy compressed variant for LLM tool responses.
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { getQueryHash } from '@/lib/utils/query-hash';
import {
  compressAugmentedFile,
  dbFileToFileState,
} from '@/lib/api/compress-augmented';
import {
  getRootParamsFromContent,
  resolveEffectiveParams,
  buildEffectiveReference,
} from '@/lib/data/helpers/param-resolution';
import type {
  IFileStateRead,
  ReadFilesOptions,
  ReadFilesByCriteriaOptions,
  ReadFolderOptions,
  ReadFolderResult,
  QueryExecutionParams,
  GetQueryResultOptions,
} from '@/lib/api/file-state-interface';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { FileInfo } from '@/lib/data/types';
import type {
  DbFile,
  FileState,
  AugmentedFile,
  CompressedAugmentedFile,
  QuestionContent,
  QueryResult,
} from '@/lib/types';

/**
 * Convert metadata-only FileInfo (no content) to a minimal FileState.
 * Used for folder listings and partial reads where content is not needed.
 */
function fileInfoToFileState(info: FileInfo): FileState {
  return {
    ...info,
    content: null,
    queryResultId: undefined,
    loading: false,
    saving: false,
    updatedAt: Date.now(),
    loadError: null,
    persistableChanges: {},
    ephemeralChanges: {},
    metadataChanges: {},
  } as unknown as FileState;
}

// ---------------------------------------------------------------------------
// Internal implementations (take explicit user param)
// ---------------------------------------------------------------------------

async function readFilesImpl(
  fileIds: number[],
  user: EffectiveUser,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: ReadFilesOptions = {}
): Promise<AugmentedFile[]> {
  const results: AugmentedFile[] = [];

  for (const fileId of fileIds) {
    try {
      const fileResult = await FilesAPI.loadFile(fileId, user);
      if (!fileResult.data) continue;

      const file = fileResult.data;
      const refs = fileResult.metadata?.references ?? [];
      const inheritedParams = getRootParamsFromContent(file.type, file.content);

      const fileState = dbFileToFileState(file);
      const refFileStates = refs.map(ref =>
        buildEffectiveReference(dbFileToFileState(ref), inheritedParams)
      );

      results.push({ fileState, references: refFileStates, queryResults: [] });
    } catch {
      // Skip files that fail to load (permission denied, not found, etc.)
    }
  }

  return results;
}

async function readFilesByCriteriaImpl(
  options: ReadFilesByCriteriaOptions,
  user: EffectiveUser
): Promise<AugmentedFile[]> {
  const { criteria, partial } = options;
  const result = await FilesAPI.getFiles(criteria, user);

  if (partial) {
    return result.data.map(file => ({
      fileState: fileInfoToFileState(file),
      references: [],
      queryResults: [],
    }));
  }

  const fileIds = result.data.map(f => f.id);
  return readFilesImpl(fileIds, user);
}

async function readFolderImpl(
  path: string,
  options: ReadFolderOptions = {},
  user: EffectiveUser
): Promise<ReadFolderResult> {
  const { depth = 1 } = options;
  try {
    const result = await FilesAPI.getFiles({ paths: [path], depth }, user);
    const files = result.data.map(file => fileInfoToFileState(file));
    return { files, loading: false, error: null };
  } catch (error) {
    return {
      files: [],
      loading: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: 'SERVER_ERROR',
      },
    };
  }
}

async function getQueryResultImpl(
  params: QueryExecutionParams,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: GetQueryResultOptions = {},
  user: EffectiveUser
): Promise<QueryResult> {
  const { query, params: queryParams, database } = params;

  if (_options.skip) {
    throw new Error('Cannot execute query with skip=true');
  }

  const paramRecord: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (typeof v === 'string' || typeof v === 'number') {
      paramRecord[k] = v;
    } else if (v != null) {
      paramRecord[k] = String(v);
    }
  }

  const id = getQueryHash(query, queryParams, database);
  const result = await runQuery(database, query, paramRecord, user);
  return { ...result, id };
}

// ---------------------------------------------------------------------------
// Query execution with param inheritance (for readFilesServer)
// ---------------------------------------------------------------------------

async function executeQueriesForFile(
  file: DbFile,
  references: DbFile[],
  inheritedParams: Record<string, any>,
  user: EffectiveUser
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  const execQuestion = async (q: DbFile): Promise<void> => {
    if (q.type !== 'question') return;
    const content = q.content as QuestionContent;
    if (!content.query || !content.connection_name) return;

    const ownParamValues = content.parameterValues ?? {};
    const params = content.parameters?.length
      ? resolveEffectiveParams(content.parameters, ownParamValues, inheritedParams)
      : ownParamValues;

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

  await execQuestion(file);
  await Promise.all(references.map(ref => execQuestion(ref)));

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * createServerFileState — returns an IFileStateRead bound to a specific user.
 * Use this in agents and tool handlers that need runtime-agnostic file access.
 *
 * @example
 * const fs = createServerFileState(user);
 * const files = await fs.readFiles([42]);
 */
export function createServerFileState(user: EffectiveUser): IFileStateRead {
  return {
    readFiles: (ids, opts) => readFilesImpl(ids, user, opts),
    readFilesByCriteria: (opts) => readFilesByCriteriaImpl(opts, user),
    readFolder: (path, opts) => readFolderImpl(path, opts, user),
    getQueryResult: (params, opts) => getQueryResultImpl(params, opts, user),
  };
}

export interface ReadFilesServerOptions {
  /** Execute queries for question files. Default: false */
  executeQueries?: boolean;
}

/**
 * readFilesServer — load files and return compressed output for LLM tool responses.
 * For runtime-agnostic access, prefer createServerFileState(user).readFiles() instead.
 */
export async function readFilesServer(
  fileIds: number[],
  user: EffectiveUser,
  options: ReadFilesServerOptions = {}
): Promise<CompressedAugmentedFile[]> {
  const { executeQueries = false } = options;

  if (!executeQueries) {
    const augmented = await readFilesImpl(fileIds, user);
    return augmented.map(compressAugmentedFile);
  }

  // With query execution: re-run augmentation with actual query results
  const results: CompressedAugmentedFile[] = [];
  for (const fileId of fileIds) {
    try {
      const fileResult = await FilesAPI.loadFile(fileId, user);
      if (!fileResult.data) continue;

      const file = fileResult.data;
      const refs = fileResult.metadata?.references ?? [];
      const inheritedParams = getRootParamsFromContent(file.type, file.content);

      const fileState = dbFileToFileState(file);
      const refFileStates = refs.map(ref =>
        buildEffectiveReference(dbFileToFileState(ref), inheritedParams)
      );

      const queryResults = await executeQueriesForFile(file, refs, inheritedParams, user);
      results.push(compressAugmentedFile({ fileState, references: refFileStates, queryResults }));
    } catch {
      // Skip files that fail to load
    }
  }

  return results;
}

/**
 * getAppStateServer — build app state for a single file (for tool context).
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

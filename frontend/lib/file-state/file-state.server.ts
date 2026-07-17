/**
 * Server-side File State — read-only file access for tool handlers, MCP tools,
 * test runners, and cron jobs.
 *
 * readFilesServer() is the compressed variant for LLM tool responses.
 */
import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { runQueryBounded } from '@/lib/connections/run-query';
import { applyNoneParams } from '@/lib/sql/none-params';
import { connectionTypeToDialect } from '@/lib/types';
import { getQueryHash } from '@/lib/utils/query-hash';
import {
  compressAugmentedFile,
  dbFileToFileState,
  AGENT_DRAIN_MAX_BYTES,
  AGENT_DRAIN_MAX_ROWS,
} from '@/lib/chat/compress-augmented';
import {
  getRootParamsFromContent,
  resolveEffectiveParams,
  buildEffectiveReference,
  storyEmbedRuns,
} from '@/lib/data/helpers/param-resolution';
import type { QuestionParameter } from '@/lib/validation/atlas-schemas';
import type { ReadFilesOptions } from '@/lib/file-state/file-state-interface';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type {
  DbFile,
  AugmentedFile,
  CompressedAugmentedFile,
  QuestionContent,
  QueryResult,
} from '@/lib/types';
import { runSpreadsheetSource } from '@/lib/spreadsheet/materialize';

// ---------------------------------------------------------------------------
// Internal implementations (take explicit user param)
// ---------------------------------------------------------------------------

async function readFilesImpl(
  fileIds: number[],
  user: EffectiveUser,
   
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

  // Resolve (and cache) a connection's SQL dialect — needed for the None-param IR transform.
  const dialectCache = new Map<string, string>();
  const getDialect = async (connectionName: string): Promise<string> => {
    const cached = dialectCache.get(connectionName);
    if (cached !== undefined) return cached;
    const raw = await ConnectionsAPI.getRawByName(connectionName, user.mode).catch(() => null);
    const dialect = connectionTypeToDialect(raw?.type ?? '');
    dialectCache.set(connectionName, dialect);
    return dialect;
  };

  // Execute one query with ALREADY-RESOLVED (canonical) params and push its result, keyed by the
  // same query hash the client cache uses so ids line up. None (null) params are handled exactly as
  // the /api/query route does (applyNoneParams: IR filter removal + NULL substitution) so an unset
  // numeric param means "no filter" rather than binding `:p` to nothing (SQL error). Errors (incl.
  // SQL parser errors) are pushed as a result-with-error so the agent SEES them, never thrown.
  const runResolved = async (query: string, connectionName: string, params: Record<string, unknown>): Promise<void> => {
    // The cache id keys on the CANONICAL params (incl. nulls) — matches the file's queryResultId.
    const id = getQueryHash(query, params, connectionName);
    const paramsForNone: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === null || typeof v === 'string' || typeof v === 'number') paramsForNone[k] = v;
      else if (v !== undefined) paramsForNone[k] = String(v);
    }
    try {
      const { sql, params: execParams } = await applyNoneParams(query, paramsForNone, await getDialect(connectionName));
      // Bounded: many-question file reads accumulate N results — cap each so peak RAM is N × budget.
      const result = await runQueryBounded(connectionName, sql, execParams, user, { maxBytes: AGENT_DRAIN_MAX_BYTES, maxRows: AGENT_DRAIN_MAX_ROWS });
      results.push({ ...result, id });
    } catch (err) {
      results.push({
        columns: [], types: [], rows: [], id,
        error: err instanceof Error ? err.message : 'Query failed',
      } as QueryResult & { error: string });
    }
  };

  // Run one question (saved or inline), resolving its declared params against the inherited
  // (story/dashboard) params first.
  const runOne = async (
    query: string | undefined,
    connectionName: string | undefined,
    parameters: QuestionParameter[] | null | undefined,
    ownParamValues: Record<string, unknown>,
  ): Promise<void> => {
    if (!query || !connectionName) return;
    const params = parameters?.length
      ? resolveEffectiveParams(parameters, ownParamValues, inheritedParams)
      : ownParamValues;
    await runResolved(query, connectionName, params);
  };

  const execQuestion = async (q: DbFile): Promise<void> => {
    if (q.type !== 'question') return;
    const content = q.content as QuestionContent;
    if (content.spreadsheet) {
      const materialized = runSpreadsheetSource(content.spreadsheet);
      if (materialized.ok) results.push(materialized.data);
      else {
        results.push({
          columns: [], types: [], rows: [],
          id: getQueryHash(`spreadsheet:invalid:${q.id}`, {}, ''),
          error: materialized.errors.map(error => error.message).join(' '),
        } as QueryResult & { error: string });
      }
      return;
    }
    await runOne(content.query, content.connection_name, content.parameters, content.parameterValues ?? {});
  };

  // A story's INLINE <Question> + <Number> embeds (no saved file) are live queries the agent must
  // see the result — and crucially the parser ERROR — of. storyEmbedRuns is the SAME extraction
  // the client augmentation uses, so params (and therefore query hashes) line up exactly. Saved
  // <Question id>/<Number id> figures point to a question file and run via execQuestion (references).
  const execStoryEmbeds = async (storyFile: DbFile): Promise<void> => {
    if (storyFile.type !== 'story') return;
    const html = (storyFile.content as { story?: string | null } | null)?.story;
    for (const r of storyEmbedRuns(html, inheritedParams)) {
      await runResolved(r.query, r.connection, r.params);
    }
  };

  await execQuestion(file);
  await execStoryEmbeds(file);
  await Promise.all(references.map(ref => execQuestion(ref)));

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReadFilesServerOptions {
  /** Execute queries for question files. Default: false */
  executeQueries?: boolean;
  /** Max characters of compressed text per file (truncates query-result markdown). Default: LIMIT_CHARS. */
  maxChars?: number;
}

/**
 * readFilesServer — load files and return compressed output for LLM tool responses.
 */
export async function readFilesServer(
  fileIds: number[],
  user: EffectiveUser,
  options: ReadFilesServerOptions = {}
): Promise<CompressedAugmentedFile[]> {
  const { executeQueries = false, maxChars } = options;

  if (!executeQueries) {
    const augmented = await readFilesImpl(fileIds, user);
    // Explicit arrow: `.map(compressAugmentedFile)` would pass the array index as maxChars.
    return augmented.map(a => compressAugmentedFile(a, maxChars));
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
      results.push(compressAugmentedFile({ fileState, references: refFileStates, queryResults }, maxChars));
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

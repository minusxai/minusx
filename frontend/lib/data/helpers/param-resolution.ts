/**
 * Param resolution helpers — pure functions for computing effective query
 * parameters as they cascade through a file reference hierarchy.
 *
 * Used by file selectors (selectAugmentedFiles) to build AugmentedFile objects
 * with correct per-context query result IDs and parameter snapshots.
 */

import type { RootState } from '@/store/store';
import { selectFile, selectMergedContent, type FileState } from '@/store/filesSlice';
import { selectQueryResult } from '@/store/queryResultsSlice';
import { getQueryHash } from '@/lib/utils/query-hash';
import { extractInlineQuestions } from '@/lib/data/story/story-question';
import { extractInlineNumbers } from '@/lib/data/story/story-number';
import { bindReferencedParams, buildQueryParamValues } from '@/lib/sql/sql-params';
import type { DocumentContent, QuestionContent, QuestionParameter, QueryResult, NotebookContent } from '@/lib/types';

/**
 * Extracts inherited params from a file's content directly.
 * Shared by both client (via selectMergedContent) and server (via DbFile.content).
 * Dashboards AND stories pass their parameterValues down to all embeds/references (so a story
 * <Param> default drives its inline <Question>/<Number> embeds the same way a dashboard filter
 * drives its tiles); everything else returns {}.
 */
export function getRootParamsFromContent(type: string, content: any): Record<string, any> {
  if (type === 'dashboard' || type === 'story') {
    return (content as DocumentContent)?.parameterValues || {};
  }
  return {};
}

/**
 * Extracts the initial inherited params for the root file being augmented.
 * Client-side version: reads merged content (including unsaved edits) from Redux.
 */
export function getRootParams(state: RootState, fileState: FileState): Record<string, any> {
  const content = selectMergedContent(state, fileState.id);
  return getRootParamsFromContent(fileState.type, content);
}

/**
 * Resolves effective parameter values for a question — THE canonical key for a question's query
 * (execution, cache store/lookup, and queryResultId all key on this exact dict).
 *
 * Merges the question's own parameterValues with inherited params (inherited wins), filtered to
 * only params the question defines (unrelated inherited params are dropped — no sibling pollution),
 * and applies the type-aware None coercion: an unset / empty-string NUMBER param → null. This is
 * the same normalization a question's query is EXECUTED with (`buildQueryParamValues`), so the
 * cache key the augmentation looks up under == the key the result is stored under == queryResultId.
 * (Keying on the raw `''` here was the param-keying bug: the executor stored under null, so the
 * lookup never found the result and queryResults came back empty.)
 */
export function resolveEffectiveParams(
  parameters: QuestionParameter[],
  ownParamValues: Record<string, any>,
  inheritedParams: Record<string, any>
): Record<string, any> {
  return buildQueryParamValues(parameters, ownParamValues, inheritedParams);
}

/**
 * Builds an effective FileState for a reference viewed in a parent's context.
 *   - Strips ephemeralChanges: the reference's transient state (lastExecuted, etc.)
 *     pertains to its own page, not to the parent context.
 *   - Patches question parameters to reflect effective inherited values.
 *     queryResultIDs are computed here from the effective params.
 */
export function buildEffectiveReference(refFile: FileState, inheritedParams: Record<string, any>): FileState {
  const stripped = { ...refFile, ephemeralChanges: {} };
  if (refFile.type !== 'question' || !refFile.content) return stripped;
  const content = refFile.content as QuestionContent;

  const ownParamValues = content.parameterValues ?? {};
  const effectiveParamsDict = content.parameters?.length
    ? resolveEffectiveParams(content.parameters, ownParamValues, inheritedParams)
    : {};
  const effectiveQueryResultId = content.query && content.connection_name
    ? getQueryHash(content.query, effectiveParamsDict, content.connection_name)
    : refFile.queryResultId;
  return {
    ...stripped,
    queryResultId: effectiveQueryResultId,
    // Propagate effective params into content so compressFileState recomputes the hash
    // from inherited values, not the question's standalone defaults.
    content: { ...content, parameterValues: effectiveParamsDict },
  };
}

/**
 * Recursively collects query results for a file and all its references,
 * cascading inherited params down the hierarchy.
 *
 * Mental model: params always flow down the reference stack.
 * - A dashboard passes its parameterValues to its questions.
 * - A question passes those same params to any questions it references.
 * - Each file uses inheritedParams as overrides for the params it defines.
 *   Params the file does not define are not included in its cache hash
 *   (no cross-question pollution).
 */
/**
 * A single query a story's body wants run: an inline `<Question query>` or an inline `<Number query>`.
 * Both the client (augmentWithParams) and the server (executeQueriesForFile) plus the EditFile
 * auto-execute must run/look-up the SAME set with the SAME params so their query hashes line up —
 * so the extraction lives here once. Inline questions resolve their declared params against the
 * story's inherited params; inline numbers carry no declared params and key on {}.
 */
export interface StoryEmbedRun { query: string; connection: string; params: Record<string, unknown>; }

export function storyEmbedRuns(
  html: string | null | undefined,
  inheritedParams: Record<string, any>,
): StoryEmbedRun[] {
  const runs: StoryEmbedRun[] = [];
  for (const e of extractInlineQuestions(html)) {
    if (!e.query || !e.connection) continue;
    runs.push({
      query: e.query,
      connection: e.connection,
      params: e.parameters?.length ? resolveEffectiveParams(e.parameters, {}, inheritedParams) : {},
    });
  }
  for (const e of extractInlineNumbers(html)) {
    if (!e.query || !e.connection) continue;
    // Inline numbers declare no `parameters` list, so bind the story params their SQL references
    // (`:name`) directly — this is what lets a story <Param> (e.g. a min_mrr slider) drive a live
    // <Number>. The renderer (InlineNumber) binds with the SAME helper, so the hashes line up.
    runs.push({ query: e.query, connection: e.connection, params: bindReferencedParams(e.query, inheritedParams) });
  }
  return runs;
}

/** Look up one query's cached result and store it in the augmentation map (data, else error). */
function setCachedResult(
  result: Map<string, QueryResult>,
  state: RootState,
  query: string,
  params: Record<string, unknown>,
  connection: string,
): void {
  const qr = selectQueryResult(state, query, params, connection);
  const id = getQueryHash(query, params, connection);
  if (qr?.data) {
    result.set(id, { ...(qr.data || {}), id });
  } else if (qr?.error) {
    result.set(id, { columns: [], types: [], rows: [], id, error: qr.error } as QueryResult & { error: string });
  }
}

export function augmentWithParams(
  state: RootState,
  fileState: FileState,
  inheritedParams: Record<string, any>
): Map<string, QueryResult> {
  const result = new Map<string, QueryResult>();

  // Questions execute SQL — look up the cached result using effective params.
  // Dashboards do not execute their own query; only their references do.
  if (fileState.type === 'question') {
    const content = selectMergedContent(state, fileState.id) as QuestionContent;
    if (content?.query) {
      const params = resolveEffectiveParams(content.parameters || [], content.parameterValues ?? {}, inheritedParams);
      setCachedResult(result, state, content.query, params, content.connection_name);
    }
  }

  // Notebook SQL cells are inline questions — collect each cell's cached result
  // (keyed on the cell's own query/params/connection) so the agent sees results
  // after an EditFile or a manual Run, just like a standalone question.
  if (fileState.type === 'notebook') {
    const content = selectMergedContent(state, fileState.id) as NotebookContent | undefined;
    for (const cell of content?.cells ?? []) {
      if (cell.type !== 'sql' || !cell.query || !cell.connection_name) continue;
      setCachedResult(result, state, cell.query, cell.parameterValues ?? {}, cell.connection_name);
    }
  }

  // Story bodies embed INLINE questions + numbers (no saved file) — collect each one's cached
  // result (or parser error), mirroring the server's executeQueriesForFile so app-state and
  // ReadFiles agree. Shared extraction (storyEmbedRuns) keeps the params/hashes identical.
  if (fileState.type === 'story') {
    const content = selectMergedContent(state, fileState.id) as { story?: string | null } | undefined;
    for (const r of storyEmbedRuns(content?.story, inheritedParams)) {
      setCachedResult(result, state, r.query, r.params, r.connection);
    }
  }

  // Cascade the same inherited params to all references.
  // Covers: dashboard → questions, question → referenced questions, etc.
  // Use Array.isArray so a malformed (truthy, non-iterable) `references` value
  // — which can leak in from FileInfo metadata updates — doesn't crash the
  // selector on every render with "object is not iterable".
  const refs = Array.isArray(fileState.references) ? fileState.references : [];
  for (const refId of refs) {
    const refFile = selectFile(state, refId);
    if (refFile) {
      for (const [key, qr] of augmentWithParams(state, refFile, inheritedParams)) {
        result.set(key, qr);
      }
    }
  }

  return result;
}

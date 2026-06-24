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
import { extractInlineQuestions } from '@/lib/data/story-question';
import type { DocumentContent, QuestionContent, QuestionParameter, QueryResult, NotebookContent } from '@/lib/types';

/**
 * Extracts inherited params from a file's content directly.
 * Shared by both client (via selectMergedContent) and server (via DbFile.content).
 * Dashboards pass their parameterValues down to all references; everything else returns {}.
 */
export function getRootParamsFromContent(type: string, content: any): Record<string, any> {
  if (type === 'dashboard') {
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
 * Resolves effective parameter values for a question.
 * Merges the question's own parameterValues with inherited params (inherited wins).
 * Returns a dict filtered to only params the question defines.
 *
 * Only params the question itself defines are included; unrelated inherited
 * params are dropped (prevents sibling-question param pollution in the hash).
 */
export function resolveEffectiveParams(
  parameters: QuestionParameter[],
  ownParamValues: Record<string, any>,
  inheritedParams: Record<string, any>
): Record<string, any> {
  const dict: Record<string, any> = {};
  for (const p of parameters) {
    dict[p.name] = Object.prototype.hasOwnProperty.call(inheritedParams, p.name)
      ? inheritedParams[p.name]
      : (ownParamValues[p.name] ?? '');
  }
  return dict;
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
      const ownParamValues = content.parameterValues ?? {};
      const params = resolveEffectiveParams(content.parameters || [], ownParamValues, inheritedParams);
      const qr = selectQueryResult(state, content.query, params, content.connection_name);
      const id = getQueryHash(content.query, params, content.connection_name);
      if (qr?.data) {
        result.set(id, { ...(qr.data || {}), id });
      } else if (qr?.error) {
        result.set(id, { columns: [], types: [], rows: [], id, error: qr.error } as any);
      }
    }
  }

  // Notebook SQL cells are inline questions — collect each cell's cached result
  // (keyed on the cell's own query/params/connection) so the agent sees results
  // after an EditFile or a manual Run, just like a standalone question.
  if (fileState.type === 'notebook') {
    const content = selectMergedContent(state, fileState.id) as NotebookContent | undefined;
    for (const cell of content?.cells ?? []) {
      if (cell.type !== 'sql' || !cell.query || !cell.connection_name) continue;
      const params = cell.parameterValues ?? {};
      const qr = selectQueryResult(state, cell.query, params, cell.connection_name);
      const id = getQueryHash(cell.query, params, cell.connection_name);
      if (qr?.data) {
        result.set(id, { ...(qr.data || {}), id });
      } else if (qr?.error) {
        result.set(id, { columns: [], types: [], rows: [], id, error: qr.error } as any);
      }
    }
  }

  // Story bodies embed INLINE questions (`data-question-inline`, no saved file) — collect each
  // one's cached result keyed on its own query/params/connection, mirroring the server's
  // executeQueriesForFile so app-state and ReadFiles agree. Params match the server: an inline
  // question with declared params resolves them against the story's inherited params; otherwise {}.
  if (fileState.type === 'story') {
    const content = selectMergedContent(state, fileState.id) as { story?: string | null } | undefined;
    for (const e of extractInlineQuestions(content?.story)) {
      if (!e.query || !e.connection) continue;
      const params = e.parameters?.length ? resolveEffectiveParams(e.parameters, {}, inheritedParams) : {};
      const qr = selectQueryResult(state, e.query, params, e.connection);
      const id = getQueryHash(e.query, params, e.connection);
      if (qr?.data) {
        result.set(id, { ...(qr.data || {}), id });
      } else if (qr?.error) {
        result.set(id, { columns: [], types: [], rows: [], id, error: qr.error } as QueryResult & { error: string });
      }
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

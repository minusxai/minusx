'use client';

/**
 * QuestionContainer V2 - Phase 3 Implementation
 * Smart component using Core Patterns with useFile hook and useQueryResult
 *
 * Phase 3 Improvements:
 * - Uses useQueryResult hook for query execution with TTL caching
 * - Tracks lastExecuted query in ephemeralChanges
 * - Explicit execute pattern (editing doesn't trigger execution)
 * - Shows old results while editing query
 * - Background refetch for stale data
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shallowEqual } from 'react-redux';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, setEphemeral, setFile, type FileId } from '@/store/filesSlice';
import { clearQueryResult } from '@/store/queryResultsSlice';
import { selectProposedQuery, selectFileEditMode, selectQuestionCollapsedPanel, setQuestionCollapsedPanel } from '@/store/uiSlice';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { editFile, getQueryResult } from '@/lib/file-state/file-state';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import { QuestionContent, type DbFile } from '@/lib/types';
import { type FileViewMode } from '@/lib/ui/fileComponents';
import { selectEffectiveUser, selectView } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { viewAtLeast } from '@/lib/view/view-types';
import { useSearchParams } from 'next/navigation';

interface QuestionContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  /** Force read-only regardless of role — e.g. inspecting a view's definition. */
  readOnly?: boolean;
}

/**
 * Smart component for question pages - Phase 3
 * Uses useFile for file state + useQueryResult for query execution
 * Delegates rendering to QuestionViewV2 (dumb component)
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView
 */
export default function QuestionContainerV2({ fileId, mode: containerMode, readOnly: readOnlyProp }: QuestionContainerV2Props) {
  const dispatch = useAppDispatch();

  // Read URL param overrides (p.start_date=... → { start_date: ... })
  const searchParams = useSearchParams();
  const urlParamOverrides = useMemo(() => {
    const values: Record<string, string> = {};
    let hasAny = false;
    searchParams.forEach((value, key) => {
      if (key.startsWith('p.')) {
        values[key.slice(2)] = value;
        hasAny = true;
      }
    });
    return hasAny ? values : undefined;
  }, [searchParams]);

  // Phase 3: Use useFile hook for file state management (purely reactive)
  const { fileState: file } = useFile(fileId) ?? {};

  // Convert fileId to number for questionId (handle both number and 'new' string).
  // Computed early (above the loading early-return below) since several Redux reads
  // that used to live inside QuestionViewV2 key off it.
  const questionId = typeof fileId === 'number' ? fileId : undefined;

  // Derive readOnly from the user's role — prevents persistable changes for non-editors.
  // An explicit `readOnly` prop forces it on regardless (e.g. viewing a view's definition).
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const readOnly = readOnlyProp || (!!effectiveUser && !!file && !canCreateFileByRole(effectiveUser.role, file.type as 'question'));
  const fileLoading = !file || file.loading;

  // --- Redux state that used to live directly inside QuestionViewV2 (a Container/View
  // convention violation) — now read here and passed down as props. See CLAUDE.md
  // "Component Patterns". ---
  const editMode = useAppSelector(state => selectFileEditMode(state, questionId ?? -1));
  const collapsedPanel = useAppSelector(selectQuestionCollapsedPanel);
  // shallowEqual avoids re-rendering when Immer rotates the bag's top-level ref on an
  // unrelated write.
  const filesState = useAppSelector(state => state.files.files, shallowEqual);
  const view = useAppSelector(selectView);

  const onTogglePanel = useCallback((panel: 'none' | 'left' | 'right') => {
    dispatch(setQuestionCollapsedPanel(panel));
  }, [dispatch]);

  const onSetFile = useCallback((referencedFile: DbFile) => {
    dispatch(setFile({ file: referencedFile, references: [] }));
  }, [dispatch]);

  // Embedded content view (view >= content): default the full-page split to showing
  // the viz expanded (collapse the left/query panel) on mount. This sets real state
  // so the panel toggles keep working — the user can re-open the query if they want.
  useEffect(() => {
    if (viewAtLeast(view, 'content')) {
      dispatch(setQuestionCollapsedPanel('left'));
    }
  }, [view, dispatch]);

  // Phase 3: Get merged content (content + persistableChanges + ephemeralChanges)
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as QuestionContent | undefined;

  // Phase 3: Get query to execute (from ephemeralChanges.lastExecuted or fallback to current)
  // lastExecuted tracks what was most recently *explicitly* executed (user click or auto-execute).
  // We display results for lastExecuted so edits don't wipe out visible results mid-typing.
  const lastExecuted = file?.ephemeralChanges?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    // Canonical params (effective + None-coerced) so the execution cache key matches the
    // augmentation lookup / queryResultId — see buildQueryParamValues / resolveEffectiveParams.
    params: buildQueryParamValues(mergedContent?.parameters ?? [], mergedContent?.parameterValues ?? {}, {}),
    database: mergedContent?.connection_name || ''
  };

  // Build a name→type map from the declared parameters so asyncpg can coerce date strings
  const parameterTypes = useMemo(() => {
    if (!mergedContent?.parameters?.length) return undefined;
    return Object.fromEntries(mergedContent.parameters.map(p => [p.name, p.type])) as Record<string, 'text' | 'number' | 'date'>;
  }, [mergedContent?.parameters]);

  // Per-file cache SWR windows (content.cachePolicy) — forwarded so /api/query honors them.
  // Memoized on the field values so the query effect isn't re-fired by an unstable object identity.
  const cachePolicy = mergedContent?.cachePolicy;
  const cachePolicyOpt = useMemo(
    () => (cachePolicy ? { revalidateMs: cachePolicy.revalidateMs ?? undefined, expiryMs: cachePolicy.expiryMs ?? undefined } : undefined),
    [cachePolicy?.revalidateMs, cachePolicy?.expiryMs],
  );

  // Ref-based guard: ensures we auto-execute exactly once per mount with the *current*
  // mergedContent (which includes persistableChanges). This means every fresh mount —
  // whether on the file page, inside a dashboard, or in the PublishModal right-pane —
  // will run the up-to-date query, not whatever lastExecuted holds from a prior session.
  const hasAutoExecutedRef = useRef(false);

  // Fetch estimated duration for the current query from analytics history
  const [queryEstimatedDurationMs, setQueryEstimatedDurationMs] = useState<number | null>(null);
  useEffect(() => {
    const q = queryToExecute.query;
    const db = queryToExecute.database;
    if (!q || !db || (file?.draft && !lastExecuted)) return;
    fetch('/api/query-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, params: queryToExecute.params, database: db }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data?.estimated_duration_ms != null) {
          setQueryEstimatedDurationMs(d.data.estimated_duration_ms);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryToExecute.query, queryToExecute.database]);

  // Phase 3: Use useQueryResult hook for query execution with caching
  const { data: queryData, loading: queryLoading, error: queryError, isStale: queryStale } = useQueryResult(
    queryToExecute.query,
    queryToExecute.params,
    queryToExecute.database,
    { skip: !queryToExecute.query || (!!file?.draft && !lastExecuted), parameterTypes, filePath: file?.path, cachePolicy: cachePolicyOpt }
  );

  // Phase 3: Update current state handler - uses editFile from file-state.ts
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    if (readOnly) return;
    editFile({ fileId, changes: { content: updates } });
  }, [fileId, readOnly]);

  // Phase 3: Execute query handler - updates lastExecuted to trigger execution.
  // `force` (a deliberate Run / param submit) additionally forces a fresh SERVER
  // execution that refreshes the durable cache — without it the cleared client
  // cache just gets re-served from the server's cache. Auto-execute on mount calls
  // this WITHOUT force, so navigating to a question stays cache-served.
  const handleExecute = useCallback((overrideParamValues?: Record<string, any>, opts?: { force?: boolean }) => {
    if (!mergedContent) return;

    // Priority: explicit override > URL params merged with content > content params
    const baseValues = mergedContent.parameterValues ?? {};
    const sourceValues = overrideParamValues
      ?? (urlParamOverrides ? { ...baseValues, ...urlParamOverrides } : baseValues);
    // Canonicalize (effective + None-coerced) so the cache key matches the augmentation lookup.
    const effectiveValues = buildQueryParamValues(mergedContent.parameters ?? [], sourceValues, {});

    const newQuery = {
      query: mergedContent.query,
      params: effectiveValues,
      database: mergedContent.connection_name
    };

    dispatch(clearQueryResult({ query: newQuery.query, params: effectiveValues, database: newQuery.database }));
    dispatch(setEphemeral({
      fileId,
      changes: { lastExecuted: newQuery }
    }));

    // Deliberate Run → force a fresh server execution + cache refresh. The declarative
    // useQueryResult effect that fires on the lastExecuted change dedups onto this same
    // in-flight request (queryPromiseManager keyed by query/params/db), so it's one hit.
    if (opts?.force) {
      getQueryResult(
        { ...newQuery, parameterTypes, filePath: file?.path },
        { forceLoad: true },
      ).catch(() => { /* error already lands in Redux */ });
    }
  }, [mergedContent, fileId, dispatch, urlParamOverrides, parameterTypes, file?.path]);

  // Auto-execute once per mount with current mergedContent (includes persistableChanges).
  // Using a ref (not lastExecuted) as the guard so every fresh mount runs the current query —
  // even if lastExecuted is stale from a prior edit session on this file.
  // Skip auto-execute for draft files — user should explicitly run with Cmd+Enter.
  useEffect(() => {
    if (!file || !mergedContent) return;
    if (hasAutoExecutedRef.current) return;
    if (file.draft) return;

    hasAutoExecutedRef.current = true;
    handleExecute();
  }, [file, mergedContent, handleExecute]);

  // Restore lastExecuted when cleared (e.g., after Cancel) so queryToExecute
  // doesn't become reactive to mergedContent, which would auto-execute on every edit.
  useEffect(() => {
    if (!mergedContent || !hasAutoExecutedRef.current || lastExecuted) return;
    const baseValues = mergedContent.parameterValues || {};
    const sourceValues = urlParamOverrides ? { ...baseValues, ...urlParamOverrides } : baseValues;
    const restoredParams = buildQueryParamValues(mergedContent.parameters ?? [], sourceValues, {});
    dispatch(setEphemeral({
      fileId,
      changes: {
        lastExecuted: {
          query: mergedContent.query,
          params: restoredParams,
          database: mergedContent.connection_name
        }
      }
    }));
  }, [lastExecuted, mergedContent, fileId, dispatch, urlParamOverrides]);

  // Handle parameter value change — persisted into file content (marks file dirty)
  const handleParameterValueChange = useCallback((paramName: string, value: string | number | null) => {
    if (readOnly) return;
    const currentValues = mergedContent?.parameterValues || {};
    editFile({ fileId, changes: { content: { parameterValues: { ...currentValues, [paramName]: value } } } });
  }, [fileId, mergedContent, readOnly]);

  // Every call from the view's onExecute is a deliberate user Run (Run button,
  // Cmd+Enter, param submit) → force a server refresh. Internal auto-execute calls
  // handleExecute directly (no force) so navigation stays cache-served.
  const handleExecuteForced = useCallback(
    (overrideParamValues?: Record<string, any>) => handleExecute(overrideParamValues, { force: true }),
    [handleExecute],
  );

  // Get proposed query from UI state (set by UserInputComponent for diff view)
  const proposedQuery = useAppSelector(state =>
    selectProposedQuery(state, typeof fileId === 'number' ? fileId : undefined)
  );

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <div>Loading question...</div>;
  }

  // In preview mode, pass the original (saved) query for diff display
  const originalQuery = containerMode === 'preview'
    ? (file.content as QuestionContent | null)?.query
    : undefined;

  return (
    <QuestionViewV2
      viewMode='page'
      content={mergedContent}
      filePath={file?.path}
      questionId={questionId}
      queryData={queryData}
      queryLoading={queryLoading}
      queryError={queryError}
      queryStale={queryStale}
      queryEstimatedDurationMs={queryEstimatedDurationMs}
      lastSubmittedParamValues={lastExecuted?.params}
      proposedQuery={containerMode === 'preview' ? undefined : proposedQuery}
      originalQuery={originalQuery}
      mode={containerMode}
      readOnly={readOnly}
      editMode={editMode}
      collapsedPanel={collapsedPanel}
      onTogglePanel={onTogglePanel}
      fileState={filesState}
      onSetFile={onSetFile}
      onChange={handleChange}
      onParameterValueChange={handleParameterValueChange}
      onExecute={handleExecuteForced}
    />
  );
}

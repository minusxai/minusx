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
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, setEphemeral, type FileId } from '@/store/filesSlice';
import { selectProposedQuery } from '@/store/uiSlice';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import { QuestionContent } from '@/lib/types';
import { type FileViewMode } from '@/lib/ui/fileComponents';
import { selectEffectiveUser } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';

interface QuestionContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

/**
 * Smart component for question pages - Phase 3
 * Uses useFile for file state + useQueryResult for query execution
 * Delegates rendering to QuestionViewV2 (dumb component)
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView
 */
export default function QuestionContainerV2({ fileId, mode: containerMode }: QuestionContainerV2Props) {
  const dispatch = useAppDispatch();

  // Phase 3: Use useFile hook for file state management (purely reactive)
  const { fileState: file } = useFile(fileId) ?? {};

  // Derive readOnly from the user's role — prevents persistable changes for non-editors
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const readOnly = !!effectiveUser && !!file && !canCreateFileByRole(effectiveUser.role, file.type as 'question');
  const fileLoading = !file || file.loading;

  // Phase 3: Get merged content (content + persistableChanges + ephemeralChanges)
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as QuestionContent | undefined;

  // Phase 3: Get query to execute (from ephemeralChanges.lastExecuted or fallback to current)
  // lastExecuted tracks what was most recently *explicitly* executed (user click or auto-execute).
  // We display results for lastExecuted so edits don't wipe out visible results mid-typing.
  const lastExecuted = file?.ephemeralChanges?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: mergedContent?.parameterValues || {},
    database: mergedContent?.connection_name || '',
    references: mergedContent?.references || []
  };

  // Build a name→type map from the declared parameters so asyncpg can coerce date strings
  const parameterTypes = useMemo(() => {
    if (!mergedContent?.parameters?.length) return undefined;
    return Object.fromEntries(mergedContent.parameters.map(p => [p.name, p.type])) as Record<string, 'text' | 'number' | 'date'>;
  }, [mergedContent?.parameters]);

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
    if (!q || !db) return;
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
    queryToExecute.references,
    { skip: !queryToExecute.query, parameterTypes, filePath: file?.path }  // Skip if no query
  );

  // Phase 3: Update current state handler - uses editFile from file-state.ts
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    if (readOnly) return;
    editFile({ fileId, changes: { content: updates } });
  }, [fileId, readOnly]);

  // Phase 3: Execute query handler - updates lastExecuted to trigger execution
  const handleExecute = useCallback((overrideParamValues?: Record<string, any>) => {
    if (!mergedContent) return;

    const effectiveValues = overrideParamValues ?? mergedContent.parameterValues ?? {};

    const newQuery = {
      query: mergedContent.query,
      params: effectiveValues,
      database: mergedContent.connection_name,
      references: mergedContent.references || []
    };

    dispatch(setEphemeral({
      fileId,
      changes: { lastExecuted: newQuery }
    }));
  }, [mergedContent, fileId, dispatch]);

  // Auto-execute once per mount with current mergedContent (includes persistableChanges).
  // Using a ref (not lastExecuted) as the guard so every fresh mount runs the current query —
  // even if lastExecuted is stale from a prior edit session on this file.
  useEffect(() => {
    if (!file || !mergedContent) return;
    if (hasAutoExecutedRef.current) return;

    hasAutoExecutedRef.current = true;
    handleExecute();
  }, [file, mergedContent, handleExecute]);

  // Restore lastExecuted when cleared (e.g., after Cancel) so queryToExecute
  // doesn't become reactive to mergedContent, which would auto-execute on every edit.
  useEffect(() => {
    if (!mergedContent || !hasAutoExecutedRef.current || lastExecuted) return;
    dispatch(setEphemeral({
      fileId,
      changes: {
        lastExecuted: {
          query: mergedContent.query,
          params: mergedContent.parameterValues || {},
          database: mergedContent.connection_name,
          references: mergedContent.references || []
        }
      }
    }));
  }, [lastExecuted, mergedContent, fileId, dispatch]);

  // Handle parameter value change — persisted into file content (marks file dirty)
  const handleParameterValueChange = useCallback((paramName: string, value: string | number | null) => {
    if (readOnly) return;
    const currentValues = mergedContent?.parameterValues || {};
    editFile({ fileId, changes: { content: { parameterValues: { ...currentValues, [paramName]: value } } } });
  }, [fileId, mergedContent, readOnly]);

  // Get proposed query from UI state (set by UserInputComponent for diff view)
  const proposedQuery = useAppSelector(state =>
    selectProposedQuery(state, typeof fileId === 'number' ? fileId : undefined)
  );

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <div>Loading question...</div>;
  }

  // Convert fileId to number for questionId (handle both number and 'new' string)
  const questionId = typeof fileId === 'number' ? fileId : undefined;

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
      onChange={handleChange}
      onParameterValueChange={handleParameterValueChange}
      onExecute={handleExecute}
    />
  );
}

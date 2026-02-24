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
import { useCallback, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectEphemeralParamValues, setEphemeral, type FileId } from '@/store/filesSlice';
import { selectProposedQuery } from '@/store/uiSlice';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import { QuestionContent } from '@/lib/types';

interface QuestionContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';  // Handled by FileHeader (rendered by FileView)
}

/**
 * Smart component for question pages - Phase 3
 * Uses useFile for file state + useQueryResult for query execution
 * Delegates rendering to QuestionViewV2 (dumb component)
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView
 */
export default function QuestionContainerV2({ fileId }: QuestionContainerV2Props) {
  const dispatch = useAppDispatch();

  // Phase 3: Use useFile hook for file state management (purely reactive)
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;

  // Phase 3: Get merged content (content + persistableChanges + ephemeralChanges)
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as QuestionContent | undefined;

  // Get ephemeral parameter values
  const ephemeralParamValues = useAppSelector(state => selectEphemeralParamValues(state, fileId));

  // Phase 3: Get query to execute (from ephemeralChanges.lastExecuted or fallback to current)
  // lastExecuted tracks what was most recently *explicitly* executed (user click or auto-execute).
  // We display results for lastExecuted so edits don't wipe out visible results mid-typing.
  const lastExecuted = file?.ephemeralChanges?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: (mergedContent?.parameters || []).reduce((acc, p) => ({
      ...acc,
      [p.name]: ephemeralParamValues[p.name] ?? p.defaultValue
    }), {}),
    database: mergedContent?.database_name || '',
    references: mergedContent?.references || []
  };

  // Ref-based guard: ensures we auto-execute exactly once per mount with the *current*
  // mergedContent (which includes persistableChanges). This means every fresh mount —
  // whether on the file page, inside a dashboard, or in the PublishModal right-pane —
  // will run the up-to-date query, not whatever lastExecuted holds from a prior session.
  const hasAutoExecutedRef = useRef(false);

  // Phase 3: Use useQueryResult hook for query execution with caching
  const { data: queryData, loading: queryLoading, error: queryError, isStale: queryStale } = useQueryResult(
    queryToExecute.query,
    queryToExecute.params,
    queryToExecute.database,
    queryToExecute.references,
    { skip: !queryToExecute.query }  // Skip if no query
  );

  // Phase 3: Update current state handler - uses editFile from file-state.ts
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    editFile({ fileId, changes: { content: updates } });
  }, [fileId]);

  // Phase 3: Execute query handler - updates lastExecuted to trigger execution
  const handleExecute = useCallback((overrideParamValues?: Record<string, any>) => {
    if (!mergedContent) return;

    const params = mergedContent.parameters || [];
    const effectiveValues = overrideParamValues || params.reduce((acc, p) => ({
      ...acc,
      [p.name]: ephemeralParamValues[p.name] ?? p.defaultValue
    }), {} as Record<string, any>);

    const newQuery = {
      query: mergedContent.query,
      params: effectiveValues,
      database: mergedContent.database_name,
      references: mergedContent.references || []
    };

    dispatch(setEphemeral({
      fileId,
      changes: { lastExecuted: newQuery }
    }));
  }, [mergedContent, fileId, dispatch, ephemeralParamValues]);

  // Auto-execute once per mount with current mergedContent (includes persistableChanges).
  // Using a ref (not lastExecuted) as the guard so every fresh mount runs the current query —
  // even if lastExecuted is stale from a prior edit session on this file.
  useEffect(() => {
    if (!file || !mergedContent) return;
    if (hasAutoExecutedRef.current) return;

    hasAutoExecutedRef.current = true;
    handleExecute();
  }, [file, mergedContent, handleExecute]);

  // Handle ephemeral parameter value change
  const handleParameterValueChange = useCallback((paramName: string, value: string | number) => {
    dispatch(setEphemeral({
      fileId,
      changes: { parameterValues: { ...ephemeralParamValues, [paramName]: value } }
    }));
  }, [fileId, dispatch, ephemeralParamValues]);

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
      ephemeralParamValues={ephemeralParamValues}
      lastSubmittedParamValues={lastExecuted?.params}
      proposedQuery={proposedQuery}
      onChange={handleChange}
      onParameterValueChange={handleParameterValueChange}
      onExecute={handleExecute}
    />
  );
}

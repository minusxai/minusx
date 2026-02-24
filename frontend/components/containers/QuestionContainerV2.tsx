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
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectIsDirty, selectMergedContent, selectEffectiveName, setEphemeral, type FileId } from '@/store/filesSlice';
import { selectProposedQuery } from '@/store/uiSlice';
import { useFile, useQueryResult, useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import PublishModal from '@/components/PublishModal';
import { QuestionContent, QuestionParameter } from '@/lib/types';
import { isUserFacingError } from '@/lib/errors';
import { last } from 'lodash';

interface QuestionContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';
}

/**
 * Smart component for question pages - Phase 3
 * Uses useFile for file state + useQueryResult for query execution
 * Delegates rendering to QuestionViewV2 (dumb component)
 */
export default function QuestionContainerV2({
  fileId,
  mode = 'view',
}: QuestionContainerV2Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Phase 3: Use useFile hook for file state management (purely reactive)
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Phase 3: Get merged content (content + persistableChanges + ephemeralChanges)
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as QuestionContent | undefined;

  // Phase 5: Get effective name (with pending metadata changes)
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';

  // Save error state (for user-facing errors)
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit mode state (controlled by container)
  const [editMode, setEditMode] = useState(mode === 'create');

  // Multi-file Publish workflow (Phase 1)
  const dirtyFiles = useDirtyFiles();
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // Handler for edit mode changes
  const handleEditModeChange = useCallback((mode: boolean) => {
    setEditMode(mode);
  }, []);

  // Automatically enter edit mode when file becomes dirty
  useEffect(() => {
    if (isDirty && !editMode) {
      handleEditModeChange(true);
    }
  }, [isDirty, editMode, handleEditModeChange]);

  // Phase 3: Get query to execute (from ephemeralChanges.lastExecuted or fallback to current)
  // lastExecuted tracks what was most recently *explicitly* executed (user click or auto-execute).
  // We display results for lastExecuted so edits don't wipe out visible results mid-typing.
  const lastExecuted = file?.ephemeralChanges?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: (mergedContent?.parameters || []).reduce((acc, p) => ({
      ...acc,
      [p.name]: p.value
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

  // Phase 3: Update metadata handler - uses editFile from file-state.ts
  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editFile({ fileId, changes });
  }, [fileId]);

  // Phase 3: Execute query handler - updates lastExecuted to trigger execution
  const handleExecute = useCallback((overrideParams?: QuestionParameter[]) => {
    // console.log('Executing query', mergedContent)
    if (!mergedContent) return;

    const params = overrideParams || mergedContent.parameters || [];
    const newQuery = {
      query: mergedContent.query,
      params: params.reduce((acc, p) => ({
        ...acc,
        [p.name]: p.value
      }), {}),
      database: mergedContent.database_name,
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

  // Phase 3: Save handler - uses publishFile from file-state.ts (handles both create and update)
  // Note: Name/description validation is handled by DocumentHeader
  const handleSave = useCallback(async () => {
    if (!mergedContent || !file) return;

    // Clear previous save error
    setSaveError(null);

    try {
      const result = await publishFile({ fileId });
      redirectAfterSave(result, fileId, router);
    } catch (error) {
      // User-facing errors should be shown in UI
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return; // Don't re-throw
      }

      // Internal errors should be logged
      console.error('Failed to save question:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [mergedContent, fileId, router, file]);

  // Phase 3: Cancel handler - uses clearFileChanges from file-state.ts
  const handleCancel = useCallback(() => {
    clearFileChanges({ fileId });
    setEditMode(false);
    setSaveError(null);
  }, [fileId]);

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
    <>
      <QuestionViewV2
        viewMode='page'
        content={mergedContent}
        fileName={effectiveName}
        filePath={file?.path}
        questionId={questionId}
        queryData={queryData}
        queryLoading={queryLoading}
        queryError={queryError}
        queryStale={queryStale}
        editMode={editMode}
        isDirty={isDirty}
        isSaving={saving}
        saveError={saveError}
        proposedQuery={proposedQuery}
        onChange={handleChange}
        onMetadataChange={handleMetadataChange}
        onExecute={handleExecute}
        onSave={handleSave}
        onCancel={handleCancel}
        onEditModeChange={handleEditModeChange}
        dirtyFileCount={dirtyFiles.length}
        onPublish={() => setIsPublishModalOpen(true)}
      />
      <PublishModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
      />
    </>
  );
}

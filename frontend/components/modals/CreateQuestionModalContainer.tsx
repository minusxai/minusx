'use client';

import { useState, useCallback, useEffect, MutableRefObject } from 'react';
import { Box, Button, HStack, Input, Text } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, clearFileChanges, createDraftFile, deleteFile } from '@/lib/api/file-state';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { selectMergedContent, selectEffectiveName, setEphemeral } from '@/store/filesSlice';
import { setFileEditMode } from '@/store/uiSlice';
import { QuestionContent } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';

interface CreateQuestionModalContainerProps {
  isOpen: boolean;
  onClose: () => void;
  onQuestionCreated: (id: number) => void;
  folderPath: string;
  questionId?: number;  // Draft or real positive ID, or undefined to self-create.
  onAttemptCloseRef?: MutableRefObject<(() => void) | null>;  // Ref for parent to call when user attempts to close
  /**
   * Explicitly controls whether this is a "fresh creation" that should be deleted
   * on cancel. When omitted, falls back to file.draft === true.
   *
   * Pass false when editing a draft question already added to the dashboard
   * (e.g. via the dashboard's "Edit" button) so cancel doesn't delete it.
   */
  isNewQuestion?: boolean;
}

/**
 * Smart container for creating OR editing questions in a modal
 * Manages virtual file lifecycle (create mode) or real file (edit mode)
 * Integrates with QuestionViewV2
 */
export default function CreateQuestionModalContainer({
  isOpen,
  onClose,
  onQuestionCreated,
  folderPath,
  questionId,
  onAttemptCloseRef,
  isNewQuestion,
}: CreateQuestionModalContainerProps) {
  const dispatch = useAppDispatch();
  const [virtualId, setVirtualId] = useState<number | undefined>(undefined);

  // Self-create a virtual file only when questionId is not provided by the caller.
  // The primary path (QuestionBrowserPanel → viewStack) always pre-creates and passes questionId.
  useEffect(() => {
    if (questionId !== undefined || virtualId !== undefined) return; // Skip if provided or already created

    createDraftFile('question', { folder: folderPath })
      .then(id => setVirtualId(id))
      .catch(err => console.error('[CreateQuestionModal] Failed to create draft file:', err));
  }, [questionId, virtualId, folderPath]);

  const effectiveId = questionId ?? virtualId;

  // Use useFile hook for state management (skip if no ID yet)
  const { fileState: file } = useFile(effectiveId) ?? {};
  const fileLoading = !file || file.loading;

  const mergedContent = useAppSelector(state => effectiveId ? selectMergedContent(state, effectiveId) as QuestionContent | undefined : undefined);
  const effectiveName = useAppSelector(state => effectiveId ? selectEffectiveName(state, effectiveId) || '' : '');

  // Local state
  const [saveError, setSaveError] = useState<string | null>(null);


  // Query execution state
  const lastExecuted = (file?.ephemeralChanges as any)?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: mergedContent?.parameterValues || {},
    database: mergedContent?.connection_name,
    references: mergedContent?.references || []
  };

  const { data: queryData, loading: queryLoading, error: queryError, isStale: queryStale } = useQueryResult(
    queryToExecute.query,
    queryToExecute.params,
    queryToExecute.database,
    queryToExecute.references,
    { skip: !queryToExecute.query }
  );

  // Don't use useEffect for cleanup - it causes unmount issues
  // Instead, cleanup in the cancel/close handlers

  // Always in edit mode in this modal (allows reference removal, editable viz)
  useEffect(() => {
    if (typeof effectiveId === 'number') {
      dispatch(setFileEditMode({ fileId: effectiveId, editMode: true }));
    }
  }, [effectiveId, dispatch]);

  // Set initial lastExecuted (only once when file is ready)
  useEffect(() => {
    if (!file || !mergedContent || !effectiveId) return;
    if (lastExecuted) return; // Already set

    const initialQuery = {
      query: mergedContent.query || '',
      params: mergedContent.parameterValues || {},
      database: mergedContent.connection_name
    };

    dispatch(setEphemeral({
      fileId: effectiveId,
      changes: { lastExecuted: initialQuery } as any
    }));
  }, [file, mergedContent, lastExecuted, effectiveId, dispatch]);

  // Handle content changes
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    editFile({ fileId: typeof effectiveId === 'number' ? effectiveId : -1, changes: { content: updates } });
  }, [effectiveId]);

  // Handle metadata changes (Phase 5)
  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editFile({ fileId: typeof effectiveId === 'number' ? effectiveId : -1, changes });
  }, [effectiveId]);

  // Handle query execution
  const handleExecute = useCallback(() => {
    if (!mergedContent || !effectiveId) return;

    const newQuery = {
      query: mergedContent.query,
      params: mergedContent.parameterValues || {},
      database: mergedContent.connection_name,
      references: mergedContent.references || []
    };

    dispatch(setEphemeral({
      fileId: effectiveId,
      changes: { lastExecuted: newQuery } as any
    }));
  }, [mergedContent, effectiveId, dispatch]);

  // Create mode: a virtual (negative) file ID that hasn't been added to a dashboard yet.
  // isNewQuestion overrides the ID-based check when the caller knows the context:
  //   true  → show "Add" button, clean up virtual file on cancel
  //   false → show "Update" button, do NOT remove on cancel (file is already referenced)
  //   undefined → infer from whether the ID is virtual
  const isCreateMode = isNewQuestion ?? (typeof effectiveId === 'number' && (file?.draft === true));

  // Create mode: "Add" — stages the virtual question in Redux, notifies parent, closes.
  // No API call — the question will be published later via "Publish All".
  const handleAdd = useCallback(() => {
    if (typeof effectiveId !== 'number') return;
    const trimmedName = effectiveName.trim();
    if (!trimmedName || trimmedName === 'New Question') {
      setSaveError('Please enter a question name before adding.');
      return;
    }
    setSaveError(null);
    onQuestionCreated(effectiveId); // passes the (negative) virtual ID to parent
    onClose();
  }, [effectiveId, effectiveName, onQuestionCreated, onClose]);

  // Edit mode: "Update" — changes are already staged in Redux via editFile() calls.
  // No API call — the question will be published later via "Publish All".
  const handleUpdate = useCallback(() => {
    onClose();
  }, [onClose]);

  const primaryActionLabel = isCreateMode ? 'Add' : 'Update';
  const handlePrimaryAction = isCreateMode ? handleAdd : handleUpdate;

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (typeof effectiveId === 'number') {
      if (isCreateMode) {
        // Cancel during creation: delete the orphaned draft from the server.
        deleteFile({ fileId: effectiveId }).catch(() => {});
      } else {
        // Cancel while editing a published file: revert to DB state.
        clearFileChanges({ fileId: effectiveId });
      }
    }
    onClose();
  }, [effectiveId, isCreateMode, dispatch, onClose]);

  // Register handleCancel with parent so ESC/click-outside go through dirty check
  useEffect(() => {
    if (onAttemptCloseRef) {
      onAttemptCloseRef.current = handleCancel;
    }
    return () => {
      if (onAttemptCloseRef) {
        onAttemptCloseRef.current = null;
      }
    };
  }, [onAttemptCloseRef, handleCancel]);


  // Show loading state
  if (fileLoading || !file || !mergedContent) {
    return (
      <Box p={6}>
        <Text>Loading question editor...</Text>
      </Box>
    );
  }

  return (
    <>
      <Box
        display="flex"
        flexDirection="column"
        height="100%"
        overflow="hidden"
      >
        {/* Modal header: name input + save/cancel (replaces DocumentHeader which lives in FileView) */}
        <HStack
          px={3}
          py={2}
          borderBottomWidth="1px"
          borderColor="border.muted"
          gap={2}
          flexShrink={0}
        >
          <Box flex={1}>
            <Input
              value={effectiveName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleMetadataChange({ name: e.target.value })}
              placeholder="Question name..."
              size="sm"
              variant="flushed"
              fontWeight="semibold"
              aria-label="Question name"
            />
          </Box>
          {saveError && (
            <Text fontSize="xs" color="accent.danger" flexShrink={0}>{saveError}</Text>
          )}
          <Button size="sm" variant="ghost" onClick={handleCancel} flexShrink={0}>
            Cancel
          </Button>
          <Button
            size="sm"
            bg="accent.teal"
            color="white"
            onClick={handlePrimaryAction}
            flexShrink={0}
            aria-label={primaryActionLabel}
          >
            {primaryActionLabel}
          </Button>
        </HStack>

        <QuestionViewV2
          viewMode="page"
          content={mergedContent}
          questionId={typeof effectiveId === 'number' ? effectiveId : undefined}
          queryData={queryData}
          queryLoading={queryLoading}
          queryError={queryError}
          queryStale={queryStale}
          onChange={handleChange}
          onExecute={handleExecute}
        />
      </Box>

    </>
  );
}

'use client';

import { useState, useCallback, useEffect, MutableRefObject } from 'react';
import { Box, Button, Dialog, HStack, Text, VStack } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useNewFile } from '@/lib/hooks/useNewFile';
import { useFile } from '@/lib/hooks/useFile';
import { useQueryResult } from '@/lib/hooks/useQueryResult';
import { selectIsDirty, selectMergedContent, selectEffectiveName, setEphemeral, deleteFile } from '@/store/filesSlice';
import { QuestionContent } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import { isUserFacingError } from '@/lib/errors';

interface CreateQuestionModalContainerProps {
  isOpen: boolean;
  onClose: () => void;
  onQuestionCreated: (id: number) => void;
  folderPath: string;
  questionId?: number;  // Optional: if provided, edit existing question instead of creating new
  onAttemptCloseRef?: MutableRefObject<(() => void) | null>;  // Ref for parent to call when user attempts to close
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
}: CreateQuestionModalContainerProps) {
  const dispatch = useAppDispatch();

  // Create virtual file for question creation, OR use provided ID for editing
  const virtualId = useNewFile('question', { folder: folderPath });
  const effectiveId = questionId ?? virtualId;

  // Use useFile hook for state management
  const { file, loading: fileLoading, saving, edit, editMetadata, save, cancel } = useFile(effectiveId);
  const isDirty = useAppSelector(state => selectIsDirty(state, effectiveId));
  const mergedContent = useAppSelector(state => selectMergedContent(state, effectiveId)) as QuestionContent | undefined;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, effectiveId)) || '';

  // Local state
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Query execution state
  const lastExecuted = (file?.ephemeralChanges as any)?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: (mergedContent?.parameters || []).reduce((acc, p) => ({
      ...acc,
      [p.name]: p.value
    }), {}),
    database: mergedContent?.database_name,
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

  // Set initial lastExecuted (only once when file is ready)
  useEffect(() => {
    if (!file || !mergedContent) return;
    if (lastExecuted) return; // Already set

    const initialQuery = {
      query: mergedContent.query || '',
      params: (mergedContent.parameters || []).reduce((acc, p) => ({
        ...acc,
        [p.name]: p.value
      }), {}),
      database: mergedContent.database_name
    };

    dispatch(setEphemeral({
      fileId: effectiveId,
      changes: { lastExecuted: initialQuery } as any
    }));
  }, [file, mergedContent, lastExecuted, effectiveId, dispatch]);

  // Handle content changes
  const handleChange = useCallback((updates: Partial<QuestionContent>) => {
    edit(updates);
  }, [edit]);

  // Handle metadata changes (Phase 5)
  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editMetadata(changes);
  }, [editMetadata]);

  // Handle query execution
  const handleExecute = useCallback(() => {
    if (!mergedContent) return;

    const newQuery = {
      query: mergedContent.query,
      params: (mergedContent.parameters || []).reduce((acc, p) => ({
        ...acc,
        [p.name]: p.value
      }), {}),
      database: mergedContent.database_name,
      references: mergedContent.references || []
    };

    dispatch(setEphemeral({
      fileId: effectiveId,
      changes: { lastExecuted: newQuery } as any
    }));
  }, [mergedContent, effectiveId, dispatch]);

  // Handle save
  // Note: Name/description validation is handled by DocumentHeader
  const handleSave = useCallback(async () => {
    if (!mergedContent || !file) return;

    setSaveError(null);

    try {
      const result = await save();

      // Ensure save was successful and returned a result
      if (!result || typeof result.id !== 'number') {
        throw new Error('Save failed to return a valid file ID');
      }

      // NOTE: Don't cleanup virtual file with deleteFile because empty path causes issues
      // The virtual file will remain in Redux but that's fine - it's harmless

      // Call parent callback with new question ID
      onQuestionCreated(result.id);

      // Close modal
      onClose();
    } catch (error) {
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return;
      }

      console.error('Failed to save question:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [mergedContent, effectiveId, save, dispatch, onQuestionCreated, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      cancel();
      // NOTE: Don't cleanup virtual file - see save handler comment
      onClose();
    }
  }, [isDirty, cancel, onClose]);

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

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    cancel();
    // NOTE: Don't cleanup virtual file - see save handler comment
    setShowConfirmClose(false);
    onClose();
  }, [cancel, onClose]);

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
        <QuestionViewV2
          viewMode="page"
          fileName={effectiveName}
          content={mergedContent}
          queryData={queryData}
          queryLoading={queryLoading}
          queryError={queryError}
          queryStale={queryStale}
          editMode={true}
          isDirty={isDirty}
          isSaving={saving}
          saveError={saveError}
          onChange={handleChange}
          onMetadataChange={handleMetadataChange}
          onExecute={handleExecute}
          onSave={handleSave}
          onCancel={handleCancel}
          onEditModeChange={() => {}} // No-op in create mode
        />
      </Box>

      {/* Confirmation dialog for unsaved changes */}
      <Dialog.Root
        open={showConfirmClose}
        onOpenChange={(e) => setShowConfirmClose(e.open)}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="400px" p={6} borderRadius="lg" bg="bg.surface">
            <Dialog.Header>
              <Dialog.Title fontSize="lg" fontWeight="bold">
                Unsaved Changes
              </Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Text>
                You have unsaved changes. What would you like to do?
              </Text>
            </Dialog.Body>

            <Dialog.Footer>
              <VStack align="stretch" gap={3} width="100%">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  loading={saving}
                  bg="accent.teal"
                  color="white"
                  _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                  width="100%"
                >
                  Save & Close
                </Button>
                <HStack gap={2} width="100%">
                  <Button
                    variant="ghost"
                    onClick={() => setShowConfirmClose(false)}
                    flex={1}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleDiscardChanges}
                    bg="accent.danger"
                    variant="outline"
                    flex={1}
                  >
                    Discard Changes
                  </Button>
                </HStack>
              </VStack>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
}

'use client';

import { useState, useCallback, useEffect, MutableRefObject } from 'react';
import { Box, Button, Dialog, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, clearFileChanges, createVirtualFile } from '@/lib/api/file-state';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { selectIsDirty, selectMergedContent, selectEffectiveName, setEphemeral } from '@/store/filesSlice';
import { setFileEditMode } from '@/store/uiSlice';
import { QuestionContent } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';

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
  const [virtualId, setVirtualId] = useState<number | undefined>(undefined);

  // Create virtual file for question creation (only once)
  useEffect(() => {
    if (questionId || virtualId !== undefined) return; // Skip if editing or already created

    createVirtualFile('question', { folder: folderPath })
      .then(id => setVirtualId(id))
      .catch(err => console.error('[CreateQuestionModal] Failed to create virtual file:', err));
  }, [questionId, virtualId, folderPath]);

  const effectiveId = questionId ?? virtualId;

  // Use useFile hook for state management (skip if no ID yet)
  const { fileState: file } = useFile(effectiveId) ?? {};
  const fileLoading = !file || file.loading;
  const isDirty = useAppSelector(state => effectiveId ? selectIsDirty(state, effectiveId) : false);
  const mergedContent = useAppSelector(state => effectiveId ? selectMergedContent(state, effectiveId) as QuestionContent | undefined : undefined);
  const effectiveName = useAppSelector(state => effectiveId ? selectEffectiveName(state, effectiveId) || '' : '');

  // Local state
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Query execution state
  const lastExecuted = (file?.ephemeralChanges as any)?.lastExecuted;
  const queryToExecute = lastExecuted || {
    query: mergedContent?.query || '',
    params: (mergedContent?.parameters || []).reduce((acc, p) => ({
      ...acc,
      [p.name]: p.defaultValue
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
      params: (mergedContent.parameters || []).reduce((acc, p) => ({
        ...acc,
        [p.name]: p.defaultValue
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
      params: (mergedContent.parameters || []).reduce((acc, p) => ({
        ...acc,
        [p.name]: p.defaultValue
      }), {}),
      database: mergedContent.database_name,
      references: mergedContent.references || []
    };

    dispatch(setEphemeral({
      fileId: effectiveId,
      changes: { lastExecuted: newQuery } as any
    }));
  }, [mergedContent, effectiveId, dispatch]);

  // Create mode: "Add" — stages the virtual question in Redux, notifies parent, closes.
  // No API call — the question will be published later via "Publish All".
  const handleAdd = useCallback(() => {
    if (typeof effectiveId !== 'number') return;
    setSaveError(null);
    onQuestionCreated(effectiveId); // passes the (negative) virtual ID to parent
    setShowConfirmClose(false);
    onClose();
  }, [effectiveId, onQuestionCreated, onClose]);

  // Edit mode: "Update" — changes are already staged in Redux via editFile() calls.
  // No API call — the question will be published later via "Publish All".
  const handleUpdate = useCallback(() => {
    setShowConfirmClose(false);
    onClose();
  }, [onClose]);

  const isCreateMode = questionId === undefined;
  const primaryActionLabel = isCreateMode ? 'Add' : 'Update';
  const handlePrimaryAction = isCreateMode ? handleAdd : handleUpdate;

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      if (typeof effectiveId === 'number') {
        clearFileChanges({ fileId: effectiveId });
      }
      // NOTE: Don't cleanup virtual file - see save handler comment
      onClose();
    }
  }, [isDirty, effectiveId, onClose]);

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
    if (typeof effectiveId === 'number') {
      clearFileChanges({ fileId: effectiveId });
    }
    // NOTE: Don't cleanup virtual file - see save handler comment
    setShowConfirmClose(false);
    onClose();
  }, [effectiveId, onClose]);

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
                  onClick={handlePrimaryAction}
                  bg="accent.teal"
                  color="white"
                  _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                  width="100%"
                >
                  {primaryActionLabel} & Close
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

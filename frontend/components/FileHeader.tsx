'use client';

/**
 * FileHeader - Common smart header for all user file types.
 *
 * Renders DocumentHeader + PublishModal by reading all state directly from Redux,
 * so it works identically whether rendered on a full page (via FileView) or
 * inside the PublishModal review pane.
 *
 * Handles: edit mode, save/cancel, name/description edits, view mode toggle.
 * System files (connection, config, styles, context) keep their own headers.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { HStack, Text } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectIsDirty, selectEffectiveName, selectMergedContent, type FileId } from '@/store/filesSlice';
import {
  selectDashboardEditMode, setDashboardEditMode,
  selectFileEditMode, setFileEditMode,
  selectFileViewMode, setFileViewMode,
} from '@/store/uiSlice';
import { editFile, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { isSystemFileType, type FileType } from '@/lib/ui/file-metadata';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { isUserFacingError } from '@/lib/errors';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import { useRouter } from '@/lib/navigation/use-navigation';
import { DocumentContent } from '@/lib/types';
import DocumentHeader from './DocumentHeader';
import PublishModal from './PublishModal';

interface FileHeaderProps {
  fileId: number;
  fileType: string;
  mode?: 'view' | 'create';
}

export default function FileHeader({ fileId, fileType, mode = 'view' }: FileHeaderProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) ?? '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId));
  const description = (mergedContent as any)?.description as string | undefined;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const isSaving = useAppSelector(state => state.files.files[fileId]?.saving ?? false);

  const isDashboard = fileType === 'dashboard';
  const editMode = useAppSelector(state =>
    isDashboard
      ? selectDashboardEditMode(state, fileId)
      : selectFileEditMode(state, fileId)
  );
  const viewMode = useAppSelector(state => selectFileViewMode(state, fileId));

  const dispatchSetEditMode = useCallback((val: boolean) => {
    if (isDashboard) {
      dispatch(setDashboardEditMode({ fileId, editMode: val }));
    } else {
      dispatch(setFileEditMode({ fileId, editMode: val }));
    }
  }, [dispatch, fileId, isDashboard]);

  const dirtyFiles = useDirtyFiles();
  const anyDirtyFiles = dirtyFiles.length > 0;

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // Set initial edit mode for create mode (once on mount only)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (mode === 'create') {
        dispatchSetEditMode(true);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enter edit mode when file becomes dirty (e.g., agent made changes)
  useEffect(() => {
    if (isDirty && !editMode) {
      dispatchSetEditMode(true);
    }
  }, [isDirty, editMode, dispatchSetEditMode]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      const result = await publishFile({ fileId });
      dispatchSetEditMode(false);
      redirectAfterSave(result, fileId, router);
    } catch (error) {
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return;
      }
      console.error('Failed to save file:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [fileId, router, dispatchSetEditMode]);

  const handleCancel = useCallback(() => {
    clearFileChanges({ fileId });
    dispatchSetEditMode(false);
    setSaveError(null);
  }, [fileId, dispatchSetEditMode]);

  const isSystem = isSystemFileType(fileType as FileType);

  // Dashboard badge: question count
  const questionCount = isDashboard
    ? ((mergedContent as DocumentContent)?.assets?.filter(a => a.type === 'question').length ?? 0)
    : undefined;

  return (
    <>
      <DocumentHeader
        name={effectiveName}
        description={description}
        fileType={fileType as any}
        editMode={editMode}
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        onNameChange={(name) => editFile({ fileId, changes: { name } })}
        onDescriptionChange={(description) => editFile({ fileId, changes: { content: { description } } })}
        onEditModeToggle={() => {
          if (editMode) {
            handleCancel();
          } else {
            dispatchSetEditMode(true);
          }
        }}
        onSave={handleSave}
        questionId={fileType === 'question' ? fileId : undefined}
        viewMode={viewMode}
        onViewModeChange={(m) => dispatch(setFileViewMode({ fileId, mode: m }))}
        additionalBadges={questionCount !== undefined ? (
          <HStack
            gap={1}
            fontFamily="mono"
            fontSize="2xs"
            fontWeight="600"
            color="fg.default"
            px={1.5}
            py={0.5}
            bg="bg.elevated"
            borderRadius="sm"
            border="1px solid"
            borderColor="border.default"
            flexShrink={0}
          >
            <Text>{questionCount.toString().padStart(2, '0')}</Text>
            <Text color="fg.muted">{questionCount !== 1 ? 'questions' : 'question'}</Text>
          </HStack>
        ) : undefined}
        onPublish={isSystem ? undefined : () => setIsPublishModalOpen(true)}
        anyDirtyFiles={anyDirtyFiles}
      />
      {!isSystem && (
        <PublishModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
        />
      )}
    </>
  );
}

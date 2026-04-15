'use client';

/**
 * FileHeader - Common smart header for all user file types.
 *
 * Renders DocumentHeader by reading all state directly from Redux,
 * so it works identically whether rendered on a full page (via FileView) or
 * inside the PublishModal review pane.
 *
 * Handles: edit mode, save/cancel, name/description edits, view mode toggle.
 * System files (connection, config, styles, context) keep their own headers.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { HStack, Text, Icon } from '@chakra-ui/react';
import { LuLock } from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { selectIsDirty, selectEffectiveName, selectMergedContent, selectDirtyFiles } from '@/store/filesSlice';
import {
  selectDashboardEditMode, setDashboardEditMode,
  selectFileEditMode, setFileEditMode,
  selectFileViewMode, setFileViewMode,
} from '@/store/uiSlice';
import { editFile, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { isUserFacingError } from '@/lib/errors';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import { useRouter } from '@/lib/navigation/use-navigation';
import { DocumentContent, FileType } from '@/lib/types';
import { isVirtualFileId } from '@/store/filesSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import DocumentHeader from './DocumentHeader';
import PublishModal from './PublishModal';

interface FileHeaderProps {
  fileId: number;
  fileType: string;
  mode?: 'view' | 'create' | 'preview';
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

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const canEdit = !effectiveUser?.role || canCreateFileByRole(effectiveUser.role, fileType as FileType);

  const dispatchSetEditMode = useCallback((val: boolean) => {
    if (isDashboard) {
      dispatch(setDashboardEditMode({ fileId, editMode: val }));
    } else {
      dispatch(setFileEditMode({ fileId, editMode: val }));
    }
  }, [dispatch, fileId, isDashboard]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const dirtyFiles = useAppSelector(selectDirtyFiles, shallowEqual);
  const otherDirtyFiles = dirtyFiles.filter(f => f.id !== fileId);

  // Local state for name/description so typing feels instant.
  // null = no local edit in progress; display falls back to the Redux value.
  // editFile is debounced (300ms) to avoid Redux dispatch + path-slug regex on every keystroke.
  const [localName, setLocalName] = useState<string | null>(null);
  const [localDesc, setLocalDesc] = useState<string | null>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set initial edit mode for create mode (once on mount only, skip for non-editors)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (mode === 'create' && canEdit) {
        dispatchSetEditMode(true);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enter edit mode when any file has unsaved changes (skip for non-editors)
  const anyDirty = dirtyFiles.length > 0;
  useEffect(() => {
    if (anyDirty && !editMode && canEdit) {
      dispatchSetEditMode(true);
    }
  }, [anyDirty, editMode, dispatchSetEditMode, canEdit]);

  const handleNameChange = useCallback((name: string) => {
    setLocalName(name);
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => editFile({ fileId, changes: { name } }), 300);
  }, [fileId]);

  const handleDescChange = useCallback((desc: string) => {
    setLocalDesc(desc);
    if (descDebounceRef.current) clearTimeout(descDebounceRef.current);
    descDebounceRef.current = setTimeout(() => editFile({ fileId, changes: { content: { description: desc } } }), 300);
  }, [fileId]);

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
    setLocalName(null);
    setLocalDesc(null);
    clearFileChanges({ fileId });
    dispatchSetEditMode(false);
    setSaveError(null);
  }, [fileId, dispatchSetEditMode]);

  // Dashboard badge: question count
  const questionCount = isDashboard
    ? ((mergedContent as DocumentContent)?.assets?.filter(a => a.type === 'question').length ?? 0)
    : undefined;

  // Read-only badge: shown for real files the user can't edit
  const readOnlyBadge = !canEdit && !isVirtualFileId(fileId) ? (
    <HStack
      gap={1}
      fontFamily="mono"
      fontSize="2xs"
      fontWeight="600"
      color="fg.muted"
      px={1.5}
      py={0.5}
      bg="bg.elevated"
      borderRadius="sm"
      border="1px solid"
      borderColor="border.default"
      flexShrink={0}
    >
      <Icon as={LuLock} boxSize={2.5} />
      <Text>read only</Text>
    </HStack>
  ) : undefined;

  return (
    <>
      <DocumentHeader
        name={localName ?? effectiveName}
        description={localDesc ?? description}
        fileType={fileType as any}
        editMode={editMode}
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescChange}
        onEditModeToggle={() => {
          if (editMode) {
            handleCancel();
          } else {
            dispatchSetEditMode(true);
          }
        }}
        onSave={handleSave}
        onReviewChanges={otherDirtyFiles.length > 0 ? () => setIsPublishModalOpen(true) : undefined}
        dirtyFileCount={dirtyFiles.length}
        hideEditToggle={isVirtualFileId(fileId) || !canEdit}
        questionId={fileType === 'question' ? fileId : undefined}
        viewMode={viewMode}
        onViewModeChange={(m) => dispatch(setFileViewMode({ fileId, mode: m }))}
        additionalBadges={(
          <>
            {questionCount !== undefined && (
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
            )}
            {readOnlyBadge}
          </>
        )}
        highlightColor={isDashboard && editMode ? 'accent.primary' : undefined}
        highlightLabel={isDashboard && editMode ? 'Editing Dashboard' : undefined}
      />
      <PublishModal isOpen={isPublishModalOpen} onClose={() => setIsPublishModalOpen(false)} />
    </>
  );
}

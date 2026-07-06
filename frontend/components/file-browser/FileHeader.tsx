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

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { HStack, Text, Icon, Button, IconButton } from '@chakra-ui/react';
import { LuLock } from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectEffectiveName, selectEffectivePath, selectMergedContent } from '@/store/filesSlice';
import {
  selectFileEditMode, setFileEditMode,
  selectFileViewMode, setFileViewMode,
} from '@/store/uiSlice';
import { editFile } from '@/lib/file-state/file-state';
import { runMicroTaskClient, buildFileMicroInput } from '@/lib/tools/micro-task';
import { toaster } from '../ui/toaster';
import { isUserFacingError } from '@/lib/errors';
import { redirectAfterSave, hasGeneratableContent } from '@/lib/ui/file-utils';
import { useRouter } from '@/lib/navigation/use-navigation';
import { DocumentContent, FileType } from '@/lib/types';
import { selectFile } from '@/store/filesSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { useSaveDecision } from '@/lib/hooks/file-state-hooks';
import DocumentHeader from './DocumentHeader';
import { FileHealthBadge } from './FileHealthPanel';
import PublishModal from '../modals/PublishModal';
import SaveFileModal from '../modals/SaveFileModal';
import { useFileToolbar } from '../file-toolbar/FileToolbarContext';
import { usePresentation } from '../file-toolbar/PresentationContext';
import { Tooltip } from '../ui/tooltip';

// File types whose content reads well fullscreen — the generic Present toggle is
// offered for these. Individual views adapt their own layout via usePresentation().
const PRESENTABLE_TYPES = ['question', 'dashboard', 'notebook', 'story', 'report'] as const;

interface FileHeaderProps {
  fileId: number;
  fileType: string;
  mode?: 'view' | 'create' | 'preview';
}

export default function FileHeader({ fileId, fileType, mode = 'view' }: FileHeaderProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const isDraft = useAppSelector(state => selectFile(state, fileId)?.draft === true);
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) ?? '';
  const effectivePath = useAppSelector(state => selectEffectivePath(state, fileId)) ?? '';
  const parentFolder = effectivePath.substring(0, effectivePath.lastIndexOf('/')) || '/';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId));
  const description = (mergedContent as any)?.description as string | undefined;
  // Only offer "✨ Auto" once the file has something to summarize (e.g. a query,
  // assets, or cells) — a blank new file has nothing to generate a title from.
  const canGenerate = useMemo(() => hasGeneratableContent(fileType, mergedContent), [fileType, mergedContent]);

  const isDashboard = fileType === 'dashboard';
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const viewMode = useAppSelector(state => selectFileViewMode(state, fileId));
  // View-published toolbar actions (e.g. notebook: Run all, Collapse all).
  const toolbarActions = useFileToolbar();
  // Generic fullscreen presentation (shared across all presentable file types).
  const presentation = usePresentation();
  const canPresent = presentation?.supported && PRESENTABLE_TYPES.includes(fileType as typeof PRESENTABLE_TYPES[number]);

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const canEdit = !effectiveUser?.role || canCreateFileByRole(effectiveUser.role, fileType as FileType);

  const dispatchSetEditMode = useCallback((val: boolean) => {
    dispatch(setFileEditMode({ fileId, editMode: val }));
  }, [dispatch, fileId]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    onSave: saveWithChildren, onCancel: cancelWithChildren, isDirty, isSaving, saveCount,
    totalDirtyCount, isPublishModalOpen, openPublishModal, closePublishModal,
  } = useSaveDecision(fileId);

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

  // Auto-enter edit mode for draft files (newly created, never saved)
  useEffect(() => {
    if (isDraft && canEdit) {
      dispatchSetEditMode(true);
    }
  }, [isDraft, canEdit, dispatchSetEditMode]);

  // Auto-enter edit mode when current file has unsaved changes (skip for non-editors)
  useEffect(() => {
    if (isDirty && !editMode && canEdit) {
      dispatchSetEditMode(true);
    }
  }, [isDirty, editMode, dispatchSetEditMode, canEdit]);

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

  // AI generation of an empty title/description from the file's current content.
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);

  const handleGenerateName = useCallback(async () => {
    setIsGeneratingName(true);
    try {
      const title = await runMicroTaskClient('title', { input: buildFileMicroInput(fileId), subject: `a ${fileType}`, instructions: '' });
      handleNameChange(title);
    } catch (err) {
      console.error('[FileHeader] failed to generate title:', err);
      toaster.create({ title: "Couldn't generate a title", description: 'Please try again.', type: 'error' });
    } finally {
      setIsGeneratingName(false);
    }
  }, [fileId, handleNameChange, fileType]);

  const handleGenerateDescription = useCallback(async () => {
    setIsGeneratingDesc(true);
    try {
      const desc = await runMicroTaskClient('description', { input: buildFileMicroInput(fileId), subject: `a ${fileType}`, instructions: '' });
      handleDescChange(desc);
    } catch (err) {
      console.error('[FileHeader] failed to generate description:', err);
      toaster.create({ title: "Couldn't generate a description", description: 'Please try again.', type: 'error' });
    } finally {
      setIsGeneratingDesc(false);
    }
  }, [fileId, handleDescChange, fileType]);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  const doSave = useCallback(async () => {
    setSaveError(null);
    try {
      const result = await saveWithChildren();
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
  }, [fileId, router, dispatchSetEditMode, saveWithChildren]);

  const handleSave = useCallback(() => {
    if (isDraft) {
      // New file — show Save modal to pick name + location
      setIsSaveModalOpen(true);
    } else {
      doSave();
    }
  }, [fileId, doSave]);

  const handleSaveModalConfirm = useCallback(async (name: string, path: string) => {
    // Update name and path on the virtual file, then save
    await editFile({ fileId, changes: { name, path: `${path}/${name.toLowerCase().replace(/\s+/g, '-')}` } });
    setLocalName(name);
    doSave();
  }, [fileId, doSave]);

  const handleCancel = useCallback(() => {
    setLocalName(null);
    setLocalDesc(null);
    cancelWithChildren();
    dispatchSetEditMode(false);
    setSaveError(null);
  }, [cancelWithChildren, dispatchSetEditMode]);

  // Dashboard badge: question count
  const questionCount = isDashboard
    ? ((mergedContent as DocumentContent)?.assets?.filter(a => a.type === 'question').length ?? 0)
    : undefined;

  // Read-only badge: shown for real files the user can't edit
  const readOnlyBadge = !canEdit && !isDraft ? (
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

  // Generic header toolbar: render whatever the current file's view registered
  // (Present, Run all, Make public, …) as one list. The header has no per-type
  // knowledge — every file view owns and registers its own actions.
  const actionButtons = toolbarActions.map(a => (
    <Tooltip key={a.id} content={a.ariaLabel} positioning={{ placement: 'top' }}>
      {a.label ? (
        <Button
          aria-label={a.ariaLabel}
          size="xs"
          variant="ghost"
          fontFamily="mono"
          fontWeight="600"
          gap={1}
          px={2}
          h="24px"
          borderRadius="sm"
          color={a.active ? 'fg.default' : 'fg.muted'}
          bg={a.active ? 'bg.emphasized' : 'transparent'}
          _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
          onClick={a.onClick}
        >
          {a.icon}{a.label}
        </Button>
      ) : (
        <IconButton
          aria-label={a.ariaLabel}
          size="xs"
          variant="ghost"
          h="24px"
          minW="28px"
          px={0}
          borderRadius="sm"
          color={a.active ? 'fg.default' : 'fg.muted'}
          bg={a.active ? 'bg.emphasized' : 'transparent'}
          _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
          onClick={a.onClick}
        >
          {a.icon}
        </IconButton>
      )}
    </Tooltip>
  ));
  const headerActionsNode = actionButtons.length > 0 ? (
    <HStack
      gap="1px"
      align="center"
      bg="bg.muted"
      borderRadius="md"
      p="1px"
      borderWidth="1px"
      borderColor="border.muted"
    >
      {actionButtons}
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
        onGenerateName={canEdit && canGenerate ? handleGenerateName : undefined}
        onGenerateDescription={canEdit && canGenerate ? handleGenerateDescription : undefined}
        isGeneratingName={isGeneratingName}
        isGeneratingDescription={isGeneratingDesc}
        onEditModeToggle={() => {
          if (editMode) {
            handleCancel();
          } else {
            dispatchSetEditMode(true);
          }
        }}
        onSave={handleSave}
        onReviewChanges={totalDirtyCount > 0 ? openPublishModal : undefined}
        dirtyFileCount={totalDirtyCount}
        saveCount={saveCount}
        hideEditToggle={isDraft || !canEdit}
        skipNameValidation={isDraft}
        questionId={fileType === 'question' ? fileId : undefined}
        onTogglePresent={canPresent ? presentation!.toggle : undefined}
        isPresenting={presentation?.isPresenting ?? false}
        viewMode={viewMode}
        onViewModeChange={(m) => dispatch(setFileViewMode({ fileId, mode: m }))}
        headerActions={headerActionsNode}
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
            <FileHealthBadge fileId={fileId} fileType={fileType} />
            {readOnlyBadge}
          </>
        )}
      />
      <PublishModal isOpen={isPublishModalOpen} onClose={closePublishModal} />
      {isSaveModalOpen && (
        <SaveFileModal
          isOpen={isSaveModalOpen}
          onClose={() => setIsSaveModalOpen(false)}
          fileId={fileId}
          fileType={fileType}
          onSave={handleSaveModalConfirm}
          defaultPath={parentFolder}
        />
      )}
    </>
  );
}

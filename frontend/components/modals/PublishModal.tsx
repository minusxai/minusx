'use client';

/**
 * PublishModal - Multi-file draft review and publish workflow (Phase 1)
 *
 * Shows a two-pane modal:
 * - Left pane: scrollable list of dirty non-system files
 * - Right pane: full FileView for the selected file (using its own DocumentHeader Save button)
 *
 * Files are removed from the left list automatically as they are saved.
 * Modal auto-closes when all dirty files have been saved.
 *
 * "Publish All" button is visible but disabled in Phase 1 (enabled in Phase 2).
 */

import { useState, useEffect, useCallback } from 'react';
import { useStableCallback } from '@/lib/hooks/use-stable-callback';
import { useAppDispatch } from '@/store/hooks';
import {
  Box,
  Text,
  HStack,
  VStack,
  Button,
  Portal,
  Badge,
  IconButton,
} from '@chakra-ui/react';
import { Dialog } from '@chakra-ui/react';
import { LuSave, LuUndo2, LuX, LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { publishAll, discardAll, editFile } from '@/lib/file-state/file-state';
import { setFileEditMode } from '@/store/uiSlice';
import SaveFileModal from './SaveFileModal';
import { DirtyFileItem } from './PublishModalDirtyFileItem';
import { SelectedFilePane } from './PublishModalSelectedFilePane';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PublishModal({ isOpen, onClose }: PublishModalProps) {
  const dispatch = useAppDispatch();
  const dirtyFiles = useDirtyFiles();
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingSingleId, setPublishingSingleId] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [saveModalFileId, setSaveModalFileId] = useState<number | null>(null);
  // fileIds queued to save after the SaveFileModal confirms (used by Save All)
  const [pendingSaveAllIds, setPendingSaveAllIds] = useState<number[] | null>(null);

  // Auto-select first file when modal opens or list changes
  useEffect(() => {
    if (!isOpen) return;

    if (dirtyFiles.length === 0) {
      // All files saved — auto-close
      onClose();
      return;
    }

    // If selected file is no longer dirty (saved), advance to next
    const selectedStillDirty = selectedFileId !== null && dirtyFiles.some(f => f.id === selectedFileId);
    if (!selectedStillDirty) {
      setSelectedFileId(dirtyFiles[0].id);
    }
  }, [dirtyFiles, isOpen, onClose, selectedFileId]);

  const handleSelect = useCallback((fileId: number) => {
    setSelectedFileId(fileId);
  }, []);

  const exitEditMode = useCallback((fileId: number) => {
    dispatch(setFileEditMode({ fileId, editMode: false }));
  }, [dispatch]);

  const handlePublishFile = useCallback(async (fileId: number) => {
    const file = dirtyFiles.find(f => f.id === fileId);
    if (file?.draft) {
      // Draft file — open SaveFileModal, same as FileHeader.handleSave does
      setSaveModalFileId(fileId);
      return;
    }
    setPublishingSingleId(fileId);
    try {
      await publishAll([fileId]);
      exitEditMode(fileId);
    } catch (err) {
      // A failed save (network blip, deploy restart, 5xx) must surface — this
      // was an unhandled rejection in prod: spinner stopped, file stayed
      // dirty, and the user got no feedback at all.
      setPublishError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setPublishingSingleId(null);
    }
  }, [dirtyFiles, exitEditMode]);

  const handleDiscardFile = useCallback((fileId: number) => {
    discardAll([fileId]);
    exitEditMode(fileId);
  }, [exitEditMode]);

  const handleDiscardAll = useCallback(() => {
    const filesToDiscard = [...dirtyFiles];
    discardAll();
    filesToDiscard.forEach(f => exitEditMode(f.id));
  }, [dirtyFiles, exitEditMode]);

  const handlePublishAll = useCallback(async () => {
    setPublishError(null);
    const drafts = dirtyFiles.filter(f => f.draft);
    const nonDrafts = dirtyFiles.filter(f => !f.draft);

    // No drafts → every dirty file is already named; batch-publish in one shot.
    if (drafts.length === 0) {
      setIsPublishing(true);
      try {
        const filesToPublish = [...dirtyFiles];
        await publishAll();
        filesToPublish.forEach(f => exitEditMode(f.id));
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : 'Failed to publish. Please try again.');
      } finally {
        setIsPublishing(false);
      }
      return;
    }

    // Drafts each need a name/folder: batch-save the already-named edits, then
    // walk a SaveFileModal for every draft (handleSaveModalConfirm advances them).
    if (nonDrafts.length > 0) {
      setIsPublishing(true);
      try {
        await publishAll(nonDrafts.map(f => f.id));
        nonDrafts.forEach(f => exitEditMode(f.id));
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
        setIsPublishing(false);
        return;
      }
      setIsPublishing(false);
    }
    const [first, ...rest] = drafts;
    setPendingSaveAllIds(rest.map(f => f.id));
    setSelectedFileId(first.id);
    setSaveModalFileId(first.id);
  }, [dirtyFiles, exitEditMode]);

  const handleSaveModalConfirm = useCallback(async (name: string, path: string) => {
    if (saveModalFileId === null) return;
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    try {
      await editFile({ fileId: saveModalFileId, changes: { name, path: `${path}/${slug}` } });
      await publishAll([saveModalFileId]);
      exitEditMode(saveModalFileId);
      // Advance to the next queued draft, re-opening its SaveFileModal. Setting
      // the next id after the awaits beats SaveFileModal's onClose reset.
      if (pendingSaveAllIds !== null && pendingSaveAllIds.length > 0) {
        const [nextId, ...rest] = pendingSaveAllIds;
        setPendingSaveAllIds(rest);
        setSelectedFileId(nextId);
        setSaveModalFileId(nextId);
      } else {
        setPendingSaveAllIds(null);
        setSaveModalFileId(null);
      }
    } catch (err) {
      // Same surface as handleSaveAll: a failed save must never be silent.
      setPublishError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
      setPendingSaveAllIds(null);
      setSaveModalFileId(null);
    }
  }, [saveModalFileId, exitEditMode, pendingSaveAllIds]);

  // Stable onOpenChange so Dialog.Root doesn't re-run its internal hooks on
  // every parent re-render (132 wasted DialogRoot renders flagged in trace).
  const handleOpenChange = useStableCallback((e: { open: boolean }) => { if (!e.open) onClose(); });

  return (
    <>
    <Dialog.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      size="xl"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            maxW="90vw"
            h="90vh"
            bg="bg.canvas"
            borderRadius="xl"
            border="1px solid"
            borderColor="border.default"
            overflow="hidden"
            display="flex"
            flexDirection="column"
          >
            {/* Header */}
            <Box
              px={5}
              py={3.5}
              borderBottom="1px solid"
              borderColor="border.default"
              flexShrink={0}
            >
              <HStack justify="space-between" align="center" width="100%">
                <HStack gap={2.5} align="center" minW="0">
                  <Text fontWeight="700" fontSize="lg" fontFamily="mono" whiteSpace="nowrap">
                    Review Unsaved Changes
                  </Text>
                  <Badge
                    size="sm"
                    colorPalette="orange"
                    variant="subtle"
                    fontFamily="mono"
                    flexShrink={0}
                  >
                    {dirtyFiles.length} {dirtyFiles.length === 1 ? 'file' : 'files'}
                  </Badge>
                </HStack>
                <HStack gap={2} flexShrink={0}>
                  <Button
                    size="xs"
                    bg="accent.danger"
                    color="white"
                    onClick={handleDiscardAll}
                  >
                    <LuUndo2 />
                    Discard All
                  </Button>
                  <Button
                    aria-label="Save all"
                    size="xs"
                    bg="accent.teal"
                    color="white"
                    loading={isPublishing}
                    onClick={handlePublishAll}
                  >
                    <LuSave />
                    Save All
                  </Button>
                  <IconButton
                    aria-label="Close"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                  >
                    <LuX />
                  </IconButton>
                </HStack>
              </HStack>
              {publishError && (
                <Text fontSize="xs" color="fg.error" mt={1}>
                  {publishError}
                </Text>
              )}
            </Box>

            {/* Body: left list + right preview */}
            <Box flex="1" display="flex" overflow="hidden">
              {/* Left pane: file list (collapsible) */}
              {!sidebarCollapsed && (
                <Box
                  w="260px"
                  flexShrink={0}
                  borderRight="1px solid"
                  borderColor="border.default"
                  overflowY="auto"
                  py={2}
                  px={2}
                  bg="bg.surface"
                  display="flex"
                  flexDirection="column"
                >
                  <HStack px={3} py={1.5} justify="space-between" align="center">
                    <Text
                      fontSize="xs"
                      fontWeight="700"
                      color="fg.subtle"
                      textTransform="uppercase"
                      letterSpacing="0.08em"
                      fontFamily="mono"
                    >
                      Unsaved Files
                    </Text>
                    <IconButton
                      aria-label="Collapse sidebar"
                      size="2xs"
                      variant="ghost"
                      onClick={() => setSidebarCollapsed(true)}
                    >
                      <LuPanelLeftClose />
                    </IconButton>
                  </HStack>
                  <VStack align="stretch" gap={0.5} mt={1}>
                    {dirtyFiles.map(file => (
                      <DirtyFileItem
                        key={file.id}
                        file={file}
                        isSelected={file.id === selectedFileId}
                        onSelect={() => handleSelect(file.id)}
                        onSave={() => handlePublishFile(file.id)}
                        onDiscard={() => handleDiscardFile(file.id)}
                        isSaving={publishingSingleId === file.id}
                      />
                    ))}
                  </VStack>
                </Box>
              )}

              {/* Collapsed sidebar toggle */}
              {sidebarCollapsed && (
                <Box
                  flexShrink={0}
                  borderRight="1px solid"
                  borderColor="border.default"
                  bg="bg.surface"
                  display="flex"
                  alignItems="start"
                  py={2}
                  px={1}
                >
                  <IconButton
                    aria-label="Expand sidebar"
                    size="xs"
                    variant="ghost"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <LuPanelLeftOpen />
                  </IconButton>
                </Box>
              )}

              {/* Right pane: file view */}
              <Box flex="1" minW="0" display="flex" flexDirection="column" bg="bg.canvas" overflow="hidden">
                {selectedFileId !== null ? (
                  <SelectedFilePane
                    fileId={selectedFileId}
                    publishingSingleId={publishingSingleId}
                    onDiscard={() => handleDiscardFile(selectedFileId)}
                    onPublish={() => handlePublishFile(selectedFileId)}
                  />

                ) : (
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    h="full"
                    color="fg.muted"
                  >
                    <Text fontSize="sm">Select a file to review</Text>
                  </Box>
                )}
              </Box>
            </Box>

          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
    {saveModalFileId !== null && (
      <SaveFileModal
        key={saveModalFileId}
        isOpen={true}
        onClose={() => { setSaveModalFileId(null); setPendingSaveAllIds(null); }}
        fileId={saveModalFileId}
        fileType={dirtyFiles.find(f => f.id === saveModalFileId)?.type ?? 'question'}
        onSave={handleSaveModalConfirm}
      />
    )}
    </>
  );
}

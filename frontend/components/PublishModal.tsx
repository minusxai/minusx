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
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectEffectiveName } from '@/store/filesSlice';
import {
  Box,
  Text,
  HStack,
  VStack,
  Button,
  Portal,
  Badge,
} from '@chakra-ui/react';
import { Dialog } from '@chakra-ui/react';
import { LuUpload, LuUndo2 } from 'react-icons/lu';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileView from '@/components/FileView';
import { publishAll, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { setDashboardEditMode, setFileEditMode } from '@/store/uiSlice';
import type { FileState } from '@/store/filesSlice';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Left pane item — one dirty file in the file list
 */
function DirtyFileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: FileState;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meta = getFileTypeMetadata(file.type as any);
  const FileIcon = meta.icon;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, file.id));

  return (
    <HStack
      px={3}
      py={2.5}
      gap={2.5}
      cursor="pointer"
      onClick={onSelect}
      bg={isSelected ? 'bg.subtle' : 'transparent'}
      _hover={{ bg: isSelected ? 'bg.subtle' : 'bg.muted' }}
      borderRadius="md"
      align="center"
      transition="background 0.1s"
    >
      <Box color={meta.color} flexShrink={0}>
        <FileIcon size={15} />
      </Box>
      <VStack align="start" gap={0} flex="1" minW="0">
        <Text
          fontSize="sm"
          fontWeight="600"
          fontFamily="mono"
          lineHeight="1.3"
          truncate
          color="fg.default"
        >
          {effectiveName || 'Untitled'}
        </Text>
      </VStack>
    </HStack>
  );
}

export default function PublishModal({ isOpen, onClose }: PublishModalProps) {
  const dispatch = useAppDispatch();
  const dirtyFiles = useDirtyFiles();
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishingSingle, setIsPublishingSingle] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

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

  const exitEditMode = useCallback((fileId: number, fileType?: string) => {
    if (fileType === 'dashboard') {
      dispatch(setDashboardEditMode({ fileId, editMode: false }));
    } else {
      dispatch(setFileEditMode({ fileId, editMode: false }));
    }
  }, [dispatch]);

  const handlePublishSelected = useCallback(async () => {
    if (selectedFileId === null) return;
    const file = dirtyFiles.find(f => f.id === selectedFileId);
    setIsPublishingSingle(true);
    try {
      await publishFile({ fileId: selectedFileId });
      exitEditMode(selectedFileId, file?.type);
    } finally {
      setIsPublishingSingle(false);
    }
  }, [selectedFileId, dirtyFiles, exitEditMode]);

  const handleDiscardSelected = useCallback(() => {
    if (selectedFileId === null) return;
    const file = dirtyFiles.find(f => f.id === selectedFileId);
    clearFileChanges({ fileId: selectedFileId });
    exitEditMode(selectedFileId, file?.type);
  }, [selectedFileId, dirtyFiles, exitEditMode]);

  const handlePublishAll = useCallback(async () => {
    setIsPublishing(true);
    setPublishError(null);
    try {
      const filesToPublish = [...dirtyFiles];
      await publishAll();
      filesToPublish.forEach(f => exitEditMode(f.id, f.type));
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish. Please try again.');
    } finally {
      setIsPublishing(false);
    }
  }, [dirtyFiles, exitEditMode]);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e: { open: boolean }) => { if (!e.open) onClose(); }}
      size="xl"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner display="flex" alignItems="center" justifyContent="center" p={4} position="fixed" inset={0} overflow="hidden">
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
            <Dialog.Header
              px={5}
              py={3.5}
              borderBottom="1px solid"
              borderColor="border.default"
              flexShrink={0}
            >
              <HStack justify="space-between" align="center">
                <HStack gap={2.5} align="center">
                  <LuUpload size={18} />
                  <Dialog.Title fontWeight="700" fontSize="lg" fontFamily="mono">
                    Review Unsaved Changes
                  </Dialog.Title>
                  <Badge
                    size="sm"
                    colorPalette="orange"
                    variant="subtle"
                    fontFamily="mono"
                  >
                    {dirtyFiles.length} {dirtyFiles.length === 1 ? 'file' : 'files'}
                  </Badge>
                </HStack>
                <Dialog.CloseTrigger asChild>
                  <Button variant="ghost" size="xs" onClick={onClose}>
                    Close
                  </Button>
                </Dialog.CloseTrigger>
              </HStack>
            </Dialog.Header>

            {/* Body: left list + right preview */}
            <Box flex="1" display="flex" overflow="hidden">
              {/* Left pane: file list */}
              <Box
                w="260px"
                flexShrink={0}
                borderRight="1px solid"
                borderColor="border.default"
                overflowY="auto"
                py={2}
                px={2}
                bg="bg.surface"
              >
                <Text
                  px={3}
                  py={1.5}
                  fontSize="xs"
                  fontWeight="700"
                  color="fg.subtle"
                  textTransform="uppercase"
                  letterSpacing="0.08em"
                  fontFamily="mono"
                >
                  Unsaved Files
                </Text>
                <VStack align="stretch" gap={0.5} mt={1}>
                  {dirtyFiles.map(file => (
                    <DirtyFileItem
                      key={file.id}
                      file={file}
                      isSelected={file.id === selectedFileId}
                      onSelect={() => handleSelect(file.id)}
                    />
                  ))}
                </VStack>
              </Box>

              {/* Right pane: toolbar + file view */}
              <Box flex="1" minW="0" display="flex" flexDirection="column" bg="bg.canvas" overflow="hidden">
                {selectedFileId !== null ? (
                  <>
                    <HStack
                      px={4}
                      py={2}
                      borderBottom="1px solid"
                      borderColor="border.default"
                      gap={2}
                      flexShrink={0}
                      justify="flex-end"
                    >
                      <Button
                        size="xs"
                        colorPalette="teal"
                        loading={isPublishingSingle}
                        onClick={handlePublishSelected}
                      >
                        <LuUpload />
                        Publish
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={handleDiscardSelected}
                      >
                        <LuUndo2 />
                        Discard
                      </Button>
                    </HStack>
                    <Box flex="1" minH="0" display="flex" flexDirection="column" overflowY="auto">
                      <FileView key={selectedFileId} fileId={selectedFileId} mode="preview" hideHeader />
                    </Box>
                  </>
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

            {/* Footer */}
            <Box
              px={5}
              py={3}
              borderTop="1px solid"
              borderColor="border.default"
              flexShrink={0}
            >
              <HStack justify="space-between" align="center">
                {publishError ? (
                  <Text fontSize="xs" color="fg.error">
                    {publishError}
                  </Text>
                ) : (
                  <Text fontSize="xs" color="fg.muted">
                    Publish or discard individual files, or publish all at once.
                  </Text>
                )}
                <Button
                  size="sm"
                  colorPalette="teal"
                  loading={isPublishing}
                  onClick={handlePublishAll}
                >
                  <LuUpload />
                  Publish All
                </Button>
              </HStack>
            </Box>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

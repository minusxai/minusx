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
import { useAppSelector } from '@/store/hooks';
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
import { LuUpload } from 'react-icons/lu';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileView from '@/components/FileView';
import { publishAll } from '@/lib/api/file-state';
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
  const Icon = meta.icon;
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
        <Icon size={15} />
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
      <Badge
        size="sm"
        fontSize="2xs"
        fontFamily="mono"
        colorPalette="orange"
        variant="subtle"
        flexShrink={0}
      >
        unsaved
      </Badge>
    </HStack>
  );
}

export default function PublishModal({ isOpen, onClose }: PublishModalProps) {
  const dirtyFiles = useDirtyFiles();
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
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

  const handlePublishAll = useCallback(async () => {
    setIsPublishing(true);
    setPublishError(null);
    try {
      await publishAll();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish. Please try again.');
    } finally {
      setIsPublishing(false);
    }
  }, []);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e: { open: boolean }) => { if (!e.open) onClose(); }}
      size="full"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner display="flex" alignItems="center" justifyContent="center" p={4}>
          <Dialog.Content
            maxW="90vw"
            h="85vh"
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

              {/* Right pane: file view */}
              <Box flex="1" overflow="auto" bg="bg.canvas">
                {selectedFileId !== null ? (
                  <Box p={4} h="full">
                    <FileView key={selectedFileId} fileId={selectedFileId} mode="view" hideHeader />
                  </Box>
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
                    Save individual files using the Save button in the preview pane.
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

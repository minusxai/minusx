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
  IconButton,
} from '@chakra-ui/react';
import { Dialog } from '@chakra-ui/react';
import { LuSave, LuUndo2, LuX, LuCheck, LuPanelLeftClose, LuPanelLeftOpen, LuCode, LuEye } from 'react-icons/lu';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileView from '@/components/FileView';
import { publishAll, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { setDashboardEditMode, setFileEditMode } from '@/store/uiSlice';
import { selectFile, selectMergedContent, selectIsDirty } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import type { FileType } from '@/lib/ui/file-metadata';
import { getStore } from '@/store/store';

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
  onSave,
  onDiscard,
  isSaving,
}: {
  file: FileState;
  isSelected: boolean;
  onSelect: () => void;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
}) {
  const meta = getFileTypeMetadata(file.type as any);
  const FileIcon = meta.icon;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, file.id));

  return (
    <HStack
      px={3}
      py={2}
      gap={2}
      cursor="pointer"
      onClick={onSelect}
      bg={isSelected ? 'bg.emphasized' : 'transparent'}
      _hover={{ bg: isSelected ? 'bg.emphasized' : 'bg.muted' }}
      borderRadius="md"
      align="center"
      transition="background 0.1s"
      minW="0"
      overflow="hidden"
    >
      <Box color={meta.color} flexShrink={0}>
        <FileIcon size={15} />
      </Box>
      <Text
        fontSize="sm"
        fontWeight="600"
        fontFamily="mono"
        lineHeight="1.3"
        truncate
        color="fg.default"
        flex="1"
        minW="0"
      >
        {effectiveName || 'Untitled'}
      </Text>
      <HStack gap={0.5} flexShrink={0} onClick={(e) => e.stopPropagation()}>
        <IconButton
          aria-label="Discard changes"
          size="2xs"
          variant="ghost"
          color="accent.danger"
          onClick={onDiscard}
        >
          <LuUndo2 />
        </IconButton>
        <IconButton
          aria-label="Save file"
          size="2xs"
          variant="ghost"
          color="accent.teal"
          loading={isSaving}
          onClick={onSave}
        >
          <LuCheck />
        </IconButton>
      </HStack>
    </HStack>
  );
}

function SelectedFileName({ fileId }: { fileId: number }) {
  const name = useAppSelector(state => selectEffectiveName(state, fileId));
  const fileState = useAppSelector(state => selectFile(state, fileId));
  const meta = fileState ? getFileTypeMetadata(fileState.type as any) : null;
  const FileIcon = meta?.icon;
  return (
    <HStack gap={2} minW="0" flex="1">
      {FileIcon && (
        <Box color={meta?.color} flexShrink={0}>
          <FileIcon size={15} />
        </Box>
      )}
      <Text
        fontSize="sm"
        fontWeight="700"
        fontFamily="mono"
        truncate
        color="fg.default"
      >
        {name || 'Untitled'}
      </Text>
    </HStack>
  );
}

export default function PublishModal({ isOpen, onClose }: PublishModalProps) {
  const dispatch = useAppDispatch();
  const dirtyFiles = useDirtyFiles();
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingSingleId, setPublishingSingleId] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const handlePublishFile = useCallback(async (fileId: number) => {
    const file = dirtyFiles.find(f => f.id === fileId);
    setPublishingSingleId(fileId);
    try {
      // Auto-publish virtual (negative-ID) dependencies first
      const state = getStore().getState();
      const mergedContent = selectMergedContent(state, fileId);
      const fileState = selectFile(state, fileId);
      if (mergedContent && fileState) {
        const refIds = extractReferencesFromContent(mergedContent as any, fileState.type as FileType);
        const virtualRefIds = refIds.filter(id => id < 0);
        for (const depId of virtualRefIds) {
          if (selectIsDirty(state, depId)) {
            const depFile = selectFile(state, depId);
            await publishFile({ fileId: depId });
            if (depFile) exitEditMode(depId, depFile.type);
          }
        }
      }

      await publishFile({ fileId });
      exitEditMode(fileId, file?.type);
    } finally {
      setPublishingSingleId(null);
    }
  }, [dirtyFiles, exitEditMode]);

  const handleDiscardFile = useCallback((fileId: number) => {
    const file = dirtyFiles.find(f => f.id === fileId);
    clearFileChanges({ fileId });
    exitEditMode(fileId, file?.type);
  }, [dirtyFiles, exitEditMode]);

  const handleDiscardAll = useCallback(() => {
    const filesToDiscard = [...dirtyFiles];
    for (const file of filesToDiscard) {
      clearFileChanges({ fileId: file.id });
      exitEditMode(file.id, file.type);
    }
  }, [dirtyFiles, exitEditMode]);

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
  );
}

function SelectedFilePane({ fileId, publishingSingleId, onDiscard, onPublish }: {
  fileId: number;
  publishingSingleId: number | null;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const showJson = useAppSelector(state => state.ui.showJson);
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>(showJson ? 'diff' : 'preview');
  const file = useAppSelector(state => selectFile(state, fileId));

  return (
    <>
      <HStack
        px={4}
        py={2}
        borderBottom="1px solid"
        borderColor="border.default"
        flexShrink={0}
        justify="space-between"
      >
        <HStack gap={2} flex={1} minW={0}>
          <SelectedFileName fileId={fileId} />
          {showJson && (
            <HStack gap={0} bg="bg.muted" borderRadius="sm" p={0.5}>
              <IconButton
                aria-label="Preview"
                size="2xs"
                variant={viewMode === 'preview' ? 'solid' : 'ghost'}
                bg={viewMode === 'preview' ? 'accent.teal' : undefined}
                color={viewMode === 'preview' ? 'white' : 'fg.muted'}
                onClick={() => setViewMode('preview')}
              >
                <LuEye />
              </IconButton>
              <IconButton
                aria-label="Diff"
                size="2xs"
                variant={viewMode === 'diff' ? 'solid' : 'ghost'}
                bg={viewMode === 'diff' ? 'accent.teal' : undefined}
                color={viewMode === 'diff' ? 'white' : 'fg.muted'}
                onClick={() => setViewMode('diff')}
              >
                <LuCode />
              </IconButton>
            </HStack>
          )}
        </HStack>
        <HStack gap={0.5} flexShrink={0}>
          <IconButton
            aria-label="Discard changes"
            size="2xs"
            variant="ghost"
            color="accent.danger"
            onClick={onDiscard}
          >
            <LuUndo2 />
          </IconButton>
          <IconButton
            aria-label="Save file"
            size="2xs"
            variant="ghost"
            color="accent.teal"
            loading={publishingSingleId === fileId}
            onClick={onPublish}
          >
            <LuCheck />
          </IconButton>
        </HStack>
      </HStack>

      {viewMode === 'preview' ? (
        <Box flex="1" minH="0" display="flex" flexDirection="column" overflowY="auto">
          <FileView key={fileId} fileId={fileId} mode="preview" hideHeader />
        </Box>
      ) : (
        <Box flex="1" minH="0" overflowY="auto" p={4} fontSize="xs" fontFamily="mono">
          {file && <DiffView file={file} />}
        </Box>
      )}
    </>
  );
}

function DiffView({ file }: { file: FileState }) {
  const { content, persistableChanges, metadataChanges } = file;

  const changedKeys = Object.keys(persistableChanges ?? {});
  const hasMetadata = metadataChanges && (metadataChanges.name !== undefined || metadataChanges.path !== undefined);

  if (changedKeys.length === 0 && !hasMetadata) {
    return <Text color="fg.muted" fontSize="sm">No changes detected</Text>;
  }

  return (
    <VStack gap={3} align="stretch">
      {hasMetadata && (
        <Box>
          <Text fontWeight="700" color="fg.subtle" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" fontSize="2xs">
            Metadata
          </Text>
          {metadataChanges?.name !== undefined && (
            <HStack gap={2} mb={1}>
              <Text color="fg.muted" minW="60px">name:</Text>
              <Text color="accent.danger" textDecoration="line-through">{file.name}</Text>
              <Text color="accent.teal">{metadataChanges.name}</Text>
            </HStack>
          )}
          {metadataChanges?.path !== undefined && (
            <HStack gap={2}>
              <Text color="fg.muted" minW="60px">path:</Text>
              <Text color="accent.danger" textDecoration="line-through">{file.path}</Text>
              <Text color="accent.teal">{metadataChanges.path}</Text>
            </HStack>
          )}
        </Box>
      )}

      {changedKeys.map(key => {
        const original = (content as Record<string, unknown>)?.[key];
        const changed = (persistableChanges as Record<string, unknown>)?.[key];

        return (
          <Box key={key}>
            <Text fontWeight="700" color="fg.subtle" mb={1.5} textTransform="uppercase" letterSpacing="0.05em" fontSize="2xs">
              {key}
            </Text>
            <HStack gap={3} align="start">
              <Box flex={1} bg="accent.danger/5" borderRadius="sm" p={2} border="1px solid" borderColor="accent.danger/20">
                <Text fontSize="2xs" color="accent.danger" fontWeight="600" mb={1}>Original</Text>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--chakra-colors-fg-default)', fontSize: '11px' }}>
                  {JSON.stringify(original ?? null, null, 2)}
                </pre>
              </Box>
              <Box flex={1} bg="accent.teal/5" borderRadius="sm" p={2} border="1px solid" borderColor="accent.teal/20">
                <Text fontSize="2xs" color="accent.teal" fontWeight="600" mb={1}>Changed</Text>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--chakra-colors-fg-default)', fontSize: '11px' }}>
                  {JSON.stringify(changed ?? null, null, 2)}
                </pre>
              </Box>
            </HStack>
          </Box>
        );
      })}
    </VStack>
  );
}

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, HStack, Text, Icon, VStack, Flex, SimpleGrid, Button, Dialog, Portal, CloseButton } from '@chakra-ui/react';
import { LuFiles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DbFile } from '@/lib/types';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useRouter } from '@/lib/navigation/use-navigation';
import { moveFile, deleteFile, duplicateFile } from '@/lib/file-state/file-state';
import BulkMoveFileModal from '../modals/BulkMoveFileModal';
import { canDeleteFileType, canCreateFileType } from '@/lib/auth/access-rules.client';
import FilesListToolbar from './FilesListToolbar';
import BulkActionBar from './BulkActionBar';
import FileListRow from './FileListRow';
import FileGridCard from './FileGridCard';
import FloatingDragGhost from './FloatingDragGhost';

interface FilesListProps {
  files: DbFile[];
  limit?: number;
  showToolbar?: boolean;
  availableTypes?: FileType[];  // Types to show in filter dropdown (defaults to all types in files)
}

type ViewMode = 'list' | 'grid';
type FileType = DbFile['type'];

export default function FilesList({ files, limit, showToolbar = true, availableTypes }: FilesListProps) {
  const router = useRouter(); // Still needed for router.refresh() in drag & drop
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedTypes, setSelectedTypes] = useState<FileType[]>([]);
  const [draggedFileId, setDraggedFileId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Exit selection mode on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionMode) {
        setSelectionMode(false);
        setSelectedFileIds(new Set());
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectionMode]);

  const toggleFileSelection = useCallback((fileId: number) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedFileIds(new Set());
  }, []);

  const enterSelectionWithFile = useCallback((fileId: number) => {
    setSelectionMode(true);
    setSelectedFileIds(new Set([fileId]));
  }, []);

  const selectedFiles = useMemo(() =>
    files.filter(f => selectedFileIds.has(f.id)).map(f => ({ id: f.id, name: f.name, path: f.path, type: f.type })),
    [files, selectedFileIds]
  );

  // Subsets of the selection that the user is allowed to act on in bulk.
  const deletableSelected = useMemo(
    () => selectedFiles.filter(f => f.type !== 'folder' && canDeleteFileType(f.type)),
    [selectedFiles]
  );
  const duplicableSelected = useMemo(
    () => selectedFiles.filter(f => f.type !== 'folder' && canCreateFileType(f.type)),
    [selectedFiles]
  );

  const handleBulkDuplicate = useCallback(async () => {
    setBulkBusy(true);
    try {
      await Promise.allSettled(duplicableSelected.map(f => duplicateFile(f.id)));
    } catch (error) {
      console.error('[FilesList] Bulk duplicate failed:', error);
    } finally {
      setBulkBusy(false);
      setSelectionMode(false);
      setSelectedFileIds(new Set());
    }
  }, [duplicableSelected]);

  const handleBulkDelete = useCallback(async () => {
    setBulkBusy(true);
    try {
      await Promise.allSettled(deletableSelected.map(f => deleteFile({ fileId: f.id })));
    } catch (error) {
      console.error('[FilesList] Bulk delete failed:', error);
    } finally {
      setBulkBusy(false);
      setShowBulkDeleteDialog(false);
      setSelectionMode(false);
      setSelectedFileIds(new Set());
    }
  }, [deletableSelected]);

  // Determine which types to show in the dropdown
  // If availableTypes is provided, use that; otherwise infer from files
  const filterTypes = availableTypes || Array.from(new Set(files.map(f => f.type)));

  // Compute per-folder context file counts (used to enable deletion when >1 exist)
  const contextCountByFolder = useMemo(() => {
    const map = new Map<string, number>();
    files.filter(f => f.type === 'context').forEach(f => {
      const parent = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
      map.set(parent, (map.get(parent) ?? 0) + 1);
    });
    return map;
  }, [files]);

  // Compute reverse reference index: question ID -> dashboard(s) that use it
  const dashboardsByQuestionId = useMemo(() => {
    const map = new Map<number, { id: number; name: string }[]>();
    files
      .filter(f => f.type === 'dashboard')
      .forEach(dashboard => {
        dashboard.references?.forEach((questionId: number) => {
          if (!map.has(questionId)) {
            map.set(questionId, []);
          }
          map.get(questionId)!.push({ id: dashboard.id, name: dashboard.name });
        });
      });
    return map;
  }, [files]);

  // Filter files based on selected types
  const filtered = selectedTypes.length === 0
    ? files
    : files.filter(f => selectedTypes.includes(f.type));

  // Group files into sections: knowledge base, dashboards, folders, questions, other
  const SECTION_ORDER = ['context', 'dashboard', 'story', 'folder', 'question', '_other'] as const;
  type SectionKey = typeof SECTION_ORDER[number];

  const SECTION_LABELS: Record<SectionKey, string> = {
    context: 'Knowledge Base',
    folder: 'Folders',
    dashboard: 'Dashboards',
    story: 'Stories',
    question: 'Questions',
    _other: 'Other',
  };

  const sections = useMemo(() => {
    const groups: Record<SectionKey, DbFile[]> = {
      context: [],
      folder: [],
      dashboard: [],
      story: [],
      question: [],
      _other: [],
    };

    filtered.forEach(f => {
      if (f.type === 'context') groups.context.push(f);
      else if (f.type === 'folder') groups.folder.push(f);
      else if (f.type === 'dashboard') groups.dashboard.push(f);
      else if (f.type === 'story') groups.story.push(f);
      else if (f.type === 'question') groups.question.push(f);
      else groups._other.push(f);
    });

    // Sort within each group by name
    for (const key of SECTION_ORDER) {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    }

    return SECTION_ORDER
      .map(key => ({ key, label: SECTION_LABELS[key], files: groups[key] }))
      .filter(s => s.files.length > 0);
  }, [filtered]);

  // Track collapsed sections — knowledge base is always open, dashboards/folders open by default
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionKey>>(new Set(['question', '_other']));

  // If no primary sections exist, force-open the remaining sections
  const hasPrimarySections = sections.some(s => s.key === 'context' || s.key === 'dashboard' || s.key === 'folder');
  const effectiveCollapsed = hasPrimarySections
    ? collapsedSections
    : new Set([...collapsedSections].filter(k => !sections.some(s => s.key === k)));
  const shouldHideSectionHeaders = sections.length <= 1;
  const nonContextSections = sections.filter(section => section.key !== 'context');
  const shouldForceOpenSingleNonContextSection =
    sections.some(section => section.key === 'context') && nonContextSections.length === 1;
  const toggleSection = (key: SectionKey) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Flat list for selection operations (select all, etc.)
  const filteredFiles = useMemo(() => {
    const flat = sections.flatMap(s => s.files);
    return limit ? flat.slice(0, limit) : flat;
  }, [sections, limit]);

  const toggleSelectAll = useCallback(() => {
    if (selectedFileIds.size === filteredFiles.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map(f => f.id)));
    }
  }, [selectedFileIds.size, filteredFiles]);

  // Toggle type selection
  const toggleType = (type: FileType) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  // Check if type is selected
  const isTypeSelected = (type: FileType) => selectedTypes.includes(type);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, file: DbFile) => {
    if (file.type === 'folder' || !canDeleteFileType(file.type)) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('fileId', file.id.toString());
    setDraggedFileId(file.id);
    setDragPosition({ x: e.clientX, y: e.clientY });

    // Hide the default drag ghost image
    const emptyImage = new Image();
    emptyImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(emptyImage, 0, 0);
  };

  const handleDrag = (e: React.DragEvent) => {
    if (e.clientX !== 0 && e.clientY !== 0) {
      setDragPosition({ x: e.clientX, y: e.clientY });
    }
  };

  const handleDragEnd = () => {
    setDraggedFileId(null);
    setDropTargetId(null);
    setDragPosition(null);
  };

  const handleDragOver = (e: React.DragEvent, targetFolder: DbFile) => {
    if (targetFolder.type !== 'folder') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, targetFolder: DbFile) => {
    if (targetFolder.type !== 'folder') return;
    e.preventDefault();
    setDropTargetId(targetFolder.id);
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: DbFile) => {
    e.preventDefault();
    e.stopPropagation();

    if (targetFolder.type !== 'folder') return;

    const fileIdStr = e.dataTransfer.getData('fileId');
    const fileId = parseInt(fileIdStr, 10);
    if (!fileIdStr || isNaN(fileId) || fileId === targetFolder.id) {
      setDropTargetId(null);
      setDraggedFileId(null);
      return;
    }

    const draggedFile = files.find(f => f.id === fileId);
    if (!draggedFile) return;

    // Construct new path: targetFolder.path + '/' + draggedFile.name
    const newPath = `${targetFolder.path}/${draggedFile.name}`;

    console.log('[FilesList] Moving file:', {
      draggedFile: draggedFile.name,
      oldPath: draggedFile.path,
      targetFolder: targetFolder.name,
      targetFolderPath: targetFolder.path,
      newPath: newPath
    });

    try {
      await moveFile(fileId, draggedFile.name, newPath);
      console.log('[FilesList] Move successful');
    } catch (error) {
      console.error('[FilesList] Move failed:', error);
      alert(`Failed to move file: ${error}`);
    } finally {
      setDropTargetId(null);
      setDraggedFileId(null);
    }
  };

  return (
    <Box minH="500px">
      {/* Toolbar: Filter + View Toggle */}
      {showToolbar && (
        <FilesListToolbar
          filterTypes={filterTypes}
          selectedTypes={selectedTypes}
          toggleType={toggleType}
          isTypeSelected={isTypeSelected}
          clearTypes={() => setSelectedTypes([])}
        />
      )}

      {/* Bulk Action Bar */}
      {selectionMode && (
        <BulkActionBar
          filteredFilesCount={filteredFiles.length}
          selectedCount={selectedFileIds.size}
          onToggleSelectAll={toggleSelectAll}
          onBulkDuplicate={handleBulkDuplicate}
          bulkBusy={bulkBusy}
          duplicableCount={duplicableSelected.length}
          onMoveClick={() => setShowBulkMoveModal(true)}
          onDeleteClick={() => setShowBulkDeleteDialog(true)}
          deletableCount={deletableSelected.length}
          onCancel={exitSelectionMode}
        />
      )}

      {/* Grouped sections */}
      {sections.length === 0 ? (
        <Flex
          direction="column"
          align="center"
          justify="center"
          py={24}
          px={8}
        >
          <Icon as={LuFiles} boxSize={16} color="fg.muted" mb={4} />
          <Text fontSize="xl" fontWeight="600" mb={2} color="fg.default">
            No files yet
          </Text>
          <Text color="fg.muted" fontSize="sm" textAlign="center" maxW="md">
            Create your first file to get started
          </Text>
        </Flex>
      ) : (
        <VStack gap={0} align="stretch">
          {sections.map((section, sectionIdx) => {
            const isCollapsible = section.key !== 'context';
            const isForcedOpen =
              shouldForceOpenSingleNonContextSection &&
              section.key === nonContextSections[0]?.key;
            const isCollapsed =
              !shouldHideSectionHeaders &&
              !isForcedOpen &&
              isCollapsible &&
              effectiveCollapsed.has(section.key);
            const showHeader = !shouldHideSectionHeaders && isCollapsible;
            // Get representative metadata for section icon/color
            const sectionMeta = section.key !== '_other'
              ? FILE_TYPE_METADATA[section.key as keyof typeof FILE_TYPE_METADATA]
              : null;

            return (
              <Box key={section.key} mb={sectionIdx < sections.length - 1 ? 2 : 0}>
                {/* Section Header */}
                {showHeader && (
                  <HStack
                    px={3}
                    py={1.5}
                    cursor="pointer"
                    onClick={() => toggleSection(section.key)}
                    _hover={{ bg: 'bg.subtle' }}
                    borderRadius="sm"
                    transition="background 0.15s"
                    userSelect="none"
                    mt={sectionIdx > 0 ? 1 : 0}
                    aria-label={`${section.label} section`}
                  >
                    <Icon
                      as={isCollapsed ? LuChevronRight : LuChevronDown}
                      boxSize={3.5}
                      color={sectionMeta?.color || 'fg.muted'}
                    />
                    <Text
                      fontSize="2xs"
                      fontWeight="600"
                      color="fg.muted"
                      textTransform="uppercase"
                      letterSpacing="0.05em"
                    >
                      {section.label}
                    </Text>
                    {isCollapsed ? (
                      <Flex
                        align="center"
                        justify="center"
                        px={2}
                        py={0.5}
                        borderRadius="full"
                        bg={sectionMeta?.color ? `${sectionMeta.color}/10` : 'bg.emphasized'}
                        flexShrink={0}
                      >
                        <Text
                          fontSize="2xs"
                          color={sectionMeta?.color || 'fg.muted'}
                          fontFamily="mono"
                          lineHeight="1"
                        >
                          Show {section.files.length} Files
                        </Text>
                      </Flex>
                    ) : (
                      <Flex
                        align="center"
                        justify="center"
                        boxSize={4}
                        borderRadius="full"
                        bg={sectionMeta?.color ? `${sectionMeta.color}/10` : 'bg.emphasized'}
                        flexShrink={0}
                      >
                        <Text
                          fontSize="2xs"
                          color={sectionMeta?.color || 'fg.muted'}
                          fontFamily="mono"
                          lineHeight="1"
                        >
                          {section.files.length}
                        </Text>
                      </Flex>
                    )}
                    <Box flex="1" h="1px" bg="border.muted" />
                  </HStack>
                )}

                {/* Section Content */}
                {!isCollapsed && (
                  viewMode === 'list' ? (
                    <VStack gap={0} align="stretch">
                      {section.files.map((file) => (
                        <FileListRow
                          key={file.id}
                          file={file}
                          sectionKey={section.key}
                          selectionMode={selectionMode}
                          selectedFileIds={selectedFileIds}
                          draggedFileId={draggedFileId}
                          dropTargetId={dropTargetId}
                          dashboardsByQuestionId={dashboardsByQuestionId}
                          contextCountByFolder={contextCountByFolder}
                          toggleFileSelection={toggleFileSelection}
                          enterSelectionWithFile={enterSelectionWithFile}
                          handleDragStart={handleDragStart}
                          handleDrag={handleDrag}
                          handleDragEnd={handleDragEnd}
                          handleDragOver={handleDragOver}
                          handleDragEnter={handleDragEnter}
                          handleDragLeave={handleDragLeave}
                          handleDrop={handleDrop}
                        />
                      ))}
                    </VStack>
                  ) : (
                    /* Grid View for this section */
                    <SimpleGrid columns={{ base: 2, sm: 4, md: 6, lg: 8 }} gap={4} px={2} pt={3} pb={2}>
                      {section.files.map((file) => (
                        <FileGridCard
                          key={file.id}
                          file={file}
                          selectionMode={selectionMode}
                          selectedFileIds={selectedFileIds}
                          draggedFileId={draggedFileId}
                          dropTargetId={dropTargetId}
                          dashboardsByQuestionId={dashboardsByQuestionId}
                          contextCountByFolder={contextCountByFolder}
                          toggleFileSelection={toggleFileSelection}
                          enterSelectionWithFile={enterSelectionWithFile}
                          handleDragStart={handleDragStart}
                          handleDrag={handleDrag}
                          handleDragEnd={handleDragEnd}
                          handleDragOver={handleDragOver}
                          handleDragEnter={handleDragEnter}
                          handleDragLeave={handleDragLeave}
                          handleDrop={handleDrop}
                        />
                      ))}
                    </SimpleGrid>
                  )
                )}
              </Box>
            );
          })}
        </VStack>
      )}

      {/* Floating Dragged Element */}
      <FloatingDragGhost
        files={files}
        draggedFileId={draggedFileId}
        dragPosition={dragPosition}
        viewMode={viewMode}
      />

      {/* Bulk Move Modal */}
      <BulkMoveFileModal
        isOpen={showBulkMoveModal}
        onClose={() => {
          setShowBulkMoveModal(false);
          exitSelectionMode();
        }}
        files={selectedFiles}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog.Root open={showBulkDeleteDialog} onOpenChange={(e) => !bulkBusy && setShowBulkDeleteDialog(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
              shadow="xl"
              p={0}
              my={12}
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontSize="lg" fontWeight="700" fontFamily="mono">Delete Files</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  Are you sure you want to delete <Text as="span" fontWeight="600" fontFamily="mono">{deletableSelected.length} file{deletableSelected.length !== 1 ? 's' : ''}</Text>? This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Button px={4} variant="outline" fontFamily="mono" disabled={bulkBusy} onClick={() => setShowBulkDeleteDialog(false)}>Cancel</Button>
                <Button px={4} bg="fg.error" color="white" onClick={handleBulkDelete} loading={bulkBusy} _hover={{ opacity: 0.9 }} fontFamily="mono">
                  Delete
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" top={4} right={4} disabled={bulkBusy} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  );
}

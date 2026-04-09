'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, HStack, Text, Icon, VStack, IconButton, Flex, SimpleGrid, Button } from '@chakra-ui/react';
import { LuList, LuLayoutGrid, LuFiles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DbFile } from '@/lib/types';
import { FILE_TYPE_METADATA, getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileActionMenu from './FileActionMenu';
import { Tooltip } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter } from '@/lib/navigation/use-navigation';
import { generateFileUrl } from '@/lib/slug-utils';
import { Link } from '@/components/ui/Link';
import DashboardUsageBadge from './DashboardUsageBadge';
import { moveFile } from '@/lib/api/file-state';
import BulkMoveFileModal from './BulkMoveFileModal';
import { canDeleteFileType } from '@/lib/auth/access-rules.client';

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

  // Determine which types to show in the dropdown
  // If availableTypes is provided, use that; otherwise infer from files
  const filterTypes = availableTypes || Array.from(new Set(files.map(f => f.type)));

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
  const SECTION_ORDER = ['context', 'dashboard', 'folder', 'question', '_other'] as const;
  type SectionKey = typeof SECTION_ORDER[number];

  const SECTION_LABELS: Record<SectionKey, string> = {
    context: 'Knowledge Base',
    folder: 'Folders',
    dashboard: 'Dashboards',
    question: 'Questions',
    _other: 'Other',
  };

  const sections = useMemo(() => {
    const groups: Record<SectionKey, DbFile[]> = {
      context: [],
      folder: [],
      dashboard: [],
      question: [],
      _other: [],
    };

    filtered.forEach(f => {
      if (f.type === 'context') groups.context.push(f);
      else if (f.type === 'folder') groups.folder.push(f);
      else if (f.type === 'dashboard') groups.dashboard.push(f);
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
      <HStack justify="space-between" mb={3}>
        {/* Filter Chips */}
        <HStack gap={1.5} flexWrap="wrap">
          <Button
            size="2xs"
            variant={selectedTypes.length === 0 ? 'solid' : 'outline'}
            bg={selectedTypes.length === 0 ? 'accent.teal' : 'transparent'}
            color={selectedTypes.length === 0 ? 'white' : 'fg.muted'}
            borderColor={selectedTypes.length === 0 ? 'accent.teal' : 'border.default'}
            _hover={{ bg: selectedTypes.length === 0 ? 'accent.teal' : 'bg.muted' }}
            fontWeight="500"
            fontSize="xs"
            borderRadius="md"
            px={2}
            onClick={() => setSelectedTypes([])}
          >
            All
          </Button>
          {filterTypes.map((type) => {
            const typeColor = FILE_TYPE_METADATA[type].color;
            const active = isTypeSelected(type);
            return (
              <Button
                key={type}
                size="2xs"
                variant={active ? 'solid' : 'outline'}
                bg={active ? typeColor : 'transparent'}
                color={active ? 'white' : 'fg.muted'}
                borderColor={active ? typeColor : 'border.default'}
                _hover={{ bg: active ? typeColor : 'bg.muted' }}
                fontSize="2xs"
                borderRadius="md"
                px={2}
                gap={1.5}
                onClick={() => toggleType(type)}
              >
                <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={3.5} />
                {FILE_TYPE_METADATA[type].label}
              </Button>
            );
          })}
        </HStack>

        {/* View Toggle */}
        <HStack gap={2} flexShrink={0}>
          <HStack
            gap={0.5}
            bg="bg.surface"
            borderRadius="md"
            p={0.5}
            border="1px solid"
            borderColor="border.default"
          >
            <Tooltip content="List view" positioning={{ placement: 'bottom' }}>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="List view"
                onClick={() => setViewMode('list')}
                bg={viewMode === 'list' ? 'accent.teal' : 'transparent'}
                color={viewMode === 'list' ? 'white' : 'fg.default'}
                _hover={{ bg: viewMode === 'list' ? 'accent.teal' : 'bg.muted' }}
                borderRadius="sm"
              >
                <LuList />
              </IconButton>
            </Tooltip>
            <Tooltip content="Grid view" positioning={{ placement: 'bottom' }}>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Grid view"
                onClick={() => setViewMode('grid')}
                bg={viewMode === 'grid' ? 'accent.teal' : 'transparent'}
                color={viewMode === 'grid' ? 'white' : 'fg.default'}
                _hover={{ bg: viewMode === 'grid' ? 'accent.teal' : 'bg.muted' }}
                borderRadius="sm"
              >
                <LuLayoutGrid />
              </IconButton>
            </Tooltip>
          </HStack>
        </HStack>
      </HStack>
      )}

      {/* Bulk Action Bar */}
      {selectionMode && (
        <HStack
          px={4}
          py={2}
          mb={2}
          bg="accent.teal/10"
          borderRadius="md"
          border="1px solid"
          borderColor="accent.teal/30"
          justify="space-between"
        >
          <HStack gap={2}>
            <Checkbox
              size="sm"
              checked={filteredFiles.length > 0 && selectedFileIds.size === filteredFiles.length}
              onCheckedChange={() => toggleSelectAll()}
              aria-label="Select all"
            />
            <Text fontSize="sm" fontWeight="500" color="fg.default" aria-label="Selection status">
              {selectedFileIds.size} file{selectedFileIds.size !== 1 ? 's' : ''} selected
            </Text>
          </HStack>
          <HStack gap={2}>
            <Button
              size="xs"
              bg="accent.teal"
              color="white"
              _hover={{ bg: 'accent.teal', opacity: 0.9 }}
              onClick={() => setShowBulkMoveModal(true)}
              disabled={selectedFileIds.size === 0}
              aria-label="Move"
            >
              Move
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={exitSelectionMode}
              aria-label="Cancel selection"
            >
              Cancel
            </Button>
          </HStack>
        </HStack>
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
            const isCollapsed = isCollapsible && effectiveCollapsed.has(section.key);
            const showHeader = isCollapsible;
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
                    <Box flex="1" h="1px" bg="border.muted" />
                  </HStack>
                )}

                {/* Section Content */}
                {!isCollapsed && (
                  viewMode === 'list' ? (
                    <VStack gap={0} align="stretch">
                      {section.files.map((file) => (
                        <Box
                          key={file.id}
                          position="relative"
                          role="group"
                          onDragOver={(e) => !selectionMode && handleDragOver(e, file)}
                          onDragEnter={(e) => !selectionMode && handleDragEnter(e, file)}
                          onDragLeave={() => !selectionMode && handleDragLeave()}
                          onDrop={(e) => !selectionMode && handleDrop(e, file)}
                        >
                          <Link
                            href={file.type === 'folder' ? `/p${file.path}` : `/f/${generateFileUrl(file.id, file.name)}`}
                            prefetch={!selectionMode}
                            style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                            draggable={!selectionMode && file.type !== 'folder'}
                            onDragStart={(e) => !selectionMode && handleDragStart(e, file)}
                            onDrag={(e) => !selectionMode && handleDrag(e)}
                            onDragEnd={() => !selectionMode && handleDragEnd()}
                            onClick={(e) => {
                              if (selectionMode) {
                                e.preventDefault();
                                toggleFileSelection(file.id);
                              } else if (draggedFileId) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <Box
                              as="div"
                              opacity={draggedFileId === file.id ? 0 : 1}
                            >
                            <HStack
                              px={4}
                              py={3}
                              h="52px"
                              borderBottom="1px solid"
                              borderColor="border.muted"
                              bg={selectionMode && selectedFileIds.has(file.id) ? 'accent.teal/10' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/10' : 'transparent'}
                              borderWidth={dropTargetId === file.id && file.type === 'folder' ? '2px' : '0'}
                              borderStyle={dropTargetId === file.id && file.type === 'folder' ? 'dashed' : 'solid'}
                              _hover={{
                                bg: selectionMode ? 'accent.teal/5' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/20' : 'bg.surface',
                              }}
                              cursor="pointer"
                              _active={{
                                cursor: 'pointer',
                              }}
                              transition="all 0.15s"
                              aria-label={file.name}
                            >
                              {/* Checkbox in selection mode */}
                              {selectionMode && (
                                <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    size="sm"
                                    checked={selectedFileIds.has(file.id)}
                                    onCheckedChange={() => toggleFileSelection(file.id)}
                                    aria-label={`Select ${file.name}`}
                                  />
                                </Box>
                              )}
                              {/* Icon + Name */}
                              <HStack flex="1" gap={3} minW={0}>
                                <Icon
                                  as={getFileTypeMetadata(file.type).icon}
                                  boxSize={5}
                                  color={getFileTypeMetadata(file.type).color}
                                  flexShrink={0}
                                />
                                <Text
                                  fontWeight="500"
                                  fontSize="sm"
                                  color="fg.default"
                                  truncate
                                  lineClamp={1}
                                  fontFamily="mono"
                                >
                                  {file.name}
                                </Text>
                                {file.type === 'question' && (
                                  <DashboardUsageBadge dashboards={dashboardsByQuestionId.get(file.id)} />
                                )}
                              </HStack>

                              {/* Type Label — hide when section already indicates the type */}
                              {(section.key === '_other' || section.key === 'folder') && (
                              <Box w="120px" display={{ base: 'none', md: 'block' }}>
                                <Text
                                  fontSize="xs"
                                  color="fg.muted"
                                  fontFamily="mono"
                                  fontWeight="500"
                                >
                                  {getFileTypeMetadata(file.type).label}
                                </Text>
                              </Box>
                              )}

                              {/* Modified Date */}
                              <Box w="140px" display={{ base: 'none', lg: 'block' }}>
                                <Text
                                  fontSize="xs"
                                  color="fg.muted"
                                  fontFamily="mono"
                                >
                                  {new Date(file.updated_at).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </Text>
                              </Box>

                              {/* Actions placeholder */}
                              <Box w="40px" />
                            </HStack>
                            </Box>
                          </Link>

                          {/* Action Menu */}
                          <Box
                            position="absolute"
                            right={2}
                            top="50%"
                            transform="translateY(-50%)"
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="sm" onSelect={enterSelectionWithFile} />
                          </Box>
                        </Box>
                      ))}
                    </VStack>
                  ) : (
                    /* Grid View for this section */
                    <SimpleGrid columns={{ base: 2, sm: 4, md: 6, lg: 8 }} gap={4} px={2} pt={3} pb={2}>
                      {section.files.map((file) => (
                        <Box
                          key={file.id}
                          position="relative"
                          role="group"
                          onDragOver={(e) => !selectionMode && handleDragOver(e, file)}
                          onDragEnter={(e) => !selectionMode && handleDragEnter(e, file)}
                          onDragLeave={() => !selectionMode && handleDragLeave()}
                          onDrop={(e) => !selectionMode && handleDrop(e, file)}
                        >
                          <Link
                            href={file.type === 'folder' ? `/p${file.path}` : `/f/${generateFileUrl(file.id, file.name)}`}
                            prefetch={!selectionMode}
                            style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                            draggable={!selectionMode && file.type !== 'folder'}
                            onDragStart={(e) => !selectionMode && handleDragStart(e, file)}
                            onDrag={(e) => !selectionMode && handleDrag(e)}
                            onDragEnd={() => !selectionMode && handleDragEnd()}
                            onClick={(e) => {
                              if (selectionMode) {
                                e.preventDefault();
                                toggleFileSelection(file.id);
                              } else if (draggedFileId) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <Box
                              as="div"
                              opacity={draggedFileId === file.id ? 0 : 1}
                            >
                            <VStack
                              p={4}
                              bg={selectionMode && selectedFileIds.has(file.id) ? 'accent.teal/10' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/10' : 'bg.surface'}
                              borderRadius="md"
                              border="2px"
                              borderStyle={dropTargetId === file.id && file.type === 'folder' ? 'dashed' : 'solid'}
                              borderColor={selectionMode && selectedFileIds.has(file.id) ? 'accent.teal' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal' : 'border.default'}
                              _hover={{
                                bg: selectionMode ? 'accent.teal/5' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/20' : 'bg.elevated',
                                borderColor: selectionMode && selectedFileIds.has(file.id) ? 'accent.teal' : dropTargetId === file.id && file.type === 'folder' ? 'accent.teal' : getFileTypeMetadata(file.type).color,
                              }}
                              cursor="pointer"
                              _active={{
                                cursor: 'pointer',
                              }}
                              transition="all 0.15s"
                              align="center"
                              gap={3}
                              h="120px"
                              justify="center"
                            >
                              {/* File Icon */}
                              <Icon
                                as={getFileTypeMetadata(file.type).icon}
                                boxSize={8}
                                color={getFileTypeMetadata(file.type).color}
                              />

                              {/* File Name */}
                              <VStack gap={0.5} w="100%" align="center" minW={0}>
                                <Text
                                  fontWeight="500"
                                  fontSize="sm"
                                  textAlign="center"
                                  w="100%"
                                  color="fg.default"
                                  overflow="hidden"
                                  textOverflow="ellipsis"
                                  whiteSpace="nowrap"
                                  fontFamily={"mono"}
                                >
                                  {file.name}
                                </Text>
                                {file.type === 'question' && (
                                  <DashboardUsageBadge dashboards={dashboardsByQuestionId.get(file.id)} compact />
                                )}
                              </VStack>
                            </VStack>
                            </Box>
                          </Link>

                          {/* Checkbox overlay in selection mode */}
                          {selectionMode && (
                            <Box
                              position="absolute"
                              left={1}
                              top={1}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                            >
                              <Checkbox
                                size="sm"
                                checked={selectedFileIds.has(file.id)}
                                onCheckedChange={() => toggleFileSelection(file.id)}
                                aria-label={`Select ${file.name}`}
                              />
                            </Box>
                          )}

                          {/* Action Menu */}
                          {!selectionMode && (
                          <Box
                            position="absolute"
                            right={1}
                            top={1}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="xs" onSelect={enterSelectionWithFile} />
                          </Box>
                          )}
                        </Box>
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
      {draggedFileId && dragPosition && (() => {
        const draggedFile = files.find(f => f.id === draggedFileId);
        if (!draggedFile) return null;
        const metadata = getFileTypeMetadata(draggedFile.type);

        return (
          <Box
            position="fixed"
            left={`${dragPosition.x}px`}
            top={`${dragPosition.y}px`}
            transform="translate(-50%, -50%)"
            pointerEvents="none"
            zIndex={9999}
            transition="none"
          >
            {viewMode === 'list' ? (
              <HStack
                px={4}
                py={3}
                h="52px"
                bg="bg.surface"
                borderRadius="md"
                border="2px solid"
                borderColor="accent.teal"
                shadow="xl"
                minW="300px"
                gap={3}
              >
                <Icon
                  as={metadata.icon}
                  boxSize={5}
                  color={metadata.color}
                  flexShrink={0}
                />
                <Text
                  fontWeight="500"
                  fontSize="sm"
                  color="fg.default"
                  fontFamily="mono"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {draggedFile.name}
                </Text>
              </HStack>
            ) : (
              <VStack
                p={4}
                bg="bg.surface"
                borderRadius="md"
                border="2px solid"
                borderColor="accent.teal"
                shadow="xl"
                align="center"
                gap={3}
                h="120px"
                w="180px"
                justify="center"
              >
                <Icon
                  as={metadata.icon}
                  boxSize={8}
                  color={metadata.color}
                />
                <VStack gap={0.5} w="100%" align="center" minW={0}>
                  <Text
                    fontWeight="500"
                    fontSize="sm"
                    textAlign="center"
                    w="100%"
                    color="fg.default"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    fontFamily="mono"
                  >
                    {draggedFile.name}
                  </Text>
                  <Text
                    fontSize="2xs"
                    color="fg.muted"
                    fontFamily="mono"
                    fontWeight="500"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    whiteSpace="nowrap"
                  >
                    {metadata.label}
                  </Text>
                </VStack>
              </VStack>
            )}
          </Box>
        );
      })()}

      {/* Bulk Move Modal */}
      <BulkMoveFileModal
        isOpen={showBulkMoveModal}
        onClose={() => {
          setShowBulkMoveModal(false);
          exitSelectionMode();
        }}
        files={selectedFiles}
      />
    </Box>
  );
}

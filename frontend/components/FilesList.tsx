'use client';

import { useState, useMemo } from 'react';
import { Box, HStack, Text, Icon, VStack, IconButton, Flex, SimpleGrid, Button, Menu } from '@chakra-ui/react';
import { LuList, LuLayoutGrid, LuChevronDown, LuFiles } from 'react-icons/lu';
import { DbFile } from '@/lib/types';
import { FILE_TYPE_METADATA, getFileTypeMetadata } from '@/lib/ui/file-metadata';
import FileActionMenu from './FileActionMenu';
import { Tooltip } from '@/components/ui/tooltip';
import { useRouter } from '@/lib/navigation/use-navigation';
import { generateFileUrl } from '@/lib/slug-utils';
import { Link } from '@/components/ui/Link';
import DashboardUsageBadge from './DashboardUsageBadge';

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

  // File type sort order: folders first, then context, dashboards, questions, others
  const FILE_TYPE_ORDER: Record<string, number> = {
    folder: 0,
    context: 1,
    dashboard: 2,
    question: 3,
  };
  const getTypeOrder = (type: string) => FILE_TYPE_ORDER[type] ?? 99;

  // Filter files based on selected types
  const filtered = selectedTypes.length === 0
    ? files
    : files.filter(f => selectedTypes.includes(f.type));

  // Sort by type priority, then by name within each type
  const sorted = [...filtered].sort((a, b) => {
    const orderDiff = getTypeOrder(a.type) - getTypeOrder(b.type);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });

  // Apply limit if specified
  const filteredFiles = limit ? sorted.slice(0, limit) : sorted;

  // Get label for current filter
  const getFilterLabel = () => {
    if (selectedTypes.length === 0) return 'All types';
    if (selectedTypes.length === 1) return FILE_TYPE_METADATA[selectedTypes[0]].label;
    return `${selectedTypes.length} types`;
  };

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
    if (file.type === 'folder') return; // Don't allow dragging folders for now
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
      const response = await fetch(`/api/documents/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPath }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[FilesList] Move failed:', error);
        throw new Error(error.error || 'Failed to move file');
      }

      console.log('[FilesList] Move successful, refreshing...');
      // Refresh the page to show updated list
      router.refresh();
    } catch (error) {
      console.error('Error moving file:', error);
      alert(`Failed to move file: ${error}`);
    } finally {
      setDropTargetId(null);
      setDraggedFileId(null);
    }
  };

  return (
    <Box>
      {/* Toolbar: Filter + View Toggle */}
      {showToolbar && (
      <HStack justify="space-between" mb={3}>
        {/* Filter Dropdown */}
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              size="sm"
              fontWeight="500"
              gap={2}
              px={2}
            >
              <Text>{getFilterLabel()}</Text>
              <Icon as={LuChevronDown} boxSize={3.5} />
            </Button>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content
              minW="200px"
              p={1}
              bg="bg.surface"
              borderColor="border.default"
              shadow="lg"
            >
              {/* All Types Option */}
              <Menu.Item
                value="all"
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedTypes([]);
                }}
                closeOnSelect={false}
                bg={selectedTypes.length === 0 ? 'accent.teal/10' : 'transparent'}
                color={selectedTypes.length === 0 ? 'accent.teal' : 'fg.default'}
                fontWeight={selectedTypes.length === 0 ? '600' : '400'}
                borderRadius="sm"
                px={3}
                py={2}
                cursor="pointer"
                _hover={{ bg: selectedTypes.length === 0 ? 'accent.teal/10' : 'bg.muted' }}
              >
                <HStack gap={2} w="100%">
                  <Box
                    w={4}
                    h={4}
                    borderRadius="sm"
                    border="2px solid"
                    borderColor={selectedTypes.length === 0 ? 'accent.teal' : 'border.default'}
                    bg={selectedTypes.length === 0 ? 'accent.teal' : 'transparent'}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    flexShrink={0}
                  >
                    {selectedTypes.length === 0 && (
                      <Box w={2} h={2} bg="white" borderRadius="xs" />
                    )}
                  </Box>
                  <Text flex="1">All types</Text>
                </HStack>
              </Menu.Item>

              {/* Type Options */}
              {filterTypes.map((type) => (
                <Menu.Item
                  key={type}
                  value={type}
                  onClick={(e) => {
                    e.preventDefault();
                    toggleType(type);
                  }}
                  closeOnSelect={false}
                  bg={isTypeSelected(type) ? 'accent.teal/10' : 'transparent'}
                  borderRadius="sm"
                  px={3}
                  py={2}
                  cursor="pointer"
                  _hover={{ bg: 'bg.muted' }}
                >
                  <HStack gap={2} w="100%">
                    <Box
                      w={4}
                      h={4}
                      borderRadius="sm"
                      border="2px solid"
                      borderColor={isTypeSelected(type) ? 'accent.teal' : 'border.default'}
                      bg={isTypeSelected(type) ? 'accent.teal' : 'transparent'}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      flexShrink={0}
                    >
                      {isTypeSelected(type) && (
                        <Box w={2} h={2} bg="white" borderRadius="xs" />
                      )}
                    </Box>
                    <Icon as={FILE_TYPE_METADATA[type].icon} boxSize={4} color={FILE_TYPE_METADATA[type].color} flexShrink={0} />
                    <Text flex="1">{FILE_TYPE_METADATA[type].label}</Text>
                  </HStack>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>

        {/* View Toggle */}
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
      )}

      {viewMode === 'list' ? (
        <VStack gap={0} align="stretch">
      {/* Header Row */}
      <HStack
        px={4}
        py={2}
        borderBottom="1px solid"
        borderColor="border.muted"
        fontSize="xs"
        fontWeight="600"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.05em"
      >
        <Box flex="1">Name</Box>
        <Box w="120px" display={{ base: 'none', md: 'block' }}>Type</Box>
        <Box w="140px" display={{ base: 'none', lg: 'block' }}>Modified</Box>
        <Box w="40px" />
      </HStack>

      {/* File Rows */}
      {filteredFiles.map((file) => (
        <Box
          key={file.id}
          position="relative"
          role="group"
          onDragOver={(e) => handleDragOver(e, file)}
          onDragEnter={(e) => handleDragEnter(e, file)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, file)}
        >
          <Link
            href={file.type === 'folder' ? `/p${file.path}` : `/f/${generateFileUrl(file.id, file.name)}`}
            prefetch={true}
            style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            draggable={file.type !== 'folder'}
            onDragStart={(e) => handleDragStart(e, file)}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onClick={(e) => {
              // Prevent navigation during drag
              if (draggedFileId) {
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
              bg={dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/10' : 'transparent'}
              borderWidth={dropTargetId === file.id && file.type === 'folder' ? '2px' : '0'}
              borderStyle={dropTargetId === file.id && file.type === 'folder' ? 'dashed' : 'solid'}
              _hover={{
                bg: dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/20' : 'bg.surface',
              }}
              cursor={file.type === 'folder' ? 'pointer' : 'grab'}
              _active={{
                cursor: file.type === 'folder' ? 'pointer' : 'grabbing',
              }}
              transition="all 0.15s"
            >
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

              {/* Type Label */}
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
            <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="sm" />
          </Box>
        </Box>
      ))}

      {/* Empty state */}
      {filteredFiles.length === 0 && (
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
      )}
    </VStack>
      ) : (
        /* Grid View */
        <SimpleGrid columns={{ base: 2, sm: 4, md: 6, lg: 8 }} gap={4}>
          {filteredFiles.map((file) => (
            <Box
              key={file.id}
              position="relative"
              role="group"
              onDragOver={(e) => handleDragOver(e, file)}
              onDragEnter={(e) => handleDragEnter(e, file)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, file)}
            >
              <Link
                href={file.type === 'folder' ? `/p${file.path}` : `/f/${generateFileUrl(file.id, file.name)}`}
                prefetch={true}
                style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                draggable={file.type !== 'folder'}
                onDragStart={(e) => handleDragStart(e, file)}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onClick={(e) => {
                  // Prevent navigation during drag
                  if (draggedFileId) {
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
                  bg={dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/10' : 'bg.surface'}
                  borderRadius="md"
                  border="2px"
                  borderStyle={dropTargetId === file.id && file.type === 'folder' ? 'dashed' : 'solid'}
                  borderColor={dropTargetId === file.id && file.type === 'folder' ? 'accent.teal' : 'border.default'}
                  _hover={{
                    bg: dropTargetId === file.id && file.type === 'folder' ? 'accent.teal/20' : 'bg.elevated',
                    borderColor: dropTargetId === file.id && file.type === 'folder' ? 'accent.teal' : getFileTypeMetadata(file.type).color,
                  }}
                  cursor={file.type === 'folder' ? 'pointer' : 'grab'}
                  _active={{
                    cursor: file.type === 'folder' ? 'pointer' : 'grabbing',
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
                    {/* File Type Badge */}
                    <Text
                      fontSize="2xs"
                      color="fg.muted"
                      fontFamily="mono"
                      fontWeight="500"
                      textTransform="uppercase"
                      letterSpacing="0.05em"
                      whiteSpace="nowrap"
                    >
                      {getFileTypeMetadata(file.type).label}
                    </Text>
                  </VStack>
                </VStack>
                </Box>
              </Link>

              {/* Action Menu */}
              <Box
                position="absolute"
                right={1}
                top={1}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="xs" />
              </Box>
            </Box>
          ))}

          {/* Empty state for grid */}
          {filteredFiles.length === 0 && (
            <Box gridColumn="1 / -1">
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
            </Box>
          )}
        </SimpleGrid>
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
    </Box>
  );
}

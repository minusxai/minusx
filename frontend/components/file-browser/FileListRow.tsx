'use client';

import { Box, HStack, Text, Icon } from '@chakra-ui/react';
import { DbFile } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { RESERVED_NAMES } from '@/lib/data/helpers/connections';
import FileActionMenu from './FileActionMenu';
import { Checkbox } from '@/components/ui/checkbox';
import { generateFileUrl } from '@/lib/slug-utils';
import { Link } from '@/components/ui/Link';
import DashboardUsageBadge from '../banners/DashboardUsageBadge';

type SectionKey = 'context' | 'dashboard' | 'story' | 'folder' | 'question' | '_other';

interface FileListRowProps {
  file: DbFile;
  sectionKey: SectionKey;
  selectionMode: boolean;
  selectedFileIds: Set<number>;
  draggedFileId: number | null;
  dropTargetId: number | null;
  dashboardsByQuestionId: Map<number, { id: number; name: string }[]>;
  contextCountByFolder: Map<string, number>;
  toggleFileSelection: (fileId: number) => void;
  enterSelectionWithFile: (fileId: number) => void;
  handleDragStart: (e: React.DragEvent, file: DbFile) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDragEnd: () => void;
  handleDragOver: (e: React.DragEvent, targetFolder: DbFile) => void;
  handleDragEnter: (e: React.DragEvent, targetFolder: DbFile) => void;
  handleDragLeave: () => void;
  handleDrop: (e: React.DragEvent, targetFolder: DbFile) => void;
}

export default function FileListRow({
  file,
  sectionKey,
  selectionMode,
  selectedFileIds,
  draggedFileId,
  dropTargetId,
  dashboardsByQuestionId,
  contextCountByFolder,
  toggleFileSelection,
  enterSelectionWithFile,
  handleDragStart,
  handleDrag,
  handleDragEnd,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
}: FileListRowProps) {
  return (
    <Box
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
            <Box flexShrink={0} display="flex" alignItems="center" alignSelf="center" onClick={(e) => e.stopPropagation()}>
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
          {sectionKey === '_other' && (
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
        <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="sm" onSelect={enterSelectionWithFile} canDelete={file.type === 'context' ? (contextCountByFolder.get(file.path.substring(0, file.path.lastIndexOf('/')) || '/') ?? 0) > 1 : file.type === 'connection' && RESERVED_NAMES.includes(file.name) ? false : undefined} />
      </Box>
    </Box>
  );
}

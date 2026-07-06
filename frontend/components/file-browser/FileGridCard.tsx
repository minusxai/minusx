'use client';

import { Box, VStack, Text, Icon } from '@chakra-ui/react';
import { DbFile } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { RESERVED_NAMES } from '@/lib/data/helpers/connections';
import FileActionMenu from './FileActionMenu';
import { Checkbox } from '@/components/ui/checkbox';
import { generateFileUrl } from '@/lib/slug-utils';
import { Link } from '@/components/ui/Link';
import DashboardUsageBadge from '../banners/DashboardUsageBadge';

interface FileGridCardProps {
  file: DbFile;
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

export default function FileGridCard({
  file,
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
}: FileGridCardProps) {
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
        <FileActionMenu fileId={file.id} fileName={file.name} filePath={file.path} fileType={file.type} size="xs" onSelect={enterSelectionWithFile} canDelete={file.type === 'context' ? (contextCountByFolder.get(file.path.substring(0, file.path.lastIndexOf('/')) || '/') ?? 0) > 1 : file.type === 'connection' && RESERVED_NAMES.includes(file.name) ? false : undefined} />
      </Box>
      )}
    </Box>
  );
}

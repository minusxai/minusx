'use client';

import { useAppSelector } from '@/store/hooks';
import { Box, Text, HStack, IconButton } from '@chakra-ui/react';
import { LuUndo2, LuCheck } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { selectEffectiveName } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';

/**
 * Left pane item — one dirty file in the file list
 */
export function DirtyFileItem({
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

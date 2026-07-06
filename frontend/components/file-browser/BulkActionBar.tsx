'use client';

import { Box, HStack, Text, Icon, Button } from '@chakra-ui/react';
import { LuCopy, LuTrash2, LuFolderInput } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';

interface BulkActionBarProps {
  filteredFilesCount: number;
  selectedCount: number;
  onToggleSelectAll: () => void;
  onBulkDuplicate: () => void;
  bulkBusy: boolean;
  duplicableCount: number;
  onMoveClick: () => void;
  onDeleteClick: () => void;
  deletableCount: number;
  onCancel: () => void;
}

export default function BulkActionBar({
  filteredFilesCount,
  selectedCount,
  onToggleSelectAll,
  onBulkDuplicate,
  bulkBusy,
  duplicableCount,
  onMoveClick,
  onDeleteClick,
  deletableCount,
  onCancel,
}: BulkActionBarProps) {
  return (
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
          checked={filteredFilesCount > 0 && selectedCount === filteredFilesCount}
          onCheckedChange={() => onToggleSelectAll()}
          aria-label="Select all"
        />
        <Text fontSize="sm" fontWeight="500" color="fg.default" aria-label="Selection status">
          {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
        </Text>
      </HStack>
      <HStack gap={1.5}>
        {/* Neutral actions — Duplicate & Move share one identical chip treatment */}
        <Button
          size="xs"
          h={7}
          px={3}
          gap={1.5}
          variant="outline"
          bg="bg.surface"
          borderColor="border.emphasized"
          color="fg.default"
          fontFamily="mono"
          fontWeight="500"
          _hover={{ bg: 'bg.muted' }}
          onClick={onBulkDuplicate}
          loading={bulkBusy}
          disabled={duplicableCount === 0}
          aria-label="Duplicate"
        >
          <Icon as={LuCopy} boxSize={3.5} />
          Duplicate
        </Button>
        <Button
          size="xs"
          h={7}
          px={3}
          gap={1.5}
          variant="outline"
          bg="bg.surface"
          borderColor="border.emphasized"
          color="fg.default"
          fontFamily="mono"
          fontWeight="500"
          _hover={{ bg: 'bg.muted' }}
          onClick={onMoveClick}
          disabled={selectedCount === 0}
          aria-label="Move"
        >
          <Icon as={LuFolderInput} boxSize={3.5} />
          Move
        </Button>
        {/* Destructive action — same chip shape, red accent only */}
        <Button
          size="xs"
          h={7}
          px={3}
          gap={1.5}
          variant="outline"
          bg="bg.surface"
          borderColor="fg.error/30"
          color="fg.error"
          fontFamily="mono"
          fontWeight="500"
          _hover={{ bg: 'fg.error/10', borderColor: 'fg.error/50' }}
          onClick={onDeleteClick}
          disabled={deletableCount === 0}
          aria-label="Delete"
        >
          <Icon as={LuTrash2} boxSize={3.5} />
          Delete
        </Button>
        {/* Divider sets the dismissive action apart from the operations */}
        <Box w="1px" h={4} bg="border.emphasized" mx={1} />
        <Button
          size="xs"
          h={7}
          px={3}
          variant="ghost"
          color="fg.muted"
          fontFamily="mono"
          fontWeight="500"
          _hover={{ bg: 'bg.muted', color: 'fg.default' }}
          onClick={onCancel}
          aria-label="Cancel selection"
        >
          Cancel
        </Button>
      </HStack>
    </HStack>
  );
}

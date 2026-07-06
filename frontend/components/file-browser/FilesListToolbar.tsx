'use client';

import { HStack, Icon, Button } from '@chakra-ui/react';
import { DbFile } from '@/lib/types';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';

type FileType = DbFile['type'];

interface FilesListToolbarProps {
  filterTypes: FileType[];
  selectedTypes: FileType[];
  toggleType: (type: FileType) => void;
  isTypeSelected: (type: FileType) => boolean;
  clearTypes: () => void;
}

export default function FilesListToolbar({ filterTypes, selectedTypes, toggleType, isTypeSelected, clearTypes }: FilesListToolbarProps) {
  return (
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
          onClick={clearTypes}
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
      {/* <HStack gap={2} flexShrink={0}>
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
      </HStack> */}
    </HStack>
  );
}

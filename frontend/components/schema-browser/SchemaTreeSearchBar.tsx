'use client';

import { Box, Icon, IconButton, Input } from '@chakra-ui/react';
import { LuSearch, LuX } from 'react-icons/lu';

interface SchemaTreeSearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showColumns: boolean;
}

/** Inset search bar for the schema tree — filters schemas/tables/columns. */
export default function SchemaTreeSearchBar({ searchQuery, onSearchChange, showColumns }: SchemaTreeSearchBarProps) {
  return (
    <Box
      position="relative"
      borderBottom="1px solid"
      borderColor="border.default"
    >
      <Icon
        as={LuSearch}
        position="absolute"
        left={3}
        top="50%"
        transform="translateY(-50%)"
        color="fg.subtle"
        boxSize={3.5}
        pointerEvents="none"
        zIndex={1}
      />
      <Input
        aria-label="Search schema tree"
        placeholder={showColumns ? "Search schemas, tables & columns..." : "Search schemas & tables..."}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        fontSize="xs"
        fontFamily="mono"
        bg="bg.muted"
        border="none"
        borderRadius={0}
        _focus={{ bg: 'bg.surface', outline: 'none', boxShadow: 'inset 0 -2px 0 0 var(--chakra-colors-accent-teal)' }}
        _placeholder={{ color: 'fg.subtle' }}
        pl={9}
        pr={searchQuery ? 9 : 3}
        py={2}
        h="auto"
      />
      {searchQuery && (
        <Box
          position="absolute"
          right={1}
          top="50%"
          transform="translateY(-50%)"
          zIndex={1}
        >
          <IconButton
            aria-label="Clear search"
            size="2xs"
            variant="ghost"
            onClick={() => onSearchChange('')}
            color="fg.subtle"
            _hover={{ color: 'fg.default' }}
          >
            <LuX size={12} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

import React from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { MentionItem } from '@/lib/data/completions/types';
import { COLUMN_MENTION_METADATA } from '@/lib/ui/file-metadata';
import { ColumnInfo } from './mentions-plugin-utils';

interface MentionSubmenuProps {
  table: MentionItem;
  items: ColumnInfo[];
  inSubmenu: boolean;
  columnIndex: number;
  onHoverItem: (index: number) => void;
  onSelectItem: (column: ColumnInfo) => void;
}

/** Column drill-down submenu for the highlighted table. */
export function MentionSubmenu({ table, items, inSubmenu, columnIndex, onHoverItem, onSelectItem }: MentionSubmenuProps) {
  return (
    <Box
      minW="210px"
      maxW="300px"
      bg="bg.panel"
      border="1px solid"
      borderColor={inSubmenu ? 'accent.secondary' : 'border.default'}
      borderRadius="lg"
      boxShadow="lg"
      maxH="360px"
      overflow="hidden"
      fontFamily="mono"
    >
      <Box px={3} py={2} borderBottom="1px solid" borderColor="border.muted" bg="bg.subtle">
        <Text fontSize="xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0" truncate>
          {table.name}
        </Text>
      </Box>
      <Box maxH="312px" overflowY="auto">
        <VStack align="stretch" gap={0}>
          {items.map((column, i) => (
            <HStack
              key={`${column.name}-${i}`}
              aria-label={`Insert column ${column.name}`}
              px={3}
              py={2}
              gap={2}
              justify="space-between"
              cursor="pointer"
              bg={inSubmenu && i === columnIndex ? 'bg.muted' : 'transparent'}
              _hover={{ bg: 'bg.muted' }}
              borderBottom="1px solid"
              borderColor="border.muted"
              _last={{ borderBottom: 'none' }}
              onMouseEnter={() => onHoverItem(i)}
              onClick={() => onSelectItem(column)}
            >
              <HStack gap={1.5} minW={0}>
                <Icon
                  as={COLUMN_MENTION_METADATA.icon}
                  boxSize={3}
                  color={COLUMN_MENTION_METADATA.color}
                  flexShrink={0}
                />
                <Text fontSize="sm" fontWeight="600" color="fg.default" truncate>{column.name}</Text>
              </HStack>
              <Text fontSize="2xs" color="fg.subtle" flexShrink={0}>
                {column.type}
              </Text>
            </HStack>
          ))}
        </VStack>
      </Box>
    </Box>
  );
}

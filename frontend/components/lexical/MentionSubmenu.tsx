import React from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { MentionItem } from '@/lib/data/completions/types';
import { METRIC_MENTION_METADATA, COLUMN_MENTION_METADATA } from '@/lib/ui/file-metadata';
import { SubItem } from './mentions-plugin-utils';

interface MentionSubmenuProps {
  table: MentionItem;
  items: SubItem[];
  inSubmenu: boolean;
  columnIndex: number;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: SubItem) => void;
}

/** Drill-down submenu (metrics + columns) for the highlighted table. */
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
          {items.map((item, i) => {
            const prevKind = i > 0 ? items[i - 1].kind : null;
            const showHeader = prevKind !== item.kind;
            const isMetric = item.kind === 'metric';
            const label = isMetric ? item.metric.name : item.column.name;
            return (
              <React.Fragment key={`${item.kind}-${label}-${i}`}>
                {showHeader && (
                  <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
                    <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
                      {isMetric ? 'Metrics' : 'Columns'}
                    </Text>
                  </Box>
                )}
                <HStack
                  aria-label={`Insert ${item.kind} ${label}`}
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
                  onClick={() => onSelectItem(item)}
                >
                  <HStack gap={1.5} minW={0}>
                    <Icon
                      as={isMetric ? METRIC_MENTION_METADATA.icon : COLUMN_MENTION_METADATA.icon}
                      boxSize={3}
                      color={isMetric ? METRIC_MENTION_METADATA.color : COLUMN_MENTION_METADATA.color}
                      flexShrink={0}
                    />
                    <Text fontSize="sm" fontWeight="600" color="fg.default" truncate>{label}</Text>
                  </HStack>
                  <Text fontSize="2xs" color="fg.subtle" flexShrink={0}>
                    {isMetric ? 'metric' : item.column.type}
                  </Text>
                </HStack>
              </React.Fragment>
            );
          })}
        </VStack>
      </Box>
    </Box>
  );
}

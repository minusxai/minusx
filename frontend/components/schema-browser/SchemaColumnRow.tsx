'use client';

import type React from 'react';
import { Box, VStack, HStack, Text, Icon } from '@chakra-ui/react';
import { LuColumns3 } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import { getTypeColor } from './type-color';

export interface SchemaColumnRowProps {
  name: string;
  type: string;
  /**
   * Optional leading checkbox. Tables omit it (columns aren't whitelistable);
   * views pass it (deselecting projects the CTE). With no `onToggle` the box is
   * state-reflecting but disabled — the read-only, view-mode rendering.
   */
  selection?: { checked: boolean; onToggle?: () => void; ariaLabel: string };
  /** Description area (flex): table = AnnInput / muted text; view = usually empty. */
  description?: React.ReactNode;
  /** Optional footer under the row (table = profiled "source:" hint). */
  footer?: React.ReactNode;
  /** aria-label for the row container (so tests/AT can find it). */
  ariaLabel?: string;
}

/**
 * The single column-row visual shared by the schema/table tree and the views
 * section, so a column looks identical wherever it's shown:
 * `[optional checkbox] ▦ name  <description…>  TYPE`. Presentational only — no
 * Redux, no data fetching — the caller supplies state and slots.
 */
export default function SchemaColumnRow({
  name, type, selection, description, footer, ariaLabel,
}: SchemaColumnRowProps) {
  return (
    <VStack
      aria-label={ariaLabel}
      align="stretch"
      gap={0}
      borderBottom="1px solid"
      borderColor="border.muted"
      _hover={{ bg: 'bg.muted' }}
      transition="background 0.1s"
    >
      <HStack pl={3} pr={3} py={1} gap={2}>
        <HStack gap={1.5} w="160px" flexShrink={0} minW={0}>
          {selection && (
            <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
              <Checkbox
                aria-label={selection.ariaLabel}
                checked={selection.checked}
                onCheckedChange={selection.onToggle}
                disabled={!selection.onToggle}
              />
            </Box>
          )}
          <Icon as={LuColumns3} boxSize={3} color="fg.subtle" flexShrink={0} />
          <Text
            fontSize="xs"
            fontWeight="500"
            fontFamily="mono"
            color="fg.default"
            textOverflow="ellipsis"
            overflow="hidden"
            whiteSpace="nowrap"
            minW={0}
            title={name}
          >
            {name}
          </Text>
        </HStack>
        <Box flex={1} minW={0}>{description}</Box>
        <Text
          fontSize="10px"
          fontWeight="600"
          color={getTypeColor(type)}
          fontFamily="mono"
          flexShrink={0}
        >
          {type}
        </Text>
      </HStack>
      {footer}
    </VStack>
  );
}

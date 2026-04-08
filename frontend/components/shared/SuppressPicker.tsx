'use client';

import { Box, Text, HStack, Button } from '@chakra-ui/react';
import { LuCirclePause } from 'react-icons/lu';

export interface SuppressPickerProps {
  suppressUntil?: string;    // ISO date "YYYY-MM-DD"; undefined = not suppressed
  onChange: (value: string | undefined) => void;
  editMode?: boolean;
}

/** Returns true when suppressUntil is set and is today or in the future. */
export function isActivelySuppressed(suppressUntil: string | undefined): boolean {
  if (!suppressUntil) return false;
  const suppressEnd = new Date(suppressUntil);
  suppressEnd.setHours(23, 59, 59, 999);
  return suppressEnd >= new Date();
}

/**
 * SuppressPicker — lets users pause scheduled cron runs until a chosen date.
 *
 * - Active suppression (future date set): shows warning badge + Clear button
 * - Edit mode, no active suppression: shows date input
 * - View mode, no active suppression: renders nothing
 */
export function SuppressPicker({ suppressUntil, onChange, editMode }: SuppressPickerProps) {
  const active = isActivelySuppressed(suppressUntil);

  if (active) {
    const display = new Date(suppressUntil!).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    return (
      <Box
        position="relative"
        bg="bg.muted"
        borderRadius="md"
        border="1px solid"
        borderColor="border.muted"
        pt={3}
        pb={2}
        pr={3}
        pl={5}
        overflow="hidden"
      >
        <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.warning" borderLeftRadius="md" />
        <HStack justify="space-between" gap={2}>
          <HStack gap={1.5}>
            <LuCirclePause size={14} color="var(--chakra-colors-accent-warning)" />
            <Text
              fontSize="xs"
              fontWeight="600"
              color="accent.warning"
              aria-label="Suppressed until"
            >
              Suppressed until {display}
            </Text>
          </HStack>
          {editMode && (
            <Button
              size="xs"
              variant="ghost"
              aria-label="Clear suppression"
              onClick={() => onChange(undefined)}
              color="fg.muted"
              _hover={{ color: 'fg' }}
            >
              Clear
            </Button>
          )}
        </HStack>
      </Box>
    );
  }

  if (!editMode) return null;

  return (
    <Box
      position="relative"
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.muted"
      pt={3}
      pb={2}
      pr={3}
      pl={5}
      overflow="hidden"
    >
      <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="border.muted" borderLeftRadius="md" />
      <HStack justify="space-between" gap={3}>
        <Text fontSize="xs" color="fg.muted">Suppress scheduled runs until</Text>
        <input
          type="date"
          aria-label="Suppress until date"
          value={suppressUntil ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          style={{ fontSize: '12px', background: 'transparent', border: '1px solid var(--chakra-colors-border-muted)', borderRadius: '4px', padding: '2px 6px', colorScheme: 'dark' }}
        />
      </HStack>
    </Box>
  );
}

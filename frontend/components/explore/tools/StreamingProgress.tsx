'use client';

import { HStack, Box, Text, Spinner } from '@chakra-ui/react';

interface StreamingProgressInlineProps {
  completedCount: number;
  totalCount: number;
  latestAction: string;
}

/**
 * Inline streaming progress — appears in the chat flow during execution.
 * Shows a live counter with the latest action.
 */
export function StreamingProgressInline({ completedCount, totalCount, latestAction }: StreamingProgressInlineProps) {
  return (
    <Box my={2}>
      <HStack gap={2} py={2} px={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
        <Spinner size="xs" color="accent.teal" />
        <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontWeight="500">
          Working... {totalCount > 0 ? `${completedCount}/${totalCount} actions` : 'starting'}
        </Text>
      </HStack>
      {latestAction && (
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mt={0.5} px={3} truncate>
          {latestAction}
        </Text>
      )}
    </Box>
  );
}

/**
 * Sticky streaming progress — small pill near the input box.
 * Shows a compact count, always visible even when scrolled.
 */
export function StreamingProgressSticky({ completedCount, totalCount }: Omit<StreamingProgressInlineProps, 'latestAction'>) {
  return (
    <HStack
      gap={1.5}
      px={2.5}
      py={1}
      bg="bg.subtle"
      border="1px solid"
      borderColor="border.default"
      borderRadius="full"
    >
      <Spinner size="xs" color="accent.teal" />
      <Text fontSize="2xs" fontFamily="mono" color="fg.muted" fontWeight="500">
        {totalCount > 0 ? `${completedCount}/${totalCount}` : 'Working...'}
      </Text>
    </HStack>
  );
}

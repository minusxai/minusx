'use client';

import { HStack, Box, Text } from '@chakra-ui/react';
import type { ChatViewMode } from '@/lib/types';

interface ViewModeToggleProps {
  viewMode: ChatViewMode;
  onChange: (mode: ChatViewMode) => void;
}

export default function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
  return (
    <HStack
      gap={0}
      bg="bg.subtle"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      p={0.5}
    >
      {(['compact', 'detailed'] as const).map((mode) => (
        <Box
          key={mode}
          as="button"
          aria-label={`Switch to ${mode} view`}
          px={2.5}
          py={1}
          borderRadius="sm"
          fontSize="xs"
          fontFamily="mono"
          fontWeight={viewMode === mode ? '600' : '400'}
          color={viewMode === mode ? 'fg.default' : 'fg.muted'}
          bg={viewMode === mode ? 'bg.default' : 'transparent'}
          border={viewMode === mode ? '1px solid' : '1px solid transparent'}
          borderColor={viewMode === mode ? 'border.default' : 'transparent'}
          cursor="pointer"
          transition="all 0.15s"
          _hover={viewMode !== mode ? { color: 'fg.default' } : {}}
          onClick={() => onChange(mode)}
        >
          <Text fontSize="xs">{mode === 'compact' ? 'Compact' : 'Detailed'}</Text>
        </Box>
      ))}
    </HStack>
  );
}

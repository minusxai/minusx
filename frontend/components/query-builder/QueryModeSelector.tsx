/**
 * QueryModeSelector - Compact pill toggle between SQL and GUI modes
 */

'use client';

import { HStack, Box, Text } from '@chakra-ui/react';
import { LuCode, LuMousePointerClick } from 'react-icons/lu';

interface QueryModeSelectorProps {
  mode: 'sql' | 'gui';
  onModeChange: (mode: 'sql' | 'gui') => void;
  canUseGUI: boolean;
  guiError?: string;
}

export function QueryModeSelector({
  mode,
  onModeChange,
  canUseGUI,
  guiError,
}: QueryModeSelectorProps) {
  return (
    <HStack
      gap={0}
      bg="rgba(255, 255, 255, 0.05)"
      borderRadius="md"
      p={0.5}
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.08)"
    >
      <Box
        as="button"
        px={2.5}
        py={1}
        borderRadius="sm"
        bg={mode === 'sql' ? 'accent.danger' : 'transparent'}
        color={mode === 'sql' ? 'white' : 'fg.muted'}
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ color: mode === 'sql' ? 'white' : 'fg' }}
        onClick={() => onModeChange('sql')}
        display="flex"
        alignItems="center"
        gap={1.5}
      >
        <LuCode size={14} />
        <Text fontSize="xs" fontWeight="600">SQL</Text>
      </Box>
      <Box
        as="button"
        px={2.5}
        py={1}
        borderRadius="sm"
        bg={mode === 'gui' ? 'accent.danger' : 'transparent'}
        color={mode === 'gui' ? 'white' : 'fg.muted'}
        cursor={canUseGUI ? 'pointer' : 'not-allowed'}
        opacity={canUseGUI ? 1 : 0.5}
        transition="all 0.15s ease"
        _hover={{ color: canUseGUI ? (mode === 'gui' ? 'white' : 'fg') : undefined }}
        onClick={() => canUseGUI && onModeChange('gui')}
        title={guiError || 'Visual query builder'}
        display="flex"
        alignItems="center"
        gap={1.5}
      >
        <LuMousePointerClick size={14} />
        <Text fontSize="xs" fontWeight="600">GUI</Text>
      </Box>
    </HStack>
  );
}

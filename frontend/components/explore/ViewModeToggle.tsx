'use client';

import { HStack, Box, Icon, Text } from '@chakra-ui/react';
import { LuLayoutPanelLeft, LuList } from 'react-icons/lu';
import type { ChatViewMode } from '@/lib/types';

interface ViewModeToggleProps {
  viewMode: ChatViewMode;
  onChange: (mode: ChatViewMode) => void;
}

const MODES: { mode: ChatViewMode; icon: typeof LuLayoutPanelLeft; label: string }[] = [
  { mode: 'compact', icon: LuLayoutPanelLeft, label: 'Summary' },
  { mode: 'detailed', icon: LuList, label: 'Detailed' },
];

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
      {MODES.map(({ mode, icon, label }) => {
        const isActive = viewMode === mode;
        return (
          <Box
            key={mode}
            as="button"
            aria-label={`Switch to ${label} view`}
            px={2}
            py={1}
            borderRadius="sm"
            bg={isActive ? 'accent.teal/12' : 'transparent'}
            border="1px solid"
            borderColor={isActive ? 'accent.teal/30' : 'transparent'}
            cursor="pointer"
            transition="all 0.15s"
            _hover={!isActive ? { bg: 'bg.muted' } : {}}
            onClick={() => onChange(mode)}
            display="flex"
            alignItems="center"
            gap={1.5}
          >
            <Icon as={icon} boxSize={3.5} color={isActive ? 'accent.teal' : 'fg.muted'} />
            <Text fontSize="xs" fontFamily="mono" fontWeight={isActive ? '600' : '400'} color={isActive ? 'accent.teal' : 'fg.muted'}>
              {label}
            </Text>
          </Box>
        );
      })}
    </HStack>
  );
}

/**
 * QueryModeSelector - Segmented control for SQL, GUI, and Viz modes
 */

'use client';

import { HStack, Box, Text } from '@chakra-ui/react';
import { LuCode, LuMousePointerClick, LuChartColumn } from 'react-icons/lu';

export type QueryTab = 'sql' | 'gui' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  onModeChange: (mode: QueryTab) => void;
  canUseGUI: boolean;
  guiError?: string;
  showVizTab?: boolean;
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; icon: React.ReactNode; disabledKey?: 'gui' }> = [
  { key: 'sql', label: 'SQL', icon: <LuCode size={13} /> },
  { key: 'gui', label: 'GUI', icon: <LuMousePointerClick size={13} />, disabledKey: 'gui' },
  { key: 'viz', label: 'Viz', icon: <LuChartColumn size={13} /> },
];

export function QueryModeSelector({
  mode,
  onModeChange,
  canUseGUI,
  guiError,
  showVizTab = true,
}: QueryModeSelectorProps) {
  const tabs = showVizTab ? TAB_ITEMS : TAB_ITEMS.filter(t => t.key !== 'viz');

  return (
    <HStack
      gap={0}
      bg="bg.muted"
      borderRadius="md"
      p={0.5}
      maxW="280px"
    >
      {tabs.map(({ key, label, icon, disabledKey }) => {
        const isActive = mode === key;
        const isDisabled = disabledKey === 'gui' && !canUseGUI;

        return (
          <HStack
            key={key}
            as="button"
            flex={1}
            justify="center"
            gap={1.5}
            py={1}
            borderRadius="sm"
            bg={isActive ? 'accent.teal' : 'transparent'}
            color={isActive ? 'white' : 'fg.muted'}
            cursor={isDisabled ? 'not-allowed' : 'pointer'}
            opacity={isDisabled ? 0.5 : 1}
            transition="all 0.15s ease"
            _hover={{ color: isDisabled ? undefined : (isActive ? 'white' : 'fg.default') }}
            onClick={() => !isDisabled && onModeChange(key)}
            title={disabledKey === 'gui' ? (guiError || 'Visual query builder') : undefined}
          >
            {icon}
            <Text fontSize="xs" fontFamily="mono" fontWeight="600">{label}</Text>
          </HStack>
        );
      })}
    </HStack>
  );
}

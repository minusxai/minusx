/**
 * QueryModeSelector - Segmented control for SQL, GUI, and Viz modes
 */

'use client';

import { HStack, Text } from '@chakra-ui/react';
import { LuCode, LuMousePointerClick, LuChartColumn } from 'react-icons/lu';

export type QueryTab = 'sql' | 'gui' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  onModeChange: (mode: QueryTab) => void;
  canUseGUI: boolean;
  guiError?: string;
  showVizTab?: boolean;
  /** 'md' (default, page) or 'sm' (compact — notebook cell toolbar). */
  size?: 'sm' | 'md';
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; disabledKey?: 'gui'; Icon: typeof LuCode }> = [
  { key: 'sql', label: 'SQL', Icon: LuCode },
  { key: 'gui', label: 'GUI', Icon: LuMousePointerClick, disabledKey: 'gui' },
  { key: 'viz', label: 'Viz', Icon: LuChartColumn },
];

export function QueryModeSelector({
  mode,
  onModeChange,
  canUseGUI,
  guiError,
  showVizTab = true,
  size = 'md',
}: QueryModeSelectorProps) {
  const tabs = showVizTab ? TAB_ITEMS : TAB_ITEMS.filter(t => t.key !== 'viz');
  const sm = size === 'sm';

  return (
    <HStack gap={0} bg="bg.muted" borderRadius="md" p="2px">
      {tabs.map(({ key, label, disabledKey, Icon }) => {
        const isActive = mode === key;
        const isDisabled = disabledKey === 'gui' && !canUseGUI;

        return (
          <HStack
            key={key}
            as="button"
            flex={1}
            justify="center"
            gap={1}
            px={sm ? 2 : 3}
            py={sm ? 0.5 : 1.5}
            borderRadius="sm"
            bg={isActive ? 'accent.teal/90' : 'transparent'}
            color={isActive ? 'white' : 'fg.subtle'}
            cursor={isDisabled ? 'not-allowed' : 'pointer'}
            opacity={isDisabled ? 0.5 : 1}
            transition="all 0.15s ease"
            _hover={{ color: isDisabled ? undefined : (isActive ? 'white' : 'fg.muted') }}
            onClick={() => !isDisabled && onModeChange(key)}
            title={disabledKey === 'gui' ? (guiError || 'Visual query builder') : undefined}
          >
            <Icon size={sm ? 11 : 13} />
            <Text fontSize={sm ? '11px' : 'xs'} fontFamily="mono" fontWeight="600">{label}</Text>
          </HStack>
        );
      })}
    </HStack>
  );
}

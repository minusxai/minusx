/**
 * QueryModeSelector - Segmented control for GUI, SQL, and Viz modes
 *
 * The GUI tab hosts the tier gradation internally (Semantic · Simple · Full —
 * see GuiBuilderRoot); this control only picks the surface: visual builder,
 * raw SQL, or chart configuration.
 */

'use client';

import { HStack, Text } from '@chakra-ui/react';
import { LuCode, LuMousePointerClick, LuChartColumn } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

export type QueryTab = 'sql' | 'gui' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  onModeChange: (mode: QueryTab) => void;
  canUseGUI: boolean;
  guiError?: string;
  /** Whether the Viz tab is shown at all (container concern). Default true. */
  showVizTab?: boolean;
  /** Whether the Viz tab is usable — false greys it out (e.g. no query results yet). Default true. */
  canUseViz?: boolean;
  vizError?: string;
  /** 'md' (default, page) or 'sm' (compact — notebook cell toolbar). */
  size?: 'sm' | 'md';
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; gated?: 'gui' | 'viz'; Icon: typeof LuCode }> = [
  { key: 'gui', label: 'GUI', Icon: LuMousePointerClick, gated: 'gui' },
  { key: 'sql', label: 'SQL', Icon: LuCode },
  { key: 'viz', label: 'Viz', Icon: LuChartColumn, gated: 'viz' },
];

export function QueryModeSelector({
  mode,
  onModeChange,
  canUseGUI,
  guiError,
  showVizTab = true,
  canUseViz = true,
  vizError,
  size = 'md',
}: QueryModeSelectorProps) {
  const tabs = showVizTab ? TAB_ITEMS : TAB_ITEMS.filter(t => t.key !== 'viz');
  const sm = size === 'sm';

  return (
    <HStack gap={0} bg="bg.muted" borderRadius="md" p="2px">
      {tabs.map(({ key, label, gated, Icon }) => {
        const isActive = mode === key;
        const isDisabled =
          (gated === 'gui' && !canUseGUI) || (gated === 'viz' && !canUseViz);
        const tooltip =
          gated === 'gui' ? (guiError || 'Visual query builder')
          : gated === 'viz' ? (vizError || (canUseViz ? 'Configure chart' : 'Run the query to configure a chart'))
          : undefined;

        return (
          <Tooltip
            key={key}
            content={tooltip}
            disabled={!tooltip}
            showArrow
            positioning={{ placement: 'top' }}
            openDelay={200}
          >
            <HStack
              as="button"
              aria-label={label}
              aria-disabled={isDisabled}
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
            >
              <Icon size={sm ? 11 : 13} />
              <Text fontSize={sm ? '11px' : 'xs'} fontFamily="mono" fontWeight="600">{label}</Text>
            </HStack>
          </Tooltip>
        );
      })}
    </HStack>
  );
}

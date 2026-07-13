/**
 * QueryModeSelector - Segmented control for Semantic, Simple, GUI, SQL, and Viz modes
 *
 * Tiers left→right from most to least abstracted: Semantic (curated metrics,
 * only shown when the active context defines semantic models), Simple
 * (Scuba-style measure/group-by/time builder), GUI (full visual builder),
 * SQL (Monaco). Viz configures the chart.
 */

'use client';

import { HStack, Text } from '@chakra-ui/react';
import { LuCode, LuMousePointerClick, LuChartColumn, LuGauge, LuSparkles } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

export type QueryTab = 'semantic' | 'simple' | 'sql' | 'gui' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  onModeChange: (mode: QueryTab) => void;
  canUseGUI: boolean;
  guiError?: string;
  /** Whether the Simple tab is usable — false greys it out with simpleError as tooltip. Default true. */
  canUseSimple?: boolean;
  simpleError?: string;
  /** Whether the Semantic tab is shown at all (only when the context defines semantic models). Default false. */
  showSemanticTab?: boolean;
  /** Whether the Viz tab is shown at all (container concern). Default true. */
  showVizTab?: boolean;
  /** Whether the Viz tab is usable — false greys it out (e.g. no query results yet). Default true. */
  canUseViz?: boolean;
  vizError?: string;
  /** 'md' (default, page) or 'sm' (compact — notebook cell toolbar). */
  size?: 'sm' | 'md';
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; gated?: 'gui' | 'viz' | 'simple'; Icon: typeof LuCode }> = [
  { key: 'semantic', label: 'Semantic', Icon: LuSparkles },
  { key: 'simple', label: 'Simple', Icon: LuGauge, gated: 'simple' },
  { key: 'gui', label: 'GUI', Icon: LuMousePointerClick, gated: 'gui' },
  { key: 'sql', label: 'SQL', Icon: LuCode },
  { key: 'viz', label: 'Viz', Icon: LuChartColumn, gated: 'viz' },
];

export function QueryModeSelector({
  mode,
  onModeChange,
  canUseGUI,
  guiError,
  canUseSimple = true,
  simpleError,
  showSemanticTab = false,
  showVizTab = true,
  canUseViz = true,
  vizError,
  size = 'md',
}: QueryModeSelectorProps) {
  const tabs = TAB_ITEMS
    .filter(t => (t.key === 'viz' ? showVizTab : true))
    .filter(t => (t.key === 'semantic' ? showSemanticTab : true));
  const sm = size === 'sm';

  return (
    <HStack gap={0} bg="bg.muted" borderRadius="md" p="2px">
      {tabs.map(({ key, label, gated, Icon }) => {
        const isActive = mode === key;
        const isDisabled =
          (gated === 'gui' && !canUseGUI) ||
          (gated === 'simple' && !canUseSimple) ||
          (gated === 'viz' && !canUseViz);
        const tooltip =
          gated === 'gui' ? (guiError || 'Visual query builder')
          : gated === 'simple' ? (simpleError || 'Simple query builder')
          : gated === 'viz' ? (vizError || (canUseViz ? 'Configure chart' : 'Run the query to configure a chart'))
          : key === 'semantic' ? 'Query curated metrics and dimensions'
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

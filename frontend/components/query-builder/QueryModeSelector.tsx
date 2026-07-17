/**
 * QueryModeSelector - Segmented control for Semantic, SQL, and Viz modes.
 *
 * Semantic is the curated query surface (only shown when the active context
 * defines semantic models for the connection; only enabled when the current
 * SQL reliably detects as a semantic query, or is empty). SQL is always
 * available. Viz configures the chart.
 */

'use client';

import { HStack, Text } from '@chakra-ui/react';
import { LuCode, LuChartColumn, LuSparkles } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

export type QueryTab = 'semantic' | 'sql' | 'viz';

interface QueryModeSelectorProps {
  mode: QueryTab;
  /** Whether this source family is active (false leaves all tabs visually unselected). */
  active?: boolean;
  onModeChange: (mode: QueryTab) => void;
  /** Whether the Semantic tab is shown at all (context defines models). Default false. */
  showSemanticTab?: boolean;
  /** Whether the Semantic tab is usable (query detects as semantic / is empty). Default true. */
  canUseSemantic?: boolean;
  semanticError?: string;
  /** Whether the Viz tab is shown at all (container concern). Default true. */
  showVizTab?: boolean;
  /** Whether the Viz tab is usable — false greys it out (e.g. no query results yet). Default true. */
  canUseViz?: boolean;
  vizError?: string;
  /** 'md' (default, page) or 'sm' (compact — notebook cell toolbar). */
  size?: 'sm' | 'md';
}

const TAB_ITEMS: Array<{ key: QueryTab; label: string; gated?: 'semantic' | 'viz'; Icon: typeof LuCode }> = [
  { key: 'semantic', label: 'GUI', Icon: LuSparkles, gated: 'semantic' },
  { key: 'sql', label: 'SQL', Icon: LuCode },
  { key: 'viz', label: 'Viz', Icon: LuChartColumn, gated: 'viz' },
];

export function QueryModeSelector({
  mode,
  active = true,
  onModeChange,
  showSemanticTab = false,
  canUseSemantic = true,
  semanticError,
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
        const isActive = active && mode === key;
        const isDisabled =
          (gated === 'semantic' && !canUseSemantic) || (gated === 'viz' && !canUseViz);
        const tooltip =
          gated === 'semantic'
            ? (canUseSemantic ? 'Query curated metrics and dimensions' : (semanticError || 'This SQL is not expressible with the semantic model'))
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

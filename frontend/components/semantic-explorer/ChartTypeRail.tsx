'use client';

/**
 * ChartTypeRail — the always-visible chart-type strip of the semantic
 * explorer (PyGWalker's "Auto Viz" panel, condensed to a rail). Types that
 * MATCH the current shelves (from inferVizForSpec) render first in ranked
 * order at full strength; the rest are dimmed but still clickable. Picking
 * any type is an explicit choice → reported locked; the reset affordance
 * (shown only while locked) hands control back to auto-inference.
 */

import { HStack, IconButton, Box } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { ALL_VIZ_TYPES } from '@/components/question/VizTypeSelector';
import { useConfigs } from '@/lib/hooks/useConfigs';
import type { VizMatch } from '@/lib/semantic/infer-viz';
import type { VizSettings } from '@/lib/types';

interface ChartTypeRailProps {
  /** Ranked matching types for the current spec; [0] is the auto choice. */
  ranked: VizMatch[];
  /** The effective chart type (auto-inferred or locked pick). */
  value: VizSettings['type'];
  /** Whether the current type is a sticky manual choice. */
  locked: boolean;
  /** Pick a type (locked=true) or reset to auto (ranked[0].type, locked=false). */
  onPick: (type: VizSettings['type'], locked: boolean) => void;
}

export function ChartTypeRail({ ranked, value, locked, onPick }: ChartTypeRailProps) {
  const { config } = useConfigs();
  const allowedVizTypes = config.allowedVizTypes;

  const catalog = allowedVizTypes
    ? ALL_VIZ_TYPES.filter((v) => allowedVizTypes.includes(v.type))
    : ALL_VIZ_TYPES;
  const rankedTypes = ranked.map((m) => m.type);
  const matching = rankedTypes
    .map((t) => catalog.find((v) => v.type === t))
    .filter((v): v is (typeof catalog)[number] => !!v);
  const rest = catalog.filter((v) => !rankedTypes.includes(v.type));
  const autoType = ranked[0]?.type;

  return (
    <HStack gap={0.5} flexWrap="wrap" align="center">
      {[...matching, ...rest].map(({ type, icon, label }) => {
        const isMatch = rankedTypes.includes(type);
        const isActive = value === type;
        const isAuto = type === autoType && !locked;
        return (
          <Tooltip
            key={type}
            content={isAuto && isActive ? `${label} (auto)` : label}
            positioning={{ placement: 'top' }}
            openDelay={200}
          >
            <IconButton
              aria-label={`Chart type ${label}`}
              size="2xs"
              variant={isActive ? 'solid' : 'ghost'}
              colorPalette={isActive ? 'teal' : undefined}
              opacity={isMatch || isActive ? 1 : 0.35}
              onClick={() => onPick(type, true)}
            >
              {icon}
            </IconButton>
          </Tooltip>
        );
      })}
      {locked && autoType && (
        <Tooltip content="Back to auto chart type" positioning={{ placement: 'top' }} openDelay={200}>
          <Box
            as="button"
            aria-label="Reset chart type to auto"
            display="flex"
            alignItems="center"
            gap={0.5}
            px={1.5}
            py={0.5}
            ml={1}
            borderRadius="sm"
            color="accent.teal"
            fontSize="2xs"
            fontFamily="mono"
            fontWeight="600"
            _hover={{ bg: 'accent.teal/10' }}
            onClick={() => onPick(autoType, false)}
          >
            <LuSparkles size={11} />
            auto
          </Box>
        </Tooltip>
      )}
    </HStack>
  );
}

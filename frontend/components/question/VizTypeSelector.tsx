/**
 * Visualization Type Selector
 * Grouped chart type selector with category labels
 */

import { Box, HStack, VStack, Text, IconButton } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import {
  LuTable2,
  LuChartLine,
  LuChartColumn,
  LuChartArea,
  LuChartScatter,
  LuFilter,
  LuChartPie,
  LuGrid3X3,
  LuTrendingUp,
  LuChartNoAxesColumn,
  LuChartNoAxesCombined,
  LuRadar,
  LuMapPinned,
  LuHash,
  LuChartBar,
  LuChartCandlestick,
  LuChartColumnBig,
} from 'react-icons/lu';
import type { VizSettings } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { immutableSet } from '@/lib/utils/immutable-collections';

// lucide `brick-wall-fire` — not in react-icons 5.5.0 yet, so the official path
// data is inlined with the same conventions the Lu* icons use (currentColor
// stroke, 24 viewBox). Swap for LuBrickWallFire when react-icons catches up.
const BrickWallFireIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16 3v2.107" />
    <path d="M17 9c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 22 17a5 5 0 0 1-10 0c0-.3 0-.6.1-.9a2 2 0 1 0 3.3-2C13 11.5 16 9 17 9" />
    <path d="M21 8.274V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.938" />
    <path d="M3 15h5.253" />
    <path d="M3 9h8.228" />
    <path d="M8 15v6" />
    <path d="M8 3v6" />
  </svg>
);

/**
 * Everything the selector can offer: the classic vizSettings types plus V2-only
 * types (Vega-tier charts with no ECharts equivalent — the legacy union stays
 * frozen until the ECharts pipeline is deleted). V2-only entries render solely
 * when `includeV2Only` is set (the Vega panel); classic surfaces never see them.
 */
export type SelectableVizType = VizSettings['type'] | 'heatmap' | 'boxplot' | 'histogram';

interface VizTypeOption {
  type: SelectableVizType;
  icon: React.ReactNode;
  label: string;
  /** Only offered on the V2 (Vega) panel — no classic renderer exists. */
  v2Only?: boolean;
}

interface VizTypeGroup {
  label: string;
  types: VizTypeOption[];
}

const ALL_VIZ_GROUPS: VizTypeGroup[] = [
  {
    label: 'Basic',
    types: [
      { type: 'table', icon: <LuGrid3X3 size={16} />, label: 'Table' },
      { type: 'bar', icon: <LuChartColumn size={16} />, label: 'Bar' },
      { type: 'line', icon: <LuChartLine size={16} />, label: 'Line' },
      { type: 'area', icon: <LuChartArea size={16} />, label: 'Area' },
      { type: 'row', icon: <LuChartBar size={16} />, label: 'Row' },
      { type: 'scatter', icon: <LuChartScatter size={16} />, label: 'Scatter' },
      { type: 'pie', icon: <LuChartPie size={16} />, label: 'Pie' },
    ],
  },
  {
    label: 'Advanced',
    types: [
      { type: 'combo', icon: <LuChartNoAxesCombined size={16} />, label: 'Combo' },
      { type: 'funnel', icon: <LuFilter size={16} />, label: 'Funnel' },
      { type: 'waterfall', icon: <LuChartNoAxesColumn size={16} />, label: 'Waterfall' },
      { type: 'radar', icon: <LuRadar size={16} />, label: 'Radar' },
      { type: 'heatmap', icon: <BrickWallFireIcon size={16} />, label: 'Heatmap', v2Only: true },
      // Candlestick is Lucide's closest glyph to a box-and-whisker plot.
      { type: 'boxplot', icon: <LuChartCandlestick size={16} />, label: 'Boxplot', v2Only: true },
      { type: 'histogram', icon: <LuChartColumnBig size={16} />, label: 'Histogram', v2Only: true },
    ],
  },
  {
    label: 'Analytic',
    types: [
      { type: 'pivot', icon: <LuTable2 size={16} />, label: 'Pivot' },
      { type: 'trend', icon: <LuTrendingUp size={16} />, label: 'Trend' },
      { type: 'single_value', icon: <LuHash size={16} />, label: 'Number' },
      { type: 'geo', icon: <LuMapPinned size={16} />, label: 'Geo' },
    ],
  },
];

// Flat list for legacy horizontal/vertical orientations
const ALL_VIZ_TYPES: VizTypeOption[] = ALL_VIZ_GROUPS.flatMap(g => g.types);

const V2_ONLY_TYPES: ReadonlySet<SelectableVizType> = immutableSet(
  ALL_VIZ_TYPES.filter(t => t.v2Only).map(t => t.type),
);

/** Narrow a selector emission to the classic vizSettings union (drops V2-only types). */
export function isClassicVizType(type: SelectableVizType): type is VizSettings['type'] {
  return !V2_ONLY_TYPES.has(type);
}

interface VizTypeSelectorProps {
  value: SelectableVizType;
  onChange: (type: SelectableVizType) => void;
  orientation?: 'vertical' | 'horizontal' | 'grouped';
  /**
   * Types that fit the current data shape (semantic questions). Everything
   * stays clickable — recommended types render at full strength, the rest
   * dim slightly. Omit for no treatment (non-semantic contexts).
   */
  recommended?: ReadonlyArray<SelectableVizType>;
  /** Types shown but not selectable (e.g. not yet supported for Vega V2 charts). */
  disabledTypes?: ReadonlyArray<SelectableVizType>;
  /** Tooltip/title for disabled entries. */
  disabledReason?: string;
  /** Offer V2-only entries (heatmap, …) — set by the Vega panel only. */
  includeV2Only?: boolean;
}

export function VizTypeSelector({
  value,
  onChange,
  orientation = 'vertical',
  recommended,
  disabledTypes,
  disabledReason,
  includeV2Only = false,
}: VizTypeSelectorProps) {
  const { config } = useConfigs();
  const allowedVizTypes = config.allowedVizTypes;
  const offered = (types: VizTypeOption[]) =>
    types.filter(v =>
      (includeV2Only || !v.v2Only) &&
      (!allowedVizTypes || v.v2Only || (allowedVizTypes as readonly string[]).includes(v.type)));

  if (orientation === 'grouped') {
    const groups = ALL_VIZ_GROUPS
      .map(group => ({ ...group, types: offered(group.types) }))
      .filter(group => group.types.length > 0);

    const allTypes = groups.flatMap(g => g.types);

    return (
      <Box
        display="grid"
        gridTemplateColumns="repeat(5, 1fr)"
        gap={1}
        width="100%"
        bg={"bg.subtle"}
        borderRadius={"md"}
        p={2}
        mb={2}
      >
        {allTypes.map(({ type, icon, label }) => {
          const isActive = value === type;
          const isRecommended = recommended?.includes(type) ?? false;
          // With recommendations present, the non-fitting types recede a
          // little (still clickable); the active pick never dims.
          const dimmed = !!recommended && !isRecommended && !isActive;
          const isDisabled = disabledTypes?.includes(type) ?? false;
          return (
            <Box
              key={type}
              as="button"
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              gap={0.5}
              py={1.5}
              borderRadius="md"
              bg={isActive ? 'accent.teal/15' : 'transparent'}
              color={isActive ? 'accent.teal' : 'fg.muted'}
              cursor={isDisabled ? 'not-allowed' : 'pointer'}
              opacity={isDisabled ? 0.3 : dimmed ? 0.5: 1}

              transition="all 0.12s ease"
              _hover={isDisabled ? undefined : {
                bg: isActive ? 'accent.teal/20' : 'bg.muted',
                color: isActive ? 'accent.teal' : 'fg.default',
                opacity: 1,
              }}
              onClick={() => { if (!isDisabled) onChange(type); }}
              aria-label={label}
              data-recommended={isRecommended ? 'true' : undefined}
              aria-disabled={isDisabled}
              title={isDisabled ? disabledReason : undefined}
            >
              {icon}
              <Text fontSize="2xs" fontFamily="mono" fontWeight={isActive ? '700' : '500'} lineHeight="1">
                {label}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Legacy flat layout (horizontal / vertical)
  const vizTypes = offered(ALL_VIZ_TYPES);

  const Container = orientation === 'horizontal' ? HStack : VStack;

  return (
    <Container
      gap={0.5}
      bg={orientation === 'horizontal' ? 'transparent' : 'bg.muted'}
      p={orientation === 'horizontal' ? 0 : 1.5}
      shadow={orientation === 'horizontal' ? undefined : 'sm'}
      h={'100%'}
      flexWrap={orientation === 'horizontal' ? 'wrap' : undefined}
    >
      {vizTypes.map(({ type, icon, label }) => {
        const isActive = value === type;

        return (
          <Tooltip
            key={type}
            content={label}
            positioning={{ placement: orientation === 'vertical' ? 'left' : 'top' }}
          >
            <IconButton
              aria-label={label}
              size="xs"
              variant={isActive ? 'solid' : 'ghost'}
              colorPalette={isActive ? 'teal' : undefined}
              onClick={() => onChange(type)}
            >
              {icon}
            </IconButton>
          </Tooltip>
        );
      })}
    </Container>
  );
}

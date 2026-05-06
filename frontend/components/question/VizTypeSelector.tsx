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
} from 'react-icons/lu';
import type { VizSettings } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface VizTypeOption {
  type: VizSettings['type'];
  icon: React.ReactNode;
  label: string;
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

interface VizTypeSelectorProps {
  value: VizSettings['type'];
  onChange: (type: VizSettings['type']) => void;
  orientation?: 'vertical' | 'horizontal' | 'grouped';
}

export function VizTypeSelector({
  value,
  onChange,
  orientation = 'vertical'
}: VizTypeSelectorProps) {
  const { config } = useConfigs();
  const allowedVizTypes = config.allowedVizTypes;

  if (orientation === 'grouped') {
    const groups = ALL_VIZ_GROUPS
      .map(group => ({
        ...group,
        types: allowedVizTypes
          ? group.types.filter(v => allowedVizTypes.includes(v.type))
          : group.types,
      }))
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
              cursor="pointer"
              transition="all 0.12s ease"
              _hover={{
                bg: isActive ? 'accent.teal/20' : 'bg.muted',
                color: isActive ? 'accent.teal' : 'fg.default',
              }}
              onClick={() => onChange(type)}
              aria-label={label}
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
  const vizTypes = allowedVizTypes
    ? ALL_VIZ_TYPES.filter(v => allowedVizTypes.includes(v.type))
    : ALL_VIZ_TYPES;

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

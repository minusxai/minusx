/**
 * Visualization Type Selector
 * Reusable component for selecting visualization types (table, line, bar, area, scatter)
 */

import { VStack, HStack, IconButton } from '@chakra-ui/react';
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
} from 'react-icons/lu';
import type { VizSettings } from '@/lib/types';

interface VizTypeOption {
  type: VizSettings['type'];
  icon: React.ReactNode;
  label: string;
}

const VIZ_TYPES: VizTypeOption[] = [
  { type: 'table', icon: <LuGrid3X3 size={18} />, label: 'Table view' },
  { type: 'line', icon: <LuChartLine size={18} />, label: 'Line chart' },
  { type: 'bar', icon: <LuChartColumn size={18} />, label: 'Bar chart' },
  { type: 'area', icon: <LuChartArea size={18} />, label: 'Area chart' },
  { type: 'scatter', icon: <LuChartScatter size={18} />, label: 'Scatter plot' },
  { type: 'funnel', icon: <LuFilter size={18} />, label: 'Funnel chart' },
  { type: 'pie', icon: <LuChartPie size={18} />, label: 'Pie chart' },
  { type: 'pivot', icon: <LuTable2 size={18} />, label: 'Pivot table' },
  { type: 'trend', icon: <LuTrendingUp size={18} />, label: 'Trend' },
];

interface VizTypeSelectorProps {
  value: VizSettings['type'];
  onChange: (type: VizSettings['type']) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function VizTypeSelector({
  value,
  onChange,
  orientation = 'vertical'
}: VizTypeSelectorProps) {
  const Container = orientation === 'horizontal' ? HStack : VStack;

  return (
    <Container
      gap={1}
      bg={'bg.muted'}
      p={2}
    //   borderRadius={10}
      shadow={'sm'}
      h={'100%'}
    >
      {VIZ_TYPES.map(({ type, icon, label }) => {
        const isActive = value === type;

        return (
          <Tooltip
            key={type}
            content={label}
            positioning={{ placement: orientation === 'vertical' ? 'left' : 'top' }}
          >
            <IconButton
              aria-label={label}
              size="sm"
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

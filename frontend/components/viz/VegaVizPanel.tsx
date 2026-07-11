'use client';

/**
 * The V2 viz settings panel: Fields (drop-zone lens) | Settings (mark type, stacking,
 * log scale) | Spec (raw envelope inspector) — mirroring the classic AxisBuilder's
 * subtab idiom. Every control performs a SURGICAL spec edit (lib/viz/encoding-edit);
 * the long tail of styling stays with the agent. Pure view: no Redux.
 */
import { useState } from 'react';
import { Box, Button, HStack, Text, Switch } from '@chakra-ui/react';
import { LuLayoutGrid, LuSettings2, LuBraces } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizSettings } from '@/lib/types';
import {
  isUnitVegaLiteSpec, getVizType, setVizType, V2_SUPPORTED_VIZ_TYPES,
  getStacked, setStacked, getYLogScale, setYLogScale,
  type V2VizType,
} from '@/lib/viz/encoding-edit';
import { VizTypeSelector } from '@/components/question/VizTypeSelector';
import { VegaEncodingPanel } from './VegaEncodingPanel';
import { VizSpecInspector } from './VizSpecInspector';

// Everything the classic selector offers minus what V2 type-switching supports today —
// shown disabled, so the icon grid doubles as the live V2 coverage checklist.
const ALL_CLASSIC_TYPES: VizSettings['type'][] = [
  'table', 'bar', 'line', 'area', 'row', 'scatter', 'pie', 'combo', 'funnel',
  'waterfall', 'radar', 'pivot', 'trend', 'single_value', 'geo',
];
const V2_DISABLED_TYPES = ALL_CLASSIC_TYPES.filter(
  t => !(V2_SUPPORTED_VIZ_TYPES as readonly string[]).includes(t),
);

export interface VegaVizPanelProps {
  envelope: VizEnvelope;
  columns: string[];
  types: string[];
  onVizChange: (envelope: VizEnvelope) => void;
}

export function VegaVizPanel({ envelope, columns, types, onVizChange }: VegaVizPanelProps) {
  const [activeTab, setActiveTab] = useState<'fields' | 'settings' | 'spec'>('fields');
  const spec = (envelope.source as { spec: Record<string, unknown> }).spec;
  const isUnit = isUnitVegaLiteSpec(spec);
  const vizType = getVizType(spec);

  const TABS = [
    { key: 'fields', icon: LuLayoutGrid, label: 'Fields' },
    { key: 'settings', icon: LuSettings2, label: 'Settings' },
    { key: 'spec', icon: LuBraces, label: 'Spec' },
  ] as const;

  return (
    <Box>
      {/* Viz-type icon grid on top — same placement as the classic panel. Disabled
          entries double as the live "not yet in V2" coverage list. */}
      {isUnit && (
        <VizTypeSelector
          value={(vizType ?? 'bar') as VizSettings['type']}
          onChange={(t) => {
            if ((V2_SUPPORTED_VIZ_TYPES as readonly string[]).includes(t)) {
              onVizChange(setVizType(envelope, t as V2VizType));
            }
          }}
          orientation="grouped"
          disabledTypes={V2_DISABLED_TYPES}
          disabledReason="Not yet supported for Vega charts — ask the agent"
        />
      )}
      <HStack gap={1} pb={2}>
        {TABS.map(({ key, icon: Icon, label }) => (
          <Button
            key={key}
            aria-label={`${label} tab`}
            size="xs"
            variant={activeTab === key ? 'solid' : 'ghost'}
            colorPalette={activeTab === key ? 'teal' : undefined}
            color={activeTab === key ? undefined : 'fg.muted'}
            fontWeight="600"
            onClick={() => setActiveTab(key)}
            px={2}
          >
            <Icon size={13} />
            {label}
          </Button>
        ))}
      </HStack>

      {activeTab === 'fields' && (
        <VegaEncodingPanel envelope={envelope} columns={columns} types={types} onVizChange={onVizChange} />
      )}

      {activeTab === 'settings' && (
        isUnit ? (
          <Box display="flex" flexDirection="column" gap={3} py={1}>
            <HStack justify="space-between">
              <Text fontSize="xs" color="fg.muted">Stacked</Text>
              <Switch.Root
                aria-label="Toggle stacked"
                size="sm"
                checked={getStacked(spec)}
                onCheckedChange={(e) => onVizChange(setStacked(envelope, e.checked))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="xs" color="fg.muted">Log scale (Y)</Text>
              <Switch.Root
                aria-label="Toggle log scale"
                size="sm"
                checked={getYLogScale(spec)}
                onCheckedChange={(e) => onVizChange(setYLogScale(envelope, e.checked))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
              Everything else (formats, colors, layers, interactions) — ask the agent; it edits the spec directly.
            </Text>
          </Box>
        ) : (
          <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            This spec uses layers/facets — settings toggles only apply to simple charts. Edit via chat.
          </Text>
        )
      )}

      {activeTab === 'spec' && <VizSpecInspector envelope={envelope} />}
    </Box>
  );
}

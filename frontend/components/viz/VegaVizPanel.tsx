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
import {
  isUnitVegaLiteSpec, getMarkType, setMarkType,
  getStacked, setStacked, getYLogScale, setYLogScale,
} from '@/lib/viz/encoding-edit';
import { VegaEncodingPanel } from './VegaEncodingPanel';
import { VizSpecInspector } from './VizSpecInspector';

const MARK_TYPES = ['bar', 'line', 'area', 'point', 'arc'] as const;

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
  const markType = getMarkType(spec);

  const TABS = [
    { key: 'fields', icon: LuLayoutGrid, label: 'Fields' },
    { key: 'settings', icon: LuSettings2, label: 'Settings' },
    { key: 'spec', icon: LuBraces, label: 'Spec' },
  ] as const;

  return (
    <Box>
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
            <Box>
              <Text fontSize="10px" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                Mark
              </Text>
              <HStack gap={1} flexWrap="wrap">
                {MARK_TYPES.map(t => (
                  <Button
                    key={t}
                    aria-label={`Mark type ${t}`}
                    size="xs"
                    variant={markType === t ? 'solid' : 'outline'}
                    colorPalette={markType === t ? 'teal' : undefined}
                    onClick={() => onVizChange(setMarkType(envelope, t))}
                    px={2}
                    fontFamily="mono"
                  >
                    {t}
                  </Button>
                ))}
              </HStack>
            </Box>
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

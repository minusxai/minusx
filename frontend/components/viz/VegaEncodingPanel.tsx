'use client';

/**
 * Drop-zone lens over a unit Vega-Lite spec (X / Y / Color channels).
 *
 * Reuses the classic builder chips/zones, but edits are SURGICAL spec edits via
 * lib/viz/encoding-edit — replace one channel's field/type, preserve everything else
 * (the RFC's cardinal rule: never round-trip the spec through a simplified model).
 * Composed specs (layer/facet/concat) show a hint instead — those are chat-edited.
 * Pure view: envelope + columns in, onVizChange(newEnvelope) out. No Redux.
 */
import { useState } from 'react';
import { Box, HStack, Text, Wrap } from '@chakra-ui/react';
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from '@/components/plotx/AxisComponents';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { isUnitVegaLiteSpec, getChannelField, setChannelField, getVizType, zonesForVizType, type EditableChannel } from '@/lib/viz/encoding-edit';
import { sqlTypeToVizKind } from '@/lib/viz/query-data';

export interface VegaEncodingPanelProps {
  envelope: VizEnvelope;
  columns: string[];
  types: string[];
  onVizChange: (envelope: VizEnvelope) => void;
}

export function VegaEncodingPanel({ envelope, columns, types, onVizChange }: VegaEncodingPanelProps) {
  const isTouchDevice = useIsTouchDevice();
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileSelected, setMobileSelected] = useState<string | null>(null);

  const spec = (envelope.source as { spec: Record<string, unknown> }).spec;
  if (!isUnitVegaLiteSpec(spec)) {
    return (
      <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
        This spec uses layers/facets — the drop zones only edit simple charts. Edit via chat,
        or inspect the spec below.
      </Text>
    );
  }

  // Zones are viz-type-aware: a pie offers Slices/Value (color/theta), never x/y —
  // positional encodings on an arc draw overlapping wedges per position.
  const zones = zonesForVizType(getVizType(spec));
  const assigned = new Set(zones.map(z => getChannelField(spec, z.channel)).filter(Boolean));

  const assign = (channel: EditableChannel, name: string | null) => {
    const column = name != null
      ? { name, kind: sqlTypeToVizKind(types[columns.indexOf(name)] ?? '') }
      : null;
    onVizChange(setChannelField(envelope, channel, column));
    setMobileSelected(null);
  };

  return (
    <Box aria-label="Vega encoding drop zones" pb={2}>
      <Wrap gap={1.5} pb={2}>
        {columns.map(col => (
          <ColumnChip
            key={col}
            column={col}
            type={resolveColumnType(col, columns, types)}
            isAssigned={assigned.has(col)}
            isDragging={dragged === col}
            isMobileSelected={mobileSelected === col}
            isTouchDevice={isTouchDevice}
            onDragStart={() => setDragged(col)}
            onDragEnd={() => setDragged(null)}
            onMobileSelect={() => setMobileSelected(sel => (sel === col ? null : col))}
          />
        ))}
      </Wrap>
      <HStack gap={2} align="stretch" flexWrap="wrap">
        {zones.map(({ channel, label }) => {
          const field = getChannelField(spec, channel);
          return (
            <Box key={channel} flex="1" minW="120px" aria-label={`${label} drop zone`}>
              <DropZone
                label={label}
                isTouchDevice={isTouchDevice}
                onDrop={() => {
                  const col = dragged ?? mobileSelected;
                  if (col) assign(channel, col);
                }}
              >
                {field ? (
                  <ZoneChip
                    column={field}
                    type={resolveColumnType(field, columns, types)}
                    onRemove={() => assign(channel, null)}
                  />
                ) : null}
              </DropZone>
            </Box>
          );
        })}
      </HStack>
    </Box>
  );
}

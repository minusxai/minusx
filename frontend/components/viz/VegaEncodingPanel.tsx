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
import { isEnvelopeEditable, getEnvelopeZones, getZoneField, setZoneField, getYFields, addYField, removeYField } from '@/lib/viz/encoding-edit';
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

  if (!isEnvelopeEditable(envelope)) {
    return (
      <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
        This spec uses layers/facets — the drop zones only edit simple charts. Edit via chat,
        or inspect the spec below.
      </Text>
    );
  }

  // Zones are source-aware: recipes expose their binding slots (funnel → Stages/Value);
  // native unit specs expose type-aware channels (pie → Slices/Value, never x/y).
  const zones = getEnvelopeZones(envelope);
  const sourceKind = (envelope.source as unknown as { kind: string }).kind;
  const spec = sourceKind === 'vega-lite'
    ? (envelope.source as unknown as { spec: Record<string, unknown> }).spec
    : null;

  // The Y zone of a native cartesian spec holds MULTIPLE measures (folded, RFC §4);
  // every other zone holds one field.
  const zoneFields = (channel: string): string[] => {
    if (channel === 'y' && spec) return getYFields(spec);
    const f = getZoneField(envelope, channel);
    return f ? [f] : [];
  };
  const assigned = new Set(zones.flatMap(z => zoneFields(z.channel)));

  const columnOf = (name: string) => ({ name, kind: sqlTypeToVizKind(types[columns.indexOf(name)] ?? '') });

  const assign = (channel: string, name: string | null) => {
    if (channel === 'y' && spec && name != null) {
      onVizChange(addYField(envelope, columnOf(name)));
    } else {
      onVizChange(setZoneField(envelope, channel, name != null ? columnOf(name) : null));
    }
    setMobileSelected(null);
  };

  const removeFromZone = (channel: string, name: string) => {
    if (channel === 'y' && spec) onVizChange(removeYField(envelope, name));
    else onVizChange(setZoneField(envelope, channel, null));
  };

  return (
    <Box aria-label="Vega encoding drop zones" pb={2}>
      <Wrap gap={1.5} pb={4}>
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
          const fields = zoneFields(channel).filter(f => f !== '__mx_key');
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
                {fields.length > 0 ? (
                  fields.map(field => (
                    <ZoneChip
                      key={field}
                      column={field}
                      type={resolveColumnType(field, columns, types)}
                      onRemove={() => removeFromZone(channel, field)}
                    />
                  ))
                ) : (
                  // chip-height placeholder so empty zones align with filled ones
                  <Box h="27px" width="full" />
                )}
              </DropZone>
            </Box>
          );
        })}
      </HStack>
    </Box>
  );
}

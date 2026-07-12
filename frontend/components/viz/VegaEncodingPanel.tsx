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
import {
  isEnvelopeEditable, getEnvelopeZones, getZoneFields, addZoneField, removeZoneField,
  getVizColumnFormats, mergeVizColumnFormat,
  getChannelPresentation, setChannelPresentation, type EditableChannel,
} from '@/lib/viz/encoding-edit';
import { sqlTypeToVizKind } from '@/lib/viz/query-data';
import { VizFieldPopover } from './VizFieldPopover';

export interface VegaEncodingPanelProps {
  envelope: VizEnvelope;
  columns: string[];
  types: string[];
  onVizChange: (envelope: VizEnvelope) => void;
  /** The user clicked the Custom icon on a non-custom source: render the same
   * read-only reference view a real custom spec gets, with copy explaining what
   * Custom is (the envelope itself is untouched). */
  customPreview?: boolean;
}

export function VegaEncodingPanel({ envelope, columns, types, onVizChange, customPreview }: VegaEncodingPanelProps) {
  const isTouchDevice = useIsTouchDevice();
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileSelected, setMobileSelected] = useState<string | null>(null);
  const editable = isEnvelopeEditable(envelope) && !customPreview;

  // Zones are source-aware: recipes expose their binding slots (funnel → Stages/Value);
  // native unit specs expose type-aware channels (pie → Slices/Value, never x/y).
  // Multi-capable zones (native Y via fold, recipe slots flagged `multi`) hold lists.
  const zones = editable ? getEnvelopeZones(envelope) : [];
  const assigned = new Set(zones.flatMap(z => getZoneFields(envelope, z.channel)));
  const isRecipe = (envelope.source as unknown as { kind: string }).kind === 'recipe';
  // Recipe chips carry the CLASSIC format popover (alias/decimals/prefix/suffix) —
  // stored as source.columnFormats and applied at materialization. Native specs use
  // the d3-native VizFieldPopover instead (spec `title`/`axis.format`).
  const recipeFormats = isRecipe ? getVizColumnFormats(envelope) : undefined;

  const columnOf = (name: string) => ({ name, kind: sqlTypeToVizKind(types[columns.indexOf(name)] ?? '') });

  const assign = (channel: string, name: string) => {
    onVizChange(addZoneField(envelope, channel, columnOf(name)));
    setMobileSelected(null);
  };

  const removeFromZone = (channel: string, name: string) => {
    onVizChange(removeZoneField(envelope, channel, name));
  };

  return (
    <Box aria-label={editable ? 'Vega encoding drop zones' : 'Query result columns'} pb={2}>
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
            interactive={editable}
            onDragStart={() => setDragged(col)}
            onDragEnd={() => setDragged(null)}
            onMobileSelect={() => setMobileSelected(sel => (sel === col ? null : col))}
          />
        ))}
      </Wrap>
      {!editable ? (
        <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
          {customPreview
            ? 'Custom is where agent-authored charts live — layers, facets, annotations, anything beyond the quick types. Ask the agent to build one, or edit the JSON in Spec. Pick a chart type above to go back.'
            : 'Query columns are shown for reference. This custom spec has no editable drop zones; use Spec or ask the agent to change its fields.'}
        </Text>
      ) : <HStack gap={2} align="stretch" flexWrap="wrap">
        {zones.map(({ channel, label }) => {
          const fields = getZoneFields(envelope, channel).filter(f => f !== '__mx_key');
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
                      // ONE popover across the vega tier (alias + d3 format); storage
                      // differs per source: native = surgical spec edits (channel
                      // title / axis.format), recipe = source.columnFormats applied
                      // at materialization. Keyed per-column for recipes (multi zones).
                      extra={isRecipe || ((envelope.source as unknown as { kind: string }).kind === 'vega-lite' && fields.length === 1) ? (
                        <VizFieldPopover
                          channel={isRecipe ? field : channel}
                          kind={sqlTypeToVizKind(types[columns.indexOf(field)] ?? '')}
                          value={isRecipe
                            ? { title: recipeFormats?.[field]?.alias ?? null, format: recipeFormats?.[field]?.format ?? null }
                            : getChannelPresentation(envelope, channel)}
                          onCommit={(next) => {
                            if (!isRecipe) {
                              onVizChange(setChannelPresentation(envelope, channel as EditableChannel, next));
                              return;
                            }
                            const cfg = { ...recipeFormats?.[field] };
                            if (next.title == null) delete cfg.alias; else cfg.alias = next.title;
                            if (next.format == null) delete cfg.format; else cfg.format = next.format;
                            onVizChange(mergeVizColumnFormat(envelope, field, cfg));
                          }}
                        />
                      ) : undefined}
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
      </HStack>}
    </Box>
  );
}

'use client';

/**
 * The V2 viz settings panel: Fields (drop-zone lens) | Settings (mark type, stacking,
 * log scale) | Spec (raw envelope inspector) — mirroring the classic AxisBuilder's
 * subtab idiom. Every control performs a SURGICAL spec edit (lib/viz/encoding-edit);
 * the long tail of styling stays with the agent. Pure view: no Redux.
 */
import { useState } from 'react';
import { Box, Button, HStack, Text, Textarea, Switch } from '@chakra-ui/react';
import { LuLayoutGrid, LuSettings2, LuBraces } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizSettings } from '@/lib/types';
import {
  isEnvelopeEditable, getEnvelopeVizType, setEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES,
  getStacked, setStacked, getYLogScale, setYLogScale,
  getTableConditionalFormats, setTableConditionalFormats, getVizCss, setVizCss,
  getPivotConfig, setPivotConfig, getVizColumnFormats, mergeVizColumnFormat,
  type V2VizType,
} from '@/lib/viz/encoding-edit';
import { sqlTypeToVizKind } from '@/lib/viz/query-data';
import { VizTypeSelector } from '@/components/question/VizTypeSelector';
import { TableConditionalFormatPanel } from '@/components/plotx/TableConditionalFormatPanel';
import { PivotAxisBuilder } from '@/components/plotx/PivotAxisBuilder';
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
  const source = envelope.source as unknown as Record<string, unknown>;
  const isRecipe = source.kind === 'recipe';
  const isTable = source.kind === 'table';
  const isPivot = source.kind === 'pivot';
  const isDomTier = isTable || isPivot;
  const spec = isRecipe || isDomTier ? null : (source as { spec: Record<string, unknown> }).spec;
  const isUnit = isEnvelopeEditable(envelope);
  const vizType = getEnvelopeVizType(envelope);
  // Draft for the DOM-tier css textarea — committed to the envelope on blur.
  const [cssDraft, setCssDraft] = useState<string | null>(null);

  const TABS = [
    { key: 'fields', icon: LuLayoutGrid, label: 'Fields' },
    { key: 'settings', icon: LuSettings2, label: 'Settings' },
    { key: 'spec', icon: LuBraces, label: 'Spec' },
  ] as const;

  return (
    <Box>
      {/* Composed/unrecognized specs are the CUSTOM state — an operator (facet/layer)
          or mark beyond the quick types. No icon claims them: the grid's transforms
          are only safe on unit specs, so structural edits route through chat. */}
      {(!isUnit || vizType == null) && (
        <HStack gap={2} pb={2} aria-label="Custom spec indicator">
          <Box px={2} py={0.5} bg="accent.secondary/15" borderRadius="md" border="1px solid" borderColor="accent.secondary/30">
            <Text fontSize="10px" fontWeight="700" color="accent.secondary" letterSpacing="0.03em">CUSTOM</Text>
          </Box>
          <Text fontSize="10px" color="fg.subtle" lineHeight="1.4">
            {isUnit
              ? 'This mark type has no quick-switch equivalent — edit via chat.'
              : 'Layered/faceted spec — beyond the quick types; edit via chat.'}
          </Text>
        </HStack>
      )}
      {/* Viz-type icon grid on top — same placement as the classic panel. Disabled
          entries double as the live "not yet in V2" coverage list. */}
      {isUnit && (
        <VizTypeSelector
          // vizType is DERIVED from the spec (never stored). null = a shape the grid
          // doesn't recognize (rule/text marks…) — highlight nothing rather than lie.
          value={vizType as VizSettings['type']}
          onChange={(t) => {
            if ((V2_SUPPORTED_VIZ_TYPES as readonly string[]).includes(t)) {
              // Columns feed the fallback inference (leaving table, which has no
              // encodings to read — classic auto-pick behavior).
              const cols = columns.map((name, i) => ({ name, kind: sqlTypeToVizKind(types[i] ?? '') }));
              onVizChange(setEnvelopeVizType(envelope, t as V2VizType, cols));
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
        isTable ? (
          <Text aria-label="Table fields hint" fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            Table columns are managed on the table itself — sort/filter/hide via the column
            headers and bottom toolbar, rename &amp; format via each header&apos;s ⚙.
          </Text>
        ) : isPivot ? (
          <PivotAxisBuilder
            columns={columns}
            types={types}
            pivotConfig={getPivotConfig(envelope) ?? undefined}
            onPivotConfigChange={(config) => onVizChange(setPivotConfig(envelope, config))}
            columnFormats={getVizColumnFormats(envelope)}
            onColumnFormatChange={(column, config) => onVizChange(mergeVizColumnFormat(envelope, column, config))}
            d3Formats
          />
        ) : (
          <VegaEncodingPanel envelope={envelope} columns={columns} types={types} onVizChange={onVizChange} />
        )
      )}

      {activeTab === 'settings' && isDomTier && (
        <Box display="flex" flexDirection="column" gap={3} py={1}>
          {isTable && (
            <TableConditionalFormatPanel
              columns={columns}
              rules={getTableConditionalFormats(envelope)}
              onChange={(rules) => onVizChange(setTableConditionalFormats(envelope, rules))}
            />
          )}
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1}>CSS overrides</Text>
            <Textarea
              aria-label="CSS overrides"
              size="xs"
              fontFamily="mono"
              fontSize="11px"
              rows={5}
              placeholder={isTable
                ? '.mx-th { background: #223; }\n.mx-toolbar { display: none; }'
                : '.mx-pivot th { background: #223; }'}
              value={cssDraft ?? getVizCss(envelope) ?? ''}
              onChange={(e) => setCssDraft(e.target.value)}
              onBlur={() => {
                if (cssDraft != null) onVizChange(setVizCss(envelope, cssDraft));
                setCssDraft(null);
              }}
            />
            <Text fontSize="10px" color="fg.subtle" mt={1} lineHeight="1.5">
              {isTable
                ? 'Scoped to this table. Classes: .mx-table, .mx-header-row, .mx-th, .mx-row (+ .mx-row-odd/-even zebra), .mx-cell, .mx-col-<column>, .mx-toolbar. No @import / url().'
                : 'Scoped to this pivot. Target .mx-pivot with element selectors (th, td, thead). No @import / url().'}
            </Text>
          </Box>
        </Box>
      )}

      {activeTab === 'settings' && !isDomTier && (
        isRecipe ? (
          <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            This chart is generated from the {String((envelope.source as unknown as Record<string, unknown>).recipe)} recipe —
            bind columns in Fields, or ask the agent for deeper customization.
          </Text>
        ) : isUnit && spec ? (
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

'use client';

/**
 * The V2 viz settings panel: Fields (drop-zone lens) | Settings (mark type, stacking,
 * log scale) | Spec (raw envelope inspector) — mirroring the classic AxisBuilder's
 * subtab idiom. Every control performs a SURGICAL spec edit (lib/viz/encoding-edit);
 * the long tail of styling stays with the agent. Pure view: no Redux.
 */
import { useCallback, useMemo, useState } from 'react';
import { Box, Button, HStack, Input, Text, Textarea, Switch, NativeSelect } from '@chakra-ui/react';
import { LuLayoutGrid, LuSettings2, LuBraces } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizSettings } from '@/lib/types';
import {
  isEnvelopeEditable, getEnvelopeVizType, setEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES,
  getStacked, setStacked, getYLogScale, setYLogScale, getMaxBins, setMaxBins,
  getTableConditionalFormats, setTableConditionalFormats, getVizCss, setVizCss,
  getPivotConfig, setPivotConfig, getVizColumnFormats, mergeVizColumnFormat,
  getRecipeParams, setRecipeParam,
  type V2VizType,
} from '@/lib/viz/encoding-edit';
import { sqlTypeToVizKind } from '@/lib/viz/query-data';
import { detachRecipe, reattachRecipe, canReattach } from '@/lib/viz/detach';
import { VizTypeSelector, type SelectableVizType } from '@/components/question/VizTypeSelector';
import { GEO_ASSET_OPTIONS, resolveGeoAsset } from '@/lib/viz/geo-assets';
import { TableConditionalFormatPanel } from '@/components/plotx/TableConditionalFormatPanel';
import { PivotAxisBuilder } from '@/components/plotx/PivotAxisBuilder';
import { VegaEncodingPanel } from './VegaEncodingPanel';
import { VizSpecInspector } from './VizSpecInspector';
import {
  aggregatePivotData, getUniqueTopLevelRowValues, getUniqueTopLevelColumnValues, getUniqueRowValuesAtLevel,
} from '@/lib/chart/pivot-utils';

// Everything the classic selector offers minus what V2 type-switching supports today —
// shown disabled, so the icon grid doubles as the live V2 coverage checklist.
const ALL_CLASSIC_TYPES: VizSettings['type'][] = [
  'table', 'bar', 'line', 'area', 'row', 'scatter', 'pie', 'combo', 'funnel',
  'waterfall', 'radar', 'pivot', 'trend', 'single_value', 'geo',
];
const V2_DISABLED_TYPES = ALL_CLASSIC_TYPES.filter(
  t => !(V2_SUPPORTED_VIZ_TYPES as readonly string[]).includes(t),
);

// Choropleth sequential color scales (matches CHOROPLETH_SCHEMES in viz-templates).
const CHOROPLETH_SCALE_OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'orange', label: 'Orange' },
  { value: 'purple', label: 'Purple' },
  { value: 'red-yellow-green', label: 'Red → Green' },
  { value: 'blue-orange', label: 'Blue → Orange' },
];

export interface VegaVizPanelProps {
  envelope: VizEnvelope;
  columns: string[];
  types: string[];
  /** Query result rows — feeds the pivot Formulas builder (dimension VALUES come
   * from the data, not the schema). Omit and formulas simply don't render. */
  rows?: Record<string, unknown>[];
  onVizChange: (envelope: VizEnvelope) => void;
}

export function VegaVizPanel({ envelope, columns, types, rows, onVizChange }: VegaVizPanelProps) {
  const [activeTab, setActiveTab] = useState<'fields' | 'settings' | 'spec'>('fields');
  const source = envelope.source as unknown as Record<string, unknown>;
  const isRecipe = source.kind === 'recipe';
  const isTable = source.kind === 'table';
  const isPivot = source.kind === 'pivot';
  const isDomTier = isTable || isPivot;
  const spec = isRecipe || isDomTier ? null : (source as { spec: Record<string, unknown> }).spec;
  const isUnit = isEnvelopeEditable(envelope);
  const vizType = getEnvelopeVizType(envelope);
  // Clicking the Custom icon "visits" the custom state without converting anything
  // (custom is derived from the spec, never stored). Pure UI state: any family
  // click exits; the envelope is untouched throughout.
  const [customPreview, setCustomPreview] = useState(false);
  // Draft for the DOM-tier css textarea — committed to the envelope on blur.
  const [cssDraft, setCssDraft] = useState<string | null>(null);
  // Draft for the histogram Max-bins input — committed on blur (empty = auto).
  const [maxBinsDraft, setMaxBinsDraft] = useState<string | null>(null);

  // Pivot Formulas builder inputs — the same derivation ChartBuilder does for the
  // classic panel: dimension VALUES come from aggregating the result rows.
  const pivotConfig = useMemo(() => (isPivot ? getPivotConfig(envelope) : null), [isPivot, envelope]);
  const pivotData = useMemo(() => {
    if (!pivotConfig || !rows?.length || pivotConfig.values.length === 0) return null;
    return aggregatePivotData(rows as Record<string, never>[], pivotConfig);
  }, [pivotConfig, rows]);
  const availableRowValues = useMemo(
    () => (pivotData ? getUniqueTopLevelRowValues(pivotData) : undefined), [pivotData]);
  const availableColumnValues = useMemo(
    () => (pivotData ? getUniqueTopLevelColumnValues(pivotData) : undefined), [pivotData]);
  const rowDimensions = useMemo(() => {
    if (!pivotData || !pivotConfig || pivotConfig.rows.length < 2) return undefined;
    return pivotConfig.rows.map((col, level) => ({
      name: col,
      level,
      availableValues: getUniqueRowValuesAtLevel(pivotData, level),
    }));
  }, [pivotData, pivotConfig]);
  const getRowValuesAtLevel = useCallback(
    (level: number, parentValues?: string[]) =>
      (pivotData ? getUniqueRowValuesAtLevel(pivotData, level, parentValues) : []),
    [pivotData]);

  const TABS = [
    { key: 'fields', icon: LuLayoutGrid, label: 'Fields' },
    { key: 'settings', icon: LuSettings2, label: 'Settings' },
    { key: 'spec', icon: LuBraces, label: 'Spec' },
  ] as const;

  return (
    <Box>
      {/* Viz-type icon grid on top — same placement as the classic panel. Disabled
          entries double as the live "not yet in V2" coverage list. CUSTOM keeps
          the grid visible for authored compositions; clicking it previews the
          custom state (info only) rather than converting. */}
      <VizTypeSelector
        // vizType is DERIVED from the source. Unrecognized shapes select Custom;
        // clicking the active family is a no-op, preserving authored specs exactly.
        value={customPreview ? 'custom' : (vizType ?? 'custom') as SelectableVizType}
        includeV2Only
        onChange={(t) => {
          if (t === 'custom') { setCustomPreview(true); return; }
          setCustomPreview(false);
          if (t === vizType) return;
          if ((V2_SUPPORTED_VIZ_TYPES as readonly string[]).includes(t)) {
            // Columns feed fallback inference for table/custom composed sources.
            const cols = columns.map((name, i) => ({ name, kind: sqlTypeToVizKind(types[i] ?? '') }));
            onVizChange(setEnvelopeVizType(envelope, t as V2VizType, cols));
          }
        }}
        orientation="grouped"
        disabledTypes={V2_DISABLED_TYPES}
        disabledReason="Not yet supported for Vega charts — ask the agent"
      />
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
        customPreview ? (
          <VegaEncodingPanel envelope={envelope} columns={columns} types={types} onVizChange={onVizChange} customPreview />
        ) : isTable ? (
          <Text aria-label="Table fields hint" fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            Table columns are managed on the table itself — sort/filter/hide via the column
            headers and bottom toolbar, rename &amp; format via each header&apos;s ⚙.
          </Text>
        ) : isPivot ? (
          // section="fields": the panel's own tabs host the builder's sections —
          // zones here, pivot options under the Settings tab (no nested tab bar).
          <PivotAxisBuilder
            columns={columns}
            types={types}
            pivotConfig={getPivotConfig(envelope) ?? undefined}
            onPivotConfigChange={(config) => onVizChange(setPivotConfig(envelope, config))}
            columnFormats={getVizColumnFormats(envelope)}
            onColumnFormatChange={(column, config) => onVizChange(mergeVizColumnFormat(envelope, column, config))}
            d3Formats
            section="fields"
          />
        ) : (
          <VegaEncodingPanel envelope={envelope} columns={columns} types={types} onVizChange={onVizChange} />
        )
      )}

      {/* The Custom preview owns BOTH content tabs — showing the real type's
          toggles under a selected Custom icon would contradict the selection. */}
      {activeTab === 'settings' && customPreview && (
        <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
          Custom charts have no settings toggles — ask the agent, or edit the JSON in Spec.
          Pick a chart type above to go back.
        </Text>
      )}

      {activeTab === 'settings' && !customPreview && isDomTier && (
        <Box display="flex" flexDirection="column" gap={3} py={1}>
          {isPivot && (
            <PivotAxisBuilder
              columns={columns}
              types={types}
              pivotConfig={pivotConfig ?? undefined}
              onPivotConfigChange={(config) => onVizChange(setPivotConfig(envelope, config))}
              columnFormats={getVizColumnFormats(envelope)}
              onColumnFormatChange={(column, config) => onVizChange(mergeVizColumnFormat(envelope, column, config))}
              d3Formats
              section="settings"
              availableRowValues={availableRowValues}
              availableColumnValues={availableColumnValues}
              rowDimensions={rowDimensions}
              getRowValuesAtLevel={getRowValuesAtLevel}
            />
          )}
          {(isTable || isPivot) && (
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

      {activeTab === 'settings' && !customPreview && !isDomTier && (
        isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/trend@1' ? (
          <Box display="flex" flexDirection="column" gap={3} py={1}>
            <HStack justify="space-between">
              <Box>
                <Text fontSize="xs" color="fg.muted">Skip partial period</Text>
                <Text fontSize="10px" color="fg.subtle">Compare the last two COMPLETE periods (ignores the in-progress one)</Text>
              </Box>
              <Switch.Root
                aria-label="Skip partial period"
                size="sm"
                checked={getRecipeParams(envelope).compareMode === 'previous'}
                onCheckedChange={(e) => onVizChange(setRecipeParam(envelope, 'compareMode', e.checked ? 'previous' : undefined))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="xs" color="fg.muted">Sparkline</Text>
              <Switch.Root
                aria-label="Toggle sparkline"
                size="sm"
                checked={getRecipeParams(envelope).sparkline !== false}
                onCheckedChange={(e) => onVizChange(setRecipeParam(envelope, 'sparkline', e.checked ? undefined : false))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
              Font sizes and everything else — ask the agent (valueFontSize/deltaFontSize/labelFontSize/dateFontSize params).
            </Text>
          </Box>
        ) : isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/single-value@1' ? (
          <Box display="flex" flexDirection="column" gap={3} py={1}>
            <HStack justify="space-between">
              <Box>
                <Text fontSize="xs" color="fg.muted">Label</Text>
                <Text fontSize="10px" color="fg.subtle">Uses the field alias configured in Fields</Text>
              </Box>
              <Switch.Root
                aria-label="Show label"
                size="sm"
                checked={getRecipeParams(envelope).showLabel !== false}
                onCheckedChange={(e) => onVizChange(setRecipeParam(envelope, 'showLabel', e.checked ? undefined : false))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
              Rename and format the value in Fields. For a caption, alignment, custom color, or exact font sizes, ask the agent.
            </Text>
          </Box>
        ) : isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/combo@1' ? (
          <Box display="flex" flexDirection="column" gap={3} py={1}>
            <HStack justify="space-between">
              <Box>
                <Text fontSize="xs" color="fg.muted">Line points</Text>
                <Text fontSize="10px" color="fg.subtle">Keep individual line values easy to inspect</Text>
              </Box>
              <Switch.Root
                aria-label="Show line points"
                size="sm"
                checked={getRecipeParams(envelope).linePoints !== false}
                onCheckedChange={(e) => onVizChange(setRecipeParam(envelope, 'linePoints', e.checked ? undefined : false))}
              >
                <Switch.HiddenInput />
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Root>
            </HStack>
            <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
              Bars use the left scale; the line uses the right. Bind Color / Split, rename, and format in Fields.
            </Text>
          </Box>
        ) : isRecipe && ['minusx/choropleth@1', 'minusx/point-map@1'].includes(String((envelope.source as unknown as Record<string, unknown>).recipe)) ? (
          (() => {
            const isPoints = (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/point-map@1';
            const params = getRecipeParams(envelope);
            // Point maps default color to a category palette (colorScale unset); the
            // choropleth is always a sequential ramp (default green).
            const scaleValue = typeof params.colorScale === 'string' ? String(params.colorScale) : (isPoints ? 'category' : 'green');
            const scaleOptions = isPoints ? [{ value: 'category', label: 'By category' }, ...CHOROPLETH_SCALE_OPTIONS] : CHOROPLETH_SCALE_OPTIONS;
            return (
              <Box display="flex" flexDirection="column" gap={3} py={1}>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Map</Text>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      aria-label="Map"
                      value={resolveGeoAsset(params.mapName)}
                      onChange={(e) => onVizChange(setRecipeParam(envelope, 'mapName', e.currentTarget.value))}
                    >
                      {GEO_ASSET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Color scale</Text>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      aria-label="Color scale"
                      value={scaleValue}
                      onChange={(e) => onVizChange(setRecipeParam(envelope, 'colorScale', e.currentTarget.value === 'category' ? undefined : e.currentTarget.value))}
                    >
                      {scaleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
                {isPoints && (
                  <>
                    <Box>
                      <Text fontSize="xs" color="fg.muted" mb={1}>Basemap</Text>
                      <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                          aria-label="Basemap"
                          value={params.basemap === 'tiles' ? 'tiles' : 'vector'}
                          onChange={(e) => onVizChange(setRecipeParam(envelope, 'basemap', e.currentTarget.value === 'tiles' ? 'tiles' : undefined))}
                        >
                          <option value="vector">Vector outline</option>
                          <option value="tiles">Street tiles</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Box>
                    <Box>
                      <Text fontSize="xs" color="fg.muted" mb={1}>Center (lat, lng)</Text>
                      <Input
                        size="sm"
                        aria-label="Center lat lng"
                        placeholder="e.g. 37, -119 — centers the map"
                        key={JSON.stringify(params.center ?? '')}
                        defaultValue={Array.isArray(params.center) ? (params.center as number[]).join(', ') : ''}
                        onBlur={(e) => {
                          const parts = e.currentTarget.value.split(',').map(s => parseFloat(s.trim()));
                          const valid = parts.length === 2 && parts.every(n => Number.isFinite(n));
                          onVizChange(setRecipeParam(envelope, 'center', valid ? parts : undefined));
                        }}
                      />
                    </Box>
                    <Box>
                      <Text fontSize="xs" color="fg.muted" mb={1}>Zoom</Text>
                      <Input
                        size="sm"
                        type="number"
                        aria-label="Zoom"
                        step="0.1"
                        min="0.5"
                        max="10"
                        value={typeof params.zoom === 'number' ? String(params.zoom) : '1'}
                        onChange={(e) => {
                          const v = parseFloat(e.currentTarget.value);
                          onVizChange(setRecipeParam(envelope, 'zoom', Number.isFinite(v) && v !== 1 ? v : undefined));
                        }}
                      />
                    </Box>
                  </>
                )}
                <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
                  {isPoints
                    ? 'Bind Latitude + Longitude in Fields. Add Size for bubbles, Color to group, or End lat/lng for flows. Center + Zoom frame the map geographically (no SQL filter needed). Street-tile basemap shows real streets for local/city views (browser only — exports fall back to the vector outline).'
                    : 'Bind Region + Value in Fields. Region names must match the map (e.g. "California", "Tanzania").'}
                </Text>
              </Box>
            );
          })()
        ) : isRecipe ? (
          <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            This chart is generated from the {String((envelope.source as unknown as Record<string, unknown>).recipe)} recipe —
            bind columns in Fields, or ask the agent for deeper customization.
          </Text>
        ) : isUnit && spec && !['heatmap', 'pie'].includes(vizType ?? '') ? (
          // Stacked / log-y are cartesian concepts — hidden for pie (theta) and
          // heatmap (colour), where they'd silently do nothing sensible.
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
            {vizType === 'histogram' && (
              <HStack justify="space-between">
                <Text fontSize="xs" color="fg.muted">Max bins</Text>
                <Input
                  aria-label="Max bins"
                  size="xs"
                  width="90px"
                  type="number"
                  placeholder="auto"
                  value={maxBinsDraft ?? getMaxBins(spec) ?? ''}
                  onChange={(e) => setMaxBinsDraft(e.target.value)}
                  onBlur={() => {
                    if (maxBinsDraft != null) {
                      const n = parseInt(maxBinsDraft, 10);
                      // Empty/invalid clears back to VL's automatic binning (~10 nice bins).
                      onVizChange(setMaxBins(envelope, Number.isFinite(n) && n > 0 ? n : null));
                    }
                    setMaxBinsDraft(null);
                  }}
                />
              </HStack>
            )}
            <Text fontSize="10px" color="fg.subtle" lineHeight="1.5">
              Everything else (formats, colors, layers, interactions) — ask the agent; it edits the spec directly.
            </Text>
          </Box>
        ) : isUnit && spec ? (
          <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            Nothing to toggle for this chart type — formats, colors, and interactions are edited via chat.
          </Text>
        ) : (
          <Text fontSize="xs" color="fg.subtle" py={1} lineHeight="1.6">
            This spec uses layers/facets — settings toggles only apply to simple charts. Edit via chat.
          </Text>
        )
      )}

      {activeTab === 'spec' && (
        <VizSpecInspector
          envelope={envelope}
          onDetach={isRecipe ? () => onVizChange(detachRecipe(envelope)) : undefined}
          onReattach={canReattach(envelope) ? () => onVizChange(reattachRecipe(envelope)) : undefined}
        />
      )}
    </Box>
  );
}

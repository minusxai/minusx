'use client';

/**
 * The V2 viz settings panel: Fields (drop-zone lens) | Settings (mark type, stacking,
 * log scale) | Spec (raw envelope inspector) — mirroring the classic AxisBuilder's
 * subtab idiom. Every control performs a SURGICAL spec edit (lib/viz/encoding-edit);
 * the long tail of styling stays with the agent. Pure view: no Redux.
 */
import { useCallback, useMemo, useState } from 'react';
import { LuLayoutGrid, LuSettings2, LuBraces } from 'react-icons/lu';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { Switch } from '@/components/kit/switch';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizSettings } from '@/lib/types';
import {
  isEnvelopeEditable, getEnvelopeVizType, setEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES,
  getStacked, setStacked, getYLogScale, setYLogScale, getMaxBins, setMaxBins,
  getSeriesColors, setSeriesColor,
  getYBounds, setYBounds, getLineInterpolate, setLineInterpolate, type LineInterpolate,
  addReferenceLine, getReferenceLines, setReferenceLineColor, removeReferenceLine,
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

// Shared control fragments (kit/Tailwind re-skin of the old xs/sm Chakra controls).
const SELECT_XS = 'h-6 rounded-md border border-input bg-transparent px-1 text-xs text-foreground outline-none focus-visible:border-ring';
const SELECT_SM = 'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring';
const CARD = 'rounded-md border border-border bg-card p-3';
const CARD_TITLE = 'text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground';
const SWITCH_TEAL = 'data-[state=checked]:bg-[#16a085]';
const COLOR_INPUT_STYLE: React.CSSProperties = {
  width: 26, height: 18, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer',
};

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
  // Drafts for the Y-bounds inputs — committed on blur (empty = automatic).
  const [yMinDraft, setYMinDraft] = useState<string | null>(null);
  const [yMaxDraft, setYMaxDraft] = useState<string | null>(null);
  // Reference-line adder drafts. Adding writes REAL rule/text layers into the spec —
  // the chart becomes a composed ("custom") spec by design; further edits go via chat.
  const [refAxis, setRefAxis] = useState<'y' | 'x'>('y');
  const [refValue, setRefValue] = useState('');
  const [refLabel, setRefLabel] = useState('');
  const commitReferenceLine = () => {
    if (refValue.trim() === '') return;
    const n = Number(refValue);
    onVizChange(addReferenceLine(envelope, {
      axis: refAxis,
      value: Number.isFinite(n) && refValue.trim() !== '' && !Number.isNaN(n) ? n : refValue.trim(),
      label: refLabel.trim() || null,
    }));
    setRefValue('');
    setRefLabel('');
  };
  const referenceLines = getReferenceLines(envelope);
  const referenceLineCard = (
    <div className={`${CARD} flex flex-col gap-2`}>
      <p className={CARD_TITLE}>
        Reference lines
      </p>
      {referenceLines.map(line => {
        const name = line.label ?? String(line.value);
        return (
          <div key={line.index} className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
              {line.label ? `${line.label} · ` : ''}{line.axis} = {String(line.value)}
            </p>
            <input
              key={`${line.index}:${line.color}`}
              aria-label={`Color for reference line ${name}`}
              type="color"
              defaultValue={line.color}
              onBlur={(e) => {
                if (e.target.value !== line.color) onVizChange(setReferenceLineColor(envelope, line.index, e.target.value));
              }}
              style={COLOR_INPUT_STYLE}
            />
            <button
              type="button"
              aria-label={`Remove reference line ${name}`}
              className="text-xs text-muted-foreground hover:text-[#c0392b]"
              onClick={() => onVizChange(removeReferenceLine(envelope, line.index))}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <select
          aria-label="Reference line axis"
          className={`${SELECT_XS} w-[58px] shrink-0`}
          value={refAxis}
          onChange={(e) => setRefAxis(e.target.value as 'y' | 'x')}
        >
          <option value="y">Y</option>
          <option value="x">X</option>
        </select>
        <Input aria-label="Reference line value" className="h-6 min-w-[60px] flex-1 px-2 text-xs md:text-xs" placeholder="value" value={refValue} onChange={(e) => setRefValue(e.target.value)} />
        <Input aria-label="Reference line label" className="h-6 min-w-[60px] flex-1 px-2 text-xs md:text-xs" placeholder="label (optional)" value={refLabel} onChange={(e) => setRefLabel(e.target.value)} />
        <Button
          aria-label="Add reference line"
          size="xs"
          className="bg-[#16a085] text-white hover:bg-[#16a085]/90"
          onClick={commitReferenceLine}
          disabled={refValue.trim() === ''}
        >
          Add
        </Button>
      </div>
      <p className="text-[10px] leading-normal text-muted-foreground">
        Saved as real chart layers — the agent and the Spec tab see exactly the same thing.
      </p>
    </div>
  );

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
    <div>
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
      <div className="flex items-center gap-1 pb-2">
        {TABS.map(({ key, icon: Icon, label }) => (
          <Button
            key={key}
            aria-label={`${label} tab`}
            size="xs"
            variant={activeTab === key ? 'default' : 'ghost'}
            className={`px-2 font-semibold ${activeTab === key ? 'bg-[#16a085] text-white hover:bg-[#16a085]/90' : 'text-muted-foreground'}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={13} />
            {label}
          </Button>
        ))}
      </div>

      {activeTab === 'fields' && (
        customPreview ? (
          <VegaEncodingPanel envelope={envelope} columns={columns} types={types} onVizChange={onVizChange} customPreview />
        ) : isTable ? (
          <p aria-label="Table fields hint" className="py-1 text-xs leading-[1.6] text-muted-foreground">
            Table columns are managed on the table itself — sort/filter/hide via the column
            headers and bottom toolbar, rename &amp; format via each header&apos;s ⚙.
          </p>
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
        <p className="py-1 text-xs leading-[1.6] text-muted-foreground">
          Custom charts have no settings toggles — ask the agent, or edit the JSON in Spec.
          Pick a chart type above to go back.
        </p>
      )}

      {activeTab === 'settings' && !customPreview && isDomTier && (
        <div className="flex flex-col gap-3 py-1">
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
          <div>
            <p className="mb-1 text-xs text-muted-foreground">CSS overrides</p>
            <textarea
              aria-label="CSS overrides"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
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
            <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
              {isTable
                ? 'Scoped to this table. Classes: .mx-table, .mx-header-row, .mx-th, .mx-row (+ .mx-row-odd/-even zebra), .mx-cell, .mx-col-<column>, .mx-toolbar. No @import / url().'
                : 'Scoped to this pivot. Target .mx-pivot with element selectors (th, td, thead). No @import / url().'}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'settings' && !customPreview && !isDomTier && (
        isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/funnel@1' ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Horizontal layout</p>
                <p className="text-[10px] text-muted-foreground">Stages run left to right instead of top to bottom</p>
              </div>
              <Switch
                aria-label="Horizontal funnel"
                className={SWITCH_TEAL}
                checked={getRecipeParams(envelope).orientation === 'horizontal'}
                onCheckedChange={(checked) => onVizChange(setRecipeParam(envelope, 'orientation', checked ? 'horizontal' : undefined))}
              />
            </div>
            <p className="text-[10px] leading-normal text-muted-foreground">
              Stage order follows the query&apos;s row order. Rename and format the value in Fields.
            </p>
          </div>
        ) : isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/trend@1' ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Skip partial period</p>
                <p className="text-[10px] text-muted-foreground">Compare the last two COMPLETE periods (ignores the in-progress one)</p>
              </div>
              <Switch
                aria-label="Skip partial period"
                className={SWITCH_TEAL}
                checked={getRecipeParams(envelope).compareMode === 'previous'}
                onCheckedChange={(checked) => onVizChange(setRecipeParam(envelope, 'compareMode', checked ? 'previous' : undefined))}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Sparkline</p>
              <Switch
                aria-label="Toggle sparkline"
                className={SWITCH_TEAL}
                checked={getRecipeParams(envelope).sparkline !== false}
                onCheckedChange={(checked) => onVizChange(setRecipeParam(envelope, 'sparkline', checked ? undefined : false))}
              />
            </div>
            <p className="text-[10px] leading-normal text-muted-foreground">
              Font sizes and everything else — ask the agent (valueFontSize/deltaFontSize/labelFontSize/dateFontSize params).
            </p>
          </div>
        ) : isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/single-value@1' ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Label</p>
                <p className="text-[10px] text-muted-foreground">Uses the field alias configured in Fields</p>
              </div>
              <Switch
                aria-label="Show label"
                className={SWITCH_TEAL}
                checked={getRecipeParams(envelope).showLabel !== false}
                onCheckedChange={(checked) => onVizChange(setRecipeParam(envelope, 'showLabel', checked ? undefined : false))}
              />
            </div>
            <p className="text-[10px] leading-normal text-muted-foreground">
              Rename and format the value in Fields. For a caption, alignment, custom color, or exact font sizes, ask the agent.
            </p>
          </div>
        ) : isRecipe && (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/combo@1' ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Line points</p>
                <p className="text-[10px] text-muted-foreground">Keep individual line values easy to inspect</p>
              </div>
              <Switch
                aria-label="Show line points"
                className={SWITCH_TEAL}
                checked={getRecipeParams(envelope).linePoints !== false}
                onCheckedChange={(checked) => onVizChange(setRecipeParam(envelope, 'linePoints', checked ? undefined : false))}
              />
            </div>
            <p className="text-[10px] leading-normal text-muted-foreground">
              Bars use the left scale; the line uses the right. Bind Color / Split, rename, and format in Fields.
            </p>
          </div>
        ) : isRecipe && ['minusx/choropleth@1', 'minusx/point-map@1'].includes(String((envelope.source as unknown as Record<string, unknown>).recipe)) ? (
          (() => {
            const isPoints = (envelope.source as unknown as Record<string, unknown>).recipe === 'minusx/point-map@1';
            const params = getRecipeParams(envelope);
            // Point maps default color to a category palette (colorScale unset); the
            // choropleth is always a sequential ramp (default green).
            const scaleValue = typeof params.colorScale === 'string' ? String(params.colorScale) : (isPoints ? 'category' : 'green');
            const scaleOptions = isPoints ? [{ value: 'category', label: 'By category' }, ...CHOROPLETH_SCALE_OPTIONS] : CHOROPLETH_SCALE_OPTIONS;
            return (
              <div className="flex flex-col gap-3 py-1">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Map</p>
                  <select
                    aria-label="Map"
                    className={SELECT_SM}
                    value={resolveGeoAsset(params.mapName)}
                    onChange={(e) => onVizChange(setRecipeParam(envelope, 'mapName', e.currentTarget.value))}
                  >
                    {GEO_ASSET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Color scale</p>
                  <select
                    aria-label="Color scale"
                    className={SELECT_SM}
                    value={scaleValue}
                    onChange={(e) => onVizChange(setRecipeParam(envelope, 'colorScale', e.currentTarget.value === 'category' ? undefined : e.currentTarget.value))}
                  >
                    {scaleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {isPoints && (
                  <>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Basemap</p>
                      <select
                        aria-label="Basemap"
                        className={SELECT_SM}
                        value={params.basemap === 'tiles' ? 'tiles' : 'vector'}
                        onChange={(e) => onVizChange(setRecipeParam(envelope, 'basemap', e.currentTarget.value === 'tiles' ? 'tiles' : undefined))}
                      >
                        <option value="vector">Vector outline</option>
                        <option value="tiles">Street tiles</option>
                      </select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Center (lat, lng)</p>
                      <Input
                        className="h-8 text-sm md:text-sm"
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
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Zoom</p>
                      <Input
                        className="h-8 text-sm md:text-sm"
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
                    </div>
                  </>
                )}
                <p className="text-[10px] leading-normal text-muted-foreground">
                  {isPoints
                    ? 'Bind Latitude + Longitude in Fields. Add Size for bubbles, Color to group, or End lat/lng for flows. Center + Zoom frame the map geographically (no SQL filter needed). Street-tile basemap shows real streets for local/city views (browser only — exports fall back to the vector outline).'
                    : 'Bind Region + Value in Fields. Region names must match the map (e.g. "California", "Tanzania").'}
                </p>
              </div>
            );
          })()
        ) : isRecipe ? (
          <p className="py-1 text-xs leading-[1.6] text-muted-foreground">
            This chart is generated from the {String((envelope.source as unknown as Record<string, unknown>).recipe)} recipe —
            bind columns in Fields, or ask the agent for deeper customization.
          </p>
        ) : isUnit && spec ? (
          <div className="flex flex-col gap-2.5 py-1">
            {/* Card sections matching the pivot settings look (card bg + border + radius). */}
            {/* Stacked / log-y are cartesian concepts — hidden for pie (theta) and
                heatmap (colour), where they'd silently do nothing sensible. */}
            {(!['heatmap', 'pie'].includes(vizType ?? '') || vizType === 'histogram') && (
              <div className={`${CARD} flex flex-col gap-2.5`}>
                <p className={CARD_TITLE}>
                  Options
                </p>
                {!['heatmap', 'pie'].includes(vizType ?? '') && (<>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Stacked</p>
                    <Switch
                      aria-label="Toggle stacked"
                      className={SWITCH_TEAL}
                      checked={getStacked(spec)}
                      onCheckedChange={(checked) => onVizChange(setStacked(envelope, checked))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Log scale (Y)</p>
                    <Switch
                      aria-label="Toggle log scale"
                      className={SWITCH_TEAL}
                      checked={getYLogScale(spec)}
                      onCheckedChange={(checked) => onVizChange(setYLogScale(envelope, checked))}
                    />
                  </div>
                </>)}
                {vizType === 'histogram' && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Max bins</p>
                    <Input
                      aria-label="Max bins"
                      className="h-6 w-[90px] px-2 text-xs md:text-xs"
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
                  </div>
                )}
                {/* Y bounds — hidden for row (its vertical axis is the category, not the measure). */}
                {!['heatmap', 'pie', 'row'].includes(vizType ?? '') && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Y range</p>
                    <div className="flex items-center gap-1">
                      {([['min', yMinDraft, setYMinDraft], ['max', yMaxDraft, setYMaxDraft]] as const).map(([side, draft, setDraft]) => (
                        <Input
                          key={side}
                          aria-label={`Y axis ${side}`}
                          className="h-6 w-[72px] px-2 text-xs md:text-xs"
                          type="number"
                          placeholder={side === 'min' ? 'min (auto)' : 'max (auto)'}
                          value={draft ?? getYBounds(spec)[side] ?? ''}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => {
                            if (draft != null) {
                              const n = parseFloat(draft);
                              // Empty/invalid clears that side back to automatic.
                              onVizChange(setYBounds(envelope, { [side]: Number.isFinite(n) ? n : null }));
                            }
                            setDraft(null);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {/* Line style — only where a line is drawn. */}
                {['line', 'area'].includes(vizType ?? '') && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Line style</p>
                    <select
                      aria-label="Line style"
                      className={`${SELECT_XS} w-[110px]`}
                      value={getLineInterpolate(spec)}
                      onChange={(e) => onVizChange(setLineInterpolate(envelope, e.target.value as LineInterpolate))}
                    >
                      <option value="linear">Straight</option>
                      <option value="monotone">Smooth</option>
                      <option value="step">Step</option>
                    </select>
                  </div>
                )}
              </div>
            )}
            {/* Series colors (V1 Style-popover parity): per-series overrides, keyed by
                series NAME on the color scale. Heatmap's quantitative ramp is excluded. */}
            {vizType !== 'heatmap' && (() => {
              const seriesColors = getSeriesColors(envelope, rows ?? []);
              if (seriesColors.length === 0) return null;
              const shown = seriesColors.slice(0, 12);
              return (
                <div className={CARD}>
                  <p className={`${CARD_TITLE} mb-2`}>
                    {vizType === 'pie' ? 'Slice colors' : 'Series colors'}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {shown.map(s => (
                      <div key={s.key} className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                          {s.key}
                        </p>
                        {s.overridden && (
                          <button
                            type="button"
                            aria-label={`Reset color for ${s.key}`}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => onVizChange(setSeriesColor(envelope, rows ?? [], s.key, null))}
                          >
                            reset
                          </button>
                        )}
                        <input
                          key={`${s.key}:${s.color}`}
                          aria-label={`Color for ${s.key}`}
                          type="color"
                          defaultValue={s.color}
                          // Commit on close/blur — a live per-tick commit would rebuild the
                          // chart dozens of times while dragging inside the native picker.
                          onBlur={(e) => {
                            if (e.target.value !== s.color) onVizChange(setSeriesColor(envelope, rows ?? [], s.key, e.target.value));
                          }}
                          style={COLOR_INPUT_STYLE}
                        />
                      </div>
                    ))}
                    {seriesColors.length > shown.length && (
                      <p className="text-[10px] text-muted-foreground">+{seriesColors.length - shown.length} more series — ask the agent to color those.</p>
                    )}
                  </div>
                </div>
              );
            })()}
            {referenceLineCard}
            <p className="text-[10px] leading-normal text-muted-foreground">
              Everything else (formats, layers, interactions) — ask the agent; it edits the spec directly.
            </p>
          </div>
        ) : spec != null && Array.isArray((spec as Record<string, unknown>).layer) ? (
          <div className="flex flex-col gap-2.5 py-1">
            {referenceLineCard}
            <p className="text-xs leading-[1.6] text-muted-foreground">
              This spec uses layers — the other settings toggles only apply to simple charts. Edit via chat.
            </p>
          </div>
        ) : (
          <p className="py-1 text-xs leading-[1.6] text-muted-foreground">
            This spec uses facets/concat — settings toggles only apply to simple charts. Edit via chat.
          </p>
        )
      )}

      {activeTab === 'spec' && (
        <VizSpecInspector
          envelope={envelope}
          onDetach={isRecipe ? () => onVizChange(detachRecipe(envelope)) : undefined}
          onReattach={canReattach(envelope) ? () => onVizChange(reattachRecipe(envelope)) : undefined}
        />
      )}
    </div>
  );
}

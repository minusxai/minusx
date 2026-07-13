/**
 * SHIPPED recipe registry (RFC §5, the `recipe` source kind).
 *
 * A recipe instance stores ONLY the reference — {kind: 'recipe', recipe: 'minusx/x@1',
 * bindings} — and the spec is materialized at render time from this registry. Shipped
 * recipes are app code: they can't be deleted or shadowed, so a reference is safe
 * (workspace-authored recipes, when they land, follow the RFC's materialize-always
 * rule instead). The `@1` is a behavior contract: changing a builder's output in a
 * visually meaningful way means shipping `@2` and keeping `@1` frozen.
 */
import type { ColumnFormatConfig } from '@/lib/validation/atlas-schemas';
import { VIZ_DATASET_MAIN } from './types';
import { GEO_ASSETS, GEO_BOUNDARY_DATASET, resolveGeoAsset } from './geo-assets';

export interface VizTemplateBinding {
  name: string;
  label: string;
  /** Column kinds this slot accepts (drives drop-zone hints; not enforced hard). */
  accepts: ReadonlyArray<'nominal' | 'quantitative' | 'temporal'>;
  /** Optional slots may be unbound (e.g. radar's series). */
  optional?: boolean;
  /** Multi-capable slots accept an array of columns (e.g. radar's value → one series each). */
  multi?: boolean;
}

type VizFormats = Record<string, ColumnFormatConfig> | undefined;

/** Display name for a bound column (alias wins). */
const aliasOf = (formats: VizFormats, column: string): string =>
  formats?.[column]?.alias || column;

/**
 * A vega expression rendering `ref` as a formatted number per the column's config.
 * A d3 `format` string is the vega-tier vocabulary and wins outright; the legacy
 * DOM-grid fields (decimalPoints/prefix/suffix) are honored as a fallback.
 * Strings are JSON-escaped into the expression.
 */
const numExpr = (ref: string, formats: VizFormats, column: string): string => {
  const cfg = formats?.[column];
  if (cfg?.format) return `format(${ref}, '${cfg.format.replace(/'/g, '')}')`;
  const pattern = cfg?.decimalPoints != null ? `,.${cfg.decimalPoints}f` : '.3~s';
  const core = `format(${ref}, '${pattern}')`;
  const pre = cfg?.prefix ? `${JSON.stringify(cfg.prefix)} + ` : '';
  const suf = cfg?.suffix ? ` + ${JSON.stringify(cfg.suffix)}` : '';
  return `${pre}${core}${suf}`;
};

export type VizTemplateEngine = 'vega-lite' | 'vega';

export type VizParams = Record<string, unknown> | null | undefined;

export interface VizTemplate {
  id: string;
  /** The icon-grid type this recipe implements. */
  vizType: 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'combo' | 'choropleth' | 'point_map';
  /** Grammar of the materialized spec ('vega' skips the VL compile). */
  engine: VizTemplateEngine;
  bindings: ReadonlyArray<VizTemplateBinding>;
  /** Materialize the full spec from bound column names (+ optional column formats and recipe params). */
  build(bindings: Record<string, string | string[]>, formats?: VizFormats, params?: VizParams): Record<string, unknown>;
  /**
   * Named boundary/lookup datasets this recipe references by local name (RFC §9/§12):
   * `{localDatasetName: assetId}`. The renderer resolves each asset id from the geo
   * registry and injects its features under the local name (alongside `main`). Only
   * geo recipes declare assets; everything else binds `main` alone.
   */
  assets?(bindings: Record<string, string | string[]>, params?: VizParams): Record<string, string>;
}

// ── minusx/funnel@1 ─────────────────────────────────────────────────────────────
// Tapered funnel silhouette (ECharts look): a ranged area over the stage sequence,
// single hue, stage + value/percent labels centered. Stage order = data order.
const funnel: VizTemplate = {
  id: 'minusx/funnel@1',
  vizType: 'funnel',
  engine: 'vega-lite',
  bindings: [
    { name: 'stage', label: 'Stages', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats) {
    const stage = String(bindings.stage);
    const value = String(bindings.value);
    // Data order IS the funnel order (SQL owns semantics — ORDER BY the stage
    // sequence). The tapered silhouette is a ranged area (x…x2 = ±value/2) over the
    // stage rank; linear interpolation between ranks yields the classic trapezoids.
    const y = { field: '__mx_rank', type: 'quantitative', axis: null, scale: { reverse: true, zero: false } };
    return {
      transform: [
        { aggregate: [{ op: 'sum', field: value, as: '__mx_value' }], groupby: [stage] },
        { window: [{ op: 'rank', as: '__mx_rank' }] },
        { window: [{ op: 'first_value', field: '__mx_value', as: '__mx_first' }], frame: [null, null] },
        { calculate: '-datum.__mx_value / 2', as: '__mx_x0' },
        { calculate: 'datum.__mx_value / 2', as: '__mx_x1' },
        { calculate: `${numExpr('datum.__mx_value', formats, value)} + ' (' + format(datum.__mx_value / datum.__mx_first * 100, '.1f') + '%)'`, as: '__mx_label' },
      ],
      layer: [
        {
          mark: { type: 'area', interpolate: 'linear', opacity: 0.88 },
          encoding: {
            y,
            x: { field: '__mx_x0', type: 'quantitative', axis: null },
            x2: { field: '__mx_x1' },
            color: { value: '#16a085' },
          },
        },
        {
          mark: { type: 'text', dy: -7, fontWeight: 'bold' },
          encoding: { y, x: { datum: 0, axis: null }, text: { field: stage, type: 'nominal' } },
        },
        {
          mark: { type: 'text', dy: 8 },
          encoding: { y, x: { datum: 0, axis: null }, text: { field: '__mx_label', type: 'nominal' } },
        },
      ],
    };
  },
};

// ── minusx/waterfall@1 ──────────────────────────────────────────────────────────
// Floating bars on a running total, data order preserved (waterfall order is
// semantic). Increases use the theme palette; decreases use the danger red —
// matching the classic ECharts waterfall. Value labels ride each bar.
const waterfall: VizTemplate = {
  id: 'minusx/waterfall@1',
  vizType: 'waterfall',
  engine: 'vega-lite',
  bindings: [
    { name: 'category', label: 'Steps', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats) {
    const category = String(bindings.category);
    const value = String(bindings.value);
    const yTitle = aliasOf(formats, value);
    const x = { field: category, type: 'nominal', sort: null, title: null };
    return {
      transform: [
        { aggregate: [{ op: 'sum', field: value, as: '__mx_amount' }], groupby: [category] },
        { window: [{ op: 'sum', field: '__mx_amount', as: '__mx_sum' }] },
        { calculate: 'datum.__mx_sum - datum.__mx_amount', as: '__mx_prev' },
        { calculate: `datum.__mx_amount >= 0 ? '+' + ${numExpr('datum.__mx_amount', formats, value)} : ${numExpr('datum.__mx_amount', formats, value)}`, as: '__mx_label' },
      ],
      layer: [
        {
          mark: { type: 'bar', cornerRadiusEnd: 2 },
          encoding: {
            x,
            y: { field: '__mx_prev', type: 'quantitative', title: yTitle },
            y2: { field: '__mx_sum' },
            color: {
              condition: { test: 'datum.__mx_amount < 0', value: '#c0392b' },
              value: '#16a085',
            },
          },
        },
        {
          mark: { type: 'text', dy: -8 },
          encoding: {
            x,
            y: { field: '__mx_sum', type: 'quantitative', title: yTitle },
            text: { field: '__mx_label', type: 'nominal' },
          },
        },
        // Closing Total bar (classic waterfall; palette blue like the ECharts builder).
        {
          transform: [
            { aggregate: [{ op: 'sum', field: '__mx_amount', as: '__mx_total' }] },
            { calculate: "'Total'", as: category },
          ],
          mark: { type: 'bar', cornerRadiusEnd: 2 },
          encoding: {
            x,
            y: { field: '__mx_total', type: 'quantitative', title: yTitle },
            y2: { datum: 0 },
            color: { value: '#2980b9' },
          },
        },
        {
          transform: [
            { aggregate: [{ op: 'sum', field: '__mx_amount', as: '__mx_total' }] },
            { calculate: "'Total'", as: category },
            { calculate: numExpr('datum.__mx_total', formats, value), as: '__mx_total_label' },
          ],
          mark: { type: 'text', dy: -8, fontWeight: 'bold' },
          encoding: {
            x,
            y: { field: '__mx_total', type: 'quantitative', title: yTitle },
            text: { field: '__mx_total_label', type: 'nominal' },
          },
        },
      ],
    };
  },
};


// ── minusx/radar@1 ──────────────────────────────────────────────────────────────
// NATIVE VEGA (no polar coordinates in vega-lite). Adapted from the official Vega
// radar example: angular point scale over metrics, linear radial scale, closed
// series polygons via trig, rule spokes, metric labels. Values SUM-aggregate per
// metric×series; the radial domain is [0, max] shared across metrics (bind
// pre-normalized values when metrics use different units — see the RFC on
// semantic scaling).
const radar: VizTemplate = {
  id: 'minusx/radar@1',
  vizType: 'radar',
  engine: 'vega',
  bindings: [
    { name: 'metric', label: 'Metrics', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'], multi: true },
    { name: 'series', label: 'Series', accepts: ['nominal'], optional: true },
  ],
  build(bindings, formats) {
    const metric = String(bindings.metric);
    const value = bindings.value;
    const series = bindings.series;
    const m = JSON.stringify(metric);
    const values = (Array.isArray(value) ? value : [value]).map(String);
    const multi = values.length > 1;
    const angular = (of: string) => `scale('angular', ${of}[${m}])`;
    // Multiple value columns fold into series (the measures ARE the series);
    // otherwise the optional series binding groups the rows. With neither, the
    // single series is NAMED AFTER the value column (alias when set) so the legend
    // reads like the classic ECharts radar ("revenue"), and the legend always shows.
    const seriesExpr = series && !multi
      ? `datum[${JSON.stringify(String(series))}]`
      : JSON.stringify(aliasOf(formats, values[0]));
    // Wide data: folded series names ARE column names — remap the aliased ones so
    // the legend shows display names (chained ternary over aliased columns only).
    const aliased = values.filter(v => formats?.[v]?.alias);
    const aliasRemap = aliased.length > 0
      ? [{
          type: 'formula', as: '__mx_series',
          expr: aliased.reduce(
            (acc, v) => `datum.__mx_series === ${JSON.stringify(v)} ? ${JSON.stringify(formats![v].alias)} : (${acc})`,
            'datum.__mx_series'),
        }]
      : [];
    const gridStroke = 'rgba(139, 148, 158, 0.35)'; // neutral in both modes
    const RINGS = 4;
    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        { name: 'radius', update: 'min(width, height) / 2 * 0.72' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'table',
          source: 'main',
          transform: multi
            ? [
                { type: 'fold', fields: values, as: ['__mx_series', '__mx_fold_value'] },
                ...aliasRemap,
                { type: 'aggregate', groupby: [String(metric), '__mx_series'], fields: ['__mx_fold_value'], ops: ['sum'], as: ['__mx_value'] },
              ]
            : [
                { type: 'formula', as: '__mx_series', expr: seriesExpr },
                { type: 'aggregate', groupby: [String(metric), '__mx_series'], fields: [values[0]], ops: ['sum'], as: ['__mx_value'] },
              ],
        },
        { name: 'keys', source: 'table', transform: [{ type: 'aggregate', groupby: [metric] }] },
        // grid levels for the concentric ring polygons (ECharts-style)
        { name: 'rings', transform: [{ type: 'sequence', start: 1, stop: RINGS + 1, as: 'lvl' }] },
      ],
      scales: [
        // First metric at 12 o'clock (ECharts convention): angles run from -PI/2,
        // stopping one step short of the full turn so first/last don't overlap.
        {
          name: 'angular', type: 'point', padding: 0,
          range: { signal: `[-PI/2, 3*PI/2 - 2*PI/max(1, length(data('keys')))]` },
          domain: { data: 'table', field: metric },
        },
        { name: 'radial', type: 'linear', range: [0, { signal: 'radius' }], zero: true, nice: false, domain: { data: 'table', field: '__mx_value' } },
        { name: 'color', type: 'ordinal', domain: { data: 'table', field: '__mx_series' }, range: 'category' },
      ],
      legends: [{ fill: 'color', symbolType: 'circle' }],
      marks: [
        {
          type: 'group',
          encode: { enter: { x: { signal: 'width / 2' }, y: { signal: 'height / 2' } } },
          marks: [
            // concentric grid polygons, one per level
            {
              type: 'group',
              from: { data: 'rings' },
              marks: [
                {
                  type: 'line',
                  from: { data: 'keys' },
                  encode: {
                    update: {
                      interpolate: { value: 'linear-closed' },
                      x: { signal: `radius * (parent.lvl / ${RINGS}) * cos(${angular('datum')})` },
                      y: { signal: `radius * (parent.lvl / ${RINGS}) * sin(${angular('datum')})` },
                      stroke: { value: gridStroke },
                      strokeWidth: { value: 1 },
                      fill: { value: 'rgba(139, 148, 158, 0.045)' },
                    },
                  },
                },
              ],
            },
            // spokes
            {
              type: 'rule',
              from: { data: 'keys' },
              encode: {
                update: {
                  x: { value: 0 },
                  y: { value: 0 },
                  x2: { signal: `radius * cos(${angular('datum')})` },
                  y2: { signal: `radius * sin(${angular('datum')})` },
                  stroke: { value: gridStroke },
                  strokeWidth: { value: 1 },
                },
              },
            },
            // series polygons + vertex points
            {
              type: 'group',
              from: { facet: { data: 'table', name: 'facet', groupby: '__mx_series' } },
              marks: [
                {
                  type: 'line',
                  from: { data: 'facet' },
                  encode: {
                    update: {
                      interpolate: { value: 'linear-closed' },
                      x: { signal: `scale('radial', datum.__mx_value) * cos(${angular('datum')})` },
                      y: { signal: `scale('radial', datum.__mx_value) * sin(${angular('datum')})` },
                      stroke: { scale: 'color', field: '__mx_series' },
                      strokeWidth: { value: 2 },
                      fill: { scale: 'color', field: '__mx_series' },
                      fillOpacity: { value: 0.15 },
                    },
                  },
                },
                {
                  type: 'symbol',
                  from: { data: 'facet' },
                  encode: {
                    update: {
                      x: { signal: `scale('radial', datum.__mx_value) * cos(${angular('datum')})` },
                      y: { signal: `scale('radial', datum.__mx_value) * sin(${angular('datum')})` },
                      fill: { scale: 'color', field: '__mx_series' },
                      size: { value: 35 },
                    },
                  },
                },
              ],
            },
            // metric labels
            {
              type: 'text',
              from: { data: 'keys' },
              encode: {
                update: {
                  x: { signal: `(radius + 12) * cos(${angular('datum')})` },
                  y: { signal: `(radius + 12) * sin(${angular('datum')})` },
                  text: { field: metric },
                  align: { signal: `cos(${angular('datum')}) > 0.05 ? 'left' : (cos(${angular('datum')}) < -0.05 ? 'right' : 'center')` },
                  baseline: { signal: `sin(${angular('datum')}) > 0.05 ? 'top' : (sin(${angular('datum')}) < -0.05 ? 'bottom' : 'middle')` },
                },
              },
            },
          ],
        },
      ],
    };
  },
};

// ── minusx/trend@1 ──────────────────────────────────────────────────────────────
// KPI cards on the NATIVE VEGA engine (the RFC §17 spike, recipe-first): one card
// per bound measure — big value, delta vs the comparison period, period labels,
// and a sparkline. Comparison semantics mirror computeTrendComparison exactly:
// 'last' = last vs second-to-last (includes the possibly-partial current period);
// 'previous' = second-to-last vs third-to-last with 3+ points (skips the partial
// period); exactly 2 points always compare directly. Rows are consumed in QUERY
// ORDER (SQL owns semantics — ORDER BY the date ascending).
//
// Params: compareMode ('last'|'previous'), sparkline (boolean, default true),
// valueFontSize/deltaFontSize/labelFontSize/dateFontSize (numbers — §17 requires
// independently adjustable sizes; defaults are responsive signals).
const trend: VizTemplate = {
  id: 'minusx/trend@1',
  vizType: 'trend',
  engine: 'vega',
  bindings: [
    { name: 'date', label: 'Date / Order', accepts: ['temporal', 'nominal'] },
    { name: 'value', label: 'Values', accepts: ['quantitative'], multi: true },
  ],
  build(bindings, formats, params) {
    const date = String(bindings.date);
    const values = (Array.isArray(bindings.value) ? bindings.value : [bindings.value]).map(String);
    const multi = values.length > 1;
    const p = (params ?? {}) as Record<string, unknown>;
    const compareMode = p.compareMode === 'previous' ? 'previous' : 'last';
    const sparkline = p.sparkline !== false;

    // Base row per compareMode (see computeTrendComparison): 'last' bases on the
    // final point; 'previous' on the second-to-last when 3+ points exist (the
    // 2-point case always compares the two directly).
    const baseExpr = compareMode === 'previous'
      ? 'datum.__mx_idx === (datum.__mx_n >= 3 ? datum.__mx_n - 1 : datum.__mx_n)'
      : 'datum.__mx_idx === datum.__mx_n';

    // Per-card value formatting: cards carry their ORIGINAL column in __mx_col, so
    // the format expression chains a ternary across the bound measures.
    const valueTextExpr = values.slice(1).reduce(
      (acc, v) => `datum.__mx_col === ${JSON.stringify(v)} ? ${numExpr('datum.__mx_value', formats, v)} : (${acc})`,
      numExpr('datum.__mx_value', formats, values[0]),
    );

    // Period labels: d3 time pattern from the date column's format (when it looks
    // like one), else a readable default; non-date strings pass through raw.
    const dateCfg = formats?.[date]?.format;
    const dateFmt = dateCfg && dateCfg.includes('%') ? dateCfg.replace(/'/g, '') : '%b %d, %Y';
    const fmtDate = (ref: string) => `(toDate(${ref}) ? timeFormat(toDate(${ref}), '${dateFmt}') : '' + ${ref})`;
    const pointTooltipExpr = `{'Metric': datum.__mx_series, 'Date': ${fmtDate('datum.__mx_date')}, 'Value': ${valueTextExpr}}`;

    // Folded series names ARE column names — remap aliased ones for display (same
    // chained-ternary idiom as radar). __mx_col keeps the original for formats.
    const aliased = values.filter(v => formats?.[v]?.alias);
    const aliasRemap = aliased.length > 0
      ? [{
          type: 'formula', as: '__mx_series',
          expr: aliased.reduce(
            (acc, v) => `datum.__mx_series === ${JSON.stringify(v)} ? ${JSON.stringify(formats![v].alias)} : (${acc})`,
            'datum.__mx_series'),
        }]
      : [];

    const sizeSignal = (name: string, override: unknown, responsive: string) => ({
      name,
      update: typeof override === 'number' && Number.isFinite(override) ? String(override) : responsive,
    });

    // Treat the full card as one data field: the area chart fills the vertical
    // canvas and the KPI sits inside it. This keeps tall dashboard tiles from
    // turning into a small sparkline stranded under a large block of empty space.
    const pctExpr = "(isValid(datum.__mx_prev) && datum.__mx_prev !== 0) ? (datum.__mx_value - datum.__mx_prev) / abs(datum.__mx_prev) * 100 : null";
    const deltaColor = { up: '#27ae60', down: '#c0392b', flat: '#8b949e' };

    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        sizeSignal('valueSize', p.valueFontSize, "clamp(min(bandwidth('slot') / 5.2, height * 0.17), 20, 72)"),
        sizeSignal('deltaSize', p.deltaFontSize, 'clamp(valueSize * 0.36, 11, 20)'),
        sizeSignal('labelSize', p.labelFontSize, 'clamp(valueSize * 0.28, 10, 15)'),
        sizeSignal('dateSize', p.dateFontSize, 'clamp(valueSize * 0.24, 9, 12)'),
        { name: 'plotTop', update: 'max(18, height * 0.08)' },
        { name: 'plotBottom', update: 'min(height - 22, height * 0.9)' },
        { name: 'kpiCenter', update: 'height * 0.42' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'points',
          source: 'main',
          transform: [
            { type: 'formula', as: '__mx_date', expr: `datum[${JSON.stringify(date)}]` },
            ...(multi
              ? [
                  { type: 'fold', fields: values, as: ['__mx_series', '__mx_fold_value'] },
                  { type: 'formula', as: '__mx_col', expr: 'datum.__mx_series' },
                  ...aliasRemap,
                  { type: 'aggregate', groupby: ['__mx_date', '__mx_col', '__mx_series'], fields: ['__mx_fold_value'], ops: ['sum'], as: ['__mx_value'] },
                ]
              : [
                  { type: 'formula', as: '__mx_col', expr: JSON.stringify(values[0]) },
                  { type: 'formula', as: '__mx_series', expr: JSON.stringify(aliasOf(formats, values[0])) },
                  { type: 'aggregate', groupby: ['__mx_date', '__mx_col', '__mx_series'], fields: [values[0]], ops: ['sum'], as: ['__mx_value'] },
                ]),
            { type: 'window', groupby: ['__mx_series'], ops: ['row_number'], as: ['__mx_idx'] },
            { type: 'window', groupby: ['__mx_series'], ops: ['lag', 'lag'], fields: ['__mx_value', '__mx_date'], params: [1, 1], as: ['__mx_prev', '__mx_prev_date'] },
            { type: 'joinaggregate', groupby: ['__mx_series'], ops: ['count'], as: ['__mx_n'] },
          ],
        },
      ],
      scales: [
        { name: 'slot', type: 'band', domain: { data: 'points', field: '__mx_series' }, range: 'width', paddingInner: 0.08 },
        { name: 'color', type: 'ordinal', domain: { data: 'points', field: '__mx_series' }, range: 'category' },
      ],
      marks: [
        {
          type: 'group',
          from: { facet: { data: 'points', name: 'card', groupby: '__mx_series' } },
          data: [
            {
              name: 'kpi',
              source: 'card',
              transform: [
                { type: 'filter', expr: baseExpr },
                { type: 'formula', as: '__mx_pct', expr: pctExpr },
              ],
            },
            {
              name: '__mx_latest',
              source: 'card',
              transform: [{ type: 'filter', expr: 'datum.__mx_idx === datum.__mx_n' }],
            },
          ],
          encode: {
            update: {
              x: { scale: 'slot', field: '__mx_series' },
              width: { signal: "bandwidth('slot')" },
              height: { signal: 'height' },
            },
          },
          ...(sparkline
            ? {
                scales: [
                  { name: '__mx_spark_x', type: 'point', domain: { data: 'card', field: '__mx_idx' }, range: [{ signal: "bandwidth('slot') * 0.075" }, { signal: "bandwidth('slot') * 0.95" }] },
                  { name: '__mx_spark_y', type: 'linear', domain: { data: 'card', field: '__mx_value' }, nice: true, zero: false, range: [{ signal: 'plotBottom' }, { signal: 'plotTop' }] },
                ],
              }
            : {}),
          marks: [
            ...(sparkline
              ? [
                  {
                    type: 'area',
                    name: '__mx_spark_area',
                    from: { data: 'card' },
                    encode: {
                      update: {
                        interpolate: { value: 'monotone' },
                        x: { scale: '__mx_spark_x', field: '__mx_idx' },
                        y: { scale: '__mx_spark_y', field: '__mx_value' },
                        y2: { signal: 'plotBottom' },
                        fill: { signal: "{gradient: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{offset: 0, color: scale('color', datum.__mx_series)}, {offset: 0.62, color: scale('color', datum.__mx_series)}, {offset: 1, color: 'rgba(' + rgb(scale('color', datum.__mx_series)).r + ',' + rgb(scale('color', datum.__mx_series)).g + ',' + rgb(scale('color', datum.__mx_series)).b + ',0)'}]}" },
                        fillOpacity: { value: 0.22 },
                      },
                    },
                  },
                  {
                    type: 'line',
                    name: '__mx_spark_line',
                    from: { data: 'card' },
                    encode: {
                      update: {
                        interpolate: { value: 'monotone' },
                        x: { scale: '__mx_spark_x', field: '__mx_idx' },
                        y: { scale: '__mx_spark_y', field: '__mx_value' },
                        stroke: { scale: 'color', field: '__mx_series' },
                        strokeWidth: { value: 3 },
                        strokeCap: { value: 'round' },
                        strokeJoin: { value: 'round' },
                      },
                      hover: { strokeWidth: { value: 4 } },
                    },
                  },
                  // Large transparent hit targets preserve the clean chart while
                  // making every point easy to inspect with a mouse or trackpad.
                  {
                    type: 'symbol',
                    name: '__mx_hover_points',
                    from: { data: 'card' },
                    encode: {
                      update: {
                        x: { scale: '__mx_spark_x', field: '__mx_idx' },
                        y: { scale: '__mx_spark_y', field: '__mx_value' },
                        fill: { scale: 'color', field: '__mx_series' },
                        fillOpacity: { value: 0 },
                        strokeOpacity: { value: 0 },
                        size: { value: 360 },
                        tooltip: { signal: pointTooltipExpr },
                      },
                      hover: {
                        fillOpacity: { value: 0.18 },
                        size: { value: 360 },
                      },
                    },
                  },
                  {
                    type: 'symbol',
                    name: '__mx_compare_point',
                    from: { data: 'kpi' },
                    encode: {
                      update: {
                        x: { signal: "scale('__mx_spark_x', datum.__mx_idx - 1)" },
                        y: { scale: '__mx_spark_y', field: '__mx_prev' },
                        fillOpacity: { value: 0 },
                        stroke: { scale: 'color', field: '__mx_series' },
                        strokeWidth: { value: 1.5 },
                        opacity: { signal: 'isValid(datum.__mx_prev) ? 0.65 : 0' },
                        size: { value: 95 },
                      },
                    },
                  },
                  {
                    type: 'symbol',
                    name: '__mx_latest_point',
                    from: { data: '__mx_latest' },
                    encode: {
                      update: {
                        x: { scale: '__mx_spark_x', field: '__mx_idx' },
                        y: { scale: '__mx_spark_y', field: '__mx_value' },
                        fill: { scale: 'color', field: '__mx_series' },
                        fillOpacity: { value: 0.2 },
                        size: { value: 240 },
                      },
                    },
                  },
                  {
                    type: 'symbol',
                    name: '__mx_latest_core',
                    from: { data: '__mx_latest' },
                    encode: {
                      update: {
                        x: { scale: '__mx_spark_x', field: '__mx_idx' },
                        y: { scale: '__mx_spark_y', field: '__mx_value' },
                        fill: { scale: 'color', field: '__mx_series' },
                        size: { value: 54 },
                      },
                      hover: { size: { value: 90 } },
                    },
                  },
                  // This is a readability mask, not decorative chrome: it uses the
                  // current theme surface and sits above the chart, below KPI text.
                  {
                    type: 'rect',
                    name: '__mx_kpi_plate',
                    from: { data: 'kpi' },
                    style: 'mx-trend-focus',
                    interactive: false,
                    encode: {
                      update: {
                        x: { signal: "bandwidth('slot') * 0.28" },
                        x2: { signal: "bandwidth('slot') * 0.72" },
                        y: { signal: 'kpiCenter - valueSize * 1.42' },
                        y2: { signal: 'kpiCenter + valueSize * 1.48' },
                        cornerRadius: { value: 10 },
                        fillOpacity: { value: 0.94 },
                      },
                    },
                  },
                ]
              : []),
            // KPI marks deliberately render last so the data can pass behind them
            // without compromising the number's hierarchy.
            {
              type: 'text',
              from: { data: 'kpi' },
              interactive: false,
              encode: {
                update: {
                  x: { signal: "bandwidth('slot') / 2" },
                  y: { signal: 'kpiCenter - valueSize * 0.95' },
                  align: { value: 'center' },
                  baseline: { value: 'middle' },
                  text: { signal: 'upper(datum.__mx_series)' },
                  fontSize: { signal: 'labelSize' },
                  fontWeight: { value: '600' },
                  letterSpacing: { value: 1.2 },
                  opacity: { value: 0.7 },
                },
              },
            },
            {
              type: 'text',
              from: { data: 'kpi' },
              interactive: false,
              encode: {
                update: {
                  x: { signal: "bandwidth('slot') / 2" },
                  y: { signal: 'kpiCenter' },
                  align: { value: 'center' },
                  baseline: { value: 'middle' },
                  text: { signal: valueTextExpr },
                  fontSize: { signal: 'valueSize' },
                  fontWeight: { value: 'bold' },
                  fill: { scale: 'color', field: '__mx_series' },
                },
              },
            },
            {
              type: 'text',
              from: { data: 'kpi' },
              interactive: false,
              encode: {
                update: {
                  x: { signal: "bandwidth('slot') / 2" },
                  y: { signal: 'kpiCenter + valueSize * 0.72' },
                  baseline: { value: 'middle' },
                  align: { value: 'center' },
                  text: { signal: "!isValid(datum.__mx_pct) ? '—' : (datum.__mx_pct > 0 ? '↗ ' : (datum.__mx_pct < 0 ? '↘ ' : '→ ')) + format(abs(datum.__mx_pct), '.1f') + '%'" },
                  fontSize: { signal: 'deltaSize' },
                  fontWeight: { value: 'bold' },
                  fill: { signal: `!isValid(datum.__mx_pct) ? '${deltaColor.flat}' : (datum.__mx_pct > 0 ? '${deltaColor.up}' : (datum.__mx_pct < 0 ? '${deltaColor.down}' : '${deltaColor.flat}'))` },
                },
              },
            },
            {
              type: 'text',
              from: { data: 'kpi' },
              interactive: false,
              encode: {
                update: {
                  x: { signal: "bandwidth('slot') / 2" },
                  y: { signal: 'kpiCenter + valueSize * 1.18' },
                  baseline: { value: 'middle' },
                  align: { value: 'center' },
                  text: { signal: `${fmtDate('datum.__mx_date')} + (isValid(datum.__mx_prev_date) ? ' vs ' + ${fmtDate('datum.__mx_prev_date')} : '')` },
                  fontSize: { signal: 'dateSize' },
                  opacity: { value: 0.62 },
                },
              },
            },
          ],
        },
      ],
    };
  },
};

// ── minusx/single-value@1 ───────────────────────────────────────────────────────
// One bound measure rendered as a cardless data poster. The FIRST query row owns
// the value (matching the classic single-value viz); SQL owns which row that is.
// The field alias and numeric format come from columnFormats. Typography scales to
// the container, while the optional params remain a compact customization surface:
// showLabel, label, caption, align, valueFontSize, labelFontSize, captionFontSize,
// and valueColor.
const singleValue: VizTemplate = {
  id: 'minusx/single-value@1',
  vizType: 'single_value',
  engine: 'vega',
  bindings: [
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  build(bindings, formats, params) {
    const value = String(bindings.value);
    const p = (params ?? {}) as Record<string, unknown>;
    const rawLabel = typeof p.label === 'string' ? p.label : aliasOf(formats, value);
    const label = rawLabel.toUpperCase();
    const caption = typeof p.caption === 'string' ? p.caption : '';
    const showLabel = p.showLabel !== false && label.length > 0;
    const align = p.align === 'left' || p.align === 'right' ? p.align : 'center';
    const x = align === 'left' ? 'width * 0.06' : align === 'right' ? 'width * 0.94' : 'width / 2';
    const formattedValue = numExpr('datum.__mx_value', formats, value);
    const displayValue = `isValid(datum.__mx_value) ? ${formattedValue} : '—'`;
    const valueColor = typeof p.valueColor === 'string' && p.valueColor.trim()
      ? { value: p.valueColor.trim() }
      : { signal: `scale('color', ${JSON.stringify(label || value)})` };
    const sizeSignal = (name: string, override: unknown, responsive: string) => ({
      name,
      update: typeof override === 'number' && Number.isFinite(override) ? String(override) : responsive,
    });

    return {
      autosize: { type: 'fit', contains: 'padding' },
      signals: [
        sizeSignal('valueSize', p.valueFontSize, 'clamp(min(width / 5.2, height * 0.3), 28, 112)'),
        sizeSignal('labelSize', p.labelFontSize, 'clamp(valueSize * 0.2, 10, 18)'),
        sizeSignal('captionSize', p.captionFontSize, 'clamp(valueSize * 0.17, 9, 15)'),
        { name: 'valueY', update: showLabel || caption ? 'height * 0.5' : 'height / 2' },
      ],
      data: [
        { name: 'main' },
        {
          name: 'kpi',
          source: 'main',
          transform: [
            { type: 'formula', as: '__mx_value', expr: `datum[${JSON.stringify(value)}]` },
            { type: 'window', ops: ['row_number'], as: ['__mx_idx'] },
            { type: 'filter', expr: 'datum.__mx_idx === 1' },
          ],
        },
      ],
      scales: [
        { name: 'color', type: 'ordinal', domain: [label || value], range: 'category' },
      ],
      marks: [
        ...(showLabel ? [{
          type: 'text',
          name: '__mx_label',
          interactive: false,
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY - valueSize * 0.78' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { value: label },
              fontSize: { signal: 'labelSize' },
              fontWeight: { value: 650 },
              letterSpacing: { value: 1.1 },
              opacity: { value: 0.68 },
            },
          },
        }] : []),
        {
          type: 'text',
          name: '__mx_value',
          from: { data: 'kpi' },
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { signal: displayValue },
              fontSize: { signal: `min(valueSize, width / max(length(${displayValue}) * 0.64, 1))` },
              fontWeight: { value: 700 },
              fill: valueColor,
              tooltip: { signal: `{'Metric': ${JSON.stringify(rawLabel || value)}, 'Value': ${displayValue}}` },
            },
            hover: {
              opacity: { value: 0.82 },
            },
          },
        },
        ...(caption ? [{
          type: 'text',
          name: '__mx_caption',
          interactive: false,
          encode: {
            update: {
              x: { signal: x },
              y: { signal: 'valueY + valueSize * 0.82' },
              align: { value: align },
              baseline: { value: 'middle' },
              text: { value: caption },
              fontSize: { signal: 'captionSize' },
              opacity: { value: 0.58 },
            },
          },
        }] : []),
      ],
    };
  },
};

// ── minusx/combo@1 ─────────────────────────────────────────────────────────────
// Canonical dual-axis composition: quiet bars establish magnitude, one crisp line
// carries the contrasting measure. An optional categorical split colors/groups both
// layers consistently. Both layers share an ordinal X domain and color scale while
// their Y scales resolve independently. X is intentionally ordinal:
// combo charts compare aligned periods/categories rather than interpolate a
// continuous time domain (matching the classic combo behavior).
const combo: VizTemplate = {
  id: 'minusx/combo@1',
  vizType: 'combo',
  engine: 'vega-lite',
  bindings: [
    { name: 'x', label: 'X-Axis', accepts: ['nominal', 'temporal'] },
    { name: 'bar', label: 'Bars', accepts: ['quantitative'] },
    { name: 'line', label: 'Line', accepts: ['quantitative'] },
    { name: 'series', label: 'Color / Split', accepts: ['nominal'], optional: true },
  ],
  build(bindings, formats, params) {
    const x = String(bindings.x);
    const bar = String(bindings.bar);
    const line = String(bindings.line);
    const series = typeof bindings.series === 'string' && bindings.series ? bindings.series : null;
    const p = (params ?? {}) as Record<string, unknown>;
    const barTitle = aliasOf(formats, bar);
    const lineTitle = aliasOf(formats, line);
    const xTitle = aliasOf(formats, x);
    const seriesTitle = series ? aliasOf(formats, series) : null;
    const barOpacity = typeof p.barOpacity === 'number' && Number.isFinite(p.barOpacity)
      ? Math.min(1, Math.max(0.1, p.barOpacity))
      : 0.72;
    const lineWidth = typeof p.lineWidth === 'number' && Number.isFinite(p.lineWidth)
      ? Math.min(8, Math.max(1, p.lineWidth))
      : 3;
    const linePoints = p.linePoints !== false;
    const xFormat = formats?.[x]?.format;
    const isTimeFormat = xFormat?.includes('%') === true;
    const axis = (column: string, title: string, extra?: Record<string, unknown>) => ({
      title,
      ...(formats?.[column]?.format ? { format: formats[column].format } : {}),
      ...extra,
    });
    // Combo deliberately uses an ordinal X scale so weekly/monthly periods keep
    // equal spacing. Vega otherwise treats a `%b %Y` axis.format on that ordinal
    // scale as a NUMBER format and aborts rendering. Date patterns therefore use
    // a label expression that explicitly parses the category value as a date.
    const xAxis = {
      title: xTitle,
      labelOverlap: true,
      ...(xFormat
        ? isTimeFormat
          ? { labelExpr: `utcFormat(toDate(datum.value), '${xFormat.replace(/'/g, '')}')` }
          : { format: xFormat }
        : {}),
    };
    const xEncoding = {
      field: x,
      type: 'ordinal',
      sort: null,
      axis: xAxis,
    };
    const xTooltip = {
      field: x,
      type: isTimeFormat ? 'temporal' : 'ordinal',
      title: xTitle,
      ...(xFormat ? { format: xFormat } : {}),
      ...(isTimeFormat ? { formatType: 'utc' } : {}),
    };
    const tooltip = (column: string, title: string) => [
      xTooltip,
      ...(series ? [{ field: series, type: 'nominal', title: seriesTitle }] : []),
      {
        field: column,
        type: 'quantitative',
        aggregate: 'sum',
        title,
        ...(formats?.[column]?.format ? { format: formats[column].format } : {}),
      },
    ];
    const seriesColor = (title: string) => series
      ? { field: series, type: 'nominal', title: seriesTitle, legend: { title: null } }
      : { datum: title, type: 'nominal', legend: { title: null } };

    return {
      layer: [
        {
          mark: { type: 'bar', opacity: barOpacity, tooltip: true },
          encoding: {
            x: xEncoding,
            y: {
              field: bar,
              type: 'quantitative',
              aggregate: 'sum',
              axis: axis(bar, barTitle),
            },
            color: seriesColor(barTitle),
            tooltip: tooltip(bar, barTitle),
          },
        },
        {
          mark: {
            type: 'line',
            strokeWidth: lineWidth,
            strokeCap: 'round',
            strokeJoin: 'round',
            point: linePoints ? { filled: true, size: 64 } : false,
            tooltip: true,
          },
          encoding: {
            x: xEncoding,
            y: {
              field: line,
              type: 'quantitative',
              aggregate: 'sum',
              axis: axis(line, lineTitle, { orient: 'right', grid: false }),
            },
            color: seriesColor(lineTitle),
            tooltip: tooltip(line, lineTitle),
          },
        },
      ],
      resolve: { scale: { y: 'independent' } },
    };
  },
};

// ── minusx/choropleth@1 ─────────────────────────────────────────────────────────
// Region-keyed thematic map (RFC §9): each boundary polygon is filled by a value
// looked up from the query result by region NAME. The boundary geometry is the
// primary data (one mark per region) injected from the named-asset registry under
// GEO_BOUNDARY_DATASET — never fetched from the network (§12); the query result is
// the lookup source under `main`. Two layers: a themed outline of EVERY region
// (so regions with no data still show) beneath the value-colored regions.
//
// Bindings: region (nominal, matches the boundary's name property) + value
// (quantitative). Params: mapName (world|us-states|india-states) picks the
// boundary + projection; colorScale picks the sequential color scheme.
const CHOROPLETH_SCHEMES: Record<string, string> = {
  green: 'greens',
  blue: 'blues',
  teal: 'teals',
  orange: 'oranges',
  purple: 'purples',
  'red-yellow-green': 'redyellowgreen',
  'blue-orange': 'blueorange',
};

const choropleth: VizTemplate = {
  id: 'minusx/choropleth@1',
  vizType: 'choropleth',
  engine: 'vega',
  bindings: [
    { name: 'region', label: 'Region', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  assets(_bindings, params) {
    const p = (params ?? {}) as Record<string, unknown>;
    return { [GEO_BOUNDARY_DATASET]: resolveGeoAsset(p.mapName) };
  },
  build(bindings, formats, params) {
    const region = String(bindings.region);
    const value = String(bindings.value);
    const p = (params ?? {}) as Record<string, unknown>;
    const asset = GEO_ASSETS[resolveGeoAsset(p.mapName)];
    const scheme = typeof p.colorScale === 'string' && CHOROPLETH_SCHEMES[p.colorScale]
      ? CHOROPLETH_SCHEMES[p.colorScale]
      : 'greens';
    const valueTitle = aliasOf(formats, value);
    const regionTitle = aliasOf(formats, region);
    const fmt = formats?.[value]?.format;
    // Interactive zoom (a multiplier) + pan (pixels). albersUsa can `scale`+`translate`
    // but not recenter (composite), so the projection FITS the whole boundary and
    // zoom/pan ride the `extent` (fit-to-source-boundary + extent — the proven pattern).
    // base/user split keeps interactive sets from being clobbered.
    const zoomVal = typeof p.zoom === 'number' && Number.isFinite(p.zoom) ? Math.min(40, Math.max(0.1, p.zoom)) : 1;
    const panXVal = typeof p.panX === 'number' && Number.isFinite(p.panX) ? p.panX : 0;
    const panYVal = typeof p.panY === 'number' && Number.isFinite(p.panY) ? p.panY : 0;
    const BORDER = 'rgba(139, 148, 158, 0.55)';
    const ttExpr = `{${JSON.stringify(regionTitle)}: datum.__mx_region, ${JSON.stringify(valueTitle)}: datum[${JSON.stringify(value)}]}`;

    return {
      autosize: { type: 'none' },
      signals: [
        { name: 'tx', update: 'width / 2' },
        { name: 'ty', update: 'height / 2' },
        { name: 'zoomUser', value: zoomVal !== 1 ? zoomVal : null, on: [
          { events: { type: 'wheel', consume: true }, update: 'clamp((zoomUser != null ? zoomUser : 1) * pow(1.0015, -event.deltaY), 0.2, 40)' },
        ] },
        { name: 'zoom', update: 'zoomUser != null ? zoomUser : 1' },
        { name: 'down', value: null, on: [ { events: 'pointerdown', update: 'xy()' }, { events: 'pointerup', update: 'null' } ] },
        { name: 'panStart', value: null, on: [ { events: 'pointerdown', update: '[panX, panY]' }, { events: 'pointerup', update: 'null' } ] },
        { name: 'delta', value: [0, 0], on: [ { events: 'pointermove', update: 'down ? [x() - down[0], y() - down[1]] : [0, 0]' } ] },
        { name: 'panX', value: panXVal, on: [ { events: { signal: 'delta' }, update: 'down && panStart ? panStart[0] + delta[0] : panX' } ] },
        { name: 'panY', value: panYVal, on: [ { events: { signal: 'delta' }, update: 'down && panStart ? panStart[1] + delta[1] : panY' } ] },
        // The view state VegaChart reads back and persists after interaction.
        { name: 'mxViewParams', update: '{zoom: zoom, panX: panX, panY: panY}' },
      ],
      data: [
        { name: VIZ_DATASET_MAIN },
        { name: GEO_BOUNDARY_DATASET },
        { name: 'fit_target', source: GEO_BOUNDARY_DATASET },
        // Join the value onto each boundary region by name; keep only regions WITH data.
        { name: 'choro', source: GEO_BOUNDARY_DATASET, transform: [
          { type: 'formula', as: '__mx_region', expr: `datum.properties[${JSON.stringify(asset.nameProp)}]` },
          { type: 'lookup', from: VIZ_DATASET_MAIN, key: region, fields: ['__mx_region'], values: [value], as: [value] },
          { type: 'filter', expr: `isValid(datum[${JSON.stringify(value)}])` },
        ] },
      ],
      projections: [{
        name: 'projection',
        type: asset.projection,
        fit: { signal: "data('fit_target')" },
        extent: { signal: '[[width/2 - width*zoom/2 + panX, height/2 - height*zoom/2 + panY], [width/2 + width*zoom/2 + panX, height/2 + height*zoom/2 + panY]]' },
      }],
      scales: [
        { name: 'color', type: 'linear', domain: { data: 'choro', field: value }, range: { scheme }, zero: false, nice: true },
      ],
      legends: [{ fill: 'color', title: valueTitle, ...(fmt ? { format: fmt } : {}), gradientLength: { signal: 'clamp(width - 40, 60, 240)' } }],
      marks: [{
        type: 'group', clip: true,
        encode: { update: { width: { signal: 'width' }, height: { signal: 'height' } } },
        marks: [
          // Backdrop: every region outlined (regions with no data still read).
          { type: 'shape', from: { data: GEO_BOUNDARY_DATASET }, encode: { update: { fill: { value: 'transparent' }, stroke: { value: BORDER }, strokeWidth: { value: 0.5 } } }, transform: [{ type: 'geoshape', projection: 'projection' }] },
          // Choropleth: the value-colored regions on top.
          { type: 'shape', from: { data: 'choro' }, encode: { update: { fill: { scale: 'color', field: value }, stroke: { value: BORDER }, strokeWidth: { value: 0.5 }, tooltip: { signal: ttExpr } } }, transform: [{ type: 'geoshape', projection: 'projection' }] },
        ],
      }],
    };
  },
};

// The mercator scale a point map uses at zoom 1 when a `center` is set (a region /
// large-state view). Interactive/persisted zoom is `scale / POINT_MAP_REGION_SCALE`.
export const POINT_MAP_REGION_SCALE = 1700;

// ── minusx/point-map@1 ──────────────────────────────────────────────────────────
// Coordinate map (RFC §9): point/marker rows plotted over a vector basemap backdrop
// via a projection. The query result is the primary data (`main`); the boundary is a
// light outline layer beneath (injected from the asset registry — the reverse of
// choropleth). `size` bound → bubbles; `color` bound → category palette (or a
// sequential scheme when `colorScale` is set). Binding BOTH `lat2`/`lng2` turns each
// row into an origin→destination flow line (rule marks) — same recipe, no mode toggle.
//
// Bindings: lat, lng (required), lat2, lng2 (optional destination → flows), size,
// color (optional). Params: mapName (basemap + projection), colorScale (quantitative
// color scheme).
const pointMap: VizTemplate = {
  id: 'minusx/point-map@1',
  vizType: 'point_map',
  engine: 'vega',
  bindings: [
    { name: 'lat', label: 'Latitude', accepts: ['quantitative'] },
    { name: 'lng', label: 'Longitude', accepts: ['quantitative'] },
    { name: 'lat2', label: 'End latitude', accepts: ['quantitative'], optional: true },
    { name: 'lng2', label: 'End longitude', accepts: ['quantitative'], optional: true },
    { name: 'size', label: 'Size', accepts: ['quantitative'], optional: true },
    { name: 'color', label: 'Color', accepts: ['nominal', 'quantitative'], optional: true },
  ],
  assets(_bindings, params) {
    const p = (params ?? {}) as Record<string, unknown>;
    return { [GEO_BOUNDARY_DATASET]: resolveGeoAsset(p.mapName) };
  },
  build(bindings, formats, params) {
    const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null);
    const lat = String(bindings.lat);
    const lng = String(bindings.lng);
    const lat2 = str(bindings.lat2);
    const lng2 = str(bindings.lng2);
    const size = str(bindings.size);
    const color = str(bindings.color);
    const p = (params ?? {}) as Record<string, unknown>;
    const isFlow = lat2 != null && lng2 != null;
    const scheme = typeof p.colorScale === 'string' && CHOROPLETH_SCHEMES[p.colorScale] ? CHOROPLETH_SCHEMES[p.colorScale] : null;
    // Projection controls (RFC §9). The map is a recenterable MERCATOR driven by
    // `scale` + `center` signals — the canonical vega zoomable-map pattern. (Vega's
    // projection `fit` can't frame a computed box; it only fits real source geometry.)
    // `center` [lat, lng] recenters GEOGRAPHICALLY, so it holds across basemaps
    // (states/counties/world); `zoom` scales in. With no center the projection frames
    // the DATA extent (where the points are). These same signals carry interactive
    // pan/zoom later. (choropleth keeps albersUsa + its AK/HI insets — that's a static
    // overview; a zoomable point map can't use a composite projection.)
    const zoomVal = typeof p.zoom === 'number' && Number.isFinite(p.zoom) ? Math.min(40, Math.max(0.1, p.zoom)) : 1;
    const center = Array.isArray(p.center) && p.center.length === 2
      && (p.center as unknown[]).every(n => typeof n === 'number' && Number.isFinite(n))
      ? (p.center as [number, number]) : null;
    const colorTitle = color ? aliasOf(formats, color) : '';
    const sizeTitle = size ? aliasOf(formats, size) : '';
    // mercator scale ≈ width·(180/π)/longitude-span-in-degrees. `lngE`/`latE` are the
    // data extents (computed as signals); an explicit center uses a region-level base
    // scale. Both multiply by zoom. isValid guards the no-data case.
    // Split each control into a reactive BASE (from data — frames the default view)
    // and a settable USER override (`value` + `on` — drag/wheel/buttons). `update`
    // would clobber interactive sets, so `centerLng`/`centerLat`/`scale` COMBINE them
    // (user wins). A `center` param seeds the user override; zoom seeds the user scale.
    const DEG = 57.29578;
    const centerLngBaseExpr = '(isValid(lngE[0]) ? (lngE[0] + lngE[1]) / 2 : 0)';
    const centerLatBaseExpr = '(isValid(latE[0]) ? (latE[0] + latE[1]) / 2 : 20)';
    const scaleBaseExpr = `(isValid(lngE[0]) ? min(width * ${DEG} / max(2, lngE[1] - lngE[0]), height * ${DEG} / max(2, latE[1] - latE[0])) * 0.82 : 120)`;
    const centerLngUserVal = center ? center[1] : null;
    const centerLatUserVal = center ? center[0] : null;
    const scaleUserVal = center ? Math.round(POINT_MAP_REGION_SCALE * zoomVal) : null;

    // Project each row's coordinate(s) to pixel x/y (geopoint); flows add a 2nd point.
    const geopoints: Record<string, unknown>[] = [{ type: 'geopoint', projection: 'projection', fields: [lng, lat], as: ['x', 'y'] }];
    if (isFlow) geopoints.push({ type: 'geopoint', projection: 'projection', fields: [lng2, lat2], as: ['x2', 'y2'] });

    const scales: Record<string, unknown>[] = [];
    if (color) {
      scales.push(scheme
        ? { name: 'color', type: 'linear', domain: { data: 'marks_data', field: color }, range: { scheme }, zero: false, nice: true }
        : { name: 'color', type: 'ordinal', domain: { data: 'marks_data', field: color }, range: 'category' });
    }
    if (size) {
      scales.push({ name: 'size', type: 'linear', domain: { data: 'marks_data', field: size }, range: isFlow ? [1, 8] : [40, 700], zero: !isFlow, nice: true });
    }

    const legends: Record<string, unknown>[] = [];
    if (color) legends.push({ [isFlow ? 'stroke' : 'fill']: 'color', title: colorTitle });
    if (size && !isFlow) legends.push({ size: 'size', title: sizeTitle });

    const tt = (pairs: Array<[string, string]>) =>
      '{' + pairs.map(([label, field]) => `${JSON.stringify(label)}: datum[${JSON.stringify(field)}]`).join(', ') + '}';

    let dataMark: Record<string, unknown>;
    if (isFlow) {
      const pairs: Array<[string, string]> = [
        [`${aliasOf(formats, lat)} (from)`, lat], [`${aliasOf(formats, lng)} (from)`, lng],
        [`${aliasOf(formats, lat)} (to)`, String(lat2)], [`${aliasOf(formats, lng)} (to)`, String(lng2)],
      ];
      if (color) pairs.push([colorTitle, color]);
      dataMark = {
        type: 'rule',
        from: { data: 'marks_data' },
        encode: { update: {
          x: { field: 'x' }, y: { field: 'y' }, x2: { field: 'x2' }, y2: { field: 'y2' },
          stroke: color ? { scale: 'color', field: color } : { value: '#16a085' },
          strokeWidth: size ? { scale: 'size', field: size } : { value: 1.5 },
          strokeOpacity: { value: 0.5 }, strokeCap: { value: 'round' },
          tooltip: { signal: tt(pairs) },
        } },
      };
    } else {
      const pairs: Array<[string, string]> = [[aliasOf(formats, lat), lat], [aliasOf(formats, lng), lng]];
      if (size) pairs.push([sizeTitle, size]);
      if (color) pairs.push([colorTitle, color]);
      dataMark = {
        type: 'symbol',
        from: { data: 'marks_data' },
        encode: { update: {
          x: { field: 'x' }, y: { field: 'y' },
          size: size ? { scale: 'size', field: size } : { value: 90 },
          fill: color ? { scale: 'color', field: color } : { value: '#16a085' },
          fillOpacity: { value: 0.72 }, stroke: { value: 'white' }, strokeWidth: { value: 0.4 },
          tooltip: { signal: tt(pairs) },
        } },
      };
    }

    return {
      autosize: { type: 'none' },
      signals: [
        { name: 'tx', update: 'width / 2' },
        { name: 'ty', update: 'height / 2' },
        { name: 'lngE', update: `extent(pluck(data('main'), ${JSON.stringify(lng)}))` },
        { name: 'latE', update: `extent(pluck(data('main'), ${JSON.stringify(lat)}))` },
        // Reactive defaults (frame the data). These `update` freely; the effective
        // center/scale below only fall back to them when there is no user override.
        { name: 'centerLngBase', update: centerLngBaseExpr },
        { name: 'centerLatBase', update: centerLatBaseExpr },
        { name: 'scaleBase', update: scaleBaseExpr },
        // Interactive pan (drag) + zoom (wheel). `down`/`center0` anchor the drag;
        // `delta` is the live pixel drag; the USER signals below are settable (no
        // `update` to clobber them) and win over the base.
        { name: 'down', value: null, on: [
          { events: 'pointerdown', update: 'xy()' },
          { events: 'pointerup', update: 'null' },
        ] },
        { name: 'center0', value: null, on: [
          { events: 'pointerdown', update: '[centerLng, centerLat]' },
          { events: 'pointerup', update: 'null' },
        ] },
        { name: 'delta', value: [0, 0], on: [
          { events: 'pointermove', update: 'down ? [x() - down[0], y() - down[1]] : [0, 0]' },
        ] },
        { name: 'centerLngUser', value: centerLngUserVal, on: [
          // 360° spans scale·2π pixels in mercator; drag right → view moves left.
          { events: { signal: 'delta' }, update: 'down && center0 ? center0[0] - delta[0] * 360 / (scale * 2 * PI) : centerLngUser' },
        ] },
        { name: 'centerLatUser', value: centerLatUserVal, on: [
          { events: { signal: 'delta' }, update: 'down && center0 ? clamp(center0[1] + delta[1] * 360 / (scale * 2 * PI), -80, 80) : centerLatUser' },
        ] },
        { name: 'scaleUser', value: scaleUserVal, on: [
          { events: { type: 'wheel', consume: true }, update: `clamp((scaleUser != null ? scaleUser : scaleBase * ${zoomVal}) * pow(1.0015, -event.deltaY), 40, 4000000)` },
        ] },
        // Effective view = user override if present, else the reactive base.
        { name: 'centerLng', update: 'centerLngUser != null ? centerLngUser : centerLngBase' },
        { name: 'centerLat', update: 'centerLatUser != null ? centerLatUser : centerLatBase' },
        { name: 'scale', update: `scaleUser != null ? scaleUser : scaleBase * ${zoomVal}` },
        // The view state VegaChart reads back and persists after interaction.
        { name: 'mxViewParams', update: `{center: [centerLat, centerLng], zoom: scale / ${POINT_MAP_REGION_SCALE}}` },
      ],
      data: [
        { name: 'main' },
        { name: GEO_BOUNDARY_DATASET },
        { name: 'marks_data', source: 'main', transform: geopoints },
      ],
      projections: [{
        name: 'projection',
        type: 'mercator',
        scale: { signal: 'scale' },
        center: [{ signal: 'centerLng' }, { signal: 'centerLat' }],
        translate: [{ signal: 'tx' }, { signal: 'ty' }],
      }],
      scales,
      ...(legends.length ? { legends } : {}),
      marks: [{
        type: 'group',
        clip: true,
        encode: { update: { width: { signal: 'width' }, height: { signal: 'height' } } },
        marks: [
          { type: 'shape', from: { data: GEO_BOUNDARY_DATASET }, encode: { update: { fill: { value: 'transparent' }, stroke: { value: 'rgba(139, 148, 158, 0.6)' }, strokeWidth: { value: 0.75 } } }, transform: [{ type: 'geoshape', projection: 'projection' }] },
          dataMark,
        ],
      }],
    };
  },
};

export const VIZ_TEMPLATES: Record<string, VizTemplate> = {
  [funnel.id]: funnel,
  [waterfall.id]: waterfall,
  [radar.id]: radar,
  [trend.id]: trend,
  [singleValue.id]: singleValue,
  [combo.id]: combo,
  [choropleth.id]: choropleth,
  [pointMap.id]: pointMap,
};

/** Registry lookup for a recipe source; null for unknown ids. */
export function getTemplate(recipeId: string): VizTemplate | null {
  return VIZ_TEMPLATES[recipeId] ?? null;
}

export type MaterializeResult =
  | { ok: true; spec: Record<string, unknown>; engine: VizTemplateEngine; assets?: Record<string, string> }
  | { ok: false; error: string };

/** Materialize a recipe source into its grammar spec. */
export function materializeRecipe(source: {
  recipe: string;
  bindings: Record<string, string | string[]>;
  columnFormats?: Record<string, ColumnFormatConfig> | null;
  params?: Record<string, unknown> | null;
}): MaterializeResult {
  const template = getTemplate(source.recipe);
  if (!template) {
    return { ok: false, error: `unknown recipe "${source.recipe}" — available: ${Object.keys(VIZ_TEMPLATES).join(', ')}` };
  }
  const empty = (v: string | string[] | undefined) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const missing = template.bindings.filter(b => !b.optional && empty(source.bindings[b.name]));
  if (missing.length > 0) {
    return { ok: false, error: `recipe "${source.recipe}" is missing binding${missing.length > 1 ? 's' : ''}: ${missing.map(b => b.name).join(', ')}` };
  }
  const badMulti = template.bindings.find(b => !b.multi && Array.isArray(source.bindings[b.name]));
  if (badMulti) {
    return { ok: false, error: `recipe "${source.recipe}" binding "${badMulti.name}" takes a single column, not an array` };
  }
  const assets = template.assets?.(source.bindings, source.params);
  return {
    ok: true,
    spec: template.build(source.bindings, source.columnFormats ?? undefined, source.params),
    engine: template.engine,
    ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
  };
}

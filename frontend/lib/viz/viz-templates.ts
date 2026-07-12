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
  vizType: 'funnel' | 'waterfall' | 'radar' | 'trend';
  /** Grammar of the materialized spec ('vega' skips the VL compile). */
  engine: VizTemplateEngine;
  bindings: ReadonlyArray<VizTemplateBinding>;
  /** Materialize the full spec from bound column names (+ optional column formats and recipe params). */
  build(bindings: Record<string, string | string[]>, formats?: VizFormats, params?: VizParams): Record<string, unknown>;
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

export const VIZ_TEMPLATES: Record<string, VizTemplate> = {
  [funnel.id]: funnel,
  [waterfall.id]: waterfall,
  [radar.id]: radar,
  [trend.id]: trend,
};

/** Registry lookup for a recipe source; null for unknown ids. */
export function getTemplate(recipeId: string): VizTemplate | null {
  return VIZ_TEMPLATES[recipeId] ?? null;
}

export type MaterializeResult =
  | { ok: true; spec: Record<string, unknown>; engine: VizTemplateEngine }
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
  return { ok: true, spec: template.build(source.bindings, source.columnFormats ?? undefined, source.params), engine: template.engine };
}

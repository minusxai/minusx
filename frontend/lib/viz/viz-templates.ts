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

export type VizTemplateEngine = 'vega-lite' | 'vega';

export interface VizTemplate {
  id: string;
  /** The icon-grid type this recipe implements. */
  vizType: 'funnel' | 'waterfall' | 'radar';
  /** Grammar of the materialized spec ('vega' skips the VL compile). */
  engine: VizTemplateEngine;
  bindings: ReadonlyArray<VizTemplateBinding>;
  /** Materialize the full spec from bound column names. */
  build(bindings: Record<string, string | string[]>): Record<string, unknown>;
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
  build(bindings) {
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
        { calculate: "format(datum.__mx_value, '.3~s') + ' (' + format(datum.__mx_value / datum.__mx_first * 100, '.1f') + '%)'", as: '__mx_label' },
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
  build(bindings) {
    const category = String(bindings.category);
    const value = String(bindings.value);
    const x = { field: category, type: 'nominal', sort: null, title: null };
    return {
      transform: [
        { aggregate: [{ op: 'sum', field: value, as: '__mx_amount' }], groupby: [category] },
        { window: [{ op: 'sum', field: '__mx_amount', as: '__mx_sum' }] },
        { calculate: 'datum.__mx_sum - datum.__mx_amount', as: '__mx_prev' },
        { calculate: "datum.__mx_amount >= 0 ? '+' + format(datum.__mx_amount, '.3~s') : format(datum.__mx_amount, '.3~s')", as: '__mx_label' },
      ],
      layer: [
        {
          mark: { type: 'bar', cornerRadiusEnd: 2 },
          encoding: {
            x,
            y: { field: '__mx_prev', type: 'quantitative', title: value },
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
            y: { field: '__mx_sum', type: 'quantitative', title: value },
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
            y: { field: '__mx_total', type: 'quantitative', title: value },
            y2: { datum: 0 },
            color: { value: '#2980b9' },
          },
        },
        {
          transform: [
            { aggregate: [{ op: 'sum', field: '__mx_amount', as: '__mx_total' }] },
            { calculate: "'Total'", as: category },
            { calculate: "format(datum.__mx_total, '.3~s')", as: '__mx_total_label' },
          ],
          mark: { type: 'text', dy: -8, fontWeight: 'bold' },
          encoding: {
            x,
            y: { field: '__mx_total', type: 'quantitative', title: value },
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
  build(bindings) {
    const metric = String(bindings.metric);
    const value = bindings.value;
    const series = bindings.series;
    const m = JSON.stringify(metric);
    const values = (Array.isArray(value) ? value : [value]).map(String);
    const multi = values.length > 1;
    const angular = (of: string) => `scale('angular', ${of}[${m}])`;
    // Multiple value columns fold into series (the measures ARE the series);
    // otherwise the optional series binding groups the rows. With neither, the
    // single series is NAMED AFTER the value column so the legend reads like the
    // classic ECharts radar ("revenue"), and the legend always shows.
    const seriesExpr = series && !multi
      ? `datum[${JSON.stringify(String(series))}]`
      : JSON.stringify(values[0]);
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

export const VIZ_TEMPLATES: Record<string, VizTemplate> = {
  [funnel.id]: funnel,
  [waterfall.id]: waterfall,
  [radar.id]: radar,
};

/** Registry lookup for a recipe source; null for unknown ids. */
export function getTemplate(recipeId: string): VizTemplate | null {
  return VIZ_TEMPLATES[recipeId] ?? null;
}

export type MaterializeResult =
  | { ok: true; spec: Record<string, unknown>; engine: VizTemplateEngine }
  | { ok: false; error: string };

/** Materialize a recipe source into its grammar spec. */
export function materializeRecipe(source: { recipe: string; bindings: Record<string, string | string[]> }): MaterializeResult {
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
  return { ok: true, spec: template.build(source.bindings), engine: template.engine };
}

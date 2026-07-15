/**
 * Shared multi-series tooltip (Viz Arch V2) — the ECharts "axis tooltip" for V2 cartesian
 * charts: hovering an x shows EVERY series at that x with a color swatch, not just the one
 * mark under the cursor. This module is the PURE core (plan + aggregation + HTML); the DOM
 * handler + color scale + vertical guide line live in `VegaChart` (browser).
 *
 * A `TooltipPlan` describes how to read series from the query result:
 *   - `wide`      — series are COLUMNS (a multi-measure fold, or a single measure). One row per x.
 *   - `long`      — series come from a color COLUMN's values; the measure is one column. N rows per x.
 *   - `bins`      — histogram: x buckets are BINS over the measure (vega's own `bin` math, so
 *                   the tooltip's buckets are exactly the drawn bars); one Count row per bin.
 *   - `stats`     — boxplot: rows are the five-number summary per category (vega's `quartiles`
 *                   + 1.5·IQR whiskers clamped to the data — exactly what VL draws).
 *   - `waterfall` — the waterfall recipe: per step, the signed change + running total, plus
 *                   the closing Total entry. Row colors mirror the recipe's bar colors.
 * `null` from `buildTooltipPlan` means "not a shared-tooltip chart" (pie, maps, row) → the
 * caller keeps the default per-mark tooltip.
 */
import * as vegaExports from 'vega';
import { WATERFALL_UP_COLOR, WATERFALL_DOWN_COLOR, WATERFALL_TOTAL_COLOR } from './viz-templates';

// vega re-exports vega-statistics (bin, quartiles) at runtime, but its .d.ts omits them.
// Using vega's own math keeps the tooltip's buckets/stats EXACTLY what the chart draws.
const { bin: vegaBin, quartiles: vegaQuartiles } = vegaExports as unknown as {
  bin: (opts: { extent: [number, number]; maxbins?: number }) => { start: number; stop: number; step: number };
  quartiles: (values: number[]) => [number, number, number];
};

export interface TooltipSeriesRef {
  /** Query-result column for a wide series (fold field / single measure). */
  field: string;
  /** Display label. */
  label: string;
  /** Key to look the swatch color up by in the chart's `color` scale. */
  colorKey: string;
}

export type TooltipSeries =
  | { kind: 'wide'; series: TooltipSeriesRef[] }
  | { kind: 'long'; colorField: string; valueField: string }
  | { kind: 'bins'; valueField: string; maxbins: number }
  | { kind: 'stats'; valueField: string; label: string }
  | { kind: 'waterfall'; categoryField: string; valueField: string; valueLabel: string };

export interface TooltipPlan {
  xField: string;
  xTitle: string;
  xFormat?: string;
  xTemporal: boolean;
  valueFormat?: string;
  series: TooltipSeries;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const markType = (spec: Record<string, unknown>): string | null => {
  const m = spec.mark;
  if (typeof m === 'string') return m;
  const mo = asRecord(m);
  return typeof mo?.type === 'string' ? mo.type : null;
};

const channel = (spec: Record<string, unknown>, ch: string): Record<string, unknown> | null =>
  asRecord((spec.encoding as Record<string, unknown> | undefined)?.[ch]);

/** The fold transform whose folded value feeds y (mirrors encoding-edit's findYFold). */
const foldFields = (spec: Record<string, unknown>, yField: string): string[] | null => {
  const transforms = spec.transform;
  if (!Array.isArray(transforms)) return null;
  for (const t of transforms) {
    const tr = asRecord(t);
    if (!tr || !Array.isArray(tr.fold)) continue;
    const as = (Array.isArray(tr.as) ? tr.as : ['key', 'value']) as string[];
    if (as[1] === yField) return tr.fold as string[];
  }
  return null;
};

/**
 * Build a shared-tooltip plan from a unit Vega-Lite spec, or null when the chart isn't a
 * shared-x cartesian (line/area/bar with a categorical/temporal x).
 */
/** Combo recipe: layered bar+line with independent Y over a shared x → a dual-measure plan. */
function comboPlan(spec: Record<string, unknown>): TooltipPlan | null {
  const layers = spec.layer;
  if (!Array.isArray(layers)) return null;
  const resolve = (spec.resolve as { scale?: { y?: unknown } } | undefined)?.scale?.y;
  if (resolve !== 'independent') return null;
  const units = layers.filter((l): l is Record<string, unknown> => asRecord(l) != null);
  const bar = units.find(l => markType(l) === 'bar');
  const line = units.find(l => markType(l) === 'line');
  if (!bar || !line) return null;
  const bx = channel(bar, 'x'), by = channel(bar, 'y'), ly = channel(line, 'y');
  if (typeof bx?.field !== 'string' || typeof by?.field !== 'string' || typeof ly?.field !== 'string') return null;
  const label = (l: Record<string, unknown>, fallback: string): string => {
    const datum = (l.encoding as { color?: { datum?: unknown } } | undefined)?.color?.datum;
    return typeof datum === 'string' ? datum : fallback;
  };
  const bxAxis = asRecord(bx.axis);
  return {
    xField: bx.field,
    xTitle: typeof bxAxis?.title === 'string' ? bxAxis.title : bx.field,
    xFormat: typeof bxAxis?.format === 'string' ? bxAxis.format : undefined,
    xTemporal: bx.type === 'temporal',
    valueFormat: typeof asRecord(by.axis)?.format === 'string' ? (asRecord(by.axis)!.format as string) : undefined,
    series: { kind: 'wide', series: [
      { field: by.field, label: label(bar, by.field), colorKey: label(bar, by.field) },
      { field: ly.field, label: label(line, ly.field), colorKey: label(line, ly.field) },
    ] },
  };
}

/**
 * The waterfall recipe's built spec: a layer whose bar floats between the running-total
 * window fields. Detected structurally (materialized specs, not envelopes, reach here).
 */
function waterfallPlan(spec: Record<string, unknown>): TooltipPlan | null {
  const layers = spec.layer;
  if (!Array.isArray(layers)) return null;
  const bar = layers.map(asRecord).find(l =>
    l != null && markType(l) === 'bar' &&
    channel(l, 'y')?.field === '__mx_prev' && (channel(l, 'y2') as { field?: unknown } | null)?.field === '__mx_sum');
  if (!bar) return null;
  const x = channel(bar, 'x');
  if (!x || typeof x.field !== 'string') return null;
  // The tooltip reads RAW rows, so it needs the ORIGINAL value column — recover it from
  // the recipe's aggregate transform (sum(value) → __mx_amount).
  let valueField: string | null = null;
  const transforms = Array.isArray(spec.transform) ? spec.transform : [];
  for (const t of transforms) {
    const agg = asRecord(t)?.aggregate;
    const first = Array.isArray(agg) ? asRecord(agg[0]) : null;
    if (first?.as === '__mx_amount' && typeof first.field === 'string') valueField = first.field;
  }
  if (!valueField) return null;
  // Display titles ride the recipe's authored tooltip encoding (alias-aware).
  const tips = (bar.encoding as { tooltip?: Array<{ field?: string; title?: string }> } | undefined)?.tooltip;
  const catTitle = tips?.find(t => t.field === x.field)?.title;
  const valueLabel = tips?.find(t => t.field === '__mx_amount')?.title ?? valueField;
  return {
    xField: x.field,
    xTitle: typeof catTitle === 'string' ? catTitle : x.field,
    xTemporal: false,
    series: { kind: 'waterfall', categoryField: x.field, valueField, valueLabel: String(valueLabel) },
  };
}

export function buildTooltipPlan(spec: Record<string, unknown>): TooltipPlan | null {
  const combo = comboPlan(spec);
  if (combo) return combo;
  const waterfall = waterfallPlan(spec);
  if (waterfall) return waterfall;

  const mark = markType(spec);
  if (mark !== 'line' && mark !== 'area' && mark !== 'bar' && mark !== 'point' && mark !== 'boxplot') return null;

  const x = channel(spec, 'x');
  const y = channel(spec, 'y');
  if (!x || typeof x.field !== 'string') return null;

  // Histogram: the measure binned along x, count on y — bucket rows with vega's own
  // bin math so the tooltip's buckets are exactly the drawn bars.
  if (mark === 'bar' && x.bin != null && x.bin !== false) {
    const binOpts = asRecord(x.bin);
    const maxbins = typeof binOpts?.maxbins === 'number' ? binOpts.maxbins : 10;
    return {
      xField: x.field,
      xTitle: typeof x.title === 'string' ? x.title : x.field,
      xTemporal: false,
      series: { kind: 'bins', valueField: x.field, maxbins },
    };
  }

  if (!y || typeof y.field !== 'string') return null;
  // An unbinned quantitative x on a BAR is the row/misfit shape — no shared axis.
  if (mark === 'bar' && x.type === 'quantitative') return null;

  // Boxplot: the composite mark aggregates internally; the tooltip mirrors it with the
  // five-number summary per category (quartiles + 1.5·IQR whiskers, computed like VL's).
  if (mark === 'boxplot') {
    const label = typeof y.title === 'string' ? y.title : y.field;
    return {
      xField: x.field,
      xTitle: typeof x.title === 'string' ? x.title : x.field,
      xTemporal: x.type === 'temporal',
      series: { kind: 'stats', valueField: y.field, label },
    };
  }

  const xField = x.field;
  const xTitle = typeof x.title === 'string' ? x.title : xField;
  const xAxis = asRecord(x.axis);
  const xFormat = typeof xAxis?.format === 'string' ? xAxis.format : undefined;
  const yAxis = asRecord(y.axis);
  const valueFormat = typeof yAxis?.format === 'string' ? yAxis.format : undefined;

  const color = channel(spec, 'color');
  const yTitle = typeof y.title === 'string' ? y.title : y.field;

  let series: TooltipSeries;
  const fold = foldFields(spec, y.field);
  if (fold && fold.length > 0) {
    // Multi-measure fold: series ARE the folded columns (colorKey = the __mx_key value = field name).
    series = { kind: 'wide', series: fold.map(f => ({ field: f, label: f, colorKey: f })) };
  } else if (typeof color?.field === 'string' && color.field !== y.field) {
    // A real category column drives the series (long data — N rows per x).
    series = { kind: 'long', colorField: color.field, valueField: y.field };
  } else {
    // Single measure: one wide series named after the measure (its injected legend color key).
    series = { kind: 'wide', series: [{ field: y.field, label: yTitle, colorKey: yTitle }] };
  }

  return { xField, xTitle, xFormat, xTemporal: x.type === 'temporal', valueFormat, series };
}

export interface TooltipRow {
  label: string;
  value: number;
  /** Key to resolve the swatch from the chart's color scale. */
  colorKey: string;
  /** Explicit swatch color — wins over the colorKey lookup (waterfall sign colors). */
  color?: string;
}

export interface TooltipEntry {
  /** Raw x value (for formatting the header; bins pre-format it to "start – end"). */
  xRaw: unknown;
  /** Value to run through the x SCALE for guide positioning, when it differs from
   *  xRaw (bin midpoints — xRaw is the range label, xPlot the numeric center). */
  xPlot?: number;
  /** Series rows at this x. */
  rows: TooltipRow[];
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A stable x key. Temporal x is normalized to its epoch so a `Date` (Vega-Lite parses
 * temporal fields to Dates in the view) and its raw ISO string map to the SAME bucket.
 */
const xKey = (raw: unknown, plan: TooltipPlan): string => {
  if (plan.xTemporal) {
    const t = +new Date(raw as string | number | Date);
    if (!Number.isNaN(t)) return String(t);
  }
  return String(raw);
};

/** The x key for a hovered datum (matches `buildTooltipData`'s keys). */
export function tooltipXKey(datum: Record<string, unknown> | null | undefined, plan: TooltipPlan): string {
  return xKey(datum?.[plan.xField], plan);
}

/** Trim float dust off nice bin edges (steps are 1/2/2.5/5 ×10^k, so 6 digits suffice). */
const fmtBinEdge = (n: number): string => String(+n.toFixed(6));

/** Histogram: bucket raw values with vega's bin math; one non-empty entry per bin. */
function binsData(rows: Array<Record<string, unknown>>, series: Extract<TooltipSeries, { kind: 'bins' }>): Map<string, TooltipEntry> {
  const index = new Map<string, TooltipEntry>();
  const values = rows.map(r => Number(r[series.valueField])).filter(Number.isFinite);
  if (values.length === 0) return index;
  const { start, stop, step } = vegaBin({ extent: [Math.min(...values), Math.max(...values)], maxbins: series.maxbins });
  const nBins = Math.max(1, Math.round((stop - start) / step));
  for (let i = 0; i < nBins; i++) {
    const b0 = start + i * step;
    const b1 = start + (i + 1) * step;
    // Vega buckets [b0, b1), except the last bin which also takes v === stop.
    const count = values.filter(v => v >= b0 && (v < b1 || (i === nBins - 1 && v <= b1))).length;
    if (count === 0) continue; // no bar drawn → nothing to snap the guide to
    const label = `${fmtBinEdge(b0)} – ${fmtBinEdge(b1)}`;
    index.set(label, { xRaw: label, xPlot: b0 + step / 2, rows: [{ label: 'Count', value: count, colorKey: 'Count' }] });
  }
  return index;
}

/** Boxplot: five-number summary per category — vega quartiles, whiskers at 1.5·IQR clamped to data. */
function statsData(rows: Array<Record<string, unknown>>, plan: TooltipPlan, series: Extract<TooltipSeries, { kind: 'stats' }>): Map<string, TooltipEntry> {
  const index = new Map<string, TooltipEntry>();
  const groups = new Map<string, { xRaw: unknown; values: number[] }>();
  for (const row of rows) {
    const xRaw = row[plan.xField];
    const key = xKey(xRaw, plan);
    if (!groups.has(key)) groups.set(key, { xRaw, values: [] });
    const v = Number(row[series.valueField]);
    if (Number.isFinite(v)) groups.get(key)!.values.push(v);
  }
  for (const [key, g] of groups) {
    if (g.values.length === 0) continue;
    const sorted = [...g.values].sort((a, b) => a - b);
    const [q1, median, q3] = vegaQuartiles(sorted);
    const iqr = q3 - q1;
    const lo = sorted.find(v => v >= q1 - 1.5 * iqr) ?? sorted[0];
    const hi = [...sorted].reverse().find(v => v <= q3 + 1.5 * iqr) ?? sorted[sorted.length - 1];
    const k = series.label;
    index.set(key, { xRaw: g.xRaw, rows: [
      { label: 'Max', value: hi, colorKey: k },
      { label: 'Q3', value: q3, colorKey: k },
      { label: 'Median', value: median, colorKey: k },
      { label: 'Q1', value: q1, colorKey: k },
      { label: 'Min', value: lo, colorKey: k },
    ] });
  }
  return index;
}

/** Waterfall: per step the signed change + running total; a closing Total entry. */
function waterfallData(rows: Array<Record<string, unknown>>, plan: TooltipPlan, series: Extract<TooltipSeries, { kind: 'waterfall' }>): Map<string, TooltipEntry> {
  const index = new Map<string, TooltipEntry>();
  const sums = new Map<string, { xRaw: unknown; sum: number }>(); // first-seen = waterfall order
  for (const row of rows) {
    const xRaw = row[series.categoryField];
    const key = xKey(xRaw, plan);
    if (!sums.has(key)) sums.set(key, { xRaw, sum: 0 });
    sums.get(key)!.sum += toNum(row[series.valueField]);
  }
  let running = 0;
  for (const [key, g] of sums) {
    running += g.sum;
    index.set(key, { xRaw: g.xRaw, rows: [
      { label: series.valueLabel, value: g.sum, colorKey: series.valueLabel, color: g.sum < 0 ? WATERFALL_DOWN_COLOR : WATERFALL_UP_COLOR },
      { label: 'Running total', value: running, colorKey: 'Running total' },
    ] });
  }
  if (sums.size > 0) {
    index.set('Total', { xRaw: 'Total', rows: [
      { label: series.valueLabel, value: running, colorKey: series.valueLabel, color: WATERFALL_TOTAL_COLOR },
    ] });
  }
  return index;
}

/**
 * Index the query result by x, summing each series' value (matching VL's SUM aggregation).
 * Series order is preserved: fold/measure order for `wide`, first-seen for `long`.
 * Bins/stats/waterfall aggregate the whole result to mirror what their chart draws.
 */
export function buildTooltipData(rows: Array<Record<string, unknown>>, plan: TooltipPlan): Map<string, TooltipEntry> {
  if (plan.series.kind === 'bins') return binsData(rows, plan.series);
  if (plan.series.kind === 'stats') return statsData(rows, plan, plan.series);
  if (plan.series.kind === 'waterfall') return waterfallData(rows, plan, plan.series);

  const index = new Map<string, TooltipEntry>();
  const acc = new Map<string, Map<string, { label: string; value: number; colorKey: string }>>();

  for (const row of rows) {
    const xRaw = row[plan.xField];
    const key = xKey(xRaw, plan);
    if (!index.has(key)) { index.set(key, { xRaw, rows: [] }); acc.set(key, new Map()); }
    const bucket = acc.get(key)!;

    if (plan.series.kind === 'wide') {
      for (const s of plan.series.series) {
        const prev = bucket.get(s.colorKey);
        const value = toNum(row[s.field]) + (prev?.value ?? 0);
        bucket.set(s.colorKey, { label: s.label, value, colorKey: s.colorKey });
      }
    } else {
      const seriesKey = String(row[plan.series.colorField]);
      const prev = bucket.get(seriesKey);
      const value = toNum(row[plan.series.valueField]) + (prev?.value ?? 0);
      bucket.set(seriesKey, { label: seriesKey, value, colorKey: seriesKey });
    }
  }

  for (const [key, entry] of index) entry.rows = [...acc.get(key)!.values()];
  return index;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export interface RenderTooltipOptions {
  xTitle: string;
  /** Resolve a series' swatch color from its colorKey. */
  colorFor: (colorKey: string) => string;
  /** Format the x header value. */
  formatX: (xRaw: unknown) => string;
  /** Format a series value. */
  formatValue: (value: number) => string;
  /** Sort series by value descending (ECharts default); else keep plan order. */
  sortByValue?: boolean;
}

/**
 * Render the shared tooltip's inner HTML: an x header, then one row per series with a color
 * swatch, name, and value. Styled by the `#vg-tooltip-element` rules in globals.css.
 */
export function renderSharedTooltipHtml(entry: TooltipEntry, opts: RenderTooltipOptions): string {
  const rows = opts.sortByValue === false ? entry.rows : [...entry.rows].sort((a, b) => b.value - a.value);
  const header =
    `<div class="mx-tt-head">${escapeHtml(opts.xTitle)} · ${escapeHtml(opts.formatX(entry.xRaw))}</div>`;
  const body = rows.map(r => {
    const swatch = `<span class="mx-tt-dot" style="background:${escapeHtml(r.color ?? opts.colorFor(r.colorKey))}"></span>`;
    return `<div class="mx-tt-row">${swatch}<span class="mx-tt-name">${escapeHtml(r.label)}</span>` +
      `<span class="mx-tt-val">${escapeHtml(opts.formatValue(r.value))}</span></div>`;
  }).join('');
  return `${header}${body}`;
}

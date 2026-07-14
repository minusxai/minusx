/**
 * Shared multi-series tooltip (Viz Arch V2) — the ECharts "axis tooltip" for V2 cartesian
 * charts: hovering an x shows EVERY series at that x with a color swatch, not just the one
 * mark under the cursor. This module is the PURE core (plan + aggregation + HTML); the DOM
 * handler + color scale + vertical guide line live in `VegaChart` (browser).
 *
 * A `TooltipPlan` describes how to read series from the query result:
 *   - `wide`  — series are COLUMNS (a multi-measure fold, or a single measure). One row per x.
 *   - `long`  — series come from a color COLUMN's values; the measure is one column. N rows per x.
 * `null` from `buildTooltipPlan` means "not a shared-tooltip chart" (pie, scatter, maps, a
 * quantitative x histogram/row) → the caller keeps the default per-mark tooltip.
 */

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
  | { kind: 'long'; colorField: string; valueField: string };

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
export function buildTooltipPlan(spec: Record<string, unknown>): TooltipPlan | null {
  const mark = markType(spec);
  if (mark !== 'line' && mark !== 'area' && mark !== 'bar') return null;

  const x = channel(spec, 'x');
  const y = channel(spec, 'y');
  if (!x || typeof x.field !== 'string' || !y || typeof y.field !== 'string') return null;
  // A quantitative x (scatter-like, histogram, row) has no shared category to group by.
  if (x.type === 'quantitative') return null;

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

export interface TooltipEntry {
  /** Raw x value (for formatting the header). */
  xRaw: unknown;
  /** Series rows at this x: label, summed value, and the color-scale key. */
  rows: Array<{ label: string; value: number; colorKey: string }>;
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

/**
 * Index the query result by x, summing each series' value (matching VL's SUM aggregation).
 * Series order is preserved: fold/measure order for `wide`, first-seen for `long`.
 */
export function buildTooltipData(rows: Array<Record<string, unknown>>, plan: TooltipPlan): Map<string, TooltipEntry> {
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
    const swatch = `<span class="mx-tt-dot" style="background:${escapeHtml(opts.colorFor(r.colorKey))}"></span>`;
    return `<div class="mx-tt-row">${swatch}<span class="mx-tt-name">${escapeHtml(r.label)}</span>` +
      `<span class="mx-tt-val">${escapeHtml(opts.formatValue(r.value))}</span></div>`;
  }).join('');
  return `${header}${body}`;
}

/**
 * Shared multi-series tooltip core (Viz Arch V2). The plan classifies a spec's series
 * shape (wide fold / single / long color-column), the aggregator sums each series per x,
 * and the renderer emits swatch+name+value rows — all pure (DOM lives in VegaChart).
 */
import { describe, it, expect } from 'vitest';
import { buildTooltipPlan, buildTooltipData, tooltipXKey, renderSharedTooltipHtml } from '../tooltip-plan';
import { materializeRecipe, WATERFALL_UP_COLOR, WATERFALL_DOWN_COLOR, WATERFALL_TOTAL_COLOR } from '../viz-templates';

const foldArea = {
  mark: { type: 'area' },
  transform: [{ fold: ['new_users', 'returning_users'], as: ['__mx_key', '__mx_value'] }],
  encoding: {
    x: { field: 'week', type: 'temporal', axis: { format: '%b %d' } },
    y: { field: '__mx_value', type: 'quantitative', axis: { format: ',.0f' } },
    color: { field: '__mx_key', type: 'nominal' },
  },
};

const singleLine = {
  mark: { type: 'line' },
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative', title: 'Revenue' },
  },
};

const colorBar = {
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'date', type: 'nominal' },
    y: { field: 'sessions', type: 'quantitative' },
    color: { field: 'platform', type: 'nominal' },
  },
};

describe('buildTooltipPlan', () => {
  it('folded multi-measure → wide series (the folded columns)', () => {
    const plan = buildTooltipPlan(foldArea)!;
    expect(plan.xField).toBe('week');
    expect(plan.xTemporal).toBe(true);
    expect(plan.xFormat).toBe('%b %d');
    expect(plan.valueFormat).toBe(',.0f');
    expect(plan.series).toEqual({ kind: 'wide', series: [
      { field: 'new_users', label: 'new_users', colorKey: 'new_users' },
      { field: 'returning_users', label: 'returning_users', colorKey: 'returning_users' },
    ] });
  });

  it('single measure → one wide series named after the measure', () => {
    const plan = buildTooltipPlan(singleLine)!;
    expect(plan.series).toEqual({ kind: 'wide', series: [{ field: 'revenue', label: 'Revenue', colorKey: 'Revenue' }] });
  });

  it('a real color column → long series', () => {
    const plan = buildTooltipPlan(colorBar)!;
    expect(plan.series).toEqual({ kind: 'long', colorField: 'platform', valueField: 'sessions' });
  });

  it('combo (layered bar+line, independent Y) → two wide series labelled by their color datum', () => {
    const combo = {
      resolve: { scale: { y: 'independent' } },
      layer: [
        { mark: { type: 'bar' }, encoding: { x: { field: 'month', type: 'ordinal', axis: { title: 'Month' } }, y: { field: 'revenue', type: 'quantitative' }, color: { datum: 'Revenue' } } },
        { mark: { type: 'line' }, encoding: { x: { field: 'month', type: 'ordinal' }, y: { field: 'orders', type: 'quantitative' }, color: { datum: 'Orders' } } },
      ],
    };
    const plan = buildTooltipPlan(combo)!;
    expect(plan.xField).toBe('month');
    expect(plan.xTitle).toBe('Month');
    expect(plan.series).toEqual({ kind: 'wide', series: [
      { field: 'revenue', label: 'Revenue', colorKey: 'Revenue' },
      { field: 'orders', label: 'Orders', colorKey: 'Orders' },
    ] });
  });

  it('returns null for non-shared charts (pie, row-shaped bar, no x)', () => {
    expect(buildTooltipPlan({ mark: { type: 'arc' }, encoding: { theta: { field: 'v' } } })).toBeNull();
    // Unbinned quantitative x on a BAR is the row/misfit shape, not a shared-x chart.
    expect(buildTooltipPlan({ mark: { type: 'bar' }, encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'b', type: 'quantitative' } } })).toBeNull();
    expect(buildTooltipPlan({ mark: { type: 'line' }, encoding: { y: { field: 'b', type: 'quantitative' } } })).toBeNull();
  });

  it('scatter (point mark, quantitative x) → single wide series', () => {
    const plan = buildTooltipPlan({ mark: { type: 'point' }, encoding: {
      x: { field: 'height', type: 'quantitative' },
      y: { field: 'weight', type: 'quantitative' },
    } })!;
    expect(plan.xField).toBe('height');
    expect(plan.series).toEqual({ kind: 'wide', series: [{ field: 'weight', label: 'weight', colorKey: 'weight' }] });
  });

  it('scatter with a color column → long series', () => {
    const plan = buildTooltipPlan({ mark: { type: 'point' }, encoding: {
      x: { field: 'height', type: 'quantitative' },
      y: { field: 'weight', type: 'quantitative' },
      color: { field: 'species', type: 'nominal' },
    } })!;
    expect(plan.series).toEqual({ kind: 'long', colorField: 'species', valueField: 'weight' });
  });

  it('histogram (binned x, count y) → bins plan', () => {
    const plan = buildTooltipPlan({ mark: { type: 'bar' }, encoding: {
      x: { field: 'price', type: 'quantitative', bin: true },
      y: { aggregate: 'count', type: 'quantitative' },
    } })!;
    expect(plan.xField).toBe('price');
    expect(plan.series).toEqual({ kind: 'bins', valueField: 'price', maxbins: 10 });
  });

  it('histogram with maxbins carries it into the plan', () => {
    const plan = buildTooltipPlan({ mark: { type: 'bar' }, encoding: {
      x: { field: 'price', type: 'quantitative', bin: { maxbins: 20 } },
      y: { aggregate: 'count', type: 'quantitative' },
    } })!;
    expect(plan.series).toEqual({ kind: 'bins', valueField: 'price', maxbins: 20 });
  });

  it('boxplot → stats plan labelled after the measure', () => {
    const plan = buildTooltipPlan({ mark: { type: 'boxplot' }, encoding: {
      x: { field: 'platform', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative', title: 'Revenue' },
    } })!;
    expect(plan.xField).toBe('platform');
    expect(plan.series).toEqual({ kind: 'stats', valueField: 'revenue', label: 'Revenue' });
  });

  it('the waterfall recipe spec → waterfall plan (detected from the built layers)', () => {
    const resolved = materializeRecipe({ recipe: 'minusx/waterfall@1', bindings: { category: 'step', value: 'amount' } });
    if (!resolved.ok) throw new Error(resolved.error);
    const plan = buildTooltipPlan(resolved.spec)!;
    expect(plan.xField).toBe('step');
    expect(plan.series).toEqual({ kind: 'waterfall', categoryField: 'step', valueField: 'amount', valueLabel: 'amount' });
  });
});

describe('buildTooltipData', () => {
  it('wide: reads each series column, one entry per x', () => {
    const plan = buildTooltipPlan(foldArea)!;
    const idx = buildTooltipData([
      { week: 'W1', new_users: 10, returning_users: 5 },
      { week: 'W2', new_users: 20, returning_users: 8 },
    ], plan);
    expect([...idx.keys()]).toEqual(['W1', 'W2']);
    expect(idx.get('W1')!.rows).toEqual([
      { label: 'new_users', value: 10, colorKey: 'new_users' },
      { label: 'returning_users', value: 5, colorKey: 'returning_users' },
    ]);
  });

  it('long: groups by the color column and SUMS duplicate (x, series) rows', () => {
    const plan = buildTooltipPlan(colorBar)!;
    const idx = buildTooltipData([
      { date: 'D1', platform: 'ios', sessions: 3 },
      { date: 'D1', platform: 'ios', sessions: 4 }, // same (x, series) → summed
      { date: 'D1', platform: 'web', sessions: 2 },
    ], plan);
    expect(idx.get('D1')!.rows).toEqual([
      { label: 'ios', value: 7, colorKey: 'ios' },
      { label: 'web', value: 2, colorKey: 'web' },
    ]);
  });
});

describe('buildTooltipData — bins (histogram)', () => {
  const plan = buildTooltipPlan({ mark: { type: 'bar' }, encoding: {
    x: { field: 'price', type: 'quantitative', bin: true },
    y: { aggregate: 'count', type: 'quantitative' },
  } })!;

  it('buckets rows with vega bin math (nice bins), skipping empty bins', () => {
    const idx = buildTooltipData([
      { price: 1 }, { price: 2 }, { price: 11 }, { price: 95 },
    ], plan);
    // extent [1,95], maxbins 10 → vega nice bins [0,100] step 10
    const entries = [...idx.values()];
    expect(entries.map(e => e.xRaw)).toEqual(['0 – 10', '10 – 20', '90 – 100']);
    expect(entries.map(e => e.rows[0].value)).toEqual([2, 1, 1]);
    // the guide positions on the bin CENTER via xPlot
    expect(entries.map(e => e.xPlot)).toEqual([5, 15, 95]);
  });

  it('one Count row per bin', () => {
    const idx = buildTooltipData([{ price: 3 }], plan);
    expect([...idx.values()][0].rows).toEqual([{ label: 'Count', value: 1, colorKey: 'Count' }]);
  });
});

describe('buildTooltipData — stats (boxplot)', () => {
  const plan = buildTooltipPlan({ mark: { type: 'boxplot' }, encoding: {
    x: { field: 'platform', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative', title: 'Revenue' },
  } })!;

  it('computes the five-number summary per category (vega quartiles + clamped whiskers)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ platform: 'ios', revenue: i + 1 }));
    const idx = buildTooltipData(rows, plan);
    const entry = idx.get('ios')!;
    // 1..10 → q1 3.25, median 5.5, q3 7.75; whiskers clamp to data → 1 and 10
    expect(entry.rows).toEqual([
      { label: 'Max', value: 10, colorKey: 'Revenue' },
      { label: 'Q3', value: 7.75, colorKey: 'Revenue' },
      { label: 'Median', value: 5.5, colorKey: 'Revenue' },
      { label: 'Q1', value: 3.25, colorKey: 'Revenue' },
      { label: 'Min', value: 1, colorKey: 'Revenue' },
    ]);
  });

  it('whiskers exclude outliers beyond 1.5·IQR (like the drawn box)', () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => ({ platform: 'ios', revenue: i + 1 })), { platform: 'ios', revenue: 100 }];
    const idx = buildTooltipData(rows, plan);
    const max = idx.get('ios')!.rows.find(r => r.label === 'Max')!;
    expect(max.value).toBeLessThan(100); // 100 is an outlier dot, not the whisker end
  });
});

describe('buildTooltipData — waterfall', () => {
  const resolved = materializeRecipe({ recipe: 'minusx/waterfall@1', bindings: { category: 'step', value: 'amount' } });
  if (!resolved.ok) throw new Error(resolved.error);
  const plan = buildTooltipPlan(resolved.spec)!;

  it('per step: signed change (sign-colored) + running total; plus the closing Total', () => {
    const idx = buildTooltipData([
      { step: 'start', amount: 10 },
      { step: 'refunds', amount: -4 },
      { step: 'upsell', amount: 6 },
    ], plan);
    expect([...idx.keys()]).toEqual(['start', 'refunds', 'upsell', 'Total']);
    expect(idx.get('start')!.rows).toEqual([
      { label: 'amount', value: 10, colorKey: 'amount', color: WATERFALL_UP_COLOR },
      { label: 'Running total', value: 10, colorKey: 'Running total' },
    ]);
    expect(idx.get('refunds')!.rows[0]).toEqual(
      { label: 'amount', value: -4, colorKey: 'amount', color: WATERFALL_DOWN_COLOR });
    expect(idx.get('refunds')!.rows[1].value).toBe(6);
    expect(idx.get('Total')!.rows).toEqual([
      { label: 'amount', value: 12, colorKey: 'amount', color: WATERFALL_TOTAL_COLOR },
    ]);
  });

  it('sums duplicate step rows before the running total (recipe aggregates per step)', () => {
    const idx = buildTooltipData([
      { step: 'a', amount: 3 }, { step: 'a', amount: 7 }, { step: 'b', amount: 5 },
    ], plan);
    expect(idx.get('a')!.rows[0].value).toBe(10);
    expect(idx.get('Total')!.rows[0].value).toBe(15);
  });
});

describe('temporal x normalization', () => {
  it('a Date (Vega-Lite view) and its raw ISO string map to the same bucket', () => {
    const plan = buildTooltipPlan(foldArea)!; // week is temporal
    const idx = buildTooltipData([{ week: '2025-06-22', new_users: 10, returning_users: 5 }], plan);
    // The hovered datum carries a parsed Date; it must resolve to the string-keyed row.
    const key = tooltipXKey({ week: new Date('2025-06-22') }, plan);
    expect(idx.get(key)).toBeTruthy();
    expect(idx.get(key)!.rows[0].value).toBe(10);
  });
});

describe('tooltipXKey', () => {
  it('keys by the x field value as a string', () => {
    const plan = buildTooltipPlan(foldArea)!;
    expect(tooltipXKey({ week: 'W2', __mx_key: 'new_users' }, plan)).toBe('W2');
  });
});

describe('renderSharedTooltipHtml', () => {
  it('renders an x header + a swatch/name/value row per series, sorted by value desc', () => {
    const entry = { xRaw: 'W1', rows: [
      { label: 'new_users', value: 10, colorKey: 'new_users' },
      { label: 'returning_users', value: 50, colorKey: 'returning_users' },
    ] };
    const html = renderSharedTooltipHtml(entry, {
      xTitle: 'Week', colorFor: k => (k === 'new_users' ? '#0f0' : '#00f'),
      formatX: x => String(x), formatValue: v => v.toLocaleString(),
    });
    expect(html).toContain('Week · W1');
    // returning_users (50) sorts before new_users (10)
    expect(html.indexOf('returning_users')).toBeLessThan(html.indexOf('new_users'));
    expect(html).toContain('background:#00f');
    expect(html).toContain('50');
  });

  it('an explicit row color wins over the colorKey lookup', () => {
    const entry = { xRaw: 'refunds', rows: [
      { label: 'amount', value: -4, colorKey: 'amount', color: '#c0392b' },
      { label: 'Running total', value: 6, colorKey: 'Running total' },
    ] };
    const html = renderSharedTooltipHtml(entry, {
      xTitle: 'Step', colorFor: () => '#ffffff', formatX: String, formatValue: String, sortByValue: false,
    });
    expect(html).toContain('background:#c0392b'); // explicit
    expect(html).toContain('background:#ffffff'); // lookup fallback for the other row
    // sortByValue false keeps plan order (change before running total despite smaller value)
    expect(html.indexOf('amount')).toBeLessThan(html.indexOf('Running total'));
  });

  it('escapes HTML in labels and values', () => {
    const entry = { xRaw: '<x>', rows: [{ label: '<b>', value: 1, colorKey: 'k' }] };
    const html = renderSharedTooltipHtml(entry, { xTitle: 'X', colorFor: () => '#fff', formatX: String, formatValue: String });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

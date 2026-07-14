/**
 * Shared multi-series tooltip core (Viz Arch V2). The plan classifies a spec's series
 * shape (wide fold / single / long color-column), the aggregator sums each series per x,
 * and the renderer emits swatch+name+value rows — all pure (DOM lives in VegaChart).
 */
import { describe, it, expect } from 'vitest';
import { buildTooltipPlan, buildTooltipData, tooltipXKey, renderSharedTooltipHtml } from '../tooltip-plan';

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

  it('returns null for non-shared charts (pie, scatter, quantitative x, no x)', () => {
    expect(buildTooltipPlan({ mark: { type: 'arc' }, encoding: { theta: { field: 'v' } } })).toBeNull();
    expect(buildTooltipPlan({ mark: { type: 'point' }, encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'b', type: 'quantitative' } } })).toBeNull();
    expect(buildTooltipPlan({ mark: { type: 'bar' }, encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'b', type: 'quantitative' } } })).toBeNull();
    expect(buildTooltipPlan({ mark: { type: 'line' }, encoding: { y: { field: 'b', type: 'quantitative' } } })).toBeNull();
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

  it('escapes HTML in labels and values', () => {
    const entry = { xRaw: '<x>', rows: [{ label: '<b>', value: 1, colorKey: 'k' }] };
    const html = renderSharedTooltipHtml(entry, { xTitle: 'X', colorFor: () => '#fff', formatX: String, formatValue: String });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

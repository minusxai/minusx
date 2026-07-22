/**
 * Series color overrides (Viz Arch V2 — the V1 Style-popover colors, done spec-native).
 * Colors are keyed by SERIES NAME and written into the color channel's scale
 * (domain + range) — not an index-keyed side-channel like V1's styleConfig.colors —
 * so they survive data reordering, detach, and agent edits, and show in Spec honestly.
 */
import { describe, it, expect } from 'vitest';
import { getSeriesColors, setSeriesColor } from '../encoding-edit';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const ROWS = [
  { week: 'W1', platform: 'web', revenue: 3 },
  { week: 'W1', platform: 'android', revenue: 1 },
  { week: 'W2', platform: 'ios', revenue: 2 },
];

const longBar = () => envelope({
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'week', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    color: { field: 'platform', type: 'nominal' },
  },
});

const foldedLine = () => envelope({
  mark: { type: 'line' },
  transform: [{ fold: ['orders', 'revenue'], as: ['__mx_key', '__mx_value'] }],
  encoding: {
    x: { field: 'week', type: 'temporal' },
    y: { field: '__mx_value', type: 'quantitative', title: null },
    color: { field: '__mx_key', type: 'nominal', title: null },
  },
});

const singleLine = () => envelope({
  mark: { type: 'line' },
  encoding: {
    x: { field: 'week', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
});

describe('getSeriesColors', () => {
  it('long chart: one entry per color-field value (ascending, matching the vega domain), default palette order', () => {
    const series = getSeriesColors(longBar(), ROWS);
    expect(series.map(s => s.key)).toEqual(['android', 'ios', 'web']);
    expect(series.map(s => s.color)).toEqual([COLOR_PALETTE[0], COLOR_PALETTE[1], COLOR_PALETTE[2]]);
    expect(series.every(s => !s.overridden)).toBe(true);
  });

  it('folded multi-measure: the folded columns are the series', () => {
    const series = getSeriesColors(foldedLine(), [{ week: 'W1', orders: 1, revenue: 2 }]);
    expect(series.map(s => s.key)).toEqual(['orders', 'revenue']);
  });

  it('single measure: one series named after the measure', () => {
    const series = getSeriesColors(singleLine(), ROWS);
    expect(series.map(s => s.key)).toEqual(['revenue']);
    expect(series[0].color).toBe(COLOR_PALETTE[0]);
  });

  it('reflects an existing override', () => {
    const next = setSeriesColor(longBar(), ROWS, 'ios', '#ff0000');
    const series = getSeriesColors(next, ROWS);
    expect(series.find(s => s.key === 'ios')).toEqual({ key: 'ios', color: '#ff0000', overridden: true });
    expect(series.find(s => s.key === 'android')!.color).toBe(COLOR_PALETTE[0]); // untouched default
  });
});

describe('setSeriesColor', () => {
  it('writes the FULL domain + range onto the color scale (name-keyed, order-stable)', () => {
    const next = setSeriesColor(longBar(), ROWS, 'ios', '#ff0000');
    const color = specOf(next).encoding.color;
    expect(color.scale.domain).toEqual(['android', 'ios', 'web']);
    expect(color.scale.range).toEqual([COLOR_PALETTE[0], '#ff0000', COLOR_PALETTE[2]]);
    expect(color.field).toBe('platform'); // surgical — the def survives
  });

  it('a second override keeps the first', () => {
    const one = setSeriesColor(longBar(), ROWS, 'ios', '#ff0000');
    const two = setSeriesColor(one, ROWS, 'web', '#00ff00');
    const scale = specOf(two).encoding.color.scale;
    expect(scale.range).toEqual([COLOR_PALETTE[0], '#ff0000', '#00ff00']);
  });

  it('clearing the last override removes the pinned scale entirely', () => {
    const one = setSeriesColor(longBar(), ROWS, 'ios', '#ff0000');
    const cleared = setSeriesColor(one, ROWS, 'ios', null);
    expect(specOf(cleared).encoding.color.scale).toBeUndefined();
  });

  it('single measure: colors via a persisted datum legend + one-entry range', () => {
    const next = setSeriesColor(singleLine(), ROWS, 'revenue', '#123456');
    const color = specOf(next).encoding.color;
    expect(color.datum).toBe('revenue');
    expect(color.scale.range).toEqual(['#123456']);
    // …and clearing removes the channel again (back to the render-time injected legend).
    const cleared = setSeriesColor(next, ROWS, 'revenue', null);
    expect(specOf(cleared).encoding.color).toBeUndefined();
  });

  it('no-op on recipes and non-unit specs', () => {
    const recipe = { version: 2, source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: { stage: 'a', value: 'b' } } } as unknown as VizEnvelope;
    expect(setSeriesColor(recipe, ROWS, 'x', '#fff')).toBe(recipe);
  });
});

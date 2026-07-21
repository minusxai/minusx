/**
 * Story_Design_V2 §5 — `--chart-1..5` drive Vega chart colors.
 *
 * The token→range mapping is a pure function (chartTokenRange) tested here; the DOM wrapper
 * resolves computed style from the chart's container so charts recolor with the surrounding
 * [data-theme] scope. compileVegaLite/toVegaSpec accept the resolved range as a categorical
 * color override; absent tokens keep the house palette.
 */
import { describe, it, expect } from 'vitest';
import { chartTokenRange } from '../chart-tokens';
import { compileVegaLite, toVegaSpec } from '../render-vega';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';

const readerOf = (vars: Record<string, string>) => (name: string) => vars[name] ?? '';

describe('chartTokenRange — token → categorical range mapping', () => {
  it('maps all five tokens in order', () => {
    const range = chartTokenRange(readerOf({
      '--chart-1': 'oklch(0.6 0.2 30)',
      '--chart-2': 'oklch(0.5 0.1 200)',
      '--chart-3': 'oklch(0.4 0.05 250)',
      '--chart-4': 'oklch(0.8 0.15 90)',
      '--chart-5': 'oklch(0.7 0.18 70)',
    }));
    expect(range).toEqual([
      'oklch(0.6 0.2 30)', 'oklch(0.5 0.1 200)', 'oklch(0.4 0.05 250)',
      'oklch(0.8 0.15 90)', 'oklch(0.7 0.18 70)',
    ]);
  });

  it('returns null when --chart-1 is undefined (no token scope → house palette)', () => {
    expect(chartTokenRange(readerOf({}))).toBeNull();
    expect(chartTokenRange(readerOf({ '--chart-2': 'red' }))).toBeNull();
  });

  it('trims computed values and skips empty middle slots', () => {
    const range = chartTokenRange(readerOf({ '--chart-1': ' red ', '--chart-3': 'blue' }));
    expect(range).toEqual(['red', 'blue']);
  });
});

const UNIT_SPEC = {
  mark: 'bar',
  encoding: {
    x: { field: 'cat', type: 'nominal' },
    y: { field: 'val', type: 'quantitative' },
    color: { field: 'cat', type: 'nominal' },
  },
};

describe('compileVegaLite — categoryRange override', () => {
  it('bakes the token range into the compiled config as range.category', () => {
    const tokens = ['oklch(0.6 0.2 30)', 'oklch(0.5 0.1 200)'];
    const spec = compileVegaLite(UNIT_SPEC, 'light', { categoryRange: tokens }) as unknown as
      { config?: { range?: { category?: unknown } } };
    expect(spec.config?.range?.category).toEqual(tokens);
  });

  it('keeps the house palette when no range is given', () => {
    const spec = compileVegaLite(UNIT_SPEC, 'light') as unknown as
      { config?: { range?: { category?: unknown } } };
    expect(spec.config?.range?.category).toEqual(COLOR_PALETTE);
  });
});

describe('toVegaSpec — native-vega engine gets the range via parser config', () => {
  it('merges range.category into the themed parser config', () => {
    const tokens = ['red', 'blue'];
    const { parserConfig } = toVegaSpec(
      { spec: { marks: [] }, engine: 'vega' }, 'light', { categoryRange: tokens },
    );
    expect((parserConfig as { range?: { category?: unknown } }).range?.category).toEqual(tokens);
  });

  it('leaves the parser config untouched without a range', () => {
    const { parserConfig } = toVegaSpec({ spec: { marks: [] }, engine: 'vega' }, 'light');
    expect((parserConfig as { range?: { category?: unknown } })?.range?.category).not.toEqual(['red', 'blue']);
  });
});

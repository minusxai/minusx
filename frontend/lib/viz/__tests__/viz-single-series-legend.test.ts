/**
 * Single-series charts (no color encoding) still show a legend named after the
 * measure — ECharts parity, matching the radar behavior. Injected at compile time
 * (render-only, never persisted); any author color encoding wins untouched.
 * Top legends are center-anchored within the chart width.
 */
import { describe, it, expect } from 'vitest';
import { compileVegaLite, injectSingleSeriesLegend } from '@/lib/viz/render-vega';

const BAR = () => ({
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
  } as Record<string, Record<string, unknown>>,
});

describe('injectSingleSeriesLegend', () => {
  it('a colorless field-bearing y gets a color datum named after the field', () => {
    const spec = BAR();
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toEqual({ datum: 'revenue' });
  });

  it('uses the y title when the author set one', () => {
    const spec = BAR();
    spec.encoding.y.title = 'Total Revenue';
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toEqual({ datum: 'Total Revenue' });
  });

  it('never touches an author color encoding', () => {
    const spec = BAR();
    spec.encoding.color = { field: 'region', type: 'nominal' };
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toEqual({ field: 'region', type: 'nominal' });
  });

  it('skips specs without a field-bearing y (nothing to name)', () => {
    const spec = { mark: 'rule', encoding: { y: { datum: 100 } } as Record<string, Record<string, unknown>> };
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toBeUndefined();
  });
});

describe('compiled output', () => {
  it('a colorless bar compiles with a legend', () => {
    const vegaSpec = JSON.stringify(compileVegaLite(BAR() as Record<string, unknown>, 'dark'));
    expect(vegaSpec).toContain('"legends"');
    expect(vegaSpec).toContain('revenue');
  });

  it('top legends are center-anchored in the compiled config', () => {
    const vegaSpec = compileVegaLite(BAR() as Record<string, unknown>, 'dark') as unknown as { config: { legend: { layout: { top: { anchor: string } } } } };
    expect(vegaSpec.config.legend.layout.top.anchor).toBe('middle');
  });

  it('composed specs get no injected legend', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: BAR().encoding },
        { mark: 'line', encoding: { x: BAR().encoding.x, y: { field: 'margin', type: 'quantitative' } } },
      ],
    };
    const vegaSpec = JSON.stringify(compileVegaLite(spec as Record<string, unknown>, 'dark'));
    expect(vegaSpec).not.toContain('"legends"');
  });
});

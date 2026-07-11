/**
 * Interactive-legend platform default: compileVegaLite injects a legend-bound point
 * selection (mx_legend_sel) + conditional opacity so clicking a legend entry
 * highlights that series — ECharts-parity behavior, render-time only (never saved).
 * Injection is conservative: single-view specs with a discrete color field only,
 * and never when the spec brings its own params or opacity encoding.
 */
import { describe, it, expect } from 'vitest';
import { compileVegaLite } from '@/lib/viz/render-vega';

const signalNames = (vegaSpec: object): string[] =>
  ((vegaSpec as { signals?: { name: string }[] }).signals ?? []).map(s => s.name);

const BASE = {
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
    color: { field: 'region', type: 'nominal' },
  },
};

describe('legend toggle injection', () => {
  it('injects a legend-bound selection for a unit spec with a discrete color field', () => {
    const vegaSpec = compileVegaLite(BASE as Record<string, unknown>, 'dark');
    expect(signalNames(vegaSpec)).toContain('mx_legend_sel');
  });

  it('does not inject when the spec has no color encoding', () => {
    const spec = { mark: 'bar', encoding: { x: BASE.encoding.x, y: BASE.encoding.y } };
    expect(signalNames(compileVegaLite(spec, 'dark'))).not.toContain('mx_legend_sel');
  });

  it('does not inject for a continuous (quantitative) color scale', () => {
    const spec = { ...BASE, encoding: { ...BASE.encoding, color: { field: 'revenue', type: 'quantitative' } } };
    expect(signalNames(compileVegaLite(spec, 'dark'))).not.toContain('mx_legend_sel');
  });

  it('does not inject when the spec declares its own opacity encoding', () => {
    const spec = { ...BASE, encoding: { ...BASE.encoding, opacity: { value: 0.5 } } };
    expect(signalNames(compileVegaLite(spec, 'dark'))).not.toContain('mx_legend_sel');
  });

  it('does not inject when the spec declares its own params (author owns interactions)', () => {
    const spec = { ...BASE, params: [{ name: 'sel', select: { type: 'point', fields: ['region'] }, bind: 'legend' }] };
    const names = signalNames(compileVegaLite(spec as Record<string, unknown>, 'dark'));
    expect(names).toContain('sel');
    expect(names).not.toContain('mx_legend_sel');
  });

  it('does not inject into composed specs (layer/facet/concat)', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: BASE.encoding },
        { mark: 'line', encoding: { x: BASE.encoding.x, y: { field: 'margin', type: 'quantitative' } } },
      ],
    };
    expect(signalNames(compileVegaLite(spec as Record<string, unknown>, 'dark'))).not.toContain('mx_legend_sel');
  });
});

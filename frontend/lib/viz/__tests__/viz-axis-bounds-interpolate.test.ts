/**
 * Settings-tab surgical edits: Y-axis bounds (scale.domainMin/domainMax — one-sided
 * capable, unlike a full domain pin) and line interpolation (mark.interpolate).
 * V1 AxisConfig parity (yMin/yMax), done as native spec properties.
 */
import { describe, it, expect } from 'vitest';
import { getYBounds, setYBounds, getLineInterpolate, setLineInterpolate } from '../encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const LINE = () => ({
  mark: { type: 'line' },
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative', scale: { zero: true } },
  },
});

describe('Y bounds (scale.domainMin/domainMax)', () => {
  it('sets min and max independently, preserving other scale props', () => {
    const next = setYBounds(envelope(LINE()), { min: 10, max: 500 });
    expect(specOf(next).encoding.y.scale).toEqual({ zero: true, domainMin: 10, domainMax: 500 });
  });

  it('one-sided bounds work (only max)', () => {
    const next = setYBounds(envelope(LINE()), { max: 500 });
    const scale = specOf(next).encoding.y.scale;
    expect(scale.domainMax).toBe(500);
    expect(scale.domainMin).toBeUndefined();
  });

  it('null clears a bound; an emptied scale object is dropped', () => {
    const bare = envelope({ mark: 'line', encoding: { x: { field: 'a', type: 'temporal' }, y: { field: 'b', type: 'quantitative' } } });
    const bounded = setYBounds(bare, { min: 1, max: 2 });
    const cleared = setYBounds(bounded, { min: null, max: null });
    expect(specOf(cleared).encoding.y.scale).toBeUndefined();
  });

  it('reads bounds back', () => {
    const next = setYBounds(envelope(LINE()), { min: 10 });
    expect(getYBounds(specOf(next))).toEqual({ min: 10, max: null });
    expect(getYBounds(LINE())).toEqual({ min: null, max: null });
  });

  // Without clipping, marks beyond the bound blow out the autosize:fit layout and the
  // chart collapses to nothing (ECharts clipped implicitly; VL must be told).
  it('setting any bound clips the marks to the plot', () => {
    const next = setYBounds(envelope(LINE()), { max: 500 });
    expect(specOf(next).mark.clip).toBe(true);
  });

  it('clearing BOTH bounds removes the clip again', () => {
    const bounded = setYBounds(envelope(LINE()), { min: 1, max: 500 });
    const cleared = setYBounds(bounded, { min: null, max: null });
    expect(specOf(cleared).mark.clip).toBeUndefined();
    // one side still bounded → clip stays
    const half = setYBounds(bounded, { max: null });
    expect(specOf(half).mark.clip).toBe(true);
  });
});

describe('line interpolation (mark.interpolate)', () => {
  it('defaults to linear', () => {
    expect(getLineInterpolate(LINE())).toBe('linear');
  });

  it('sets smooth (monotone) and step, keeping other mark props', () => {
    const smooth = setLineInterpolate(envelope(LINE()), 'monotone');
    expect(specOf(smooth).mark).toEqual({ type: 'line', interpolate: 'monotone' });
    const step = setLineInterpolate(smooth, 'step');
    expect(specOf(step).mark.interpolate).toBe('step');
    expect(getLineInterpolate(specOf(step))).toBe('step');
  });

  it('linear removes the prop (the VL default stays implicit)', () => {
    const smooth = setLineInterpolate(envelope(LINE()), 'monotone');
    const back = setLineInterpolate(smooth, 'linear');
    expect(specOf(back).mark).toEqual({ type: 'line' });
  });

  it('a string mark is upgraded to a mark object when needed', () => {
    const stringMark = envelope({ mark: 'area', encoding: { x: { field: 'a', type: 'temporal' }, y: { field: 'b', type: 'quantitative' } } });
    const smooth = setLineInterpolate(stringMark, 'monotone');
    expect(specOf(smooth).mark).toEqual({ type: 'area', interpolate: 'monotone' });
  });
});

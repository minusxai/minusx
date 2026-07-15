/**
 * infer-viz — pure viz recommendations from a semantic spec's SHAPE.
 *
 * `inferVizType` is the single default the explorer applies while the chart
 * type is UNLOCKED (time → line, dimensions → bar, else table — the exact
 * semantics SemanticExplorer.vizOf always had). `recommendedVizTypes` is the
 * wider set the type selector highlights: every type that makes sense for
 * the current dims/measures/time shape, always including the inferred
 * default and 'table'.
 */
import { describe, it, expect } from 'vitest';
import { inferVizType, recommendedVizTypes } from '@/lib/semantic/infer-viz';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const spec = (over: Partial<SemanticQuerySpec>): SemanticQuerySpec => ({
  model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [], ...over,
});

describe('inferVizType', () => {
  it('time grain → line', () => {
    expect(inferVizType(spec({ timeGrain: 'MONTH' }))).toBe('line');
    expect(inferVizType(spec({ timeGrain: 'WEEK', dimensions: ['Status'] }))).toBe('line');
  });

  it('dimensions without time → bar', () => {
    expect(inferVizType(spec({ dimensions: ['Status'] }))).toBe('bar');
  });

  it('bare measures → table', () => {
    expect(inferVizType(spec({}))).toBe('table');
  });
});

describe('recommendedVizTypes', () => {
  it('always contains the inferred default and table', () => {
    for (const s of [spec({}), spec({ timeGrain: 'MONTH' }), spec({ dimensions: ['Status'] })]) {
      const rec = recommendedVizTypes(s);
      expect(rec).toContain(inferVizType(s));
      expect(rec).toContain('table');
    }
  });

  it('time series recommends line/area/bar', () => {
    const rec = recommendedVizTypes(spec({ timeGrain: 'MONTH' }));
    expect(rec).toEqual(expect.arrayContaining(['line', 'area', 'bar']));
    expect(rec).not.toContain('pie');
  });

  it('categorical (one measure) recommends bar/row/pie', () => {
    const rec = recommendedVizTypes(spec({ dimensions: ['Status'] }));
    expect(rec).toEqual(expect.arrayContaining(['bar', 'row', 'pie']));
    expect(rec).not.toContain('line');
  });

  it('categorical with several measures drops pie, adds scatter', () => {
    const rec = recommendedVizTypes(spec({ dimensions: ['Status'], measures: ['Revenue', 'Orders'] }));
    expect(rec).not.toContain('pie');
    expect(rec).toContain('scatter');
  });

  it('bare measures recommend the big number', () => {
    expect(recommendedVizTypes(spec({}))).toContain('single_value');
  });

  it('two or more dimensions recommend pivot', () => {
    expect(recommendedVizTypes(spec({ dimensions: ['Status', 'Region'] }))).toContain('pivot');
    expect(recommendedVizTypes(spec({ dimensions: ['Status'] }))).not.toContain('pivot');
  });
});

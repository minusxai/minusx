/**
 * Viz-type switching for unit specs. Cartesian marks (bar/line/area/scatter) are pure
 * mark swaps; `row` swaps the x/y channel defs wholesale (axis/format travel with
 * them); `pie` is an encoding TRANSFORM (y→theta, color??x→color, positional channels
 * removed) — a naive mark swap to `arc` renders garbage (x/y mean nothing to arcs).
 */
import { describe, it, expect } from 'vitest';
import { getVizType, setVizType, V2_SUPPORTED_VIZ_TYPES } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const BAR = {
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'month', type: 'temporal', axis: { format: '%b' } },
    y: { field: 'revenue', type: 'quantitative', axis: { format: ',.0f' } },
    color: { field: 'region', type: 'nominal' },
  },
};

describe('getVizType', () => {
  it('maps marks to viz types', () => {
    expect(getVizType(BAR)).toBe('bar');
    expect(getVizType({ mark: 'line', encoding: BAR.encoding })).toBe('line');
    expect(getVizType({ mark: 'point', encoding: BAR.encoding })).toBe('scatter');
    expect(getVizType({ mark: 'arc', encoding: {} })).toBe('pie');
  });

  it('detects row as bar with a discrete y and quantitative x', () => {
    const row = { mark: 'bar', encoding: { y: { field: 'region', type: 'nominal' }, x: { field: 'revenue', type: 'quantitative' } } };
    expect(getVizType(row)).toBe('row');
  });
});

describe('setVizType', () => {
  it('cartesian → cartesian is a pure mark swap (encodings untouched)', () => {
    const next = setVizType(envelope(BAR), 'area');
    expect(specOf(next).mark).toEqual({ type: 'area' });
    expect(specOf(next).encoding).toEqual(BAR.encoding);
  });

  it('scatter maps to the point mark', () => {
    expect(specOf(setVizType(envelope(BAR), 'scatter')).mark).toEqual({ type: 'point' });
  });

  it('bar → row swaps x and y channel defs wholesale (axis config travels)', () => {
    const next = setVizType(envelope(BAR), 'row');
    const enc = specOf(next).encoding;
    expect(enc.y.field).toBe('month');
    expect(enc.y.axis).toEqual({ format: '%b' });
    expect(enc.x.field).toBe('revenue');
    expect(enc.x.axis).toEqual({ format: ',.0f' });
    expect(getVizType(specOf(next))).toBe('row');
  });

  it('bar → pie transforms encodings: y→theta (SUM-aggregated), color kept, x/y removed', () => {
    const next = setVizType(envelope(BAR), 'pie');
    const spec = specOf(next);
    expect(getVizType(spec)).toBe('pie');
    expect(spec.encoding.theta.field).toBe('revenue');
    // One arc per DATUM otherwise — a weekly result draws hundreds of slivers per
    // category. The classic pipeline SUM-aggregated; pie must too.
    expect(spec.encoding.theta.aggregate).toBe('sum');
    expect(spec.encoding.theta.axis).toBeUndefined(); // axis is meaningless on theta
    expect(spec.encoding.color.field).toBe('region');
    expect(spec.encoding.x).toBeUndefined();
    expect(spec.encoding.y).toBeUndefined();
  });

  it('pie drops grouping channels (tooltip/detail) — non-aggregated fields re-shard the arcs', () => {
    const withTooltip = {
      ...BAR,
      encoding: {
        ...BAR.encoding,
        tooltip: [{ field: 'month', type: 'temporal' }, { field: 'revenue', type: 'quantitative' }],
        detail: { field: 'order_id', type: 'nominal' },
      },
    };
    const spec = specOf(setVizType(envelope(withTooltip), 'pie'));
    expect(spec.encoding.tooltip).toBeUndefined();
    expect(spec.encoding.detail).toBeUndefined();
  });

  it('pie keeps an author-specified theta aggregate (mean stays mean)', () => {
    const withAgg = { ...BAR, encoding: { ...BAR.encoding, y: { ...BAR.encoding.y, aggregate: 'mean' } } };
    const spec = specOf(setVizType(envelope(withAgg), 'pie'));
    expect(spec.encoding.theta.aggregate).toBe('mean');
  });

  it('bar without color → pie uses x as the slice category', () => {
    const noColor = { ...BAR, encoding: { x: { field: 'region', type: 'nominal' }, y: BAR.encoding.y } };
    const spec = specOf(setVizType(envelope(noColor), 'pie'));
    expect(spec.encoding.color.field).toBe('region');
    expect(spec.encoding.theta.field).toBe('revenue');
  });

  it('pie → bar restores positional encodings (color→x, theta→y)', () => {
    const pie = specOf(setVizType(envelope(BAR), 'pie'));
    const back = specOf(setVizType(envelope(pie), 'bar'));
    expect(getVizType(back)).toBe('bar');
    expect(back.encoding.x.field).toBe('region');
    expect(back.encoding.y.field).toBe('revenue');
    expect(back.encoding.theta).toBeUndefined();
  });

  it('exports the supported set for the selector', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toEqual(['bar', 'line', 'area', 'scatter', 'pie', 'row', 'funnel', 'waterfall']);
  });

  it('pie renders as a donut with rounded, padded sectors (ECharts house style)', () => {
    const spec = specOf(setVizType(envelope(BAR), 'pie'));
    const mark = spec.mark as Record<string, unknown>;
    expect(mark.innerRadius).toBeDefined();
    expect(mark.cornerRadius).toBe(6);
    expect(mark.padAngle).toBeGreaterThan(0);
  });

  it('leaving pie strips the donut innerRadius from the mark', () => {
    const pie = specOf(setVizType(envelope(BAR), 'pie'));
    const back = specOf(setVizType(envelope(pie), 'bar'));
    expect((back.mark as Record<string, unknown>).innerRadius).toBeUndefined();
  });
});

describe('zonesForVizType', () => {
  it('cartesian types get X/Y/Color zones', async () => {
    const { zonesForVizType } = await import('@/lib/viz/encoding-edit');
    expect(zonesForVizType('bar').map(z => z.channel)).toEqual(['x', 'y', 'color']);
    expect(zonesForVizType('line').map(z => z.channel)).toEqual(['x', 'y', 'color']);
  });

  it('pie gets Slices/Value zones (color/theta) — no positional channels offered', async () => {
    const { zonesForVizType } = await import('@/lib/viz/encoding-edit');
    expect(zonesForVizType('pie').map(z => z.channel)).toEqual(['color', 'theta']);
  });
});

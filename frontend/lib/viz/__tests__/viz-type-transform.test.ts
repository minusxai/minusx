/**
 * Viz-type switching for unit specs. Cartesian marks (bar/line/area/scatter) are pure
 * mark swaps; `row` swaps the x/y channel defs wholesale (axis/format travel with
 * them); `pie` is an encoding TRANSFORM (y→theta, color??x→color, positional channels
 * removed) — a naive mark swap to `arc` renders garbage (x/y mean nothing to arcs).
 */
import { describe, it, expect } from 'vitest';
import { getVizType, setVizType, setEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES } from '@/lib/viz/encoding-edit';
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
    expect(V2_SUPPORTED_VIZ_TYPES).toEqual(['table', 'pivot', 'bar', 'line', 'area', 'scatter', 'pie', 'row', 'funnel', 'waterfall', 'radar', 'heatmap', 'boxplot', 'trend', 'single_value', 'histogram']);
  });

  it('detects histogram as a bar with a binned x (before the row check — binned x is quantitative)', () => {
    const hist = { mark: 'bar', encoding: { x: { field: 'revenue', bin: true, type: 'quantitative' }, y: { aggregate: 'count', type: 'quantitative' } } };
    expect(getVizType(hist)).toBe('histogram');
    const maxbins = { mark: 'bar', encoding: { x: { field: 'revenue', bin: { maxbins: 40 }, type: 'quantitative' }, y: { aggregate: 'count', type: 'quantitative' } } };
    expect(getVizType(maxbins)).toBe('histogram');
  });

  it('bar → histogram bins the measure on x, counts on y, keeps the colour split, drops the category', () => {
    const next = setVizType(envelope(BAR), 'histogram');
    const spec = specOf(next);
    expect(getVizType(spec)).toBe('histogram');
    expect(spec.mark).toEqual({ type: 'bar' });
    expect(spec.encoding.x.field).toBe('revenue');
    expect(spec.encoding.x.bin).toBe(true);
    expect(spec.encoding.x.type).toBe('quantitative');
    expect(spec.encoding.x.axis).toEqual({ format: ',.0f' }); // the measure's axis travels
    expect(spec.encoding.x.aggregate).toBeUndefined(); // bin and aggregate fight
    expect(spec.encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' });
    expect(spec.encoding.color).toEqual(BAR.encoding.color); // the split column
  });

  it('row → histogram reads the measure from x (row is horizontal)', () => {
    const row = { mark: 'bar', encoding: { y: { field: 'region', type: 'nominal' }, x: { field: 'revenue', type: 'quantitative' } } };
    const spec = specOf(setVizType(envelope(row), 'histogram'));
    expect(spec.encoding.x.field).toBe('revenue');
    expect(spec.encoding.x.bin).toBe(true);
    expect(spec.encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' });
  });

  it('histogram → bar restores the measure to y (bin stripped, count dropped)', () => {
    const hist = specOf(setVizType(envelope(BAR), 'histogram'));
    const back = specOf(setVizType(envelope(hist), 'bar'));
    expect(back.encoding.y.field).toBe('revenue');
    expect(back.encoding.y.bin).toBeUndefined();
    expect(back.encoding.y.axis).toEqual({ format: ',.0f' });
    expect(back.encoding.x).toBeUndefined(); // the original category was dropped entering histogram
    expect(back.encoding.color).toEqual(BAR.encoding.color);
  });

  it('histogram → pie routes the measure to theta with the SUM default', () => {
    const hist = specOf(setVizType(envelope(BAR), 'histogram'));
    const spec = specOf(setVizType(envelope(hist), 'pie'));
    expect(spec.encoding.theta.field).toBe('revenue');
    expect(spec.encoding.theta.aggregate).toBe('sum');
    expect(spec.encoding.theta.bin).toBeUndefined();
  });

  it('table → histogram (envelope path) bins the first measure from result columns', () => {
    const table = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } as unknown as VizEnvelope;
    const cols = [
      { name: 'region', kind: 'nominal' as const },
      { name: 'revenue', kind: 'quantitative' as const },
    ];
    const spec = specOf(setEnvelopeVizType(table, 'histogram', cols));
    expect(getVizType(spec)).toBe('histogram');
    expect(spec.encoding.x.field).toBe('revenue');
    expect(spec.encoding.x.bin).toBe(true);
    expect(spec.encoding.x.aggregate).toBeUndefined();
    expect(spec.encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' });
  });

  it('maps the boxplot composite mark (string or mark-def) to boxplot', () => {
    expect(getVizType({ mark: 'boxplot', encoding: BAR.encoding })).toBe('boxplot');
    expect(getVizType({ mark: { type: 'boxplot', extent: 'min-max' }, encoding: BAR.encoding })).toBe('boxplot');
  });

  it('bar → boxplot swaps the mark and strips y aggregate/stack (boxplot computes its own stats)', () => {
    // A pre-aggregated y feeds ONE value per group into the composite mark — a
    // degenerate box (and VL warns on custom aggregates for the continuous axis).
    const withAgg = { ...BAR, encoding: { ...BAR.encoding, y: { ...BAR.encoding.y, aggregate: 'sum', stack: null } } };
    const next = setVizType(envelope(withAgg), 'boxplot');
    const spec = specOf(next);
    expect(getVizType(spec)).toBe('boxplot');
    expect(spec.mark).toEqual({ type: 'boxplot' });
    expect(spec.encoding.y.aggregate).toBeUndefined();
    expect(spec.encoding.y.stack).toBeUndefined();
    expect(spec.encoding.y.axis).toEqual({ format: ',.0f' }); // presentation survives
    expect(spec.encoding.x).toEqual(BAR.encoding.x);
    expect(spec.encoding.color).toEqual(BAR.encoding.color);
  });

  it('boxplot → bar is a pure mark swap (encodings untouched)', () => {
    const box = { mark: { type: 'boxplot' }, encoding: BAR.encoding };
    const back = specOf(setVizType(envelope(box), 'bar'));
    expect(back.mark).toEqual({ type: 'bar' });
    expect(back.encoding).toEqual(BAR.encoding);
  });

  it('boxplot → pie transforms encodings with the SUM default on theta', () => {
    const box = { mark: { type: 'boxplot' }, encoding: BAR.encoding };
    const spec = specOf(setVizType(envelope(box), 'pie'));
    expect(spec.encoding.theta.field).toBe('revenue');
    expect(spec.encoding.theta.aggregate).toBe('sum');
  });

  it('table → boxplot (envelope path) reconstructs from result columns WITHOUT a y aggregate', () => {
    // The reconstruct path builds a SUM-aggregated bar first; the boxplot transform
    // must strip that aggregate so the composite mark sees raw per-datum values.
    const table = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } as unknown as VizEnvelope;
    const cols = [
      { name: 'region', kind: 'nominal' as const },
      { name: 'revenue', kind: 'quantitative' as const },
    ];
    const next = setEnvelopeVizType(table, 'boxplot', cols);
    const spec = specOf(next);
    expect(getVizType(spec)).toBe('boxplot');
    expect(spec.encoding.x).toEqual({ field: 'region', type: 'nominal' });
    expect(spec.encoding.y.field).toBe('revenue');
    expect(spec.encoding.y.aggregate).toBeUndefined();
  });

  it('pie emits a MINIMAL arc mark — the theme owns the house donut styling', () => {
    // The saved spec stays clean (identical to what an agent authors); the donut
    // look (responsive innerRadius, rounded, padded) is applied by config.arc at
    // render time, so UI-created and agent-created pies converge on one spec.
    const spec = specOf(setVizType(envelope(BAR), 'pie'));
    const mark = spec.mark as Record<string, unknown>;
    expect(mark.type).toBe('arc');
    expect(mark.innerRadius).toBeUndefined();
    expect(mark.cornerRadius).toBeUndefined();
    expect(mark.padAngle).toBeUndefined();
  });

  it('leaving pie strips arc-only donut props (from legacy/agent-authored marks)', () => {
    const pie = {
      mark: { type: 'arc', innerRadius: 55, cornerRadius: 6, padAngle: 0.015 },
      encoding: {
        theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
        color: { field: 'region', type: 'nominal' },
      },
    };
    const back = specOf(setVizType(envelope(pie), 'bar'));
    const mark = back.mark as Record<string, unknown>;
    expect(mark.innerRadius).toBeUndefined();
    expect(mark.cornerRadius).toBeUndefined();
    expect(mark.padAngle).toBeUndefined();
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

  it('histogram gets Values/Split zones (x/color) — y is the implicit count', async () => {
    const { zonesForVizType } = await import('@/lib/viz/encoding-edit');
    const zones = zonesForVizType('histogram');
    expect(zones.map(z => z.channel)).toEqual(['x', 'color']);
    expect(zones.map(z => z.label)).toEqual(['Values', 'Color / Split']);
  });
});

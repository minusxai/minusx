/**
 * Surgical "Settings" edits for unit specs (mark type, stacking, log scale) —
 * the V2 settings subtab. Same cardinal rule as the drop zones: replace exactly
 * one property, preserve everything else.
 */
import { describe, it, expect } from 'vitest';
import { getMarkType, setMarkType, getStacked, setStacked, getYLogScale, setYLogScale } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const UNIT = {
  mark: { type: 'bar', cornerRadius: 3 },
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative', axis: { format: ',.0f' } },
  },
};

describe('mark type', () => {
  it('reads string and object marks', () => {
    expect(getMarkType({ mark: 'line' })).toBe('line');
    expect(getMarkType(UNIT)).toBe('bar');
  });

  it('replaces type but preserves mark-def props', () => {
    const next = setMarkType(envelope(UNIT), 'line');
    expect(specOf(next).mark).toEqual({ type: 'line', cornerRadius: 3 });
  });

  it('replaces a string mark wholesale', () => {
    const next = setMarkType(envelope({ ...UNIT, mark: 'bar' }), 'area');
    expect(specOf(next).mark).toBe('area');
  });
});

describe('stacking', () => {
  it('default (no stack prop) reads as stacked; explicit null reads unstacked', () => {
    expect(getStacked(UNIT)).toBe(true);
    expect(getStacked({ ...UNIT, encoding: { ...UNIT.encoding, y: { ...UNIT.encoding.y, stack: null } } })).toBe(false);
  });

  it('unstacking sets y.stack null, restacking removes the prop; axis config survives', () => {
    const un = setStacked(envelope(UNIT), false);
    expect(specOf(un).encoding.y.stack).toBeNull();
    expect(specOf(un).encoding.y.axis).toEqual({ format: ',.0f' });
    const re = setStacked(un, true);
    expect('stack' in specOf(re).encoding.y).toBe(false);
  });
});

describe('log scale', () => {
  it('round-trips y log scale, preserving other scale props', () => {
    const withScale = envelope({ ...UNIT, encoding: { ...UNIT.encoding, y: { ...UNIT.encoding.y, scale: { domainMin: 1 } } } });
    const on = setYLogScale(withScale, true);
    expect(specOf(on).encoding.y.scale).toEqual({ domainMin: 1, type: 'log' });
    expect(getYLogScale(specOf(on))).toBe(true);
    const off = setYLogScale(on, false);
    expect(specOf(off).encoding.y.scale).toEqual({ domainMin: 1 });
    expect(getYLogScale(specOf(off))).toBe(false);
  });
});

describe('histogram max bins', () => {
  const HIST = {
    mark: { type: 'bar' },
    encoding: {
      x: { field: 'revenue', bin: true, type: 'quantitative', axis: { format: ',.0f' } },
      y: { aggregate: 'count', type: 'quantitative' },
    },
  };

  it('bin: true reads as auto (null); an explicit maxbins reads back', async () => {
    const { getMaxBins } = await import('@/lib/viz/encoding-edit');
    expect(getMaxBins(HIST)).toBeNull();
    const explicit = { ...HIST, encoding: { ...HIST.encoding, x: { ...HIST.encoding.x, bin: { maxbins: 40 } } } };
    expect(getMaxBins(explicit)).toBe(40);
  });

  it('setting maxbins turns bin into a param object; clearing returns to bin: true', async () => {
    const { getMaxBins, setMaxBins } = await import('@/lib/viz/encoding-edit');
    const on = setMaxBins(envelope(HIST), 25);
    expect(specOf(on).encoding.x.bin).toEqual({ maxbins: 25 });
    expect(specOf(on).encoding.x.axis).toEqual({ format: ',.0f' }); // presentation survives
    expect(getMaxBins(specOf(on))).toBe(25);
    const off = setMaxBins(on, null);
    expect(specOf(off).encoding.x.bin).toBe(true);
  });

  it('preserves other author bin params (step, extent) when editing maxbins', async () => {
    const { setMaxBins } = await import('@/lib/viz/encoding-edit');
    const authored = envelope({ ...HIST, encoding: { ...HIST.encoding, x: { ...HIST.encoding.x, bin: { step: 5, maxbins: 20 } } } });
    const changed = setMaxBins(authored, 30);
    expect(specOf(changed).encoding.x.bin).toEqual({ step: 5, maxbins: 30 });
    const cleared = setMaxBins(authored, null);
    expect(specOf(cleared).encoding.x.bin).toEqual({ step: 5 }); // other params keep the object alive
  });

  it('no-op on specs without a binned x (nothing to tune)', async () => {
    const { setMaxBins } = await import('@/lib/viz/encoding-edit');
    const bar = envelope(UNIT);
    expect(specOf(setMaxBins(bar, 25))).toEqual(specOf(bar));
  });
});

/**
 * Targeted encoding edits for the drop-zone lens over unit Vega-Lite specs (RFC:
 * "a path-targeted inspector may edit portions it understands while preserving
 * everything else"). Never a decompile/recompile — surgical JSON edits only.
 */
import { describe, it, expect } from 'vitest';
import { isUnitVegaLiteSpec, getChannelField, setChannelField } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const UNIT = {
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal', axis: { format: '%b %Y' } },
    y: { field: 'revenue', type: 'quantitative' },
  },
};

describe('isUnitVegaLiteSpec', () => {
  it('true for a mark+encoding spec, false for composed specs', () => {
    expect(isUnitVegaLiteSpec(UNIT)).toBe(true);
    expect(isUnitVegaLiteSpec({ layer: [UNIT] })).toBe(false);
    expect(isUnitVegaLiteSpec({ facet: { field: 'a' }, spec: UNIT })).toBe(false);
    expect(isUnitVegaLiteSpec({ hconcat: [UNIT, UNIT] })).toBe(false);
  });
});

describe('getChannelField', () => {
  it('reads the field of a channel, null when absent or non-field', () => {
    expect(getChannelField(UNIT, 'x')).toBe('month');
    expect(getChannelField(UNIT, 'color')).toBeNull();
    expect(getChannelField({ mark: 'rule', encoding: { y: { datum: 5 } } }, 'y')).toBeNull();
  });
});

describe('setChannelField', () => {
  it('assigns a new channel with the inferred VL type', () => {
    const next = setChannelField(envelope(UNIT), 'color', { name: 'region', kind: 'nominal' });
    const spec = (next.source as unknown as { spec: typeof UNIT & { encoding: Record<string, { field?: string; type?: string }> } }).spec;
    expect(spec.encoding.color).toEqual({ field: 'region', type: 'nominal' });
  });

  it('replaces field+type on an existing channel but PRESERVES its other props (axis, title…)', () => {
    const next = setChannelField(envelope(UNIT), 'x', { name: 'order_date', kind: 'temporal' });
    const spec = (next.source as unknown as { spec: { encoding: Record<string, Record<string, unknown>> } }).spec;
    expect(spec.encoding.x.field).toBe('order_date');
    expect(spec.encoding.x.axis).toEqual({ format: '%b %Y' }); // surgical: axis config survives
  });

  it('removes a channel when column is null', () => {
    const next = setChannelField(envelope(UNIT), 'x', null);
    const spec = (next.source as unknown as { spec: { encoding: Record<string, unknown> } }).spec;
    expect('x' in spec.encoding).toBe(false);
    expect('y' in spec.encoding).toBe(true);
  });

  it('never mutates the input envelope and preserves unrelated spec content', () => {
    const input = envelope({ ...UNIT, transform: [{ calculate: 'datum.a', as: 'b' }] });
    const next = setChannelField(input, 'y', { name: 'profit', kind: 'quantitative' });
    expect((input.source as unknown as { spec: { encoding: { y: { field: string } } } }).spec.encoding.y.field).toBe('revenue');
    expect((next.source as unknown as { spec: { transform: unknown[] } }).spec.transform).toEqual([{ calculate: 'datum.a', as: 'b' }]);
  });

  it('maps boolean/unknown kinds to nominal', () => {
    const next = setChannelField(envelope(UNIT), 'color', { name: 'active', kind: 'boolean' });
    const spec = (next.source as unknown as { spec: { encoding: { color: { type: string } } } }).spec;
    expect(spec.encoding.color.type).toBe('nominal');
  });
});

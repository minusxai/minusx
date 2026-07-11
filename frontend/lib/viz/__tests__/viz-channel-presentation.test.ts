/**
 * The zone-chip settings popover (alias + format) in V2: surgical spec edits —
 * alias = the channel's `title`, format = a d3 pattern on `axis.format` (x/y) or
 * the field def's `format` (theta). Presets in the UI compile to d3 strings (RFC §6).
 */
import { describe, it, expect } from 'vitest';
import { getChannelPresentation, setChannelPresentation } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const BAR = () => ({
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative', scale: { zero: true } },
  },
});

describe('setChannelPresentation', () => {
  it('sets an alias as the channel title', () => {
    const next = setChannelPresentation(envelope(BAR()), 'y', { title: 'Total Revenue' });
    expect(specOf(next).encoding.y.title).toBe('Total Revenue');
    expect(specOf(next).encoding.y.scale).toEqual({ zero: true }); // surgical
  });

  it('clearing the alias removes the title', () => {
    const titled = setChannelPresentation(envelope(BAR()), 'y', { title: 'X' });
    const cleared = setChannelPresentation(titled, 'y', { title: null });
    expect('title' in specOf(cleared).encoding.y).toBe(false);
  });

  it('sets a d3 format on the axis for positional channels', () => {
    const next = setChannelPresentation(envelope(BAR()), 'y', { format: ',.2f' });
    expect(specOf(next).encoding.y.axis).toEqual({ format: ',.2f' });
  });

  it('format edits preserve other axis props', () => {
    const spec = BAR();
    (spec.encoding.y as Record<string, unknown>).axis = { grid: false };
    const next = setChannelPresentation(envelope(spec), 'y', { format: '.1%' });
    expect(specOf(next).encoding.y.axis).toEqual({ grid: false, format: '.1%' });
  });

  it('clearing the format keeps other axis props and drops an emptied axis object', () => {
    const withFmt = setChannelPresentation(envelope(BAR()), 'x', { format: '%b %Y' });
    const cleared = setChannelPresentation(withFmt, 'x', { format: null });
    expect(specOf(cleared).encoding.x.axis).toBeUndefined();
  });

  it('uses the field-def format for theta (no axis on arcs)', () => {
    const pie = envelope({ mark: 'arc', encoding: { theta: { field: 'revenue', type: 'quantitative' }, color: { field: 'region', type: 'nominal' } } });
    const next = setChannelPresentation(pie, 'theta', { format: '$,.0f' });
    expect(specOf(next).encoding.theta.format).toBe('$,.0f');
    expect(specOf(next).encoding.theta.axis).toBeUndefined();
  });
});

describe('getChannelPresentation', () => {
  it('reads title and format back', () => {
    const env = setChannelPresentation(setChannelPresentation(envelope(BAR()), 'y', { title: 'Rev' }), 'y', { format: ',.0f' });
    expect(getChannelPresentation(env, 'y')).toEqual({ title: 'Rev', format: ',.0f' });
    expect(getChannelPresentation(envelope(BAR()), 'x')).toEqual({ title: null, format: null });
  });
});

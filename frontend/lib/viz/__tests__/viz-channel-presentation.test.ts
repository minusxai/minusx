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

  // A temporal COLUMN on a DISCRETE axis (the heatmap x: temporal → ordinal band) still
  // takes date patterns — but ordinal axes treat `format` as a NUMBER format, and
  // d3-format('%b %Y') THROWS inside the vega dataflow (silent blank chart); VL also
  // DROPS formatType:'utc' as a custom type, and 'time' shifts Z-dates a month back
  // locally. The temporalKind flag therefore writes a UTC labelExpr instead of `format`.
  it('temporal column on a discrete axis: date formats become a UTC labelExpr', () => {
    const heatmap = envelope({ mark: { type: 'rect' }, encoding: {
      x: { field: 'week_start', type: 'ordinal' },
      y: { field: 'category', type: 'nominal' },
      color: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    } });
    const next = setChannelPresentation(heatmap, 'x', { format: '%b %Y' }, { temporalKind: true });
    expect(specOf(next).encoding.x.axis).toEqual({ labelExpr: 'utcFormat(toDate(datum.value), "%b %Y")' });
  });

  it("date patterns with apostrophes (Jan '25) survive the labelExpr round-trip", () => {
    const heatmap = envelope({ mark: { type: 'rect' }, encoding: {
      x: { field: 'week_start', type: 'ordinal' },
      y: { field: 'category', type: 'nominal' },
    } });
    const next = setChannelPresentation(heatmap, 'x', { format: "%b '%y" }, { temporalKind: true });
    expect(specOf(next).encoding.x.axis.labelExpr).toBe('utcFormat(toDate(datum.value), "%b \'%y")');
    expect(getChannelPresentation(next, 'x').format).toBe("%b '%y");
  });

  it('reads the format back out of the discrete-axis labelExpr (popover round-trip)', () => {
    const heatmap = envelope({ mark: { type: 'rect' }, encoding: {
      x: { field: 'week_start', type: 'ordinal' },
      y: { field: 'category', type: 'nominal' },
    } });
    const withFmt = setChannelPresentation(heatmap, 'x', { format: '%b %Y' }, { temporalKind: true });
    expect(getChannelPresentation(withFmt, 'x').format).toBe('%b %Y');
  });

  it('clearing the format on a discrete temporal axis drops the labelExpr', () => {
    const heatmap = envelope({ mark: { type: 'rect' }, encoding: {
      x: { field: 'week_start', type: 'ordinal' },
      y: { field: 'category', type: 'nominal' },
    } });
    const withFmt = setChannelPresentation(heatmap, 'x', { format: '%b %Y' }, { temporalKind: true });
    const cleared = setChannelPresentation(withFmt, 'x', { format: null }, { temporalKind: true });
    expect(specOf(cleared).encoding.x.axis).toBeUndefined();
  });

  it('a true temporal channel keeps plain axis.format (VL time-formats natively)', () => {
    const next = setChannelPresentation(envelope(BAR()), 'x', { format: '%b %Y' }, { temporalKind: true });
    expect(specOf(next).encoding.x.axis).toEqual({ format: '%b %Y' });
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

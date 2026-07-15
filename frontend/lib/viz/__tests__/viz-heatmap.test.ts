/**
 * Heatmap as a first-class V2 viz type — a NATIVE vega-lite rect spec (like pie:
 * no recipe, so the Fields zones work directly). Replaces the pivot's compact
 * "GitHub-graph" mode as the way to visualize a cross-tab as colour.
 */
import { describe, it, expect } from 'vitest';
import {
  V2_SUPPORTED_VIZ_TYPES,
  getVizType,
  zonesForVizType,
  setEnvelopeVizType,
  getEnvelopeVizType,
} from '../encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const COLUMNS = [
  { name: 'region', kind: 'nominal' as const },
  { name: 'month', kind: 'nominal' as const },
  { name: 'revenue', kind: 'quantitative' as const },
];

const pivotEnvelope = {
  version: 2,
  source: {
    kind: 'pivot',
    config: {
      rows: ['region'],
      columns: ['month'],
      values: [{ column: 'revenue', aggFunction: 'SUM' }],
    },
    columnFormats: null,
    css: null,
  },
} as unknown as VizEnvelope;

const tableEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
} as unknown as VizEnvelope;

const specOf = (env: VizEnvelope) => (env.source as unknown as { spec: Record<string, unknown> }).spec;
const encodingOf = (env: VizEnvelope) => specOf(env).encoding as Record<string, Record<string, unknown>>;

describe('heatmap viz type', () => {
  it('is a supported V2 type', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('heatmap');
  });

  it('getVizType classifies a rect mark as heatmap', () => {
    expect(getVizType({ mark: { type: 'rect' }, encoding: {} })).toBe('heatmap');
  });

  it('zones are X / Y / Value(color)', () => {
    const zones = zonesForVizType('heatmap');
    expect(zones.map(z => z.channel)).toEqual(['x', 'y', 'color']);
  });

  it('pivot → heatmap maps columns[0]→x, rows[0]→y, values[0]→SUM color', () => {
    const next = setEnvelopeVizType(pivotEnvelope, 'heatmap', COLUMNS);
    expect((next.source as unknown as { kind: string }).kind).toBe('vega-lite');
    const enc = encodingOf(next);
    expect((specOf(next).mark as { type: string }).type).toBe('rect');
    expect(enc.x).toMatchObject({ field: 'month', type: 'nominal' });
    expect(enc.y).toMatchObject({ field: 'region', type: 'nominal' });
    expect(enc.color).toMatchObject({ field: 'revenue', aggregate: 'sum', type: 'quantitative' });
    expect(getEnvelopeVizType(next)).toBe('heatmap');
  });

  it('table → heatmap uses the columns fallback: first two categories + measure', () => {
    const next = setEnvelopeVizType(tableEnvelope, 'heatmap', COLUMNS);
    const enc = encodingOf(next);
    expect((specOf(next).mark as { type: string }).type).toBe('rect');
    expect(enc.x).toMatchObject({ field: 'region' });
    expect(enc.y).toMatchObject({ field: 'month' });
    expect(enc.color).toMatchObject({ field: 'revenue', aggregate: 'sum', type: 'quantitative' });
  });

  it('bar with a colour series → heatmap: series becomes y, measure becomes color', () => {
    const bar = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'bar' },
          encoding: {
            x: { field: 'month', type: 'nominal' },
            y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
            color: { field: 'region', type: 'nominal' },
          },
        },
      },
    } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(bar, 'heatmap', COLUMNS);
    const enc = encodingOf(next);
    expect(enc.x).toMatchObject({ field: 'month' });
    expect(enc.y).toMatchObject({ field: 'region' });
    expect(enc.color).toMatchObject({ field: 'revenue', aggregate: 'sum', type: 'quantitative' });
  });

  it('heatmap → bar round-trips: color measure returns to y, y category to series', () => {
    const heat = setEnvelopeVizType(pivotEnvelope, 'heatmap', COLUMNS);
    const back = setEnvelopeVizType(heat, 'bar', COLUMNS);
    const enc = encodingOf(back);
    expect((specOf(back).mark as { type: string }).type).toBe('bar');
    expect(enc.x).toMatchObject({ field: 'month' });
    expect(enc.y).toMatchObject({ field: 'revenue', type: 'quantitative' });
    expect(enc.color).toMatchObject({ field: 'region' });
  });
});

describe('house heatmap look (GitHub-graph) — theme-owned, like the pie donut', () => {
  it('quantitative rect colour pulls the GitHub green ramps per mode (range.heatmap)', async () => {
    const { getVegaLiteConfig } = await import('../theme');
    const light = getVegaLiteConfig('light') as Record<string, any>;
    const dark = getVegaLiteConfig('dark') as Record<string, any>;
    expect(light.range.heatmap).toEqual(['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']);
    // Dark low end sits one step above the card surface (#161B22) so the lowest
    // value still reads as a cell.
    expect(dark.range.heatmap).toEqual(['#21262d', '#0e4429', '#006d32', '#26a641', '#39d353']);
  });

  it('rect marks default to rounded cells with a constant-pixel gap (surface-colour stroke)', async () => {
    const { getVegaLiteConfig } = await import('../theme');
    const light = getVegaLiteConfig('light') as Record<string, any>;
    const dark = getVegaLiteConfig('dark') as Record<string, any>;
    expect(light.rect.cornerRadius).toBe(5);
    expect(light.rect.strokeWidth).toBe(4);
    expect(light.rect.stroke).toBe('#FFFFFF');   // light card surface
    expect(dark.rect.stroke).toBe('#161B22');    // dark card surface
    expect(light.rect.discreteBandSize).toBeUndefined();
  });
});

describe('heatmap discrete axes & cell layout', () => {
  it('zone-dropping a temporal column onto rect x/y types it ORDINAL (discrete bands)', async () => {
    const { setZoneField } = await import('../encoding-edit');
    const heat = setEnvelopeVizType(pivotEnvelope, 'heatmap', COLUMNS);
    const next = setZoneField(heat, 'x', { name: 'week_start', kind: 'temporal' });
    const enc = encodingOf(next);
    expect(enc.x).toMatchObject({ field: 'week_start', type: 'ordinal' });
  });

  it('temporal stays temporal on non-rect marks (bar keeps time axes)', async () => {
    const { setZoneField } = await import('../encoding-edit');
    const bar = {
      version: 2,
      source: {
        kind: 'vega-lite', grammar: 'vega-lite@6',
        spec: { mark: { type: 'bar' }, encoding: { y: { field: 'revenue', type: 'quantitative' } } },
      },
    } as unknown as VizEnvelope;
    const next = setZoneField(bar, 'x', { name: 'week_start', kind: 'temporal' });
    expect(encodingOf(next).x).toMatchObject({ field: 'week_start', type: 'temporal' });
  });

  it('compile injects FLUSH bands on rect discrete axes (gap = theme stroke, not padding)', async () => {
    const { injectHeatmapCellLayout } = await import('../render-vega');
    const spec: Record<string, any> = {
      mark: { type: 'rect' },
      encoding: {
        x: { field: 'month', type: 'nominal' },
        y: { field: 'region', type: 'ordinal' },
        color: { field: 'revenue', aggregate: 'sum', type: 'quantitative' },
      },
    };
    injectHeatmapCellLayout(spec);
    expect(spec.encoding.x.scale).toMatchObject({ paddingInner: 0, paddingOuter: 0 });
    expect(spec.encoding.y.scale).toMatchObject({ paddingInner: 0, paddingOuter: 0 });
    expect(spec.encoding.color.scale).toBeUndefined();
  });

  it('author-set scale padding on a channel is respected', async () => {
    const { injectHeatmapCellLayout } = await import('../render-vega');
    const spec: Record<string, any> = {
      mark: { type: 'rect' },
      encoding: { x: { field: 'month', type: 'nominal', scale: { paddingInner: 0.3 } } },
    };
    injectHeatmapCellLayout(spec);
    expect(spec.encoding.x.scale).toEqual({ paddingInner: 0.3 });
  });

  it('non-rect specs are untouched', async () => {
    const { injectHeatmapCellLayout } = await import('../render-vega');
    const spec: Record<string, any> = {
      mark: { type: 'bar' },
      encoding: { x: { field: 'month', type: 'nominal' } },
    };
    injectHeatmapCellLayout(spec);
    expect(spec.encoding.x.scale).toBeUndefined();
  });

  it('theme thins overlapping axis labels by default (100-week ordinal axes)', async () => {
    const { getVegaLiteConfig } = await import('../theme');
    const config = getVegaLiteConfig('light') as Record<string, any>;
    expect(config.axis.labelOverlap).toBe(true);
  });
});

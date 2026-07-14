/**
 * V2 (Vega/Vega-Lite envelope) chart → JPEG, headless path (Viz Arch V2 §21 item 2).
 * Proves an envelope rasterizes to a real JPEG buffer via the shared compositor, and
 * that DOM-tier sources (table/pivot) are correctly not image-able.
 */
import { describe, it, expect } from 'vitest';
import { renderVizEnvelopeToJpeg } from '@/lib/chart/render-viz-image';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import { vizSettingsToEnvelope } from '@/lib/viz/from-vizsettings';
import type { VizSettings } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'month', kind: 'nominal' },
  { name: 'revenue', kind: 'quantitative' },
];
const ROWS = [
  { month: 'Jan', revenue: 100 },
  { month: 'Feb', revenue: 200 },
  { month: 'Mar', revenue: 150 },
];
const vs = (type: VizSettings['type'], extra: Partial<VizSettings> = {}): VizSettings => ({
  type, xCols: ['month'], yCols: ['revenue'], yRightCols: null, tooltipCols: null,
  pivotConfig: null, columnFormats: null, conditionalFormats: null, styleConfig: null,
  annotations: null, axisConfig: null, trendConfig: null, geoConfig: null, singleValueConfig: null,
  ...extra,
});

// JPEG files begin with the SOI marker FF D8 FF.
const isJpeg = (buf: Buffer) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

describe('isEnvelopeImageViz', () => {
  it('is true for a chart (vega-lite) envelope, false for table/pivot', () => {
    expect(isEnvelopeImageViz(vizSettingsToEnvelope(vs('bar'), COLUMNS))).toBe(true);
    expect(isEnvelopeImageViz(vizSettingsToEnvelope(vs('funnel', { xCols: ['month'], yCols: ['revenue'] })))).toBe(true);
    expect(isEnvelopeImageViz(vizSettingsToEnvelope(vs('table')))).toBe(false);
    expect(isEnvelopeImageViz(vizSettingsToEnvelope(vs('pivot', { pivotConfig: { rows: [], columns: [], values: [] } })))).toBe(false);
  });
});

describe('renderVizEnvelopeToJpeg', () => {
  it('renders a vega-lite bar envelope to a JPEG buffer', async () => {
    const jpeg = await renderVizEnvelopeToJpeg(vizSettingsToEnvelope(vs('bar'), COLUMNS), ROWS, { width: 480, height: 300 });
    expect(jpeg).not.toBeNull();
    expect(isJpeg(jpeg!)).toBe(true);
    expect(jpeg!.length).toBeGreaterThan(500);
  });

  it('renders a native-vega recipe (funnel) envelope to a JPEG buffer', async () => {
    const env = vizSettingsToEnvelope(vs('funnel', { xCols: ['month'], yCols: ['revenue'] }));
    const jpeg = await renderVizEnvelopeToJpeg(env, ROWS, { width: 480, height: 300 });
    expect(jpeg).not.toBeNull();
    expect(isJpeg(jpeg!)).toBe(true);
  });

  it('returns null for a table envelope (not chart-renderable)', async () => {
    const jpeg = await renderVizEnvelopeToJpeg(vizSettingsToEnvelope(vs('table')), ROWS);
    expect(jpeg).toBeNull();
  });
});

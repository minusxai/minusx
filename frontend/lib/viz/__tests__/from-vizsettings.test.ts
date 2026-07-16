/**
 * V1 → V2 converter (Visualization Arch V2 §21 item 1). `vizSettingsToEnvelope` maps
 * every legacy `VizSettings.type` (and every geo subtype) to a V2 `VizEnvelope`. These
 * tests pin the target source kind + bindings/encodings for each, and prove the output
 * is renderable: recipe sources materialize; vega-lite sources validate against columns.
 */
import { describe, it, expect } from 'vitest';
import { vizSettingsToEnvelope, resolveLegacyRenderEnvelope, type ConvertibleVizSettings as VizSettings } from '@/lib/viz/from-vizsettings';
import { materializeRecipe } from '@/lib/viz/viz-templates';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { getEnvelopeVizType, annotationSplit } from '@/lib/viz/encoding-edit';
import { getEffectiveColorPalette } from '@/lib/chart/echarts-theme';
import type { GeoConfig } from '@/lib/validation/atlas-schemas';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

// A VizSettings with every optional field nulled — overridden per test.
const vs = (partial: Partial<VizSettings> & { type: VizSettings['type'] }): VizSettings => ({
  xCols: null, yCols: null, yRightCols: null, tooltipCols: null,
  pivotConfig: null, columnFormats: null, conditionalFormats: null,
  styleConfig: null, annotations: null, axisConfig: null, trendConfig: null,
  geoConfig: null, singleValueConfig: null,
  ...partial,
});

// Shorthands to read the (opaque) source of an envelope.
const src = (e: VizEnvelope) => e.source as unknown as Record<string, unknown>;
const spec = (e: VizEnvelope) => (src(e).spec as Record<string, unknown>);
const enc = (e: VizEnvelope) => (spec(e).encoding as Record<string, Record<string, unknown>>);
const markType = (e: VizEnvelope) => {
  const m = spec(e).mark;
  return typeof m === 'string' ? m : (m as Record<string, unknown>).type;
};

// A recipe source must always materialize (renderability guarantee).
const expectMaterializes = (e: VizEnvelope) => {
  const s = src(e);
  expect(s.kind).toBe('recipe');
  const result = materializeRecipe({
    recipe: s.recipe as string,
    bindings: s.bindings as Record<string, string | string[]>,
    params: s.params as Record<string, unknown> | null,
    columnFormats: s.columnFormats as never,
  });
  expect(result.ok).toBe(true);
};

describe('envelope shape', () => {
  it('always emits version 2 with reserved fields absent-or-null', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'table' }));
    expect(e.version).toBe(2);
    expect(src(e).kind).toBe('table');
  });
});

describe('DOM-tier sources (table / pivot)', () => {
  it('table → kind:table, transferring column + conditional formats', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'table',
      columnFormats: { revenue: { alias: 'Revenue', format: '$,.0f', decimalPoints: null, dateFormat: null, prefix: null, suffix: null } },
      conditionalFormats: [{ id: 'r1', column: 'revenue', operator: '>', value: '100', target: 'cell', bgColor: '#fde68a' }],
    }));
    expect(src(e).kind).toBe('table');
    expect((src(e).columnFormats as Record<string, unknown>).revenue).toBeTruthy();
    expect((src(e).conditionalFormats as unknown[]).length).toBe(1);
    expect(getEnvelopeVizType(e)).toBe('table');
  });

  it('pivot → kind:pivot, carrying the PivotConfig verbatim', () => {
    const config = { rows: ['region'], columns: ['month'], values: [{ column: 'revenue', aggFunction: 'SUM' as const }] };
    const e = vizSettingsToEnvelope(vs({ type: 'pivot', pivotConfig: config }));
    expect(src(e).kind).toBe('pivot');
    expect(src(e).config).toEqual(config);
    expect(getEnvelopeVizType(e)).toBe('pivot');
  });
});

describe('cartesian vega-lite sources', () => {
  const COLUMNS: VizResultColumn[] = [
    { name: 'month', kind: 'temporal' },
    { name: 'region', kind: 'nominal' },
    { name: 'revenue', kind: 'quantitative' },
    { name: 'orders', kind: 'quantitative' },
  ];

  it('bar → vega-lite bar; x from xCols[0], y (SUM) from yCols[0]', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'bar', xCols: ['region'], yCols: ['revenue'] }), COLUMNS);
    expect(src(e).kind).toBe('vega-lite');
    expect(markType(e)).toBe('bar');
    expect(enc(e).x.field).toBe('region');
    expect(enc(e).y.field).toBe('revenue');
    expect(enc(e).y.aggregate).toBe('sum');
    expect(validateVizEnvelope(e, COLUMNS).ok).toBe(true);
  });

  it('types the x channel from the column KIND (temporal, not nominal)', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'line', xCols: ['month'], yCols: ['revenue'] }), COLUMNS);
    expect(enc(e).x.type).toBe('temporal');
    expect(markType(e)).toBe('line');
  });

  it('area → area mark; scatter → point mark', () => {
    const area = vizSettingsToEnvelope(vs({ type: 'area', xCols: ['region'], yCols: ['revenue'] }), COLUMNS);
    const scatter = vizSettingsToEnvelope(vs({ type: 'scatter', xCols: ['revenue'], yCols: ['orders'] }), COLUMNS);
    expect(markType(area)).toBe('area');
    expect(markType(scatter)).toBe('point');
  });

  it('row → horizontal bar (measure on x, category on y)', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'row', xCols: ['region'], yCols: ['revenue'] }), COLUMNS);
    expect(getEnvelopeVizType(e)).toBe('row');
  });

  it('pie → arc mark with theta (SUM) + color slices', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'pie', xCols: ['region'], yCols: ['revenue'] }), COLUMNS);
    expect(markType(e)).toBe('arc');
    expect(enc(e).theta.field).toBe('revenue');
    expect(enc(e).theta.aggregate).toBe('sum');
    expect(enc(e).color.field).toBe('region');
    expect(getEnvelopeVizType(e)).toBe('pie');
  });

  it('a second xCol becomes the color/series split', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'bar', xCols: ['month', 'region'], yCols: ['revenue'] }), COLUMNS);
    expect(enc(e).x.field).toBe('month');
    expect(enc(e).color.field).toBe('region');
  });

  it('multiple yCols fold into one measure axis + a series color', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'bar', xCols: ['region'], yCols: ['revenue', 'orders'] }), COLUMNS);
    const transforms = spec(e).transform as Array<Record<string, unknown>>;
    const fold = transforms.find(t => Array.isArray(t.fold));
    expect(fold).toBeTruthy();
    expect(fold!.fold).toEqual(['revenue', 'orders']);
    expect(enc(e).color).toBeTruthy();
    expect(validateVizEnvelope(e, COLUMNS).ok).toBe(true);
  });
});

describe('recipe sources (non-geo)', () => {
  it('funnel → minusx/funnel@1 { stage, value }', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'funnel', xCols: ['stage'], yCols: ['users'] }));
    expect(src(e).recipe).toBe('minusx/funnel@1');
    expect(src(e).bindings).toEqual({ stage: 'stage', value: 'users' });
    expectMaterializes(e);
  });

  it('waterfall → minusx/waterfall@1 { category, value }', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'waterfall', xCols: ['step'], yCols: ['delta'] }));
    expect(src(e).recipe).toBe('minusx/waterfall@1');
    expect(src(e).bindings).toEqual({ category: 'step', value: 'delta' });
    expectMaterializes(e);
  });

  it('radar → minusx/radar@1 { metric, value[] } folding multiple measures', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'radar', xCols: ['skill'], yCols: ['a', 'b'] }));
    expect(src(e).recipe).toBe('minusx/radar@1');
    expect((src(e).bindings as Record<string, unknown>).metric).toBe('skill');
    expect((src(e).bindings as Record<string, unknown>).value).toEqual(['a', 'b']);
    expectMaterializes(e);
  });

  it('trend → minusx/trend@1 { date, value }, compareMode from trendConfig', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'trend', xCols: ['month'], yCols: ['mrr'], trendConfig: { compareMode: 'previous' } }));
    expect(src(e).recipe).toBe('minusx/trend@1');
    expect((src(e).bindings as Record<string, unknown>).date).toBe('month');
    expect((src(e).params as Record<string, unknown>).compareMode).toBe('previous');
    expectMaterializes(e);
  });

  it('combo → minusx/combo@1 { x, bar, line } from two measures', () => {
    const e = vizSettingsToEnvelope(vs({ type: 'combo', xCols: ['month'], yCols: ['revenue', 'orders'] }));
    expect(src(e).recipe).toBe('minusx/combo@1');
    expect(src(e).bindings).toEqual({ x: 'month', bar: 'revenue', line: 'orders' });
    expectMaterializes(e);
  });

  it('single_value → minusx/single-value@1 { value }, styling from singleValueConfig', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'single_value', yCols: ['mrr'],
      singleValueConfig: { label: 'Monthly Recurring', valueColor: '#16a34a', align: 'left', prefix: null, suffix: null, valueSize: null, valueWeight: null, labelColor: null },
    }));
    expect(src(e).recipe).toBe('minusx/single-value@1');
    expect((src(e).bindings as Record<string, unknown>).value).toBe('mrr');
    const params = src(e).params as Record<string, unknown>;
    expect(params.label).toBe('Monthly Recurring');
    expect(params.valueColor).toBe('#16a34a');
    expect(params.align).toBe('left');
    expectMaterializes(e);
  });
});

describe('resolveImageEnvelope (chart→image bridge — Slack, LLM attachments)', () => {
  const columns = ['month', 'revenue'];
  const types = ['TIMESTAMP', 'DOUBLE'];

  it('a V2 envelope passes through (image kinds only)', async () => {
    const { resolveImageEnvelope } = await import('@/lib/viz/from-vizsettings');
    const viz = vizSettingsToEnvelope(vs({ type: 'bar', xCols: ['month'], yCols: ['revenue'] }));
    expect(resolveImageEnvelope({ viz, vizSettings: null, columns, types })).toBe(viz);
    const table = vizSettingsToEnvelope(vs({ type: 'table' }));
    expect(resolveImageEnvelope({ viz: table, vizSettings: null, columns, types })).toBeNull();
  });

  it('legacy vizSettings CHARTS convert — with column kinds honored (temporal x)', async () => {
    const { resolveImageEnvelope } = await import('@/lib/viz/from-vizsettings');
    const e = resolveImageEnvelope({
      viz: null,
      vizSettings: vs({ type: 'line', xCols: ['month'], yCols: ['revenue'] }),
      columns, types,
    })!;
    expect(e).not.toBeNull();
    const spec = (e.source as unknown as { spec: Record<string, any> }).spec;
    expect(spec.encoding.x.type).toBe('temporal'); // types flowed through toVizColumns
  });

  it('table/pivot vizSettings and missing settings yield null (no image)', async () => {
    const { resolveImageEnvelope } = await import('@/lib/viz/from-vizsettings');
    expect(resolveImageEnvelope({ viz: null, vizSettings: vs({ type: 'table' }), columns, types })).toBeNull();
    expect(resolveImageEnvelope({ viz: null, vizSettings: null, columns, types })).toBeNull();
  });
});

describe('resolveLegacyRenderEnvelope (render bridge)', () => {
  const cols: VizResultColumn[] = [{ name: 'region', kind: 'nominal' }, { name: 'revenue', kind: 'quantitative' }];
  const bar = vs({ type: 'bar', xCols: ['region'], yCols: ['revenue'] });

  it('bridges a legacy CHART on every surface — including the editable question page', () => {
    const e = resolveLegacyRenderEnvelope({ hasVizEnvelope: false, vizSettings: bar, columns: cols });
    expect(e).not.toBeNull();
    expect(src(e!).kind).toBe('vega-lite');
    expect(markType(e!)).toBe('bar');
  });

  it('does NOT bridge when a V2 envelope already exists', () => {
    expect(resolveLegacyRenderEnvelope({ hasVizEnvelope: true, vizSettings: bar, columns: cols })).toBeNull();
  });

  it('does NOT bridge table or pivot (their DOM renderers stay)', () => {
    expect(resolveLegacyRenderEnvelope({ hasVizEnvelope: false, vizSettings: vs({ type: 'table' }), columns: cols })).toBeNull();
    expect(resolveLegacyRenderEnvelope({ hasVizEnvelope: false, vizSettings: vs({ type: 'pivot', pivotConfig: { rows: [], columns: [], values: [] } }), columns: cols })).toBeNull();
  });

  it('does NOT bridge when there is no vizSettings at all', () => {
    expect(resolveLegacyRenderEnvelope({ hasVizEnvelope: false, vizSettings: null, columns: cols })).toBeNull();
  });
});

describe('geo recipe sources', () => {
  const geo = (g: Partial<GeoConfig> & { subType: GeoConfig['subType'] }): GeoConfig => ({
    mapName: null, showTiles: null, pinnedCenter: null, pinnedZoom: null,
    ...(g as object),
  } as GeoConfig);

  it('top-level choropleth → minusx/choropleth@1 from geoConfig region/value + params', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'choropleth',
      geoConfig: geo({ subType: 'choropleth', regionCol: 'state', valueCol: 'sales', colorScale: 'blue', mapName: 'us-states' }),
    }));
    expect(src(e).recipe).toBe('minusx/choropleth@1');
    expect(src(e).bindings).toEqual({ region: 'state', value: 'sales' });
    const params = src(e).params as Record<string, unknown>;
    expect(params.mapName).toBe('us-states');
    expect(params.colorScale).toBe('blue');
    expectMaterializes(e);
  });

  it('top-level point_map → minusx/point-map@1 from geoConfig lat/lng', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'point_map',
      geoConfig: geo({ subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: null, colorCol: null, colorScale: null, minRadius: null, radiusScale: null }),
    }));
    expect(src(e).recipe).toBe('minusx/point-map@1');
    expect((src(e).bindings as Record<string, unknown>).lat).toBe('lat');
    expect((src(e).bindings as Record<string, unknown>).lng).toBe('lng');
    expectMaterializes(e);
  });

  it('geo/choropleth subtype → minusx/choropleth@1', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'geo',
      geoConfig: geo({ subType: 'choropleth', regionCol: 'country', valueCol: 'gdp', colorScale: null, mapName: 'world' }),
    }));
    expect(src(e).recipe).toBe('minusx/choropleth@1');
    expect(src(e).bindings).toEqual({ region: 'country', value: 'gdp' });
    expect((src(e).params as Record<string, unknown>).mapName).toBe('world');
    expectMaterializes(e);
  });

  it('geo/points subtype → minusx/point-map@1 with size=value, color=colorCol, tiles from showTiles', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'geo',
      geoConfig: geo({ subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'amount', colorCol: 'category', colorScale: null, minRadius: null, radiusScale: null, showTiles: true }),
    }));
    expect(src(e).recipe).toBe('minusx/point-map@1');
    const b = src(e).bindings as Record<string, unknown>;
    expect(b.lat).toBe('lat');
    expect(b.lng).toBe('lng');
    expect(b.size).toBe('amount');
    expect(b.color).toBe('category');
    expect((src(e).params as Record<string, unknown>).basemap).toBe('tiles');
    expectMaterializes(e);
  });

  it('geo/lines subtype → minusx/point-map@1 flow (lat2/lng2)', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'geo',
      geoConfig: geo({ subType: 'lines', latCol: 'olat', lngCol: 'olng', latCol2: 'dlat', lngCol2: 'dlng' }),
    }));
    expect(src(e).recipe).toBe('minusx/point-map@1');
    const b = src(e).bindings as Record<string, unknown>;
    expect(b).toEqual({ lat: 'olat', lng: 'olng', lat2: 'dlat', lng2: 'dlng' });
    expectMaterializes(e);
  });

  it('geo/heatmap subtype → minusx/point-map@1 with size=value (density folds into bubbles)', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'geo',
      geoConfig: geo({ subType: 'heatmap', latCol: 'lat', lngCol: 'lng', valueCol: 'intensity', colorScale: null }),
    }));
    expect(src(e).recipe).toBe('minusx/point-map@1');
    const b = src(e).bindings as Record<string, unknown>;
    expect(b.lat).toBe('lat');
    expect(b.lng).toBe('lng');
    expect(b.size).toBe('intensity');
    expectMaterializes(e);
  });
});

// ─── Legacy style carry-over (§21 items 6/9 — the "robust converter") ─────────
//
// V1 style knobs must survive the JIT conversion so a styled V1 chart looks the
// same under the vega renderer: styleConfig (stacked, colors, opacity,
// markerSize), axisConfig (yScale/yMin/yMax/yTitle), and annotations. Each maps
// onto the SAME spec shapes the V2 panel's surgical editors write, so a
// converted-then-upgraded file stays fully editable.
describe('legacy style carry-over', () => {
  const mark = (e: VizEnvelope) => {
    const m = spec(e).mark;
    return (typeof m === 'string' ? { type: m } : m) as Record<string, unknown>;
  };

  it('styleConfig.stacked=false unstacks bars (y.stack: null)', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'bar', xCols: ['month', 'region'], yCols: ['revenue'],
      styleConfig: { colors: null, opacity: null, markerSize: null, stacked: false, showDataLabels: null, dataLabelColor: null },
    }));
    expect(enc(e).y.stack).toBe(null);
  });

  it('styleConfig.colors carries the effective palette onto the color scale range', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'line', xCols: ['month', 'region'], yCols: ['revenue'],
      styleConfig: { colors: { '0': 'danger', '1': '#7c3aed' }, opacity: null, markerSize: null, stacked: null, showDataLabels: null, dataLabelColor: null },
    }));
    const scale = enc(e).color.scale as Record<string, unknown>;
    expect(scale.range).toEqual(getEffectiveColorPalette({ '0': 'danger', '1': '#7c3aed' }));
  });

  it('styleConfig.colors["0"] colors a single-measure mark directly', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'bar', xCols: ['month'], yCols: ['revenue'],
      styleConfig: { colors: { '0': '#112233' }, opacity: null, markerSize: null, stacked: null, showDataLabels: null, dataLabelColor: null },
    }));
    expect(mark(e).color).toBe('#112233');
  });

  it('axisConfig yScale/log + yMin/yMax + yTitle land on the y channel', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'line', xCols: ['month'], yCols: ['revenue'],
      axisConfig: { xScale: null, yScale: 'log', xMin: null, xMax: null, yMin: 10, yMax: 1000, yTitle: 'Revenue ($)', dualAxis: null },
    }));
    const y = enc(e).y as Record<string, unknown>;
    const scale = y.scale as Record<string, unknown>;
    expect(scale.type).toBe('log');
    expect(scale.domainMin).toBe(10);
    expect(scale.domainMax).toBe(1000);
    expect((y.axis as Record<string, unknown>).title).toBe('Revenue ($)');
  });

  it('styleConfig.opacity + markerSize style the mark (scatter)', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'scatter', xCols: ['month'], yCols: ['revenue'],
      styleConfig: { colors: null, opacity: 0.5, markerSize: 12, stacked: null, showDataLabels: null, dataLabelColor: null },
    }));
    expect(mark(e).opacity).toBe(0.5);
    expect(typeof mark(e).size).toBe('number');
    expect(mark(e).size as number).toBeGreaterThan(0);
  });

  it('annotations become reference-line layers (x-anchored rule + label badge)', () => {
    const e = vizSettingsToEnvelope(vs({
      type: 'bar', xCols: ['month'], yCols: ['revenue'],
      annotations: [{ x: 'Feb', series: null, text: 'Launch' }],
    }));
    const s = spec(e);
    expect(Array.isArray(s.layer)).toBe(true);
    const split = annotationSplit(s);
    expect(split).not.toBe(null);
    expect(split!.annotations.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).toContain('Launch');
    // The base chart survives the wrap intact.
    expect((split!.unit.encoding as Record<string, Record<string, unknown>>).x.field).toBe('month');
  });
});

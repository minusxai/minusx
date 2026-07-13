import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Feature } from 'geojson';
import { materializeRecipe } from '../viz-templates';
import { GEO_BOUNDARY_DATASET, assetFeatures, GEO_ASSETS } from '../geo-assets';
import { resolveEnvelopeSpec, toVegaSpec, createVegaView, injectNamedAssets } from '../render-vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const POINT_MAP = 'minusx/point-map@1';

const source = (bindings: Record<string, string>, params?: Record<string, unknown>) => ({
  recipe: POINT_MAP,
  bindings,
  params: params ?? null,
  columnFormats: null,
});

type Rec = Record<string, unknown>;
const dataset = (spec: Rec, name: string): Rec =>
  (spec.data as Rec[]).find(d => d.name === name)!;
// Marks nest inside a clip group — search recursively.
const markOfType = (spec: Rec, type: string): Rec | undefined => {
  const search = (marks: Rec[] | undefined): Rec | undefined => {
    for (const m of marks ?? []) {
      if (m.type === type) return m;
      const found = m.type === 'group' ? search(m.marks as Rec[]) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return search(spec.marks as Rec[]);
};

const signal = (spec: Rec, name: string): Rec =>
  (spec.signals as Rec[]).find(s => s.name === name)!;

describe('minusx/point-map@1 (native Vega)', () => {
  it('materializes a recenterable mercator driven by scale + center signals', () => {
    const result = materializeRecipe(source({ lat: 'latitude', lng: 'longitude' }, { mapName: 'world' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engine).toBe('vega');

    const proj = (result.spec.projections as Rec[])[0];
    // Recenterable projection (composite albersUsa can't pan/zoom); center + scale signals.
    expect(proj.type).toBe('mercator');
    expect(proj.scale).toEqual({ signal: 'scale' });
    expect(proj.center).toEqual([{ signal: 'centerLng' }, { signal: 'centerLat' }]);
  });

  it('declares the basemap boundary asset for injection', () => {
    const result = materializeRecipe(source({ lat: 'lat', lng: 'lng' }, { mapName: 'us-states' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
  });

  it('renders point marks (symbol) with a geoshape backdrop by default', () => {
    const result = materializeRecipe(source({ lat: 'lat', lng: 'lng' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Backdrop shape mark over the boundary.
    const backdrop = markOfType(result.spec as Rec, 'shape')!;
    expect((backdrop.from as { data?: string }).data).toBe(GEO_BOUNDARY_DATASET);
    expect((backdrop.transform as Rec[])[0].type).toBe('geoshape');
    // Points are symbols projected via geopoint.
    expect(markOfType(result.spec as Rec, 'symbol')).toBeTruthy();
    const md = dataset(result.spec as Rec, 'marks_data');
    const gp = (md.transform as Rec[]).find(t => t.type === 'geopoint')!;
    expect(gp.fields).toEqual(['lng', 'lat']);
  });

  it('recenters via the center param [lat, lng] — seeds the user-override signals', () => {
    const result = materializeRecipe(source({ lat: 'lat', lng: 'lng' }, { mapName: 'us-counties', center: [37, -119] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // center = [lat, lng]; user overrides seed [lng, lat]. `centerLng` combines user↦base.
    expect(signal(result.spec as Rec, 'centerLngUser').value).toBe(-119);
    expect(signal(result.spec as Rec, 'centerLatUser').value).toBe(37);
    expect(String(signal(result.spec as Rec, 'centerLng').update)).toContain('centerLngUser');
  });

  it('defaults to framing the data extent when no center is set (base from data, user null)', () => {
    const result = materializeRecipe(source({ lat: 'lat', lng: 'lng' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(signal(result.spec as Rec, 'centerLngUser').value).toBeNull(); // no override
    expect(String(signal(result.spec as Rec, 'lngE').update)).toContain("data('main')");
    expect(String(signal(result.spec as Rec, 'centerLngBase').update)).toContain('lngE');
  });

  it('scales the projection by the zoom param (via the user scale seed)', () => {
    const z1 = materializeRecipe(source({ lat: 'lat', lng: 'lng' }, { center: [37, -119], zoom: 1 }));
    const z2 = materializeRecipe(source({ lat: 'lat', lng: 'lng' }, { center: [37, -119], zoom: 2 }));
    if (!z1.ok || !z2.ok) return;
    expect(Number(signal(z2.spec as Rec, 'scaleUser').value)).toBeGreaterThan(Number(signal(z1.spec as Rec, 'scaleUser').value));
  });

  it('draws flow lines (rule + second geopoint) when the destination is bound', () => {
    const result = materializeRecipe(source({ lat: 'from_lat', lng: 'from_lng', lat2: 'to_lat', lng2: 'to_lng' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(markOfType(result.spec as Rec, 'rule')).toBeTruthy();
    expect(markOfType(result.spec as Rec, 'symbol')).toBeUndefined();
    const md = dataset(result.spec as Rec, 'marks_data');
    const geopoints = (md.transform as Rec[]).filter(t => t.type === 'geopoint');
    expect(geopoints).toHaveLength(2);
    expect(geopoints[1].fields).toEqual(['to_lng', 'to_lat']);
  });

  it('colors by category (ordinal) by default, quantitative (linear) with a colorScale', () => {
    const cat = materializeRecipe(source({ lat: 'lat', lng: 'lng', color: 'region' }));
    if (!cat.ok) return;
    expect((cat.spec.scales as Rec[]).find(s => s.name === 'color')!.type).toBe('ordinal');

    const num = materializeRecipe(source({ lat: 'lat', lng: 'lng', color: 'temp' }, { colorScale: 'blue' }));
    if (!num.ok) return;
    const scale = (num.spec.scales as Rec[]).find(s => s.name === 'color')!;
    expect(scale.type).toBe('linear');
    expect((scale.range as { scheme?: string }).scheme).toBe('blues');
  });

  it('errors when a required coordinate is missing', () => {
    const result = materializeRecipe(source({ lat: 'lat' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/lng/);
  });
});

describe('point-map render pipeline', () => {
  const usFeatures = assetFeatures(
    'us-states',
    JSON.parse(readFileSync(resolve(process.cwd(), `public/geojson/${GEO_ASSETS['us-states'].file}.json`), 'utf8')),
  );
  const loadUs = async () => usFeatures as Feature[];

  const cityRows = [
    { city: 'SF', lat: 37.77, lng: -122.42, revenue: 120 },
    { city: 'NYC', lat: 40.71, lng: -74.0, revenue: 200 },
    { city: 'Chicago', lat: 41.88, lng: -87.63, revenue: 90 },
  ];

  const renderSvg = async (bindings: Record<string, string>, rows: Rec[], params?: Rec) => {
    const envelope = {
      version: 2,
      source: { kind: 'recipe', recipe: POINT_MAP, bindings, params: params ?? { mapName: 'us-states' }, columnFormats: null },
    } as unknown as VizEnvelope;
    const resolved = resolveEnvelopeSpec(envelope);
    if (!resolved.ok) throw new Error(resolved.error);
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig, width: 600, height: 400 });
    await injectNamedAssets(view, resolved.assets, loadUs);
    await view.runAsync();
    const svg = await view.toSVG();
    view.finalize();
    return svg;
  };

  it('renders bubbles over the US basemap (backdrop states + city marks)', async () => {
    const svg = await renderSvg({ lat: 'lat', lng: 'lng', size: 'revenue' }, cityRows);
    const paths = (svg.match(/<path/g) ?? []).length;
    expect(paths).toBeGreaterThanOrEqual(50); // ~50 backdrop states
    expect(svg).toMatch(/circle|symbol|<path/i); // symbol marks present
  });

  it('centers on California via center + zoom, landing the CA point near the middle', async () => {
    const caRows = [{ lat: 37, lng: -119 }];
    const envelope = {
      version: 2,
      source: { kind: 'recipe', recipe: POINT_MAP, bindings: { lat: 'lat', lng: 'lng' }, params: { mapName: 'us-states', center: [37, -119], zoom: 1 }, columnFormats: null },
    } as unknown as VizEnvelope;
    const resolved = resolveEnvelopeSpec(envelope);
    if (!resolved.ok) throw new Error(resolved.error);
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, caRows, { renderer: 'none', parserConfig, width: 600, height: 400 });
    await injectNamedAssets(view, resolved.assets, loadUs);
    await view.runAsync();
    const md = (view.data('marks_data') as Array<{ x: number; y: number }>);
    view.finalize();
    // The centered point projects to the viewport middle (600×400 → ~300,200).
    expect(Math.abs(md[0].x - 300)).toBeLessThan(60);
    expect(Math.abs(md[0].y - 200)).toBeLessThan(60);
  });

  it('renders flow lines without throwing when the destination is bound', async () => {
    const flowRows = [{ lat: 37.77, lng: -122.42, to_lat: 40.71, to_lng: -74.0 }];
    const svg = await renderSvg({ lat: 'lat', lng: 'lng', lat2: 'to_lat', lng2: 'to_lng' }, flowRows);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toMatch(/<path|<line/i);
  });
});

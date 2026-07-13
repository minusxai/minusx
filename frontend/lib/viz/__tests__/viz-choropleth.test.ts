import { describe, it, expect } from 'vitest';
import { materializeRecipe } from '../viz-templates';
import { GEO_BOUNDARY_DATASET } from '../geo-assets';
import { validateVizEnvelope } from '../validate';
import type { VizResultColumn } from '../types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const CHOROPLETH = 'minusx/choropleth@1';

const source = (bindings: Record<string, string>, params?: Record<string, unknown>) => ({
  recipe: CHOROPLETH,
  bindings,
  params: params ?? null,
  columnFormats: null,
});

/** Find the layer that carries the lookup transform (the data-bound choropleth layer). */
function lookupLayer(spec: Record<string, unknown>): Record<string, unknown> {
  const layers = spec.layer as Record<string, unknown>[];
  const found = layers.find(l => Array.isArray((l as { transform?: unknown }).transform));
  if (!found) throw new Error('no layer with a transform');
  return found;
}

describe('minusx/choropleth@1', () => {
  it('materializes a layered geoshape+lookup vega-lite spec', () => {
    const result = materializeRecipe(source({ region: 'state', value: 'revenue' }, { mapName: 'us-states' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engine).toBe('vega-lite');

    // Projection frames the boundary set.
    expect((result.spec.projection as { type?: string }).type).toBe('albersUsa');

    // Two layers: a background outline of every region + the value-colored choropleth.
    const layers = result.spec.layer as Record<string, unknown>[];
    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBe(2);

    // Both layers render the boundary geometry (not `main`).
    for (const layer of layers) {
      expect((layer.data as { name?: string }).name).toBe(GEO_BOUNDARY_DATASET);
      const mark = layer.mark as { type?: string };
      expect(mark.type).toBe('geoshape');
    }

    // The choropleth layer looks the value up from the query result by region name.
    const layer = lookupLayer(result.spec);
    const lookup = (layer.transform as Record<string, unknown>[]).find(t => 'lookup' in t)!;
    expect(lookup.lookup).toBe('properties.name');
    const from = lookup.from as { data: { name: string }; key: string; fields: string[] };
    expect(from.data.name).toBe('main');
    expect(from.key).toBe('state');
    expect(from.fields).toContain('revenue');

    // Fill encodes the looked-up value as a quantitative color.
    const color = (layer.encoding as Record<string, Record<string, unknown>>).color;
    expect(color.field).toBe('revenue');
    expect(color.type).toBe('quantitative');
  });

  it('declares its boundary asset for renderer injection', () => {
    const result = materializeRecipe(source({ region: 'state', value: 'revenue' }, { mapName: 'us-states' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
  });

  it('defaults the boundary when mapName is omitted', () => {
    const result = materializeRecipe(source({ region: 'state', value: 'revenue' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
    expect((result.spec.projection as { type?: string }).type).toBe('albersUsa');
  });

  it('maps mapName to the matching projection', () => {
    const world = materializeRecipe(source({ region: 'country', value: 'gdp' }, { mapName: 'world' }));
    expect(world.ok).toBe(true);
    if (!world.ok) return;
    expect((world.spec.projection as { type?: string }).type).toBe('equalEarth');
    expect(world.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'world' });

    const india = materializeRecipe(source({ region: 'st_nm', value: 'pop' }, { mapName: 'india-states' }));
    expect(india.ok).toBe(true);
    if (!india.ok) return;
    expect((india.spec.projection as { type?: string }).type).toBe('mercator');
  });

  it('falls back to the default boundary for an unknown mapName', () => {
    const result = materializeRecipe(source({ region: 'state', value: 'revenue' }, { mapName: 'mars' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
  });

  it('errors when a required binding is missing', () => {
    const result = materializeRecipe(source({ region: 'state' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/value/);
  });

  it('passes validation — the boundary dataset name is allowed, value binding checked', () => {
    const columns: VizResultColumn[] = [
      { name: 'state', kind: 'nominal' },
      { name: 'revenue', kind: 'quantitative' },
    ];
    const envelope = {
      version: 2,
      source: { kind: 'recipe', ...source({ region: 'state', value: 'revenue' }, { mapName: 'us-states' }) },
    } as unknown as VizEnvelope;
    const result = validateVizEnvelope(envelope, columns);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('flags a value binding that is not a query column', () => {
    const columns: VizResultColumn[] = [{ name: 'state', kind: 'nominal' }];
    const envelope = {
      version: 2,
      source: { kind: 'recipe', ...source({ region: 'state', value: 'revenue' }, { mapName: 'us-states' }) },
    } as unknown as VizEnvelope;
    const result = validateVizEnvelope(envelope, columns);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_FIELD_NOT_FOUND')).toBe(true);
  });
});

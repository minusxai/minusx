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

type Rec = Record<string, unknown>;
const dataset = (spec: Rec, name: string): Rec =>
  (spec.data as Rec[]).find(d => d.name === name)!;
const projection = (spec: Rec): Rec => (spec.projections as Rec[])[0];
// Marks nest inside a clip group — search recursively.
const marksOfType = (spec: Rec, type: string): Rec[] => {
  const out: Rec[] = [];
  const walk = (marks: Rec[] | undefined) => {
    for (const m of marks ?? []) {
      if (m.type === type) out.push(m);
      if (m.type === 'group') walk(m.marks as Rec[]);
    }
  };
  walk(spec.marks as Rec[]);
  return out;
};

describe('minusx/choropleth@1', () => {
  it('materializes a native-Vega geoshape+lookup spec (backdrop + value-colored regions)', () => {
    const result = materializeRecipe(source({ region: 'state', value: 'revenue' }, { mapName: 'us-states' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engine).toBe('vega');

    // Projection frames the boundary set.
    expect(projection(result.spec as Rec).type).toBe('albersUsa');

    // Two geoshape marks: a backdrop outline of every region + the value-colored choropleth.
    const shapes = marksOfType(result.spec as Rec, 'shape');
    expect(shapes.length).toBe(2);
    for (const shape of shapes) {
      expect((shape.transform as Rec[])[0].type).toBe('geoshape');
    }
    // Backdrop renders EVERY boundary region; choropleth renders only regions WITH data.
    const [backdrop, choro] = shapes;
    expect((backdrop.from as { data?: string }).data).toBe(GEO_BOUNDARY_DATASET);
    expect((choro.from as { data?: string }).data).toBe('choro');

    // The choropleth dataset looks the value up from the query result by region name.
    const choroData = dataset(result.spec as Rec, 'choro');
    expect((choroData.source as string)).toBe(GEO_BOUNDARY_DATASET);
    const lookup = (choroData.transform as Rec[]).find(t => t.type === 'lookup')!;
    expect(lookup.from).toBe('main');
    expect(lookup.key).toBe('state');
    expect(lookup.values).toContain('revenue');

    // Fill encodes the looked-up value through a linear color scale.
    const fill = ((choro.encode as Rec).update as Rec).fill as Rec;
    expect(fill.scale).toBe('color');
    expect(fill.field).toBe('revenue');
    const colorScale = (result.spec.scales as Rec[]).find(s => s.name === 'color')!;
    expect(colorScale.type).toBe('linear');
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
    expect(projection(result.spec as Rec).type).toBe('albersUsa');
  });

  it('maps mapName to the matching projection', () => {
    const world = materializeRecipe(source({ region: 'country', value: 'gdp' }, { mapName: 'world' }));
    expect(world.ok).toBe(true);
    if (!world.ok) return;
    expect(projection(world.spec as Rec).type).toBe('equalEarth');
    expect(world.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'world' });

    const india = materializeRecipe(source({ region: 'st_nm', value: 'pop' }, { mapName: 'india-states' }));
    expect(india.ok).toBe(true);
    if (!india.ok) return;
    expect(projection(india.spec as Rec).type).toBe('mercator');
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

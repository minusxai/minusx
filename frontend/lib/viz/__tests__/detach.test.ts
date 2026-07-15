import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Feature } from 'geojson';
import { detachRecipe, reattachRecipe, canReattach } from '../detach';
import { GEO_BOUNDARY_DATASET, GEO_ASSETS, assetFeatures } from '../geo-assets';
import { resolveEnvelopeSpec, toVegaSpec, createVegaView, injectNamedAssets } from '../render-vega';
import { validateVizEnvelope } from '../validate';
import type { VizResultColumn } from '../types';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

type Rec = Record<string, unknown>;
const recipeEnvelope = (recipe: string, bindings: Rec, params?: Rec): VizEnvelope => ({
  version: 2,
  source: { kind: 'recipe', recipe, bindings, params: params ?? null, columnFormats: null },
} as unknown as VizEnvelope);

const src = (env: VizEnvelope) => env.source as unknown as Rec;

describe('detachRecipe', () => {
  it('detaches a native-Vega recipe into a kind:"vega" source carrying the materialized spec', () => {
    const env = recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states' });
    const out = detachRecipe(env);
    const s = src(out);
    expect(s.kind).toBe('vega');
    expect(s.grammar).toBe(VIZ_GRAMMAR_VEGA);
    // The frozen spec is the full native-Vega output (has projections + signals).
    expect(Array.isArray((s.spec as Rec).projections)).toBe(true);
    expect(Array.isArray((s.spec as Rec).signals)).toBe(true);
    // The recipe's boundary asset rides along for render-time injection.
    expect(s.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
    // Version + other envelope fields are preserved.
    expect(out.version).toBe(2);
  });

  it('detaches a Vega-Lite recipe into a kind:"vega-lite" source (no assets)', () => {
    const env = recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'value' });
    const out = detachRecipe(env);
    const s = src(out);
    expect(s.kind).toBe('vega-lite');
    expect(s.grammar).toBe(VIZ_GRAMMAR_VEGA_LITE);
    expect(typeof s.spec).toBe('object');
    expect('assets' in s).toBe(false);
  });

  it('carries a non-geo native-Vega recipe with null assets', () => {
    const env = recipeEnvelope('minusx/radar@1', { metric: 'metric', value: 'value' });
    const out = detachRecipe(env);
    const s = src(out);
    expect(s.kind).toBe('vega');
    expect(s.assets).toBeNull();
  });

  it('is a no-op for an already-detached (non-recipe) source', () => {
    const vegaEnv = {
      version: 2,
      source: { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: { marks: [] }, assets: null },
    } as unknown as VizEnvelope;
    expect(detachRecipe(vegaEnv)).toEqual(vegaEnv);
  });

  it('throws when the recipe cannot materialize (missing binding)', () => {
    const env = recipeEnvelope('minusx/point-map@1', { lat: 'lat' }); // no lng
    expect(() => detachRecipe(env)).toThrow(/lng/);
  });

  it('keeps the original recipe as `detachedFrom` provenance for re-attach', () => {
    const original = recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states', zoom: 6 });
    const detached = detachRecipe(original);
    const s = src(detached);
    expect(s.detachedFrom).toEqual((original.source as unknown as Rec)); // the exact recipe source
    expect(canReattach(detached)).toBe(true);
  });

  it('reattachRecipe restores the original recipe source (discarding the custom spec)', () => {
    const original = recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states', zoom: 6 });
    const detached = detachRecipe(original);
    // Simulate a custom edit to the detached spec — reattach must still restore the recipe.
    ((detached.source as unknown as { spec: Rec }).spec as Rec).marks = [];
    const reattached = reattachRecipe(detached);
    expect(reattached).toEqual(original);
  });

  it('canReattach is false for a plain recipe or a spec with no provenance', () => {
    expect(canReattach(recipeEnvelope('minusx/funnel@1', { stage: 's', value: 'v' }))).toBe(false);
    const handAuthored = { version: 2, source: { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: {}, assets: null } } as unknown as VizEnvelope;
    expect(canReattach(handAuthored)).toBe(false);
    expect(reattachRecipe(handAuthored)).toBe(handAuthored); // no-op
  });
});

describe('detached kind:"vega" resolves + renders', () => {
  it('resolveEnvelopeSpec returns engine:"vega" + assets for a detached native map', () => {
    const detached = detachRecipe(recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states' }));
    const resolved = resolveEnvelopeSpec(detached);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.engine).toBe('vega');
    expect(resolved.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'us-states' });
  });

  it('resolveEnvelopeSpec returns engine:"vega-lite" for a detached VL recipe', () => {
    const detached = detachRecipe(recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'value' }));
    const resolved = resolveEnvelopeSpec(detached);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.engine).toBe('vega-lite');
  });

  it('validateVizEnvelope accepts a detached native-Vega source', () => {
    const detached = detachRecipe(recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states' }));
    const columns: VizResultColumn[] = [
      { name: 'lat', kind: 'quantitative' },
      { name: 'lng', kind: 'quantitative' },
    ];
    const result = validateVizEnvelope(detached, columns);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('validateVizEnvelope rejects an external data url in a kind:"vega" spec', () => {
    const bad = {
      version: 2,
      source: { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: { data: [{ name: 'evil', url: 'https://x.com/d.json' }], marks: [] }, assets: null },
    } as unknown as VizEnvelope;
    const result = validateVizEnvelope(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_EXTERNAL_DATA')).toBe(true);
  });

  it('validateVizEnvelope rejects a kind:"vega" source with the wrong grammar', () => {
    const bad = {
      version: 2,
      source: { kind: 'vega', grammar: 'vega@5', spec: { marks: [] }, assets: null },
    } as unknown as VizEnvelope;
    const result = validateVizEnvelope(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'E_ENVELOPE')).toBe(true);
  });

  it('a detached map renders identically (boundary paths present after asset injection)', async () => {
    const usFeatures = assetFeatures(
      'us-states',
      JSON.parse(readFileSync(resolve(process.cwd(), `public/geojson/${GEO_ASSETS['us-states'].file}.json`), 'utf8')),
    ) as Feature[];
    const detached = detachRecipe(recipeEnvelope('minusx/point-map@1', { lat: 'lat', lng: 'lng' }, { mapName: 'us-states' }));
    const resolved = resolveEnvelopeSpec(detached);
    if (!resolved.ok) throw new Error(resolved.error);
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, [{ lat: 37, lng: -122 }], { renderer: 'none', parserConfig, width: 600, height: 400 });
    await injectNamedAssets(view, resolved.assets, async () => usFeatures);
    await view.runAsync();
    const svg = await view.toSVG();
    view.finalize();
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(50); // ~50 backdrop states
  });
});

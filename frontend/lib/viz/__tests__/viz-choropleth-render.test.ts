import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  resolveEnvelopeSpec,
  toVegaSpec,
  createVegaView,
  injectNamedAssets,
} from '../render-vega';
import { GEO_BOUNDARY_DATASET } from '../geo-assets';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

/** Two square regions at valid lon/lat so equalEarth projects them into view. */
const square = (name: string, x: number, y: number): Feature => ({
  type: 'Feature',
  properties: { name },
  geometry: {
    type: 'Polygon',
    coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]],
  },
});

const FAKE_BOUNDARY: Feature[] = [square('Alpha', 0, 0), square('Beta', 20, 20)];
const fakeLoader = async () => FAKE_BOUNDARY;

const choroplethEnvelope: VizEnvelope = {
  version: 2,
  source: {
    kind: 'recipe',
    recipe: 'minusx/choropleth@1',
    bindings: { region: 'region', value: 'val' },
    params: { mapName: 'world' },
    columnFormats: null,
  },
} as unknown as VizEnvelope;

const rows = [
  { region: 'Alpha', val: 5 },
  { region: 'Beta', val: 10 },
];

describe('choropleth render pipeline', () => {
  it('resolveEnvelopeSpec surfaces the recipe assets for injection', () => {
    const resolved = resolveEnvelopeSpec(choroplethEnvelope);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.assets).toEqual({ [GEO_BOUNDARY_DATASET]: 'world' });
  });

  it('injectNamedAssets binds resolved features under the local dataset name', async () => {
    const resolved = resolveEnvelopeSpec(choroplethEnvelope);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig });
    try {
      await injectNamedAssets(view, resolved.assets, fakeLoader);
      await view.runAsync();
      const bound = view.data(GEO_BOUNDARY_DATASET) as unknown[];
      expect(bound).toHaveLength(2);
    } finally {
      view.finalize();
    }
  });

  it('renders both regions as geoshape paths after boundary injection', async () => {
    const resolved = resolveEnvelopeSpec(choroplethEnvelope);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig, width: 400, height: 300 });
    try {
      await injectNamedAssets(view, resolved.assets, fakeLoader);
      await view.runAsync();
      const svg = await view.toSVG();
      // Background outline (2) + colored data regions (2) = 4 geoshape paths.
      const paths = svg.match(/<path/g) ?? [];
      expect(paths.length).toBeGreaterThanOrEqual(4);
    } finally {
      view.finalize();
    }
  });

  it('does not mutate the shared cached feature objects (per-view clone)', async () => {
    const resolved = resolveEnvelopeSpec(choroplethEnvelope);
    if (!resolved.ok) return;
    const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, rows, { renderer: 'none', parserConfig });
    try {
      await injectNamedAssets(view, resolved.assets, fakeLoader);
      await view.runAsync();
      // Vega tags each bound tuple with Symbol(vega_id); the source objects must
      // stay clean so a second view over the same cached features is safe.
      for (const f of FAKE_BOUNDARY) {
        expect(Object.getOwnPropertySymbols(f)).toHaveLength(0);
      }
    } finally {
      view.finalize();
    }
  });
});

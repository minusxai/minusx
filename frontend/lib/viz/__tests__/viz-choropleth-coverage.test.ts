import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Feature } from 'geojson';
import { resolveEnvelopeSpec, toVegaSpec, createVegaView, injectNamedAssets } from '../render-vega';
import { assetFeatures, GEO_ASSETS } from '../geo-assets';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const usFeatures = assetFeatures(
  'us-states',
  JSON.parse(readFileSync(resolve(process.cwd(), `public/geojson/${GEO_ASSETS['us-states'].file}.json`), 'utf8')),
);
const loadUs = async () => usFeatures as Feature[];

const envelope: VizEnvelope = {
  version: 2,
  source: {
    kind: 'recipe',
    recipe: 'minusx/choropleth@1',
    bindings: { region: 'state', value: 'revenue' },
    params: { mapName: 'us-states' },
    columnFormats: null,
  },
} as unknown as VizEnvelope;

// Only 3 of the ~50 states carry data.
const rows = [
  { state: 'California', revenue: 120 },
  { state: 'Texas', revenue: 95 },
  { state: 'New York', revenue: 140 },
];

describe('choropleth region coverage', () => {
  it('renders EVERY boundary region in the background layer, not just data-matched ones', async () => {
    const resolved = resolveEnvelopeSpec(envelope);
    if (!resolved.ok) throw new Error(resolved.error);
    const { vegaSpec } = toVegaSpec(resolved, 'light');
    const view = createVegaView(vegaSpec, rows, { renderer: 'none', width: 600, height: 400 });
    try {
      await injectNamedAssets(view, resolved.assets, loadUs);
      await view.runAsync();
      const svg = await view.toSVG();
      const paths = (svg.match(/<path/g) ?? []).length;
      // Background layer draws every state; the data layer adds 3 more. Territories
      // outside albersUsa (Guam, PR…) project to null and emit no path — so assert a
      // healthy floor (all 50 states + DC render) rather than the raw feature count.
      expect(paths).toBeGreaterThanOrEqual(50);
    } finally {
      view.finalize();
    }
  });
});

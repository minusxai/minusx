import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetFeatures, GEO_ASSETS } from '../geo-assets';

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `public/geojson/${file}.json`), 'utf8'));

describe('geo asset feature extraction', () => {
  it('converts the us-atlas TopoJSON into named state features', () => {
    const features = assetFeatures('us-states', read(GEO_ASSETS['us-states'].file));
    const names = features.map(f => (f.properties as { name: string }).name);
    expect(names).toContain('California');
    expect(names).toContain('Alaska'); // clean antimeridian geometry — no longer excluded
    expect(names).toContain('Hawaii');
    // Every feature carries a name for the choropleth lookup.
    expect(features.every(f => typeof (f.properties as { name?: unknown })?.name === 'string')).toBe(true);
  });

  it('converts the world-atlas TopoJSON into named country features', () => {
    const features = assetFeatures('world', read(GEO_ASSETS['world'].file));
    const names = features.map(f => (f.properties as { name: string }).name);
    expect(features.length).toBeGreaterThan(150);
    expect(names).toContain('Tanzania');
  });

  it('passes GeoJSON assets (India) through untouched', () => {
    const features = assetFeatures('india-states', read(GEO_ASSETS['india-states'].file));
    expect(features.length).toBeGreaterThan(0);
    expect(typeof (features[0].properties as { name?: unknown })?.name).toBe('string');
  });
});

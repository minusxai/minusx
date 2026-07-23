/**
 * Geo boundaries in NO-ORIGIN contexts (Renderer_v2 Phase 2): `loadGeoFeatures` fetches
 * root-relative `/geojson/…` — fine in a browser, unparseable in Node. The server seam
 * (`installFsGeoAssetFetcher`) resolves those paths against `public/` on the filesystem so
 * headless renders (Slack images, scripts) can draw choropleths/point maps instead of
 * silently dropping them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { loadGeoFeatures, setGeoAssetFetcher, resetGeoAssetFetcher } from '@/lib/viz/geo-assets';
import { installFsGeoAssetFetcher } from '@/lib/viz/geo-assets.server';
import { vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import { renderEnvelopeToSvg } from '@/lib/viz/render-vega';
import type { VizSettings } from '@/lib/types';

afterEach(() => { resetGeoAssetFetcher(); });

describe('geo assets headless (fs fetcher)', () => {
  it('loads a boundary set from public/ on the filesystem (no origin, no network)', async () => {
    installFsGeoAssetFetcher();
    const features = await loadGeoFeatures('us-states');
    expect(features.length).toBeGreaterThan(40); // 50 states + DC/territories
    expect(features[0]).toHaveProperty('properties');
  });

  it('renders a full choropleth envelope to SVG headlessly through the production bridge', async () => {
    installFsGeoAssetFetcher();
    const rows = [
      { state: 'California', value: 500 },
      { state: 'Texas', value: 300 },
      { state: 'New York', value: 200 },
    ];
    const env = vizSettingsToEnvelopeStatic(
      { type: 'choropleth', xCols: ['state'], yCols: ['value'] } as VizSettings, 'q',
    );
    const svg = await renderEnvelopeToSvg(env, rows, 'light', { width: 400, height: 300 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<path\b/g) || []).length).toBeGreaterThan(10); // state shapes drawn
  });

  it('setGeoAssetFetcher overrides the loader (and reset restores the default)', async () => {
    let called = '';
    setGeoAssetFetcher(async (p) => { called = p; return { type: 'FeatureCollection', features: [] }; });
    const features = await loadGeoFeatures('india-states');
    expect(called).toBe('/geojson/india-states.json');
    expect(features).toEqual([]);
  });
});

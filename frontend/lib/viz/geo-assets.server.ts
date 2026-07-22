/**
 * Filesystem geo-asset loader for NO-ORIGIN contexts (Renderer_v2 Phase 2): headless server
 * renders (Slack chart images, scripts) can't fetch root-relative `/geojson/…` URLs, so this
 * resolves them against `public/` on disk. Installed at module load by the server image
 * pipeline (`lib/chart/render-viz-image.ts`); idempotent.
 */
import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setGeoAssetFetcher } from './geo-assets';

export function installFsGeoAssetFetcher(): void {
  setGeoAssetFetcher(async (publicPath) => {
    const file = path.join(process.cwd(), 'public', publicPath.replace(/^\//, ''));
    return JSON.parse(await readFile(file, 'utf8'));
  });
}

/**
 * Server-side V2 (Vega/Vega-Lite envelope) chart → JPEG (Viz Arch V2 §21 item 2, the
 * headless path). Envelope → SVG (`renderEnvelopeToSvg`) → PNG (Resvg) → JPEG (Sharp),
 * reusing the exact compositor the ECharts path uses (`composeSvgToJpeg`) so the two
 * families produce byte-compatible output (size, background, logo footer).
 *
 * Node.js only. For the browser path (real street tiles via `view.toCanvas()`), use
 * `VizImageRenderer.client.ts`. Slack/cron/server previews use this.
 */
import 'server-only';

import { composeSvgToJpeg } from './svg-to-jpeg';
import { renderEnvelopeToSvg } from '@/lib/viz/render-vega';
import { installFsGeoAssetFetcher } from '@/lib/viz/geo-assets.server';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

// Headless context: boundary files resolve from public/ on disk (Renderer_v2 Phase 2) — without
// this, geo charts silently drop from server-rendered images.
installFsGeoAssetFetcher();

export interface RenderVizImageOptions {
  width?: number;
  height?: number;
  colorMode?: 'light' | 'dark';
  padding?: boolean;
  logoPath?: string;
}

/**
 * Render a V2 viz envelope to a JPEG buffer. Returns null for DOM-tier sources
 * (table/pivot — not chart-renderable) or when the SVG render fails.
 */
export async function renderVizEnvelopeToJpeg(
  envelope: VizEnvelope,
  rows: Record<string, unknown>[],
  options: RenderVizImageOptions = {},
): Promise<Buffer | null> {
  if (!isEnvelopeImageViz(envelope)) return null;
  const width = options.width ?? 512;
  const height = options.height ?? 256;
  const colorMode = options.colorMode ?? 'dark';

  let svg: string;
  try {
    svg = await renderEnvelopeToSvg(envelope, rows, colorMode, { width, height });
  } catch {
    // A bad spec / unresolvable asset (geo boundary needs the browser loader) — the
    // caller keeps the row data rather than an empty image.
    return null;
  }
  if (!svg) return null;

  return composeSvgToJpeg(svg, { width, height, colorMode, padding: options.padding, logoPath: options.logoPath });
}

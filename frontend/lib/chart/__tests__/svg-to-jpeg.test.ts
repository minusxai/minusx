/**
 * The engine-free SVG→JPEG composer (survivor of the deleted ECharts SSR renderer,
 * Renderer_v2 Phase 2): any SVG string → Resvg rasterize → Sharp JPEG. Feeds the
 * server-side Vega image pipeline (render-viz-image → Slack, benchmark tools).
 */
import { describe, it, expect } from 'vitest';
import { composeSvgToJpeg } from '@/lib/chart/svg-to-jpeg';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="rgb(22,160,133)"/></svg>';

describe('composeSvgToJpeg', () => {
  it('rasterizes an SVG string to a JPEG buffer', async () => {
    const buf = await composeSvgToJpeg(SVG, { width: 120, colorMode: 'light', logoPath: '/dev/null/no-logo' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    // JPEG magic bytes
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
    expect(buf.length).toBeGreaterThan(300);
  });
});

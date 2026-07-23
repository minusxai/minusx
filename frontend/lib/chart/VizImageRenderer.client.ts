/**
 * Client-side V2 (Vega/Vega-Lite envelope) chart image renderer (Viz Arch V2 §21 item 2,
 * the client path). Renders an envelope off-screen through Vega's canvas renderer and
 * hands the PNG to the SHARED `toJpegObjectUrl` encoder — the exact watermark/scale/JPEG
 * path the ECharts client renderer uses, so both families upload identical-looking JPEGs.
 *
 * Rendering through canvas (not SVG) means slippy street TILES are captured for real,
 * matching what the user sees. Browser-only — needs a document + canvas.
 */
import { renderEnvelopeToCanvas } from '@/lib/viz/render-vega';
import { getEnvelopeVizType, isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import { toJpegObjectUrl } from '@/lib/chart/render-chart-client';
import { getChartHeight } from '@/lib/chart/renderable-types';
import { AGENT_IMAGE_PIXEL_RATIO } from '@/lib/screenshot/constants';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export interface RenderEnvelopeImageOptions {
  width: number;
  colorMode: 'light' | 'dark';
  addWatermark?: boolean;
  padding?: boolean;
  logoSrc?: string;
  /** Explicit height; defaults to the same aspect the ECharts renderer picks per viz type. */
  height?: number;
}

/**
 * Render a V2 viz envelope to a JPEG object URL. Returns null for DOM-tier sources
 * (table/pivot), empty data, or a render failure — the caller then skips the image.
 */
export async function renderEnvelopeImageDataUrl(
  envelope: VizEnvelope,
  rows: Record<string, unknown>[],
  options: RenderEnvelopeImageOptions,
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  if (!isEnvelopeImageViz(envelope) || rows.length === 0) return null;

  const width = options.width;
  const height = options.height ?? getChartHeight(getEnvelopeVizType(envelope) ?? 'bar', width);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await renderEnvelopeToCanvas(envelope, rows, options.colorMode, {
      width, height, pixelRatio: AGENT_IMAGE_PIXEL_RATIO,
    });
  } catch {
    return null;
  }

  const png = canvas.toDataURL('image/png');
  return toJpegObjectUrl(png, width, options.addWatermark ?? false, options.colorMode, options.padding ?? false, options.logoSrc);
}

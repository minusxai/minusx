/**
 * Server-side chart rendering to JPEG.
 *
 * Uses ECharts SSR → SVG (via render-chart-svg.ts) then
 * Resvg (font-aware SVG→PNG) + Sharp (JPEG compression + logo footer).
 *
 * Node.js only — not safe for browser bundles.
 * For browser-side rendering, use chart-image-client.ts.
 */
import 'server-only';

import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { renderChartToSvg, BG_COLORS } from './render-chart-svg';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

export type { RenderChartOptions } from './render-chart-svg';
export { renderChartToSvg, RENDERABLE_CHART_TYPES } from './render-chart-svg';

// ── Font-aware SVG → PNG conversion ──────────────────────────────────────────

let fontFilesCache: string[] | null = null;

function getFontFiles(): string[] {
  if (fontFilesCache && fontFilesCache.length > 0) return fontFilesCache;

  const fontsDir = path.join(process.cwd(), 'public/fonts');
  const files = ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Bold.ttf'];
  const resolved: string[] = [];

  for (const file of files) {
    const fontPath = path.join(fontsDir, file);
    if (fs.existsSync(fontPath)) {
      resolved.push(fontPath);
    }
  }

  fontFilesCache = resolved;
  return resolved;
}

function svgToPngBuffer(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: getFontFiles(),
      defaultFontFamily: 'JetBrains Mono',
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a chart to a JPEG buffer (q=85) with logo in the footer.
 *
 * Always includes:
 * - Auto-generated chart title from xCols/yCols
 * - Solid background (dark theme by default)
 * - Logo in bottom-right corner
 * - JetBrains Mono font (embedded, renders correctly in Docker)
 *
 * Returns null for unsupported types (table, pivot) or empty data.
 *
 * Used by: Slack integration, any server-side chart export.
 * For browser-side JPEG upload to S3, use chart-image-client.ts instead.
 */
export async function renderChartToJpeg(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  options: import('./render-chart-svg').RenderChartOptions = {},
): Promise<Buffer | null> {
  const width = options.width ?? 512;
  const height = options.height ?? 256;
  const colorMode = options.colorMode ?? 'dark';

  const defaultLogoFile = colorMode === 'dark' ? 'logox.svg' : 'logox_dark.svg';
  const logoPath = options.logoPath ?? path.join(process.cwd(), 'public', defaultLogoFile);

  const svg = renderChartToSvg(queryResult, vizSettings, options);
  if (!svg) return null;

  const chartPng = svgToPngBuffer(svg);

  const padding = options.padding ?? false;
  const logoSize = 24;
  const footerHeight = 64;  // logo (24) + 20px top + 20px bottom
  const totalHeight = padding ? height + footerHeight : height;
  const bgColor = BG_COLORS[colorMode];

  const layers: sharp.OverlayOptions[] = [
    { input: chartPng, top: 0, left: 0 },
  ];

  if (padding && fs.existsSync(logoPath)) {
    try {
      const logoBuf = await sharp(logoPath).resize(logoSize, logoSize).png().toBuffer();
      layers.push({
        input: logoBuf,
        // Centre vertically in footer strip, right-aligned with 20px from edge
        top: height + Math.floor((footerHeight - logoSize) / 2),
        left: width - 20 - logoSize,
      });
    } catch {
      // Logo load failed — continue without it
    }
  }

  return sharp({
    create: { width, height: totalHeight, channels: 4, background: bgColor },
  })
    .composite(layers)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * @deprecated Use renderChartToJpeg instead.
 * Kept for backward compatibility — callers will be migrated.
 */
export const renderChartToPng = renderChartToJpeg;

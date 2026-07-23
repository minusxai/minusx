/**
 * SVG → JPEG composer for server-side chart images (Resvg rasterize → Sharp encode, with
 * optional padding + logo overlay). Engine-free — the input is ANY SVG string (today: Vega
 * output via lib/chart/render-viz-image). Survivor of the deleted ECharts SSR renderer
 * (Renderer_v2 Phase 2).
 */
import 'server-only';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { AGENT_IMAGE_JPEG_QUALITY, CHART_WATERMARK_PADDING_PX, CHART_WATERMARK_LOGO_SCALE } from '@/lib/screenshot/constants';

const BG_COLORS = {
  dark: '#161b22',
  light: '#ffffff',
}

// eslint-disable-next-line no-restricted-syntax -- process-lifetime font cache
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

export interface ComposeJpegOptions {
  width?: number;
  height?: number;
  colorMode?: 'light' | 'dark';
  padding?: boolean;
  logoPath?: string;
}

/**
 * Composite a rendered chart SVG into the final agent JPEG: Resvg rasterizes the SVG on
 * a solid theme background, Sharp adds the optional padding strips + logo footer, then
 * JPEG-encodes at the shared quality. Grammar-agnostic — the ECharts and Vega paths both
 * feed their SVG here so the two families share one background/logo/quality contract.
 */
export async function composeSvgToJpeg(svg: string, options: ComposeJpegOptions = {}): Promise<Buffer> {
  const width = options.width ?? 512;
  const height = options.height ?? 256;
  const colorMode = options.colorMode ?? 'dark';
  const defaultLogoFile = colorMode === 'dark' ? 'logox.svg' : 'logox_dark.svg';
  const logoPath = options.logoPath ?? path.join(process.cwd(), 'public', defaultLogoFile);

  const chartPng = svgToPngBuffer(svg);

  const usePadding = options.padding ?? false;
  const P = CHART_WATERMARK_PADDING_PX;     // shared with the client renderer (single source)
  const logoSize = Math.round(P * CHART_WATERMARK_LOGO_SCALE); // 28px, fits in P×P with equal gaps
  const topPad    = usePadding ? P : 0;
  const bottomPad = usePadding ? P : 0;
  const totalHeight = topPad + height + bottomPad;
  const bgColor = BG_COLORS[colorMode];

  const layers: sharp.OverlayOptions[] = [
    { input: chartPng, top: topPad, left: 0 },
  ];

  if (usePadding && fs.existsSync(logoPath)) {
    try {
      const logoBuf = await sharp(logoPath).resize(logoSize, logoSize).png().toBuffer();
      const gap = Math.floor((P - logoSize) / 2); // equal gap on all sides within P×P
      layers.push({
        input: logoBuf,
        top: topPad + height + gap,    // centred in bottom P strip
        left: width - gap - logoSize,  // centred in right P zone
      });
    } catch {
      // Logo load failed — continue without it
    }
  }

  return sharp({
    create: { width, height: totalHeight, channels: 4, background: bgColor },
  })
    .composite(layers)
    .jpeg({ quality: Math.round(AGENT_IMAGE_JPEG_QUALITY * 100) })
    .toBuffer();
}

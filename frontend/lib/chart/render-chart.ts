/**
 * Server-side chart rendering.
 *
 * Takes a QueryResult + VizSettings and renders to SVG using ECharts SSR mode.
 * Reuses the same aggregateData() and chart option builders as the
 * client-side chart components.
 *
 * No DOM required — safe for Node.js server contexts.
 */
import * as echarts from 'echarts';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { aggregateData } from './aggregate-data';
import { buildChartOption, buildFunnelChartOption, buildPieChartOption, buildWaterfallChartOption } from './chart-utils';
import { COLOR_PALETTE } from './echarts-theme';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

// Register individual ECharts components for Next.js tree-shaking (SSR).
// In Jest/tsx the full echarts bundle is loaded and these are already included.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax -- dynamic require needed: echarts sub-path exports are ESM-only and break Jest's CJS transform
  const r = require;
  const { SVGRenderer } = r('echarts/renderers');
  const { TitleComponent, LegendComponent, TooltipComponent, GridComponent } = r('echarts/components');
  const { BarChart, LineChart, PieChart, ScatterChart, FunnelChart } = r('echarts/charts');
  echarts.use([SVGRenderer, TitleComponent, LegendComponent, TooltipComponent, GridComponent, BarChart, LineChart, PieChart, ScatterChart, FunnelChart]);
} catch {
  // Full echarts bundle already includes everything — no registration needed
}

// eslint-disable-next-line no-restricted-syntax -- immutable constant set of renderable chart types
const RENDERABLE_TYPES = new Set(['line', 'bar', 'area', 'scatter', 'pie', 'funnel', 'waterfall']);

const BG_COLORS = {
  dark: '#161b22',
  light: '#ffffff',
};

// ── Title generation (mirrors ChartBuilder.tsx logic) ─────────────────────────

function buildChartTitle(xCols: string[], yCols: string[]): string | undefined {
  if (yCols.length === 0 && xCols.length === 0) return undefined;
  const yPart = yCols.join(', ');
  const xPart = xCols.length > 0 ? xCols[0] : '';
  const splitPart = xCols.length > 1 ? xCols.slice(1).join(', ') : '';
  const parts = [yPart, xPart && `vs ${xPart}`, splitPart && `split by ${splitPart}`].filter(Boolean).join(' ');
  return parts || undefined;
}

// ── Chart option builders ────────────────────────────────────────────────────

export interface RenderChartOptions {
  width?: number;
  height?: number;
  colorMode?: 'light' | 'dark';
  /** Path to logo file for footer. Defaults to MinusX logo from public/ */
  logoPath?: string;
}

/**
 * Strip toolbox from an ECharts option (removes download buttons from SSR output).
 */
function stripToolbox(option: echarts.EChartsOption): echarts.EChartsOption {
  const { toolbox: _, ...rest } = option as Record<string, unknown>;
  return rest as echarts.EChartsOption;
}

/**
 * Inject background color and override transparent backgrounds for export.
 */
function forceBackground(option: echarts.EChartsOption, colorMode: 'light' | 'dark'): echarts.EChartsOption {
  return { ...option, backgroundColor: BG_COLORS[colorMode] };
}


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a chart to SVG string server-side.
 *
 * Returns null for unsupported viz types (table, pivot) or empty data.
 */
export function renderChartToSvg(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  options: RenderChartOptions = {},
): string | null {
  const {
    width = 800,
    height = 400,
    colorMode = 'dark',
  } = options;

  const chartType = vizSettings.type;

  if (!RENDERABLE_TYPES.has(chartType)) {
    return null;
  }

  const xCols = vizSettings.xCols ?? [];
  const yCols = vizSettings.yCols ?? [];

  if (yCols.length === 0 || queryResult.rows.length === 0) {
    return null;
  }

  const aggregated = aggregateData(
    queryResult.rows,
    xCols,
    yCols,
    chartType as Parameters<typeof aggregateData>[3],
  );

  if (aggregated.xAxisData.length === 0 && aggregated.series.length === 0) {
    return null;
  }

  // Auto-generate title and axis labels from columns (same logic as ChartBuilder.tsx)
  const chartTitle = buildChartTitle(xCols, yCols);
  const xAxisLabel = xCols.length > 0 ? xCols[0] : undefined;
  const yAxisLabel = yCols.length === 1 ? yCols[0] : yCols.length > 1 ? yCols.join(', ') : undefined;

  let option: echarts.EChartsOption;

  if (chartType === 'pie') {
    option = buildPieChartOption({
      xAxisData: aggregated.xAxisData,
      series: aggregated.series,
      colorMode,
      xAxisColumns: xCols,
      yAxisColumns: yCols,
      chartTitle,
      colorPalette: COLOR_PALETTE,
      columnFormats: vizSettings.columnFormats ?? undefined,
    });
  } else if (chartType === 'funnel') {
    option = buildFunnelChartOption({
      xAxisData: aggregated.xAxisData,
      series: aggregated.series,
      colorMode,
      xAxisColumns: xCols,
      yAxisColumns: yCols,
      chartTitle,
      colorPalette: COLOR_PALETTE,
      columnFormats: vizSettings.columnFormats ?? undefined,
    });
  } else if (chartType === 'waterfall') {
    option = buildWaterfallChartOption({
      xAxisData: aggregated.xAxisData,
      series: aggregated.series,
      colorMode,
      xAxisColumns: xCols,
      yAxisColumns: yCols,
      chartTitle,
      colorPalette: COLOR_PALETTE,
      columnFormats: vizSettings.columnFormats ?? undefined,
    });
  } else {
    option = buildChartOption({
      xAxisData: aggregated.xAxisData,
      series: aggregated.series,
      chartType: chartType as 'line' | 'bar' | 'area' | 'scatter',
      colorMode,
      colorPalette: COLOR_PALETTE,
      containerWidth: width,
      containerHeight: height,
      xAxisColumns: xCols,
      yAxisColumns: yCols,
      xAxisLabel,
      yAxisLabel,
      columnFormats: vizSettings.columnFormats ?? undefined,
      chartTitle,
    });
  }

  option = stripToolbox(option);
  option = forceBackground(option, colorMode);

  const chart = echarts.init(null, null, {
    ssr: true,
    renderer: 'svg',
    width,
    height,
  });

  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();

  return svg;
}

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

function svgToPng(svg: string): Buffer {
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

/**
 * Render a chart to PNG buffer with logo in the footer.
 *
 * Always includes:
 * - Auto-generated chart title from xCols/yCols
 * - Solid background (dark theme by default)
 * - Logo in bottom-right corner
 * - JetBrains Mono font (embedded, renders correctly in Docker)
 *
 * Returns null for unsupported types or empty data.
 */
export async function renderChartToPng(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  options: RenderChartOptions = {},
): Promise<Buffer | null> {
  const width = options.width ?? 800;
  const height = options.height ?? 400;
  const colorMode = options.colorMode ?? 'dark';

  // Default logo: resolve from public/ directory
  const defaultLogoFile = colorMode === 'dark' ? 'logox.svg' : 'logox_dark.svg';
  const logoPath = options.logoPath ?? path.join(process.cwd(), 'public', defaultLogoFile);

  const svg = renderChartToSvg(queryResult, vizSettings, options);
  if (!svg) return null;

  // Use resvg-js for font-aware SVG → PNG
  const chartPng = svgToPng(svg);

  // Compose chart + footer with logo
  const logoSize = 24;
  const footerHeight = 36;
  const totalHeight = height + footerHeight;
  const bgColor = BG_COLORS[colorMode];

  const hasLogo = fs.existsSync(logoPath);

  const layers: sharp.OverlayOptions[] = [
    { input: chartPng, top: 0, left: 0 },
  ];

  if (hasLogo) {
    try {
      const logoBuf = await sharp(logoPath).resize(logoSize, logoSize).png().toBuffer();
      layers.push({
        input: logoBuf,
        top: height + Math.floor((footerHeight - logoSize) / 2),
        left: width - 16 - logoSize,
      });
    } catch {
      // Logo load failed — continue without it
    }
  }

  return sharp({
    create: { width, height: totalHeight, channels: 4, background: bgColor },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Server-side chart rendering.
 *
 * Takes a QueryResult + VizSettings and renders to SVG using ECharts SSR mode.
 * Reuses the same aggregateData(), buildChartOption(), and withMinusXTheme()
 * logic as the client-side chart components.
 *
 * No DOM required — safe for Node.js server contexts.
 */
import * as echarts from 'echarts';
import { SVGRenderer } from 'echarts/renderers';
import { TitleComponent, LegendComponent, TooltipComponent, GridComponent } from 'echarts/components';
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart } from 'echarts/charts';
echarts.use([SVGRenderer, TitleComponent, LegendComponent, TooltipComponent, GridComponent, BarChart, LineChart, PieChart, ScatterChart, FunnelChart] as any);
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { aggregateData } from './aggregate-data';
import { buildChartOption } from './chart-utils';
import { COLOR_PALETTE, withMinusXTheme } from './echarts-theme';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

const RENDERABLE_TYPES = new Set(['line', 'bar', 'area', 'scatter', 'pie', 'funnel']);

const LABEL_COLORS = {
  light: '#0D1117',
  dark: '#E6EDF3',
};

const BG_COLORS = {
  dark: '#161b22',
  light: '#ffffff',
};

// ── Font embedding for SVG ───────────────────────────────────────────────────

let fontCssCache: string | null = null;

function getEmbeddedFontCss(): string {
  if (fontCssCache !== null) return fontCssCache;

  const fontsDir = path.join(process.cwd(), 'public/fonts');
  const faces: string[] = [];

  const weights = [
    { file: 'JetBrainsMono-Regular.ttf', weight: '400' },
    { file: 'JetBrainsMono-Bold.ttf', weight: '700' },
  ];

  for (const { file, weight } of weights) {
    const fontPath = path.join(fontsDir, file);
    try {
      if (fs.existsSync(fontPath)) {
        const data = fs.readFileSync(fontPath).toString('base64');
        faces.push(`@font-face { font-family: 'JetBrains Mono'; font-weight: ${weight}; src: url(data:font/ttf;base64,${data}) format('truetype'); }`);
      }
    } catch {
      // Skip missing font
    }
  }

  fontCssCache = faces.join('\n');
  return fontCssCache;
}

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
 * Build pie chart option — mirrors PiePlot.tsx logic.
 */
function buildPieOption(
  xAxisData: string[],
  series: Array<{ name: string; data: number[] }>,
  colorMode: 'light' | 'dark',
  chartTitle?: string,
): echarts.EChartsOption {
  const pieData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, s) => {
      const val = s.data[index];
      return sum + (typeof val === 'number' && !isNaN(val) ? val : 0);
    }, 0);
    return { name, value };
  });

  const total = pieData.reduce((sum, item) => sum + item.value, 0);

  const coloredData = pieData.map((item, index) => ({
    ...item,
    itemStyle: { color: COLOR_PALETTE[index % COLOR_PALETTE.length] },
  }));

  const baseOption: echarts.EChartsOption = {
    backgroundColor: BG_COLORS[colorMode],
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: true } } : {}),
    tooltip: { trigger: 'item' },
    legend: {
      data: pieData.map(d => d.name),
      top: chartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    series: [{
      name: 'Pie',
      type: 'pie',
      radius: ['30%', '70%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 10,
        borderColor: colorMode === 'dark' ? '#1a1a1a' : '#ffffff',
        borderWidth: 2,
      },
      label: {
        show: true,
        position: 'outside',
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(1);
          return `${params.name}\n${percent}%`;
        },
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        color: colorMode === 'dark' ? '#ffffff' : '#1a1a1a',
      },
      labelLine: { show: true, length: 15, length2: 10 },
      emphasis: {
        label: {
          show: true,
          fontSize: 14,
          fontWeight: 'bold',
          textBorderColor: 'transparent',
          textBorderWidth: 0,
          textShadowColor: 'transparent',
          textShadowBlur: 0,
        },
      },
      data: coloredData,
    }],
  };

  return withMinusXTheme(baseOption, colorMode);
}

/**
 * Build funnel chart option — mirrors FunnelPlot.tsx logic.
 */
function buildFunnelOption(
  xAxisData: string[],
  series: Array<{ name: string; data: number[] }>,
  colorMode: 'light' | 'dark',
  chartTitle?: string,
): echarts.EChartsOption {
  const rawData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, s) => {
      const val = s.data[index];
      return sum + (typeof val === 'number' && !isNaN(val) ? val : 0);
    }, 0);
    return { name, value };
  });

  const baseColor = COLOR_PALETTE[0];
  const funnelData = rawData.map((item) => ({
    ...item,
    itemStyle: { color: baseColor },
  }));

  const maxValue = Math.max(...funnelData.map(d => d.value));
  const topValue = maxValue > 0 ? maxValue : 1;

  const baseOption: echarts.EChartsOption = {
    backgroundColor: BG_COLORS[colorMode],
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: true } } : {}),
    tooltip: { trigger: 'item' },
    legend: {
      data: funnelData.map(d => d.name),
      top: chartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    series: [{
      name: 'Funnel',
      type: 'funnel',
      orient: 'horizontal',
      left: '5%',
      right: '5%',
      top: 60,
      bottom: 20,
      width: '90%',
      height: '70%',
      min: 0,
      max: maxValue,
      minSize: '0%',
      maxSize: '100%',
      sort: 'none',
      gap: 2,
      label: {
        show: true,
        position: 'inside',
        color: LABEL_COLORS[colorMode],
        fontWeight: 'bold',
        backgroundColor: colorMode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
        borderRadius: 4,
        padding: [4, 8],
        formatter: (params: any) => {
          const pct = ((params.value / topValue) * 100).toFixed(1);
          return `${params.name}\n${params.value} (${pct}%)`;
        },
      },
      labelLine: { length: 10, lineStyle: { width: 1 } },
      itemStyle: { borderColor: 'transparent', borderWidth: 1 },
      emphasis: {
        label: { fontSize: 14, color: LABEL_COLORS[colorMode] },
      },
      data: funnelData,
    }],
  };

  return withMinusXTheme(baseOption, colorMode);
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

/**
 * Embed font CSS into an SVG string so text renders correctly in sharp/rsvg.
 */
function embedFontInSvg(svg: string): string {
  const fontCss = getEmbeddedFontCss();
  if (!fontCss) return svg;

  // Inject font-face inside existing <style> or add a new <style> block
  if (svg.includes('<style')) {
    return svg.replace(/<style\s*>/, `<style>\n${fontCss}\n`);
  }
  return svg.replace('</svg>', `<style>${fontCss}</style></svg>`);
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
    option = buildPieOption(aggregated.xAxisData, aggregated.series, colorMode, chartTitle);
  } else if (chartType === 'funnel') {
    option = buildFunnelOption(aggregated.xAxisData, aggregated.series, colorMode, chartTitle);
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
  let svg = chart.renderToSVGString();
  chart.dispose();

  svg = embedFontInSvg(svg);

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

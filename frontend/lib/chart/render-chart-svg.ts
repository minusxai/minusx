/**
 * Portable chart → SVG renderer.
 *
 * Uses ECharts SSR mode (ssr:true, renderer:'svg') — no DOM required.
 * Safe in both Node.js server contexts AND browser (no native deps).
 *
 * For PNG output (server-side with branding), see render-chart.ts.
 * For client-side JPEG upload, see chart-image-client.ts.
 */
import * as echarts from 'echarts';
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
export const RENDERABLE_CHART_TYPES = new Set(['line', 'bar', 'area', 'scatter', 'pie', 'funnel', 'waterfall']);

export const BG_COLORS = {
  dark: '#161b22',
  light: '#ffffff',
};

export interface RenderChartOptions {
  width?: number;
  height?: number;
  colorMode?: 'light' | 'dark';
  /** Path to logo file for footer. Used by server-side renderChartToPng only. */
  logoPath?: string;
}

function buildChartTitle(xCols: string[], yCols: string[]): string | undefined {
  if (yCols.length === 0 && xCols.length === 0) return undefined;
  const yPart = yCols.join(', ');
  const xPart = xCols.length > 0 ? xCols[0] : '';
  const splitPart = xCols.length > 1 ? xCols.slice(1).join(', ') : '';
  const parts = [yPart, xPart && `vs ${xPart}`, splitPart && `split by ${splitPart}`].filter(Boolean).join(' ');
  return parts || undefined;
}

function stripToolbox(option: echarts.EChartsOption): echarts.EChartsOption {
  const { toolbox: _, ...rest } = option as Record<string, unknown>;
  return rest as echarts.EChartsOption;
}

function forceBackground(option: echarts.EChartsOption, colorMode: 'light' | 'dark'): echarts.EChartsOption {
  return { ...option, backgroundColor: BG_COLORS[colorMode] };
}

/**
 * Render a chart to SVG string.
 *
 * Works in both Node.js (server) and browser — no native deps.
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

  if (!RENDERABLE_CHART_TYPES.has(chartType)) {
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

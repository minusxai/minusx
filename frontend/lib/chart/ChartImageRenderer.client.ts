/**
 * Client-side chart image renderer.
 *
 * Renders charts using ECharts canvas (hidden offscreen) — exact same visual
 * output as the live chart shown to the user. Works for line, bar, area,
 * scatter, pie, funnel, waterfall charts.
 *
 * Browser-only — not safe for Node.js/server bundles.
 * For server-side rendering, use ChartImageRenderer.server.ts.
 */
import * as echarts from 'echarts'
import { aggregateData } from '@/lib/chart/aggregate-data'
import {
  buildChartOption,
  buildPieChartOption,
  buildFunnelChartOption,
  buildWaterfallChartOption,
} from '@/lib/chart/chart-utils'
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import { toJpegObjectUrl } from '@/lib/chart/render-chart-client'
import type { IChartImageRenderer, ChartInput, ChartRenderOptions, RenderedChart } from './IChartImageRenderer'
import type { QueryResult } from '@/lib/types'
import type { VizSettings } from '@/lib/types.gen'

function buildEChartsOption(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  colorMode: 'light' | 'dark',
  width: number,
  height: number,
  titleOverride?: string,
): echarts.EChartsOption | null {
  const xCols = vizSettings.xCols ?? []
  const yCols = vizSettings.yCols ?? []
  if (yCols.length === 0 || queryResult.rows.length === 0) return null

  const chartType = vizSettings.type
  const aggregated = aggregateData(
    queryResult.rows,
    xCols,
    yCols,
    chartType as Parameters<typeof aggregateData>[3],
  )
  if (aggregated.xAxisData.length === 0 && aggregated.series.length === 0) return null

  const autoTitle = [
    yCols.join(', '),
    xCols.length > 0 && `vs ${xCols[0]}`,
    xCols.length > 1 && `split by ${xCols.slice(1).join(', ')}`,
  ].filter(Boolean).join(' ') || undefined
  const chartTitle = titleOverride || autoTitle
  const xAxisLabel = xCols.length > 0 ? xCols[0] : undefined
  const yAxisLabel = yCols.length === 1 ? yCols[0] : yCols.length > 1 ? yCols.join(', ') : undefined
  const sharedArgs = {
    xAxisData: aggregated.xAxisData,
    series: aggregated.series,
    colorMode,
    xAxisColumns: xCols,
    yAxisColumns: yCols,
    chartTitle,
    colorPalette: COLOR_PALETTE,
    columnFormats: vizSettings.columnFormats ?? undefined,
  }

  if (chartType === 'pie') return buildPieChartOption(sharedArgs)
  if (chartType === 'funnel') return buildFunnelChartOption(sharedArgs)
  if (chartType === 'waterfall') return buildWaterfallChartOption(sharedArgs)

  return buildChartOption({
    ...sharedArgs,
    chartType: chartType as 'line' | 'bar' | 'area' | 'scatter',
    containerWidth: width,
    containerHeight: height,
    xAxisLabel,
    yAxisLabel,
  })
}

async function renderSingleChartToDataUrl(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  colorMode: 'light' | 'dark',
  width: number,
  height: number,
  titleOverride?: string,
): Promise<string | null> {
  const option = buildEChartsOption(queryResult, vizSettings, colorMode, width, height, titleOverride)
  if (!option) return null

  const container = document.createElement('div')
  container.style.cssText = `width:${width}px;height:${height}px;position:absolute;left:-9999px;top:-9999px;visibility:hidden;`
  document.body.appendChild(container)

  try {
    const bgColor = colorMode === 'dark' ? '#161b22' : '#ffffff'
    const chart = echarts.init(container, null, { renderer: 'canvas', width, height })
    chart.setOption({ ...option, animation: false, backgroundColor: bgColor })
    const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bgColor, excludeComponents: ['toolbox'] })
    chart.dispose()
    return dataUrl
  } finally {
    document.body.removeChild(container)
  }
}

export const clientChartImageRenderer: IChartImageRenderer = {
  async renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]> {
    const { width, colorMode, addWatermark } = options
    const height = Math.round(width * 0.5625) // 16:9
    const results: RenderedChart[] = []

    for (const { queryResult, vizSettings, titleOverride } of inputs) {
      const rawUrl = await renderSingleChartToDataUrl(queryResult, vizSettings, colorMode, width, height, titleOverride)
      if (!rawUrl) continue
      const dataUrl = await toJpegObjectUrl(rawUrl, width, addWatermark, colorMode)
      const label = titleOverride ?? vizSettings.type
      results.push({ label, dataUrl })
    }

    return results
  },
}

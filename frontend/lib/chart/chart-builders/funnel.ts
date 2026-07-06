import type { EChartsOption } from 'echarts'
import { withMinusXTheme } from '../echarts-theme'
import { resolveChartFormats } from '../chart-format'
import {
  tooltipAppendTo,
  buildChartTitleOption,
  buildToolbox,
  type SpecialChartOptionConfig,
} from '../chart-utils'

interface FunnelChartOptionConfig extends SpecialChartOptionConfig {
  orientation?: 'horizontal' | 'vertical'
}

export const buildFunnelChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  containerWidth,
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
  orientation = 'horizontal',
}: FunnelChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  const rawData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
    return { name: fmtName(name), value }
  })

  const baseColor = colorPalette[0]
  const maxValue = Math.max(...rawData.map(d => d.value))
  const topValue = maxValue > 0 ? maxValue : 1
  const n = rawData.length

  // Parse base color to RGB so we can apply per-stage alpha via rgba()
  // This fades the fill without affecting label opacity
  const hex = baseColor.replace('#', '')
  const bR = parseInt(hex.substring(0, 2), 16) || 0
  const bG = parseInt(hex.substring(2, 4), 16) || 0
  const bB = parseInt(hex.substring(4, 6), 16) || 0

  const funnelData = rawData.map((item, i) => {
    const baseAlpha = n > 1 ? 1 - (i / (n - 1)) * 0.5 : 1
    const alpha = styleConfig?.opacity != null ? baseAlpha * styleConfig.opacity : baseAlpha
    return {
      ...item,
      itemStyle: {
        color: `rgba(${bR}, ${bG}, ${bB}, ${alpha})`,
      },
    }
  })

  const labelColor = styleConfig?.dataLabelColor || '#ffffff'

  const baseOption: EChartsOption = {
    ...buildChartTitleOption(chartTitle, showChartTitle ?? true, containerWidth),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'item',
      appendTo: tooltipAppendTo,
      z: 9999,
      confine: false,
      formatter: (params: any) => {
        const { name, value } = params
        const percentOfTop = (value / topValue) * 100
        return `${name}<br/>Value: ${fmtValue(value)}<br/>Percent: ${percentOfTop.toFixed(1)}%`
      },
    },
    legend: { show: false },
    series: [
      {
        name: 'Funnel',
        type: 'funnel',
        orient: orientation,
        ...(orientation === 'horizontal'
          ? { left: '5%', right: '5%', top: chartTitle && showChartTitle ? 35 : 10, bottom: 20, width: '90%', height: '80%' }
          : { left: '10%', top: chartTitle && showChartTitle ? 35 : 10, bottom: 20, width: '80%' }
        ),
        min: 0,
        max: maxValue,
        minSize: '0%',
        maxSize: '100%',
        sort: 'none',
        gap: 2,
        label: {
          show: true,
          position: 'inside',
          color: labelColor,
          fontWeight: 'bold',
          backgroundColor: 'rgba(0,0,0,0.45)',
          borderRadius: 4,
          padding: [4, 8],
          formatter: (params: any) => {
            const pct = ((params.value / topValue) * 100).toFixed(1)
            return `${params.name}\n${fmtValue(params.value)} (${pct}%)`
          },
        },
        labelLine: {
          length: 10,
          lineStyle: {
            width: 1,
          },
        },
        itemStyle: {
          borderColor: 'transparent',
          borderWidth: 1,
        },
        emphasis: {
          label: {
            fontSize: 14,
            color: labelColor,
          },
        },
        data: funnelData,
      },
    ],
  }

  return withMinusXTheme(baseOption, colorMode, colorPalette)
}

import type { EChartsOption } from 'echarts'
import { withMinusXTheme } from '../echarts-theme'
import { resolveChartFormats } from '../chart-format'
import {
  tooltipAppendTo,
  buildChartTitleOption,
  buildToolbox,
  lightenHex,
  type SpecialChartOptionConfig,
} from '../chart-utils'

export const buildPieChartOption = ({
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
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)
  const borderColor = colorMode === 'dark' ? '#1a1a1a' : '#ffffff'
  const labelColor = styleConfig?.dataLabelColor || (colorMode === 'dark' ? '#ffffff' : '#1a1a1a')
  const scaleOpacity = (base: number) => styleConfig?.opacity != null ? base * styleConfig.opacity : base
  const opacityStyle = styleConfig?.opacity != null ? { opacity: scaleOpacity(1) } : {}

  // Inner/summary data: one slice per xAxisData entry, summing all series
  const innerData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
    return { name: fmtName(name), value }
  })

  const total = innerData.reduce((sum, item) => sum + item.value, 0)
  const isNested = series.length > 1

  const coloredInnerData = innerData.map((item, index) => ({
    ...item,
    itemStyle: { color: colorPalette[index % colorPalette.length], ...opacityStyle },
  }))

  // Build series array
  const pieSeries: any[] = []

  if (isNested) {
    // Inner ring: category totals
    pieSeries.push({
      name: 'Inner',
      type: 'pie',
      radius: ['0%', '35%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'inside',
        formatter: (params: any) => params.name,
        fontSize: 11,
        color: labelColor,
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
      },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: coloredInnerData,
    })

    // Outer ring: one slice per (xAxisData entry × series), skip zero-value slices
    const outerData: any[] = []
    xAxisData.forEach((xName, xIdx) => {
      const parentColor = colorPalette[xIdx % colorPalette.length]
      series.forEach((s, sIdx) => {
        const val = s.data[xIdx]
        const value = typeof val === 'number' && !isNaN(val) ? val : 0
        if (value === 0) return
        // Spread lighter shades across series within this parent
        const lightenAmount = 0.15 + (sIdx / Math.max(series.length, 1)) * 0.45
        outerData.push({
          name: `${fmtName(xName)} — ${s.name}`,
          value,
          itemStyle: { color: lightenHex(parentColor, lightenAmount), ...opacityStyle },
        })
      })
    })

    pieSeries.push({
      name: 'Outer',
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(1)
          return `${params.name}\n${percent}%`
        },
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        color: labelColor,
      },
      labelLine: { show: true, length: 15, length2: 10 },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: outerData,
    })
  } else {
    // Single-level pie (existing behavior)
    pieSeries.push({
      name: 'Pie',
      type: 'pie',
      radius: ['30%', '70%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(1)
          return `${params.name}\n${percent}%`
        },
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        color: labelColor,
      },
      labelLine: { show: true, length: 15, length2: 10 },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: coloredInnerData,
    })
  }

  // Legend: show inner categories for nested, all slices for single
  const legendData = innerData.map(d => d.name)

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
        const { name, value, percent } = params
        return `${name}<br/>Value: ${fmtValue(value)}<br/>Percent: ${percent.toFixed(1)}%`
      },
    },
    legend: {
      data: legendData,
      top: chartTitle && showChartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    series: pieSeries,
  }

  return withMinusXTheme(baseOption, colorMode, colorPalette)
}

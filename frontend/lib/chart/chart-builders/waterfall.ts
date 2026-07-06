import type { EChartsOption } from 'echarts'
import { withMinusXTheme } from '../echarts-theme'
import { resolveChartFormats, getNumberScale, formatWithScale, applyPrefixSuffix } from '../chart-format'
import {
  tooltipAppendTo,
  buildChartTitleOption,
  buildToolbox,
  type SpecialChartOptionConfig,
} from '../chart-utils'

export const buildWaterfallChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  containerWidth,
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  xAxisLabel,
  yAxisLabel,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue, yPrefix, ySuffix } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)
  const yScale = getNumberScale(series)
  const xLabel = xAxisLabel || xAxisColumns?.[0]
  const yLabel = yAxisLabel || yAxisColumns?.[0]

  const values = xAxisData.map((_, index) =>
    series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
  )

  const runningTotals: number[] = []
  const bases: number[] = []
  let cumulative = 0
  for (let i = 0; i < values.length; i++) {
    bases.push(values[i] >= 0 ? cumulative : cumulative + values[i])
    cumulative += values[i]
    runningTotals.push(cumulative)
  }

  const totalValue = cumulative
  const allLabels = [...xAxisData.map(fmtName), 'Total']
  const allValues = [...values, totalValue]
  const allRunningTotals = [...runningTotals, totalValue]
  const allBases = [...bases, 0]

  const increaseData = allValues.map((value, index) => (index === allValues.length - 1 ? 0 : value >= 0 ? value : 0))
  const decreaseData = allValues.map((value, index) => (index === allValues.length - 1 ? 0 : value < 0 ? Math.abs(value) : 0))
  const totalData = allValues.map((value, index) => (index === allValues.length - 1 ? value : 0))

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
      trigger: 'axis',
      appendTo: tooltipAppendTo,
      z: 9999,
      confine: false,
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex ?? 0
        const name = allLabels[idx]
        const value = allValues[idx]
        const total = allRunningTotals[idx]
        const isTotal = idx === allLabels.length - 1
        if (isTotal) {
          return `${name}<br/>Total: ${fmtValue(total)}`
        }
        const sign = value >= 0 ? '+' : ''
        return `${name}<br/>Change: ${sign}${fmtValue(value)}<br/>Running Total: ${fmtValue(total)}`
      },
    },
    xAxis: {
      type: 'category',
      data: allLabels,
      name: xLabel,
      axisLabel: {
        hideOverlap: true,
      },
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      ...(() => {
        const formatter = (v: number) => applyPrefixSuffix(formatWithScale(v, yScale), yPrefix, ySuffix)
        const allVals = allValues.filter(isFinite)
        if (allVals.length === 0) return {}
        const maxAbs = Math.max(...allVals.map(Math.abs))
        const sampleVals = [0, maxAbs, -maxAbs, maxAbs / 2].filter(isFinite)
        const maxLen = Math.max(...sampleVals.map(v => formatter(v).length))
        const gap = Math.max(50, maxLen * 7 + 16)
        return { nameGap: gap }
      })(),
      axisLabel: {
        formatter: (value: number) => applyPrefixSuffix(formatWithScale(value, yScale), yPrefix, ySuffix),
      },
    },
    series: [
      {
        name: 'Base',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        data: allBases,
        tooltip: { show: false },
      },
      {
        name: 'Increase',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: colorPalette[0],
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: increaseData,
      },
      {
        name: 'Decrease',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: '#e74c3c',
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: decreaseData,
      },
      {
        name: 'Total',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: colorPalette[1 % colorPalette.length],
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: totalData,
      },
    ],
    legend: { show: false },
  }

  return withMinusXTheme(baseOption, colorMode, colorPalette)
}
